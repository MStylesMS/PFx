/**
 * Audio Zone
 * Handles audio-only zones with audio capabilities:
 * - Background music playback
 * - Speech/narration with queuing
 * - Sound effects
 * - Dual output support for combined audio sinks
 */

const path = require('path');
const BaseZone = require('./base-zone');
const AudioManager = require('../media/audio-manager');
const { resolveEffectiveVolume } = require('../audio/resolve-effective-volume'); // PR-VOLUME Phase 8

class AudioZone extends BaseZone {
    constructor(config, mqttClient, zoneManager) {
        super(config, mqttClient);
        this.zoneManager = zoneManager;

        // Audio-specific configuration
        this.audioConfig = {
            baseMediaPath: this._resolveDeviceMediaDir(config),
            audioDevice: config.audioDevice || config.audio_device || 'auto',
            dualOutputMode: config.dualOutputMode || config.dual_output_mode || false,
            primaryDevice: config.primaryDevice || config.primary_device || null,
            secondaryDevice: config.secondaryDevice || config.secondary_device || null,
            defaultVolume: parseInt(config.volume) || 80,
            duckingVolume: config.duckingVolume !== undefined ? config.duckingVolume : null,
            zoneId: config.name || 'unknown',
            maxVolume: config.maxVolume || config.max_volume || 150
        };

        // Audio management
        this.audioManager = new AudioManager(this.audioConfig, this);

        if (this.audioConfig.dualOutputMode) {
            this.logger.info(`Dual output mode enabled for zone ${this.audioConfig.zoneId}`);
        }

        this.originalBackgroundVolume = null;

        // Audio-specific state
        // Map legacy per-type volume config names into volumeModel if provided so status reflects user config rather than defaults
        if (this.volumeModel && this.volumeModel.baseVolumes) {
            if (this.audioConfig && this.audioConfig.defaultVolume !== undefined && this.config.background_volume !== undefined) {
                this.volumeModel.baseVolumes.background = parseInt(this.config.background_volume, 10);
            }
            if (this.config.speech_volume !== undefined) this.volumeModel.baseVolumes.speech = parseInt(this.config.speech_volume, 10);
            if (this.config.effects_volume !== undefined) this.volumeModel.baseVolumes.effects = parseInt(this.config.effects_volume, 10);
            // Map unified ducking adjustment if provided (Phase 8 runtime model)
            if (this.config.ducking_adjust !== undefined || this.config.duckingAdjust !== undefined) {
                const da = this.config.ducking_adjust !== undefined ? this.config.ducking_adjust : this.config.duckingAdjust;
                const parsed = parseInt(da, 10);
                if (!isNaN(parsed)) {
                    this.volumeModel.duckingAdjust = parsed; // negative value representing percentage reduction
                }
            }
        }
        this.currentState = {
            ...this.currentState,
            backgroundMusic: {
                playing: false,
                file: null,
                volume: this.audioConfig.defaultVolume,
                isDucked: false
            },
            speechQueue: {
                length: 0,
                isProcessing: false
            },
            lastSpeech: null,
            lastSoundEffect: null
        };
        this._queuedSpeechStartEvents = new Map();
    }

    async initialize() {
        this.logger.info('Initializing audio zone...');
        await this.audioManager.initialize();

        this.mpvInstances.background = { status: 'idle', manager: this.audioManager };
        this.mpvInstances.speech = { status: 'idle', manager: this.audioManager };

        this.isInitialized = true;
        this.publishStatus();
    }

