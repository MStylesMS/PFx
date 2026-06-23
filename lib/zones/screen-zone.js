/**
 * Screen Zone
 * 
 * Handles screen zones with full multimedia capabilities:
 * - Image display
 * - Video playback  
 * - Audio playback (background music, speech, sound effects)
 * - Screen power management
 */

const BaseZone = require('./base-zone');
const ScreenZoneBrowserController = require('./screen-zone-browser-controller');
const ScreenZonePlaybackController = require('./screen-zone-playback-controller');
const ScreenZoneVideoQueueController = require('./screen-zone-video-queue-controller');
const MediaPlayerFactory = require('../media/media-player-factory');
const ScreenPowerManager = require('../utils/screen-power-manager');
const AudioManager = require('../media/audio-manager');
const WindowManager = require('../utils/window-manager');
const { applyScreenResolution } = require('../utils/screen-resolution-helper');
const { resolveEffectiveVolume } = require('../audio/resolve-effective-volume'); // PR-VOLUME Phase 8

class ScreenZone extends BaseZone {
    constructor(config, mqttClient, zoneManager) {
        super(config, mqttClient);
        this.zoneManager = zoneManager; // The main ZoneManager

        // Screen-specific configuration
        this.display = config.display || ':0';
        this.targetMonitor = config.targetMonitor || 0;
        this.defaultImage = config.defaultImage || config.default_image || 'default.png';

        // Media playback management
        this.mediaPlayerFactory = new MediaPlayerFactory(config);
        this.mpvZoneManager = null; // MPV Zone Manager for images/video

        // Resolve media directory once for consistent path handling
        const resolvedMediaDir = this._resolveDeviceMediaDir(config);

        // Audio management for background music, speech, and effects
        this.audioManager = new AudioManager({
            baseMediaPath: resolvedMediaDir,
            audioDevice: config.audioDevice || 'auto',
            defaultVolume: parseInt(config.volume) || 80,
            duckingVolume: config.duckingVolume,
            zoneId: config.name || 'unknown'  // Add zone-specific identifier
        }, this);

        // Screen power management
        this.screenPowerManager = new ScreenPowerManager(this.display);

        // Window management for browser switching
        this.windowManager = new WindowManager(this.display);

        // Browser management
        this.browserManager = {
            process: null,
            windowId: null,
            url: null,
            enabled: false,
            keepAlive: false,
            profilePath: `/tmp/pfx-browser-${config.name}`,
            className: 'ParadoxBrowser'
        };
        this.browserController = new ScreenZoneBrowserController(this);
        this.playbackController = new ScreenZonePlaybackController(this);
        this.videoQueueController = new ScreenZoneVideoQueueController(this);

        // Browser monitoring
        this._browserMonitorInterval = null;

        // Zone configuration for MPV manager
        this.zoneConfig = {
            name: config.name,
            mediaDir: resolvedMediaDir,
            audioDevice: config.audioDevice,
            display: this.display,
            targetMonitor: this.targetMonitor,
            videoQueueMax: config.videoQueueMax || 5,
            mpvVideoOptions: config.mpvVideoOptions,
            mpvVideoProfile: config.mpvVideoProfile,
            maxVolume: config.maxVolume || config.max_volume
        };

        // Screen-specific state
        this.currentState = {
            ...this.currentState,
            currentImage: null,
            currentVideo: null,
            backgroundMusic: null,
            videoQueueLength: 0,
            audioQueueLength: 0,
            speechQueueLength: 0,
            screenAwake: true,
            zoneVolume: 80, // Default zone master volume
            focus: 'mpv',  // 'mpv' | 'chromium' | 'none'
            content: null, // current file/url being displayed
            browser: {
                enabled: false,
                url: null,
                process_id: null,
                window_id: null
            }
        };

        // Smart media handling state
        this.videoQueue = [];
        this.isProcessingVideoQueue = false;
        this._videoEofTimer = null;

        // Smart media handling state
        this.smartMediaState = {
            lastCommand: null,           // 'setImage' or 'playVideo'
            lastMediaPath: null,         // The last media file path
            currentLoadedPath: null,     // Currently loaded in MPV
            isVideoPaused: false         // Whether video is paused on first frame
        };

        // Video looping state
        this.loopState = {
            isLooping: false,            // Is current video in loop mode?
            loopStartedAt: null,         // When did loop start (ms timestamp)
            loopIterations: 0,           // How many complete loops so far
            currentVideoFile: null,      // File path being looped
            isRestarting: false          // Is a loop restart currently in progress?
        };

        // EOF detection state
        this._videoEofCache = new Map();           // cache durations
        this._videoEofTimeout = null;              // duration-based timer
        this._observerId = null;                   // playback-time observer ID
        this._lastPlaybackTime = 0;                // last observed playback-time
        this._stallCount = 0;                      // consecutive stalled ticks
        this._pausedAt = null;                     // timestamp when video was paused
        this._videoStartedAt = null;               // timestamp when video started playing
        this._originalDuration = null;             // original video duration for resume calculations


        // initialize our queue state

        // Phase 5: map initial configured per-type volumes into volumeModel baseVolumes so flattened status reflects user configuration.
        if (this.volumeModel && this.volumeModel.baseVolumes) {
            if (this.config.background_volume !== undefined) this.volumeModel.baseVolumes.background = parseInt(this.config.background_volume, 10);
            if (this.config.speech_volume !== undefined) this.volumeModel.baseVolumes.speech = parseInt(this.config.speech_volume, 10);
            if (this.config.effects_volume !== undefined) this.volumeModel.baseVolumes.effects = parseInt(this.config.effects_volume, 10);
            // Always map video_volume for screen zones (create field if missing)
            if (this.config.video_volume !== undefined) this.volumeModel.baseVolumes.video = parseInt(this.config.video_volume, 10);
            // Provide a default video base volume if still undefined (align with background for initial consistency)
            if (this.volumeModel.baseVolumes.video === undefined) {
                this.volumeModel.baseVolumes.video = this.volumeModel.baseVolumes.background;
            }
        }
    }

    async initialize() {
        this.logger.info(`Initializing screen zone on display ${this.display}`);

        try {
            // Initialize screen power management
            await this.screenPowerManager.disableScreenBlanking();
            await this.screenPowerManager.checkDpmsSupport();

            // Attempt to apply configured screen resolution before launching media players.
            try {
                await applyScreenResolution({
                    display: this.display,
                    outputName: this.config.outputName,
                    targetMonitor: this.targetMonitor,
                    resolutionMode: this.config.resolutionMode,
                    resolutionFallback: this.config.resolutionFallback,
                    logger: this.logger
                });
            } catch (error) {
                this.logger.warn(`Screen resolution helper failed: ${error.message}`);
            }

            // Initialize MPV Zone Manager for images/video
            this.mpvZoneManager = await this.mediaPlayerFactory.createZoneManager(this.zoneConfig);
            this.mpvInstances.media = {
                status: 'idle',
                manager: this.mpvZoneManager
            };

            // Wire MPV resilience events to zone-level publishCommandOutcome / events
            this.mpvZoneManager.on('mpv_exited', (info) => {
                if (info.intentional) return; // deliberate shutdown — not a warning
                this.publishCommandOutcome({
                    command: 'internal:mpv',
                    outcome: 'warning',
                    parameters: { event: 'mpv_exited', code: info.code, signal: info.signal, attempts: info.attempts },
                    warning_type: 'mpv_exited',
                    message: `MPV process exited unexpectedly (code=${info.code}, signal=${info.signal}).`
                });
            });
            this.mpvZoneManager.on('mpv_restarting', (info) => {
                this.publishMessage('events', {
                    command: 'internal:mpv',
                    outcome: 'warning',
                    restarting: true,
                    attempt: info.attempt,
                    delay_ms: info.delay,
                    code: info.code,
                    signal: info.signal,
                    message: `Attempting MPV restart (attempt ${info.attempt}) in ${info.delay}ms`
                });
            });
            this.mpvZoneManager.on('mpv_restarted', (info) => {
                this.publishCommandOutcome({
                    command: 'internal:mpv',
                    outcome: 'success',
                    parameters: { event: 'mpv_restarted', attempt: info.attempt, socket: info.socket },
                    message: `MPV restarted successfully on attempt ${info.attempt}`
                });
            });
            this.mpvZoneManager.on('mpv_restart_failed', (info) => {
                this.publishCommandOutcome({
                    command: 'internal:mpv',
                    outcome: 'failed',
                    parameters: { event: 'mpv_restart_failed', attempt: info.attempt, max: info.max },
                    error_type: 'mpv_restart_failed',
                    error_message: info.error || 'MPV restart failed',
                    message: `MPV restart failed after ${info.attempt}/${info.max} attempts`
                });
            });

            // Initialize audio system
            await this.audioManager.initialize();
            this.mpvInstances.background = {
                status: 'idle',
                manager: this.audioManager
            };
            this.mpvInstances.speech = {
                status: 'idle',
                manager: this.audioManager
            };

            // BUGFIX: Give MPV zone manager extra time to be fully ready for IPC commands
            // The zone manager initialization includes a 500ms delay, but we need to ensure
            // the IPC connection is completely stable before loading default media
            this.logger.debug('Waiting for MPV zone manager to be fully ready...');
            await new Promise(resolve => setTimeout(resolve, 250));

            // NOTE: DO NOT enable native MPV 'end-file' event handler here!
            // MPV's native end-file events are unreliable due to 'keep alive' and other MPV settings.
            // They fire immediately instead of when video actually ends, breaking the queue system.
            // Use only the duration-based EOF detection in _setupVideoEof() method.
            // this.mpvZoneManager.on('end-file', () => this._handleMediaEnd()); // DISABLED - DO NOT RE-ENABLE

            // Display default image on startup
            await this._setDefaultImage();

            // Auto-enable browser if browser_url is configured in the INI
            if (this.config.browserUrl) {
                try {
                    this.logger.info(`Auto-enabling browser at ${this.config.browserUrl} (hidden behind MPV)`);
                    await this._enableBrowser(this.config.browserUrl);
                } catch (err) {
                    this.logger.warn(`Browser auto-enable failed: ${err.message}`);
                }
            }

            // Publish initial status
            this.publishStatus();

            // Start periodic status publishing (every 10 seconds)
            this._startPeriodicStatus();

            this.isInitialized = true;
            this.logger.info('Screen zone initialized successfully');

        } catch (error) {
            this.logger.error('Screen zone initialization failed:', error);
            this.publishError('Zone initialization failed', { error: error.message });
            throw error;
        }
    }