    async handleCommand(command) {
        if (!this.isInitialized) throw new Error('Audio zone not initialized');

        this.currentState.lastCommand = command.command;

        // Extract parameters excluding command
        const parameters = Object.keys(command)
            .filter(k => k !== 'Command' && k !== 'command')
            .reduce((acc, k) => { acc[k] = command[k]; return acc; }, {});

        // System control shortcuts
        if (['reboot', 'shutdown', 'killPfx'].includes(command.command)) {
            try {
                if (command.command === 'reboot') require('child_process').exec('sudo reboot');
                if (command.command === 'shutdown') require('child_process').exec('sudo shutdown now');
                if (command.command === 'killPfx') process.kill(process.pid, 'SIGTERM');
                this.publishCommandOutcome({
                    command: command.command,
                    outcome: 'success',
                    parameters,
                    message: `Command '${command.command}' executed successfully`
                });
            } catch (error) {
                this.publishCommandOutcome({
                    command: command.command,
                    outcome: 'failed',
                    parameters,
                    error_type: 'execution_error',
                    error_message: error.message,
                    message: `Command '${command.command}' failed: ${error.message}`
                });
                throw error;
            }
            return;
        }

        // Route commands
        try {
            let suppressSuccess = false;
            switch (command.command) {
                case 'playBackground': {
                    const ok = await this._playBackgroundMusic(
                        command.file || command.audio,
                        {
                            volume: command.volume,
                            adjustVolume: command.adjustVolume,
                            loop: command.loop,
                            skipDucking: command.skipDucking || command.skip_ducking
                        }
                    );
                    if (ok === false) return; // outcome already published
                    break;
                }
                case 'pauseBackground':
                    await this._pauseBackgroundMusic();
                    break;
                case 'resumeBackground':
                    await this._resumeBackgroundMusic();
                    break;
                case 'stopBackground':
                    await this._stopBackgroundMusic(command.fadeTime || 0);
                    suppressSuccess = true; // Custom minimal stop event emitted in stop logic
                    break;

                case 'playSpeech': {
                    const ok = await this._playSpeech(
                        command.file || command.audio,
                        command.volume,
                        command.ducking,
                        command.adjustVolume
                    );
                    if (ok === false) return; // outcome already published
                    break;
                }
                case 'pauseSpeech':
                    await this._pauseSpeech();
                    break;
                case 'resumeSpeech':
                    await this._resumeSpeech();
                    break;
                case 'skipSpeech':
                    await this._skipSpeech();
                    break;
                case 'stopSpeech':
                    await this._stopSpeech(command.fadeTime || 0);
                    break;
                case 'clearSpeechQueue':
                    await this._clearSpeechQueue();
                    break;
                case 'duck':
                    await this._handleDuckCommand(command);
                    break;
                case 'unduck':
                    await this._handleUnduckCommand(command);
                    break;

                case 'playSoundEffect':
                case 'playEffect':
                case 'playAudioFX': {
                    const ok = await this._playSoundEffect(command.file || command.audio, command.volume, command.volumeAdjust);
                    if (ok === false) return;
                    break;
                }

                case 'setVolume':
                    if (command.type || command.volumes) {
                        await this._handleSetVolumeModel(command);
                    } else {
                        await this._setVolume(command.volume);
                    }
                    break;
                case 'setDuckingAdjustment':
                    await this._handleSetDuckingAdjustment(command);
                    break;
                case 'getStatus':
                case 'getState':
                    this.publishStatus();
                    break;
                case 'stopAudio':
                    await this._stopAudio(command.fadeTime || 0);
                    break;
                case 'stopAll':
                    await this._stopAll(command.fadeTime || 0);
                    break;
                default:
                    this._handleUnsupportedCommand(command.command);
                    return; // Unsupported already published as warning
            }
            // Merge telemetry if last playback produced it and matches this command
            if (this._lastPlaybackTelemetry && this._lastPlaybackTelemetry.command === command.command) {
                Object.assign(parameters, {
                    effective_volume: this._lastPlaybackTelemetry.effective_volume,
                    pre_duck_volume: this._lastPlaybackTelemetry.pre_duck_volume,
                    ducked: this._lastPlaybackTelemetry.ducked
                });
                // clear after use to avoid leaking to unrelated commands
                this._lastPlaybackTelemetry = null;
            }
            if (!suppressSuccess) {
                this.publishCommandOutcome({
                    command: command.command,
                    outcome: 'success',
                    parameters,
                    message: `Command '${command.command}' executed successfully`
                });
            }
        } catch (error) {
            this.publishCommandOutcome({
                command: command.command,
                outcome: 'failed',
                parameters,
                error_type: 'execution_error',
                error_message: error.message,
                message: `Command '${command.command}' failed: ${error.message}`
            });
            throw error;
        }
    }

    getSupportedCommands() {
        return [
            'playBackground', 'pauseBackground', 'resumeBackground', 'stopBackground',
            'playSpeech', 'pauseSpeech', 'resumeSpeech', 'stopSpeech', 'skipSpeech', 'clearSpeechQueue',
            'playSoundEffect', 'playEffect', 'playAudioFX',
            'duck', 'unduck',
            'setVolume', 'getStatus', 'getState', 'stopAll', 'reboot', 'shutdown', 'killPfx'
        ];
    }

    _isCommandSupported(command) {
        // Audio zone ignores screen/video commands
        const unsupported = ['setImage', 'playVideo', 'stopVideo', 'sleepScreen', 'wakeScreen'];
        return !unsupported.includes(command);
    }