    async handleCommand(command) {
        // Normalize command field: support both 'Command' and 'command' keys
        command.command = command.command || command.Command;

        if (!this.isInitialized) {
            throw new Error('Screen zone not initialized');
        }

        this.currentState.lastCommand = command.command;
        this.logger.debug(`Handling command: ${command.command}`);

        // Check if command is supported
        if (!this._isCommandSupported(command.command)) {
            this._handleUnsupportedCommand(command.command);
            return;
        }

        // Capture parameters excluding the command field for event payload
        const parameters = Object.keys(command)
            .filter(k => k !== 'Command' && k !== 'command')
            .reduce((acc, k) => { acc[k] = command[k]; return acc; }, {});

        try {
            switch (command.command) {
                // Queue inspection commands
                case 'videoQueue':
                    await this._videoQueue();
                    break;
                case 'speechQueue':
                    await this._speechQueue();
                    break;
                // System control commands
                case 'sleepScreen':
                    await this._sleepScreen();
                    break;
                case 'wakeScreen':
                    await this._wakeScreen();
                    break;
                case 'reboot': {
                    const { exec } = require('child_process');
                    exec('sudo reboot', (err) => { if (err) this.logger.error('Reboot failed', err); });
                    break;
                }
                case 'shutdown': {
                    const { exec } = require('child_process');
                    exec('sudo shutdown now', (err) => { if (err) this.logger.error('Shutdown failed', err); });
                    break;
                }
                case 'killPfx':
                    process.kill(process.pid, 'SIGTERM');
                    break;
                // Image commands
                case 'setImage':
                    await this._enqueueVideoCommand(command);
                    break;

                // Video commands
                case 'playVideo':
                    await this._enqueueVideoCommand(command);
                    break;
                case 'stopVideo':
                    await this._stopVideo(command.fadeTime || 0);
                    break;

                // Audio commands
                case 'playAudio':
                    await this._playAudio(command.file, { adjustVolume: command.adjustVolume, channel: command.channel, volume: command.volume });
                    break;
                case 'playBackground':
                    await this._playBackgroundMusic(command.file, {
                        volume: command.volume,
                        adjustVolume: command.adjustVolume,
                        loop: command.loop,
                        skipDucking: command.skipDucking || command.skip_ducking
                    });
                    break;
                case 'pauseBackground':
                    await this._pauseBackgroundMusic();
                    break;
                case 'resumeBackground':
                    await this._resumeBackgroundMusic();
                    break;
                case 'stopBackground':
                    await this._stopBackgroundMusic(command.fadeTime || 0);
                    break;
                case 'playSpeech': {
                    // Updated minimal speech model: no per-item speech_started or separate success outcome.
                    await this._playSpeech(command.file, command.volume, command.ducking, { adjustVolume: command.adjustVolume });
                    break;
                }
                case 'pauseSpeech':
                    await this.audioManager.pauseSpeech();
                    break;
                case 'resumeSpeech':
                    await this.audioManager.resumeSpeech();
                    break;
                case 'skipSpeech':
                    await this.audioManager.skipSpeech();
                    break;
                case 'playAudioFX':
                case 'playSoundEffect':
                    await this._playSoundEffect(command.file, { volume: command.volume, adjustVolume: command.adjustVolume });
                    break;
                case 'duck':
                    await this._handleDuckCommand(command);
                    break;
                case 'unduck':
                    await this._handleUnduckCommand(command);
                    break;
                case 'stopAudio':
                    await this._stopAudio(command.fadeTime || 0);
                    break;
                case 'stopSpeech':
                    await this._stopSpeech(command.fadeTime || 0);
                    break;

                // Screen power management
                case 'sleepScreen':
                    await this._sleepScreen();
                    break;
                case 'wakeScreen':
                    await this._wakeScreen();
                    break;
                case 'recoverScreens':
                    await this._recoverScreens();
                    break;

                // Volume control
                case 'setVolume':
                    // Phase 4 extension: support either legacy single numeric volume (legacy behavior) OR
                    // new model mutation when 'type' or 'volumes' present.
                    if (command.type || command.volumes) {
                        await this._handleSetVolumeModel(command);
                    } else {
                        await this._setVolume(command.volume); // legacy single master volume (kept for backward compat)
                    }
                    break;
                case 'setDuckingAdjustment':
                    await this._handleSetDuckingAdjustment(command);
                    break;

                // Stop commands
                case 'stopAll':
                    await this._stopAll(command.fadeTime || 0);
                    break;
                case 'pauseAll':
                    await this._pauseAll();
                    break;
                case 'resumeAll':
                    await this._resumeAll();
                    break;

                // Browser/Clock commands — removed operator commands emit warnings
                case 'enableBrowser':
                case 'disableBrowser':
                case 'verifyBrowser':
                    this._warnRemovedBrowserCommand(command.command);
                    return;
                case 'moveBrowser':
                    this._warnMoveBrowserNotSupported();
                    return;
                case 'showBrowser':
                    await this._showBrowser();
                    break;
                case 'hideBrowser':
                    await this._hideBrowser();
                    break;
                case 'setBrowserUrl':
                    await this._setBrowserUrl(command.url);
                    break;
                case 'setBrowserKeepAlive':
                    await this._setBrowserKeepAlive(command.enabled);
                    break;
                case 'setZoneVolume':
                    await this._setZoneVolume(command.volume);
                    break;
                case 'restartPfx':
                    await this._restartPfx();
                    break;
                case 'getState':
                case 'getStatus':
                    this.publishStatus();
                    break;

                default:
                    throw new Error(`Unknown command: ${command.command}`);
            }
            // Suppress success outcome for playBackground (start event already emitted) and stopBackground (custom minimal event emitted)
            if (!['playSpeech', 'playBackground', 'stopBackground', 'playVideo'].includes(command.command)) {
                this.publishCommandOutcome({
                    command: command.command,
                    outcome: 'success',
                    parameters,
                    message: `Command '${command.command}' executed successfully`
                });
            }

        } catch (error) {
            this.logger.error(`Command failed: ${command.command}`, error);
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
            'setImage',
            'playVideo', 'stopVideo',
            'videoQueue',
            'playAudio', 'playBackground', 'pauseBackground', 'resumeBackground', 'stopBackground',
            'playSpeech', 'pauseSpeech', 'resumeSpeech', 'skipSpeech', 'speechQueue', 'playAudioFX', 'playSoundEffect', 'stopAudio', 'stopSpeech',
            'sleepScreen', 'wakeScreen', 'recoverScreens',
            'reboot', 'shutdown', 'killPfx', 'restartPfx',
            'setVolume', 'setZoneVolume', 'getStatus', 'getState', 'stopAll', 'pauseAll', 'resumeAll',
            'showBrowser', 'hideBrowser', 'setBrowserUrl', 'setBrowserKeepAlive'
        ];
    }
    /** Publish the current video queue */
    async _videoQueue() {
        const queue = this.videoQueue.map(item => item.mediaPath);
        this.publishEvent({ video_queue: queue });
        this.publishStatus();
    }

    /** Publish the current speech queue */
    async _speechQueue() {
        const queue = (this.audioManager.speechQueue || []).map(item => item.filePath);
        this.publishEvent({ speech_queue: queue });
        this.publishStatus();
    }

    async shutdown() {
        if (!this.isInitialized) {
            return;
        }

        this.logger.info('Shutting down screen zone...');

        try {
            // Stop browser monitoring
            this._stopBrowserMonitoring();

            // Kill browser process if it was running
            if (this.browserManager.enabled) {
                try {
                    await this._disableBrowser();
                } catch (err) {
                    this.logger.warn('Error disabling browser during shutdown: ' + err.message);
                }
            }

            // Stop all media
            await this._stopAll();

            // Shutdown audio manager
            if (this.audioManager) {
                await this.audioManager.shutdown();
            }

            // Shutdown media player factory
            if (this.mediaPlayerFactory) {
                await this.mediaPlayerFactory.shutdown();
            }

            // Stop periodic status updates
            this._stopPeriodicStatus();

            this.isInitialized = false;
            this.logger.info('Screen zone shutdown complete');

        } catch (error) {
            this.logger.error('Error during screen zone shutdown:', error);
            throw error;
        }
    }

    // ========================================================================
    // SMART MEDIA HANDLING HELPERS
    // ========================================================================

    /**
     * Detect if a file is a video based on its extension
     * @param {string} filePath - File path to check
     * @returns {boolean} True if file is a video
     */
    _isVideoFile(filePath) {
        return this.mediaPlayerFactory.getMediaType(filePath) === 'video';
    }

    /**
     * Check if we should resume existing media instead of reloading
     * @param {string} mediaPath - Media path being requested
     * @param {string} commandType - 'setImage' or 'playVideo'
     * @returns {boolean} True if we should resume instead of reload
     */
    _shouldResumeExistingMedia(mediaPath, commandType) {
        return (
            commandType === 'playVideo' &&
            this.smartMediaState.lastCommand === 'setImage' &&
            this.smartMediaState.lastMediaPath === mediaPath &&
            this.smartMediaState.currentLoadedPath === mediaPath &&
            this.smartMediaState.isVideoPaused &&
            this._isVideoFile(mediaPath)
        );
    }

    // ========================================================================
    // COMMAND IMPLEMENTATIONS
    // ========================================================================

    async _setImage(command) {
        return this.playbackController.setImage(command);
    }

    async _setDefaultImage() {
        return this.playbackController.setDefaultImage();
    }

    async _playVideo(command) {
        return this.playbackController.playVideo(command);
    }

    /**
     * Unified video completion (natural end, stopped, queue cleared, error, heuristic_eof)
     * @param {('natural_end'|'stopped'|'queue_cleared'|'error'|'heuristic_eof')} reason
     * @param {Object} [opts]
     * @param {string} [opts.error] optional error message
     */
    _completeCurrentVideo(reason, opts = {}) {
        return this.videoQueueController.completeCurrentVideo(reason, opts);
    }

    /**
     * Handle video loop restart (called when natural end occurs on a looping video)
     * @private
     */
    async _handleLoopRestart() {
        return this.videoQueueController.handleLoopRestart();
    }

    /**
     * Get current video queue length from zone manager
     * @private
     */
    async _getVideoQueueLength() {
        // For now, return 0 since we've reverted to simple implementation
        return 0;
    }

    /**
     * Normalize media path for comparison (handles relative vs absolute paths)
     * @private
     */
    _normalizeMediaPath(mediaPath) {
        if (!mediaPath) return '';

        const path = require('path');

        // If already absolute, return as-is
        if (path.isAbsolute(mediaPath)) {
            return path.resolve(mediaPath);
        }

        // If relative, resolve against media directory
        return path.resolve(this.zoneConfig.mediaDir, mediaPath);
    }

    async _stopVideo(fadeTime = 0) {
        if (!this.currentState.currentVideo) {
            // Clear queue regardless
            this.videoQueue = [];
            this.currentState.videoQueueLength = 0;
            this.publishStatus();
            return;
        }
        if (fadeTime > 0) {
            try {
                const startVolResp = await this.mpvZoneManager.sendCommand(['get_property', 'volume']).catch(() => null);
                const startVol = startVolResp && startVolResp.data !== undefined ? startVolResp.data : 100;
                const durationMs = fadeTime * 1000;
                const steps = Math.max(10, Math.floor(durationMs / 100));
                const stepMs = durationMs / steps;
                for (let i = 1; i <= steps; i++) {
                    const v = Math.max(0, startVol - (startVol * (i / steps)));
                    try { await this.mpvZoneManager.sendCommand(['set_property', 'volume', v]); } catch (_) { }
                    await new Promise(r => setTimeout(r, stepMs));
                }
            } catch (_) { }
        }
        try { await this.mpvZoneManager.stop(); } catch (_) { }
        this._completeCurrentVideo('stopped');
        this.videoQueue = [];
        this.currentState.videoQueueLength = 0;
        this.publishStatus();
    }

    // Video pause/resume/skip fully removed in unified no-preemption model.