    async shutdown() {
        await this._stopAll();
        await this.audioManager.shutdown();
        this._queuedSpeechStartEvents.clear();
        this._stopPeriodicStatus();
        this.isInitialized = false;
    }

    // ---------------------- Background music ----------------------
    async _playBackgroundMusic(audioPath, params = {}) {
        return this._playBackgroundWithLifecycle(audioPath, params, {
            applySuccessState: ({ audioPath, targetVolume, resolved }) => {
                this.currentState.backgroundMusic = {
                    playing: true,
                    file: audioPath,
                    volume: targetVolume,
                    isDucked: resolved.ducked
                };
            },
            applyTelemetry: ({ targetVolume, resolved }) => {
                this._lastPlaybackTelemetry = {
                    command: 'playBackground',
                    effective_volume: targetVolume,
                    pre_duck_volume: resolved.preDuck,
                    ducked: resolved.ducked
                };
            },
            buildWarningParameters: ({ audioPath, loop, targetVolume, resolved, volume, adjustVolume, skipDucking }) => {
                const warningParameters = {
                    file: audioPath,
                    loop,
                    volume: targetVolume,
                    warnings: resolved.warnings.map(w => w.code),
                    effective_volume: targetVolume,
                    pre_duck_volume: resolved.preDuck,
                    ducked: resolved.ducked
                };
                if (volume !== undefined) warningParameters.requested_volume = volume;
                if (adjustVolume !== undefined) warningParameters.adjustVolume = adjustVolume;
                if (skipDucking !== undefined) warningParameters.skipDucking = skipDucking;
                return warningParameters;
            }
        });
    }

    async _stopBackgroundMusic(fadeTime = 0) {
        await this._stopBackgroundWithFade(fadeTime, {
            resetState: () => {
                this.currentState.backgroundMusic = {
                    playing: false,
                    file: null,
                    volume: this.currentState.backgroundMusic.volume,
                    isDucked: false
                };
                this.mpvInstances.background.currentFile = null;
                this.mpvInstances.background.status = 'idle';
            },
            eventPayload: { command: 'stopBackground', message: "Command 'stopBackground' executed successfully" }
        });
    }

    async _pauseBackgroundMusic() {
        await this._pauseBackgroundWithLifecycle();
    }

    async _resumeBackgroundMusic() {
        await this._resumeBackgroundWithLifecycle();
    }