    async _playAudio(audioPath, opts = {}) {
        if (!audioPath) throw new Error('Audio path is required');
        const { adjustVolume, channel, volume } = opts || {};
        const fileValidation = await this._validateMediaFile(audioPath);
        if (!fileValidation.exists) {
            this.publishCommandOutcome({ command: 'playAudio', outcome: 'failed', parameters: { file: audioPath }, error_type: 'file_not_found', error_message: fileValidation.error, message: `Audio file not found: ${audioPath}` });
            return false;
        }
        if (this.screenPowerManager.shouldWakeForAudio(this.config.audioDevice)) {
            await this.screenPowerManager.autoWakeForMedia('audio');
        }
        const options = {};
        let resolvedAudio = null;
        try {
            const commandPayload = {};
            if (volume !== undefined) commandPayload.volume = volume;
            if (adjustVolume !== undefined) commandPayload.adjustVolume = adjustVolume;
            resolvedAudio = resolveEffectiveVolume({ type: 'effects', zoneModel: this.volumeModel, command: commandPayload, duckActive: false });
            if (resolvedAudio.final !== undefined) options.volume = resolvedAudio.final;
        } catch (e) {
            this.publishCommandOutcome({ command: 'playAudio', outcome: 'failed', parameters: { file: audioPath }, error_type: 'volume_resolution_error', error_message: e.message, message: `Failed to resolve audio volume: ${e.message}` });
            return false;
        }
        await this.mpvZoneManager.loadMedia(fileValidation.path, 'audio', options);
        this.currentState.currentAudio = audioPath;
        this.currentState.status = 'playing_audio';
        this.mpvInstances.media.currentFile = audioPath;
        this.publishStatus();
        this.publishEvent({ audio_started: audioPath, adjust_volume: adjustVolume || 0, volume: resolvedAudio ? resolvedAudio.final : undefined });
        if (resolvedAudio && resolvedAudio.warnings && resolvedAudio.warnings.length) {
            this.publishCommandOutcome({ command: 'playAudio', outcome: 'warning', parameters: { file: audioPath, warnings: resolvedAudio.warnings.map(w => w.code), volume: resolvedAudio.final }, warning_type: 'volume_resolution_warning', message: 'Audio started with volume resolution warnings' });
        }
        this.logger.debug(`Audio playing: ${audioPath} at volume ${resolvedAudio ? resolvedAudio.final : 'default'}`);
        return true;
    }

    async _playBackgroundMusic(audioPath, params = {}) {
        return this._playBackgroundWithLifecycle(audioPath, params, {
            ensureSubsystemAvailable: async () => {
                const processRunning = await this.audioManager.checkAndRestartProcesses();
                if (processRunning) {
                    return { ok: true };
                }

                return {
                    ok: false,
                    parameters: { file: audioPath },
                    errorType: 'subsystem_unavailable',
                    errorMessage: 'Background system not available',
                    message: `Background system not available for file: ${audioPath}`
                };
            },
            applySuccessState: ({ audioPath }) => {
                this.currentState.backgroundMusic = audioPath;
            },
            buildVolumeResolutionFailureParameters: ({ audioPath }) => ({ file: audioPath }),
            buildWarningParameters: ({ audioPath, shouldLoop, targetVolume, resolved }) => ({
                file: audioPath,
                loop: shouldLoop,
                volume: targetVolume,
                warnings: resolved.warnings.map(w => w.code)
            })
        });
    }

    async _stopBackgroundMusic(fadeTime = 0) {
        await this._stopBackgroundWithFade(fadeTime, {
            resetState: () => {
                this.currentState.backgroundMusic = null;
                this.mpvInstances.background.currentFile = null;
                this.mpvInstances.background.status = 'idle';
            },
            eventPayload: { command: 'stopBackground', message: "Command 'stopBackground' executed successfully" },
            onFadeComplete: () => {
                this.logger.info(`Background music stopped with ${fadeTime}s fade`);
            }
        });
    }

    async _pauseBackgroundMusic() {
        await this._pauseBackgroundWithLifecycle({
            eventPayload: { background_music_paused: true },
            logMessage: 'Background music paused'
        });
    }

    async _resumeBackgroundMusic() {
        await this._resumeBackgroundWithLifecycle({
            eventPayload: { background_music_resumed: true },
            logMessage: 'Background music resumed'
        });
    }