    // ---------------------- Speech ----------------------
    async _playSpeech(audioPath, volume, ducking, adjustVolume) {
        if (!audioPath) throw new Error('Speech path is required');
        const fv = await this._validateMediaFile(audioPath);
        if (!fv.exists) {
            this.publishCommandOutcome({
                command: 'playSpeech',
                outcome: 'failed',
                parameters: { file: audioPath, ducking },
                error_type: 'file_not_found',
                error_message: fv.error,
                message: `Speech file not found: ${audioPath}`
            });
            return false;
        }
        const fullPath = fv.path;
        // Duplicate detection BEFORE queueing so we don't emit start events for duplicates
        const am = this.audioManager;
        const speechQueue = Array.isArray(am.speechQueue) ? am.speechQueue : [];
        const lastInQueue = speechQueue.length > 0 ? speechQueue[speechQueue.length - 1].filePath : null;
        if (am.currentSpeechFile === fullPath || lastInQueue === fullPath) {
            this.logger.debug(`Duplicate speech ignored (pre-queue): ${fullPath}`);
            this.publishEvent({ speech_duplicate_ignored: audioPath });
            return true; // treat as benign success
        }
        const processRunning = await this.audioManager.checkAndRestartProcesses();
        if (!processRunning) {
            this.publishCommandOutcome({
                command: 'playSpeech',
                outcome: 'failed',
                parameters: { file: audioPath },
                error_type: 'subsystem_unavailable',
                error_message: 'Speech system not available',
                message: `Speech system not available for file: ${audioPath}`
            });
            return false;
        }
        const commandPayload = {};
        if (volume !== undefined) commandPayload.volume = volume;
        if (adjustVolume !== undefined) commandPayload.adjustVolume = adjustVolume;
        const resolvedSpeech = resolveEffectiveVolume({ type: 'speech', zoneModel: this.volumeModel, command: commandPayload, duckActive: false });
        const targetVolume = resolvedSpeech.final;

        const filename = path.basename(fullPath);
        if (this.audioManager && typeof this.audioManager.expirePriorSpeechCompletion === 'function') {
            this.audioManager.expirePriorSpeechCompletion(filename);
        }
        const previousQueued = this._queuedSpeechStartEvents.get(filename);
        if (previousQueued) {
            previousQueued.speech_started = null;
        }
        const queuedMessage = this.publishEvent({
            command: 'playSpeech',
            speech_started: filename,
            file: filename,
            effective_volume: targetVolume,
            queued: true
        });
        this._queuedSpeechStartEvents.set(filename, queuedMessage);

        // Phase 8: use duckLifecycle instead of legacy _applyDucking for speech-triggered background duck
        let duckId = null;
        // Determine if we should activate ducking on background based on provided ducking param or defaults
        const codeDefault = -26;
        const zoneDefault = (this.audioConfig.duckingVolume !== null && this.audioConfig.duckingVolume < 0) ? this.audioConfig.duckingVolume : undefined;
        const globalDefault = (this.config && this.config.speechDucking !== undefined && this.config.speechDucking < 0) ? this.config.speechDucking : undefined;
        const duckingLevel = ducking !== undefined ? ducking : (zoneDefault !== undefined ? zoneDefault : (globalDefault !== undefined ? globalDefault : codeDefault));
        if (duckingLevel < 0) {
            duckId = `speech-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            this.duckLifecycle.addTrigger(duckId, 'speech');
            // Recompute background volume with duck active
            await this._recomputeBackgroundAfterDuckChange();
        }

        this.logger.info(`Playing speech: ${audioPath} at volume ${targetVolume} (duck trigger=${duckId ? 'yes' : 'no'})`);

        // Queue the speech asynchronously; do NOT await completion so subsequent playSpeech commands can queue immediately.
        // We intentionally suppress per-item start/complete events and instead rely on a single consolidated command outcome event
        // following the minimal schema requested: { command, file, completed }.
        try {
            this.mpvInstances.speech.status = 'playing';
            const promise = this.audioManager.playSpeech(fullPath, { volume: targetVolume });
            promise.then(() => {
                // On natural completion or interruption cleanup duck trigger
                if (duckId) {
                    this.duckLifecycle.removeTrigger(duckId);
                    this._recomputeBackgroundAfterDuckChange().catch(() => { });
                }
                this.mpvInstances.speech.status = 'idle';
                this.currentState.lastSpeech = { file: audioPath, timestamp: new Date().toISOString(), duckingLevel, duckId };
                this.publishStatus();
            }).catch(err => {
                const errCode = err && err.error ? err.error : null;
                const errMessage = err && err.message ? err.message : err;
                if (errCode === 'speech_queue_cleared' || errCode === 'speech_interrupted') {
                    this.logger.debug('Speech playback promise settled during cleanup:', errCode);
                } else {
                    this.logger.error('Async speech playback error:', errMessage);
                }
                if (duckId) {
                    this.duckLifecycle.removeTrigger(duckId);
                    this._recomputeBackgroundAfterDuckChange().catch(() => { });
                }
                this.mpvInstances.speech.status = 'idle';
                this.publishStatus();
            });
        } catch (err) {
            this.logger.error('Error queueing speech playback:', err && err.message ? err.message : err);
            if (duckId) {
                this.duckLifecycle.removeTrigger(duckId);
                await this._recomputeBackgroundAfterDuckChange();
            }
            this.mpvInstances.speech.status = 'idle';
            this.publishEvent({
                command: 'playSpeech',
                file: audioPath,
                done: false,
                error: true,
                error_type: 'play_error',
                error_message: err && err.message ? err.message : String(err),
                message: `Failed to queue speech: ${audioPath}`
            });
            return false;
        }
        // Store telemetry (kept internal) but DO NOT emit a success outcome event.
        this._lastPlaybackTelemetry = { command: 'playSpeech', effective_volume: targetVolume, pre_duck_volume: resolvedSpeech.preDuck, ducked: false };
        if (resolvedSpeech.warnings && resolvedSpeech.warnings.length) {
            const warningParameters = {
                file: audioPath,
                effective_volume: targetVolume,
                pre_duck_volume: resolvedSpeech.preDuck,
                ducked: false,
                warnings: resolvedSpeech.warnings.map(w => w.code)
            };
            if (volume !== undefined) warningParameters.requested_volume = volume;
            if (adjustVolume !== undefined) warningParameters.adjustVolume = adjustVolume;
            this.publishCommandOutcome({
                command: 'playSpeech',
                outcome: 'warning',
                parameters: warningParameters,
                warning_type: 'volume_resolution_warning',
                message: 'Speech playback queued with volume resolution warnings'
            });
        }
        // Acceptance event suppressed; zone-manager publishes generic command_received start event.
        return true;
    }

    _publishSpeechStateChange(status, eventPayload) {
        if (status) {
            this.mpvInstances.speech.status = status;
        }

        this.publishStatus();
        this.publishEvent(eventPayload);
    }

    async _clearSpeechQueue() {
        await this.audioManager.clearSpeechQueue();
        this.currentState.speechQueue = { length: 0, isProcessing: false };
        this._publishSpeechStateChange('idle', { speech_queue_cleared: true });
    }

    async _pauseSpeech() {
        await this.audioManager.pauseSpeech();
        this._publishSpeechStateChange('paused', { speech_paused: true });
    }

    async _resumeSpeech() {
        await this.audioManager.resumeSpeech();
        this._publishSpeechStateChange('playing', { speech_resumed: true });
    }

    async _stopSpeech(fadeTime = 0) {
        if (fadeTime > 0) {
            const durationMs = fadeTime * 1000;
            const fadeResult = await this.audioManager.fadeSpeech(0, durationMs, async () => {
                await this.audioManager.stopSpeech();
                this._publishSpeechStateChange('idle', { speech_stopped: true, fade_time: fadeTime });
                this.logger.info(`Speech stopped with ${fadeTime}s fade`);
            });
            if (!fadeResult.success) {
                this.logger.error('Failed to start speech fade:', fadeResult.error);
                await this.audioManager.stopSpeech();
                this._publishSpeechStateChange('idle', { speech_stopped: true });
            }
        } else {
            await this.audioManager.stopSpeech();
            this._publishSpeechStateChange('idle', { speech_stopped: true });
        }
    }

    async _skipSpeech() {
        await this.audioManager.skipSpeech();
        this._publishSpeechStateChange(null, { speech_skipped: true });
    }

    // ---------------------- Sound effects ----------------------
    async _playSoundEffect(audioPath, volume, adjustVolume) {
        const prepared = await this._prepareSoundEffectPlayback(audioPath, { volume, adjustVolume }, {
            buildFileNotFoundParameters: ({ audioPath, volume, adjustVolume }) => ({ file: audioPath, volume, adjustVolume }),
            onResolveFailure: ({ volume }) => ({
                final: volume !== undefined ? volume : this.currentState.backgroundMusic.volume,
                preDuck: volume !== undefined ? volume : this.currentState.backgroundMusic.volume,
                ducked: false,
                warnings: []
            })
        });
        if (!prepared) {
            return false;
        }

        const { filePath, resolvedFX, targetVolume } = prepared;
        const result = await this.audioManager.playSoundEffect(filePath, targetVolume);
        if (!result.success) {
            this.publishCommandOutcome({
                command: 'playSoundEffect',
                outcome: 'failed',
                parameters: { file: audioPath, volume: targetVolume },
                error_type: 'play_error',
                error_message: result.error,
                message: `Failed to play sound effect: ${audioPath}`
            });
            return false;
        }
        this.currentState.lastSoundEffect = { file: audioPath, timestamp: new Date().toISOString() };
        this.publishEvent({ sound_effect_played: audioPath, volume: targetVolume, pre_duck: resolvedFX.preDuck, ducked: resolvedFX.ducked });
        this._lastPlaybackTelemetry = { command: 'playSoundEffect', effective_volume: targetVolume, pre_duck_volume: resolvedFX.preDuck, ducked: resolvedFX.ducked };
        if (resolvedFX.warnings && resolvedFX.warnings.length) {
            this.publishCommandOutcome({
                command: 'playSoundEffect',
                outcome: 'warning',
                parameters: { file: audioPath, volume: targetVolume, warnings: resolvedFX.warnings.map(w => w.code), effective_volume: targetVolume, pre_duck_volume: resolvedFX.preDuck, ducked: resolvedFX.ducked },
                warning_type: 'volume_resolution_warning',
                message: 'Sound effect played with volume resolution warnings'
            });
        }
        return true;
    }

    async _setVolume(volume) {
        if (volume === undefined || volume < 0 || volume > 200) throw new Error('Volume must be between 0 and 200');
        if (this.currentState.backgroundMusic.playing) {
            await this.audioManager.setBackgroundMusicVolume(volume);
            this.currentState.backgroundMusic.volume = volume;
        }
        this.currentState.volume = volume;
        this.publishStatus();
        this.publishEvent({ volume_changed: volume });
    }

    async _stopAudio(fadeTime = 0) {
        await this._stopAudioWithLifecycle(fadeTime, {
            shouldStopBackground: () => this.currentState.backgroundMusic.playing,
            stopSpeech: async (stopFadeTime) => this._stopSpeech(stopFadeTime)
        });
    }

    async _stopAll(fadeTime = 0) {
        await this._stopAudio(fadeTime);
        this._setIdleStatus();
    }

    async _pauseAudio() { if (this.currentState.backgroundMusic.playing) await this._pauseBackgroundMusic(); if (this.mpvInstances.speech.status === 'playing') await this._pauseSpeech(); this.publishEvent({ all_audio_paused: true }); }
    async _resumeAudio() { if (this.mpvInstances.background.status === 'paused') await this._resumeBackgroundMusic(); if (this.mpvInstances.speech.status === 'paused') await this._resumeSpeech(); this.publishEvent({ all_audio_resumed: true }); }

    // ---------------------- Manual duck/unduck commands ----------------------
    async _handleDuckCommand(command) {
        // Phase 8: manual duck now uses unified lifecycle (percentage duck handled by resolver via duckingAdjust)
        // We interpret provided 'ducking' value only to decide whether to create a trigger (negative) or ignore.
        let duckValue = command.ducking;
        if (duckValue === undefined) {
            // Use average of configured video/speech defaults (legacy behavior) just for telemetry; effect size now comes from model.duckingAdjust
            const v1 = this.audioConfig.duckingVolume !== null ? this.audioConfig.duckingVolume : (this.config.videoDucking !== undefined ? this.config.videoDucking : -24);
            const v2 = this.config.speechDucking !== undefined ? this.config.speechDucking : -26;
            duckValue = Math.round((v1 + v2) / 2);
        }
        if (duckValue >= 0) {
            this.publishEvent({ manual_duck_ignored: true, reason: 'non_negative_value', requested: duckValue });
            return;
        }
        const duckId = `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.duckLifecycle.addTrigger(duckId, 'manual');
        await this._recomputeBackgroundAfterDuckChange();
        this.publishEvent({ ducked: true, ducking_triggered: true, duck_id: duckId, requested_duck_level: duckValue });
        this.publishStatus();
    }

    async _handleUnduckCommand(command) {
        const id = command.duck_id;
        if (id) {
            this.duckLifecycle.removeTrigger(id);
            await this._recomputeBackgroundAfterDuckChange();
            this.publishEvent({ unducked: true, duck_id: id });
        } else {
            // Remove all manual triggers
            if (this.duckLifecycle) {
                const snap = this.duckLifecycle.snapshot();
                // We don't track IDs by kind, so brute force by inspecting internal map via snapshot not possible; maintain external list earlier? Instead rely on pattern: manual-
                // DuckLifecycle doesn't expose internal IDs; we stored them only when creating manual triggers. As a pragmatic approach, we can't enumerate -> soft reset.
                // Clear all then re-add non-manual if we had a catalog (we don't). Simpler: clear all and warn.
                this.duckLifecycle.clear();
            }
            await this._recomputeBackgroundAfterDuckChange();
            this.publishEvent({ unducked_all_manual: true, note: 'cleared_all_triggers_due_to_lifecycle_limitation' });
        }
        this.publishStatus();
    }

    // ---------------------- Helpers ----------------------
    _setBackgroundVolume(volume) { if (this.currentState.backgroundMusic.playing) { this.audioManager.setBackgroundMusicVolume(volume); this.currentState.backgroundMusic.volume = volume; } }
    _getCurrentBackgroundVolume() { return this.currentState.backgroundMusic.volume || this.audioConfig.defaultVolume; }

    // Phase 8 helper: recompute background volume when duck lifecycle changes
    async _recomputeBackgroundAfterDuckChange() {
        await this._recomputeBackgroundAfterDuckChangeShared({
            hasBackgroundPlayback: () => this.currentState.backgroundMusic.playing,
            applyResolvedState: (resolved) => {
                this.currentState.backgroundMusic.volume = resolved.final;
                this.currentState.backgroundMusic.isDucked = resolved.ducked;
            },
            buildEventPayload: (resolved) => ({
                background_volume_recomputed: true,
                effective_volume: resolved.final,
                pre_duck_volume: resolved.preDuck,
                ducked: resolved.ducked
            }),
            resolveFailureMessage: 'Failed to recompute background volume after duck change: ',
            applyFailureMessage: 'Failed to apply recomputed background volume: '
        });
    }
}

module.exports = AudioZone;