    async _playSpeech(audioPath, volume, ducking, opts = {}) {
        if (!audioPath) throw new Error('Speech path is required');
        const fileValidation = await this._validateMediaFile(audioPath);
        if (!fileValidation.exists) {
            this.publishCommandOutcome({ command: 'playSpeech', outcome: 'failed', parameters: { file: audioPath }, error_type: 'file_not_found', error_message: fileValidation.error, message: `Speech file not found: ${audioPath}` });
            return false;
        }
        const processRunning = await this.audioManager.checkAndRestartProcesses();
        if (!processRunning) {
            this.publishCommandOutcome({ command: 'playSpeech', outcome: 'failed', parameters: { file: audioPath }, error_type: 'subsystem_unavailable', error_message: 'Speech system not available', message: `Speech system not available for file: ${audioPath}` });
            return false;
        }
        const commandPayload = {};
        if (volume !== undefined) commandPayload.volume = volume;
        const { adjustVolume } = opts || {};
        if (adjustVolume !== undefined) commandPayload.adjustVolume = adjustVolume;
        let resolvedSpeech;
        try {
            resolvedSpeech = resolveEffectiveVolume({ type: 'speech', zoneModel: this.volumeModel, command: commandPayload, duckActive: false });
        } catch (e) {
            this.publishCommandOutcome({ command: 'playSpeech', outcome: 'failed', parameters: { file: audioPath }, error_type: 'volume_resolution_error', error_message: e.message, message: `Failed to resolve speech volume: ${e.message}` });
            return false;
        }
        const targetVolume = resolvedSpeech.final;
        // Determine duck trigger necessity
        const codeDefault = -26;
        const zoneDefault = (this.config.speechDucking !== undefined && this.config.speechDucking < 0) ? this.config.speechDucking : undefined;
        const skipDucking = (typeof ducking === 'object' && ducking.skipDucking) || (ducking && ducking.skipDucking) || false;
        const duckingLevel = skipDucking ? 0 : (ducking !== undefined ? (typeof ducking === 'number' ? ducking : (ducking.level !== undefined ? ducking.level : (zoneDefault !== undefined ? zoneDefault : codeDefault))) : (zoneDefault !== undefined ? zoneDefault : codeDefault));
        let duckId = null;
        if (duckingLevel < 0) {
            duckId = `speech-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            this.duckLifecycle.addTrigger(duckId, 'speech');
            await this._recomputeBackgroundAfterDuckChange();
        }
        this.logger.info(`Playing speech: ${audioPath} at volume ${targetVolume} (duck trigger=${!!duckId})`);
        this.mpvInstances.speech.status = 'playing';
        let playbackError = null;
        try {
            await this.audioManager.playSpeech(fileValidation.path, { volume: targetVolume });
        } catch (err) {
            playbackError = err;
            this.logger.warn('Speech playback error: ' + (err.message || err));
            this.publishCommandOutcome({ command: 'playSpeech', outcome: 'failed', parameters: { file: audioPath, volume: targetVolume }, error_type: 'play_error', error_message: err.message || String(err), message: `Failed to play speech: ${audioPath}` });
        }
        if (duckId) {
            this.duckLifecycle.removeTrigger(duckId);
            await this._recomputeBackgroundAfterDuckChange();
        }
        this.mpvInstances.speech.status = 'idle';
        this.publishStatus();
        // (Acceptance event suppressed per updated requirement—use command_received start + final minimal event only)
        if (resolvedSpeech.warnings && resolvedSpeech.warnings.length) {
            this.publishCommandOutcome({ command: 'playSpeech', outcome: 'warning', parameters: { file: audioPath, volume: targetVolume, warnings: resolvedSpeech.warnings.map(w => w.code) }, warning_type: 'volume_resolution_warning', message: 'Speech playback completed with volume resolution warnings' });
        }
        return !playbackError;
    }

    async _playSoundEffect(audioPath, opts = {}) {
        const { volume, adjustVolume } = opts || {};
        const prepared = await this._prepareSoundEffectPlayback(audioPath, { volume, adjustVolume }, {
            buildFileNotFoundParameters: ({ audioPath }) => ({ file: audioPath }),
            onResolveFailure: ({ error, audioPath }) => {
                this.publishCommandOutcome({
                    command: 'playSoundEffect',
                    outcome: 'failed',
                    parameters: { file: audioPath },
                    error_type: 'volume_resolution_error',
                    error_message: error.message,
                    message: `Failed to resolve effect volume: ${error.message}`
                });
                return null;
            }
        });
        if (!prepared) {
            return false;
        }

        const { filePath, resolvedFX } = prepared;
        await this.audioManager.playSoundEffect(filePath, resolvedFX.final);
        this.publishEvent({ sound_effect_played: audioPath, volume: resolvedFX.final, pre_duck: resolvedFX.preDuck, adjust_volume: adjustVolume || 0 });
        if (resolvedFX.warnings && resolvedFX.warnings.length) {
            this.publishCommandOutcome({ command: 'playSoundEffect', outcome: 'warning', parameters: { file: audioPath, volume: resolvedFX.final, warnings: resolvedFX.warnings.map(w => w.code) }, warning_type: 'volume_resolution_warning', message: 'Sound effect played with volume resolution warnings' });
        }
        this.logger.debug(`Sound effect played: ${audioPath} at volume ${resolvedFX.final}`);
        return true;
    }

    async _stopAudio(fadeTime = 0) {
        await this._stopAudioWithLifecycle(fadeTime, {
            stopSpeech: async () => this.audioManager.clearSpeechQueue(),
            logMessage: (stopFadeTime) => `All audio stopped${stopFadeTime > 0 ? ` with ${stopFadeTime}s fade` : ' immediately'}`
        });
    }

    async _stopSpeech(fadeTime = 0) {
        await this._stopSpeechWithLifecycle(fadeTime, {
            stopPlayback: async () => this.audioManager.clearSpeechQueue(),
            afterStop: async ({ includeFadeTime, fadeTime: stopFadeTime }) => {
                const eventPayload = includeFadeTime
                    ? { speech_stopped: true, fade_time: stopFadeTime }
                    : { speech_stopped: true };
                this.publishEvent(eventPayload);
            },
            fadeSuccessLogMessage: (stopFadeTime) => `Speech stopped with ${stopFadeTime}s fade`,
            fadeFailureLogMessage: 'Speech stopped immediately (fade failed)',
            immediateLogMessage: 'Speech stopped immediately'
        });
    }

    async _sleepScreen() {
        // Ignore sleep commands while video is actively playing
        if (this.currentState.status === 'playing_video') {
            this.logger.info('Sleep command ignored: video is actively playing');
            this.publishEvent({
                screen_sleep: false,
                ignored: true,
                reason: 'video_playing'
            });
            return;
        }

        // Sleep only the target monitor
        await this.screenPowerManager.sleepMonitor(this.targetMonitor);

        this.currentState.screenAwake = false;
        this.currentState.status = 'screen_asleep';

        this.publishStatus();
        this.publishEvent({ screen_sleep: true });
        this.logger.info('Screen put to sleep');
    }

    async _wakeScreen() {
        // Wake only the target monitor
        await this.screenPowerManager.wakeMonitor(this.targetMonitor);

        // Restore default image if no media is currently playing
        if (!this.currentState.currentVideo && !this.currentState.currentAudio) {
            await this._setDefaultImage();
        }

        this.currentState.screenAwake = true;

        this.publishStatus();
        this.publishEvent({ screen_wake: true });
        this.logger.info('Screen woken up');
    }

    async _recoverScreens() {
        this.logger.info('Recovering all screens via screen power manager');
        await this.screenPowerManager.recoverAllMonitors();

        // Restore default image if no media is currently playing
        if (!this.currentState.currentVideo && !this.currentState.currentAudio) {
            await this._setDefaultImage();
        }

        this.currentState.screenAwake = true;

        this.publishStatus();
        this.publishEvent({ screens_recovered: true });
        this.logger.info('Screens recovered');
    }

    async _setVolume(volume) {
        if (volume === undefined || volume < 0 || volume > 200) {
            throw new Error('Volume must be between 0 and 200');
        }

        this.currentState.volume = volume;

        // Set volume on audio manager
        await this.audioManager.setBackgroundMusicVolume(volume);

        this.publishStatus();
        this.publishEvent({ volume_changed: volume });
        this.logger.info(`Volume set to: ${volume}`);
    }

    async _setZoneVolume(volume) {
        if (volume === undefined || volume < 0 || volume > 200) {
            throw new Error('Zone volume must be between 0 and 200');
        }

        this.logger.info(`Setting zone master volume to: ${volume}`);

        // Apply volume to all MPV instances in this zone
        const promises = [];

        // Set volume on MPV zone manager (for media/video)
        if (this.mpvZoneManager) {
            promises.push(this.mpvZoneManager.setVolume(volume));
        }

        // Set volume on audio manager (background music, speech, effects)
        if (this.audioManager) {
            promises.push(this.audioManager.setBackgroundMusicVolume(volume));
        }

        await Promise.all(promises);

        // Update zone state
        this.currentState.zoneVolume = volume;

        this.publishStatus();
        this.publishEvent({ zone_volume_changed: volume });
        this.logger.info(`Zone master volume set to: ${volume}`);
    }

    // Phase 8 helper: recompute background volume when lifecycle duck triggers change
    async _recomputeBackgroundAfterDuckChange() {
        await this._recomputeBackgroundAfterDuckChangeShared({
            hasBackgroundPlayback: () => Boolean(this.currentState.backgroundMusic),
            applyResolvedState: null,
            buildEventPayload: (resolved) => ({
                background_volume_recomputed: true,
                volume: resolved.final,
                pre_duck: resolved.preDuck,
                ducked: resolved.ducked,
                effective_volume: resolved.final,
                pre_duck_volume: resolved.preDuck
            }),
            resolveFailureMessage: 'ScreenZone background recompute failed: ',
            applyFailureMessage: 'Failed applying recomputed background volume: ',
            publishEventFirst: true
        });
    }

    async _restartPfx() {
        this.logger.info('Restarting PFX: executing cleanup and restart sequence...');

        try {
            // Execute cleanup logic (similar to cleanup.sh script)
            await this._executeCleanupSequence();

            // Restart the PFX process
            this.publishEvent({ pfx_restart_initiated: true });
            this.logger.info('PFX restart initiated - terminating current process for restart');

            // Give a moment for the message to be published
            setTimeout(() => {
                process.exit(0); // Exit cleanly to allow restart by process manager
            }, 1000);

        } catch (error) {
            this.logger.error('PFX restart failed:', error);
            this.publishError('PFX restart failed', { error: error.message });
            throw error;
        }
    }

    async _executeCleanupSequence() {
        const { exec } = require('child_process');
        const util = require('util');
        const execAsync = util.promisify(exec);

        this.logger.info('Executing cleanup sequence...');

        try {
            // 1. Kill MPV processes
            this.logger.debug('Killing MPV processes...');
            try {
                await execAsync('pkill mpv || true');
                await new Promise(resolve => setTimeout(resolve, 2000));
                await execAsync('pkill -9 mpv || true'); // Force kill any remaining
            } catch (err) {
                this.logger.debug('MPV cleanup completed:', err.message);
            }

            // 2. Clean up socket files
            this.logger.debug('Cleaning up socket files...');
            try {
                await execAsync('rm -f /tmp/mpv-*.sock /tmp/pfx-*.sock');
            } catch (err) {
                this.logger.debug('Socket cleanup completed:', err.message);
            }

            // 3. Clean up PulseAudio combined sinks
            this.logger.debug('Cleaning up PulseAudio combined sinks...');
            try {
                const { stdout } = await execAsync('pactl list short sinks | grep "paradox_dual_output" || true');
                if (stdout.trim()) {
                    await execAsync('pactl unload-module module-combine-sink || true');
                }
            } catch (err) {
                this.logger.debug('PulseAudio cleanup completed:', err.message);
            }

            // 4. Kill Chromium processes
            this.logger.debug('Killing Chromium processes...');
            try {
                await execAsync('pkill chromium || true');
                await new Promise(resolve => setTimeout(resolve, 2000));
                await execAsync('pkill -9 chromium || true'); // Force kill any remaining
            } catch (err) {
                this.logger.debug('Chromium cleanup completed:', err.message);
            }

            this.logger.info('Cleanup sequence completed successfully');

        } catch (error) {
            this.logger.error('Cleanup sequence failed:', error);
            throw error;
        }
    }

    async _stopAll(fadeTime = 0) {
        // Stop video (now supports fadeTime)
        if (this.currentState.currentVideo) {
            await this._stopVideo(fadeTime);
        }

        // Stop all audio with fade if specified
        await this._stopAudio(fadeTime);

        // Return to default image
        await this._setDefaultImage();

        this._setIdleStatus();
        this.publishEvent({ all_media_stopped: true, fade_time: fadeTime });
        this.logger.debug(`All media stopped${fadeTime > 0 ? ` with ${fadeTime}s fade` : ' immediately'}`);
    }

    async _pauseAll() {
        // Pause audio manager only (video pause removed)
        await this.audioManager.pauseAll();

        this.publishEvent({ all_media_paused: true });
        this.logger.debug('All media paused');
    }

    async _resumeAll() {
        // Resume audio manager only (video resume removed)
        await this.audioManager.resumeAll();

        this.publishEvent({ all_media_resumed: true });
        this.logger.debug('All media resumed');
    }

    // ========================================================================
    // VIDEO QUEUE MANAGEMENT
    // ========================================================================

    /**
     * Enqueue a playVideo or setImage command with advanced deduplication/replacement logic
     */
    async _enqueueVideoCommand(command) {
        return this.videoQueueController.enqueueVideoCommand(command);
    }

    /**
     * Process the video/image queue (one at a time)
     */
    async _processVideoQueue() {
        return this.videoQueueController.processVideoQueue();
    }

    /**
     * Handle setImage command in queue
     */
    async _handleSetImageQueue(mediaPath, mediaType, command) {
        return this.videoQueueController.handleSetImageQueue(mediaPath, mediaType, command);
    }

    /**
     * Handle playVideo command in queue
     */
    async _handlePlayVideoQueue(mediaPath, mediaType, command) {
        return this.videoQueueController.handlePlayVideoQueue(mediaPath, mediaType, command);
    }

    /**
     * Start a simulated EOF timer for a video file
     * @param {string} mediaPath - Path to the video file
     * @param {number|null} remainingDuration - Optional remaining duration in seconds (for resume)
     */
    async _setupVideoEof(mediaPath, remainingDuration = null) {
        return this.videoQueueController.setupVideoEof(mediaPath, remainingDuration);
    }

    async _probeDuration(mediaPath) {
        return this.videoQueueController.probeDuration(mediaPath);
    }

    _clearEofHandlers() {
        return this.videoQueueController.clearEofHandlers();
    }

    _onPlaybackTime(event) {
        return this.videoQueueController.onPlaybackTime(event);
    }

    /**
     * Handle end of file (real or simulated)
     */
    _handleMediaEnd() {
        return this.videoQueueController.handleMediaEnd();
    }

    /**
     * Validate that a media file exists and return its full path
     * @private
     */
    async _validateMediaFile(mediaPath) {
        if (!mediaPath) {
            return { exists: false, path: null, error: 'Media path is empty' };
        }

        const fullPath = this.audioManager.resolveMediaPath(mediaPath);
        const fs = require('fs');

        if (!fs.existsSync(fullPath)) {
            return { exists: false, path: fullPath, error: `Media file not found: ${fullPath}` };
        }

        return { exists: true, path: fullPath, error: null };
    }

    // ========================================================================
    // BROWSER MANAGEMENT METHODS
    // ========================================================================

    /**
     * Emit MQTT warning + log for removed browser lifecycle commands.
     * Called when enableBrowser, disableBrowser, or verifyBrowser are received.
     */
    _warnRemovedBrowserCommand(commandName) {
        const msg = `Command '${commandName}' has been removed from PFx. ` +
            `Configure 'browser_url' in the INI to auto-enable the browser at zone startup; ` +
            `use 'showBrowser' / 'hideBrowser' to control visibility.`;
        this.publishWarning(msg, { command: commandName, warning_type: 'removed_command' });
        process.stderr.write(`[PFx] ${msg}\n`);
    }

    /**
     * Emit MQTT warning + log for moveBrowser (PFxE-only; not meaningful on PFx).
     */
    _warnMoveBrowserNotSupported() {
        const msg = `Command 'moveBrowser' is not supported on PFx — the browser overlay is always full-screen. ` +
            `Use 'showBrowser' / 'hideBrowser' to control browser visibility.`;
        this.publishWarning(msg, { command: 'moveBrowser', warning_type: 'unsupported_on_pfx' });
        process.stderr.write(`[PFx] ${msg}\n`);
    }

    async _enableBrowser(url = null) {
        return this.browserController.enableBrowser(url);
    }

    async _disableBrowser() {
        return this.browserController.disableBrowser();
    }

    async _showBrowser() {
        return this.browserController.showBrowser();
    }

    async _hideBrowser() {
        return this.browserController.hideBrowser();
    }

    async _setBrowserUrl(url) {
        return this.browserController.setBrowserUrl(url);
    }

    async _setBrowserKeepAlive(enabled) {
        return this.browserController.setBrowserKeepAlive(enabled);
    }

    _startBrowserMonitoring() {
        return this.browserController.startBrowserMonitoring();
    }

    _stopBrowserMonitoring() {
        return this.browserController.stopBrowserMonitoring();
    }

    _updateFocusAndContent() {
        return this.browserController.updateFocusAndContent();
    }

    async _switchToMpv() {
        return this.browserController.switchToMpv();
    }

    async _switchToBrowser() {
        return this.browserController.switchToBrowser();
    }

    async _toggleMpvBrowser() {
        return this.browserController.toggleMpvBrowser();
    }

    // ========================================================================
    // ENHANCED STATUS REPORTING
    // ========================================================================

    // Phase 5: hook for flattened status schema extension
    _extendStatusPayload(payload) {
        // Update focus/content first
        this._updateFocusAndContent();
        // Video block (rename legacy 'media' mpv instance -> 'video')
        const videoInst = this.mpvInstances.media;
        // Derive queue metrics from internal queue (simple queue used here)
        let queueLength = this.videoQueue ? this.videoQueue.length : 0;
        let nextFile = null;
        if (queueLength > 0) {
            // Next file is first queued item mediaPath
            nextFile = this.videoQueue[0].mediaPath || null;
        }
        payload.video = {
            status: videoInst ? (videoInst.status || 'idle') : 'idle',
            file: videoInst ? (videoInst.currentFile || null) : null,
            next: nextFile,
            queue_length: queueLength,
            socket_path: this.socketPaths.media,
            volume: this.volumeModel.baseVolumes.video
        };
        // Browser block
        payload.browser = {
            enabled: !!(this.browserManager && this.browserManager.enabled),
            url: this.browserManager ? this.browserManager.url || null : null,
            focused: this.currentState.focus === 'chromium',
            process_id: this.browserManager && this.browserManager.process ? this.browserManager.process.pid : null,
            window_id: this.browserManager ? this.browserManager.windowId || null : null
        };
    }

    // ---------------------- Manual duck/unduck commands ----------------------
    async _handleDuckCommand(command) {
        const duckId = `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.duckLifecycle.addTrigger(duckId, 'manual');
        await this._recomputeBackgroundAfterDuckChange();
        this.publishEvent({ ducked: true, duck_id: duckId });
        this.publishStatus();
    }

    async _handleUnduckCommand(command) {
        const id = command.duck_id;
        if (id) {
            this.duckLifecycle.removeTrigger(id);
            await this._recomputeBackgroundAfterDuckChange();
            this.publishEvent({ unducked: true, duck_id: id });
        } else {
            // remove all manual triggers (no enumeration yet; clear snapshot by kind)
            const snap = this.duckLifecycle.snapshot();
            if (snap.triggers) {
                for (const t of Object.keys(snap.triggers)) {
                    if (t.startsWith('manual-')) this.duckLifecycle.removeTrigger(t);
                }
            }
            await this._recomputeBackgroundAfterDuckChange();
            this.publishEvent({ unducked_all_manual: true });
        }
        this.publishStatus();
    }
}

module.exports = ScreenZone;
