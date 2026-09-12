/**
 * @fileoverview Audio Manager for ParadoxFX System
 * @description Comprehensive audio management system implementing the validated MPV-based architecture
 * 
 * This module provides centralized audio management for the ParadoxFX system, supporting:
 * - Background music with seamless looping and ducking
 * - Low-latency sound effects with overlapping capability
 * - Speech/narration with automatic background music ducking
 * - Multi-device audio routing for multiple outputs
 * 
 * ARCHITECTURE:
 * =============
 * Three distinct audio subsystems with different management strategies:
 * 1. Background Music: Persistent IPC instance with volume control
 * 2. Sound Effects: Fire-and-forget spawn for low latency and parallelism
 * 3. Speech: Queue-based system with background music coordination
 * 
 * Based on validation testing from test/manual/test-audio.js
 * 
 * @author ParadoxFX Team
 * @version 1.0.0
 * @since 2025-01-16
 */

const { spawn, spawnSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const Logger = require('../utils/logger');
const Utils = require('../utils/utils');
const PlaybackMonitor = require('./playback-monitor');

/** Minimum interval between PulseAudio sink checks during playback (ms). */
const PULSE_SINK_WAKE_COOLDOWN_MS = 5 * 60 * 1000;

class AudioManager {
    constructor(config, zone = null) {
        this.config = config || {};

        // Socket paths for IPC communication - Zone-specific to prevent conflicts
        const zoneId = this.config.zoneId || 'default';
        const safeZoneId = Utils.sanitizeFilename(zoneId);
        this.zoneId = zoneId;
        this.logger = new Logger(`AudioManager:${zoneId}`);
        this.zone = zone; // Reference to the zone for event publishing

        // Audio subsystem instances
        this._safeZoneId = safeZoneId;
        this.backgrounds = new Map(); // id -> { id, process, socket, file, displayFile, volume, loop, monitor }
        this._audioStatusCache = { backgrounds: [], speech: { current: null, queue: [] } };
        this.backgroundMusic = null; // legacy alias: default bed process
        this.speechProcess = null;
        this.currentSpeechFile = null; // Track currently playing speech file
        this._currentSpeechItem = null; // Resolver bookkeeping for active speech item
        this.speechQueue = [];
        this.isProcessingSpeech = false;
        this._speechMonitor = null; // PlaybackMonitor instance for current speech
        this._activeSpeechCompletionEvents = new Map();
        this._activeSpeechStartEvents = new Map();

        this.backgroundMusicSocket = `/tmp/pfx-background-music-${safeZoneId}.sock`;
        this.speechSocket = `/tmp/pfx-speech-${safeZoneId}.sock`;

        // Audio device configuration
        this.audioDevice = this.config.audioDevice || 'auto';
        this.audioChannels = this.config.audioChannels || null;
        this.dualOutputMode = this.config.dualOutputMode || false;
        this.primaryDevice = this.config.primaryDevice || null;
        this.secondaryDevice = this.config.secondaryDevice || null;

        this.logger.info(`AudioManager initialized with device: ${this.audioDevice}`);
        if (this.dualOutputMode) {
            this.logger.info(`Dual output mode enabled: ${this.primaryDevice} + ${this.secondaryDevice}`);
        }

        // Volume settings
        this.backgroundMusicVolume = this.config.backgroundMusicVolume || 70;
        this.effectsVolume = this.config.effectsVolume || 100;
        this.speechVolume = this.config.speechVolume || 90;
        this.duckingVolume = this.config.duckingVolume || 30;

        // Max volume settings
        this.maxVolume = this.config.maxVolume || this.config.max_volume || 150;

        // State tracking
        this.isInitialized = false;
        this.isShuttingDown = false;
        // Track active IPC clients and timeouts so we can force-close them on shutdown
        this._activeMpvClients = new Set();
        this._activeMpvTimeouts = new Set();

        // Fade tracking
        this._activeBackgroundFade = null;
        this._activeSpeechFade = null;

        /** @type {Map<string, {file: string, loop: boolean, promise: Promise<object>}>} */
        this._backgroundPlayInFlight = new Map();
        /** @type {Map<string, Promise<object>>} In-flight mpv spawn by bed id */
        this._backgroundEnsureInFlight = new Map();
        /** Last successful identical start per bed id (short-window dedupe). */
        this._lastBackgroundPlay = new Map();
        /** Ignore identical playBackground (same id + file) within this window (ms). */
        this._backgroundDedupMs = 500;

        /** Last time we ran a throttled PulseAudio sink check (ms). */
        this._lastPulseSinkCheckMs = 0;

    }

    /**
     * @returns {string|null} PulseAudio sink name from audioDevice, or null
     * @private
     */
    _getPulseSinkName() {
        if (!this.audioDevice || this.audioDevice === 'auto' || !this.audioDevice.startsWith('pulse/')) {
            return null;
        }
        return this.audioDevice.slice('pulse/'.length);
    }

    /**
     * @returns {NodeJS.ProcessEnv} Environment for pactl
     * @private
     */
    _getPulseEnv() {
        return {
            ...process.env,
            XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '/run/user/1000'
        };
    }

    /**
     * @param {string} sinkName
     * @returns {string|null} Sink state (e.g. RUNNING, SUSPENDED, IDLE) or null
     * @private
     */
    _getPulseSinkState(sinkName) {
        const result = spawnSync('pactl', ['list', 'sinks'], {
            env: this._getPulseEnv(),
            encoding: 'utf8'
        });
        if (result.status !== 0) {
            return null;
        }

        const blocks = result.stdout.split(/\n(?=Sink #)/);
        for (const block of blocks) {
            if (!block.includes(`Name: ${sinkName}`)) {
                continue;
            }
            const match = block.match(/State:\s(\S+)/);
            return match ? match[1] : null;
        }
        return null;
    }

    /**
     * @param {string} sinkName
     * @private
     */
    _wakePulseSink(sinkName) {
        const env = this._getPulseEnv();
        for (const args of [
            ['suspend-sink', sinkName, '0'],
            ['set-default-sink', sinkName]
        ]) {
            const result = spawnSync('pactl', args, { env, encoding: 'utf8' });
            if (result.status !== 0) {
                const detail = (result.stderr || result.stdout || '').trim();
                this.logger.warn(`pactl ${args[0]} failed for ${sinkName}: ${detail || 'unknown error'}`);
            }
        }
    }

    /**
     * Throttled PulseAudio sink wake before audio output.
     * suspend-sink 0 wakes a suspended sink without stopping active streams.
     * @param {{ force?: boolean }} [options]
     * @private
     */
    _beforeAudioOutput({ force = false } = {}) {
        const sinkName = this._getPulseSinkName();
        if (!sinkName) {
            return;
        }

        const now = Date.now();
        if (!force && (now - this._lastPulseSinkCheckMs) < PULSE_SINK_WAKE_COOLDOWN_MS) {
            return;
        }
        this._lastPulseSinkCheckMs = now;

        const state = force ? null : this._getPulseSinkState(sinkName);
        if (!force && state && state !== 'SUSPENDED') {
            return;
        }

        this._wakePulseSink(sinkName);
        if (force || state === 'SUSPENDED') {
            this.logger.debug(`PulseAudio sink ${sinkName} wake (state=${state || 'unknown'}, force=${force})`);
        }
    }

    _getMediaId() {
        if (this.zone && this.zone.mediaId != null) {
            return String(this.zone.mediaId);
        }
        if (this.config && this.config.mediaId != null) {
            return String(this.config.mediaId);
        }
        return undefined;
    }

    /**
     * Resolve media path
     * @param {string} mediaPath - Relative or absolute media path
     * @returns {string} Fully resolved media path
     */
    resolveMediaPath(mediaPath) {
        if (path.isAbsolute(mediaPath)) {
            return mediaPath;
        }
        const mediaId = this._getMediaId();
        if (mediaId) {
            return path.join(this.config.baseMediaPath, mediaId, mediaPath);
        }
        return path.join(this.config.baseMediaPath, mediaPath);
    }

    /**
     * Initialize the audio system
     */
    async initialize() {
        if (this.isInitialized) {
            this.logger.warn('AudioManager already initialized');
            return;
        }

        this.logger.info('Initializing audio system...');

        try {
            // Clean up any existing socket files
            this._cleanupSockets();

            // Initialize background music system
            await this._initializeBackgroundMusic();

            // Initialize speech system
            await this._initializeSpeech();

            this._beforeAudioOutput({ force: true });
            this.isInitialized = true;
            this.logger.info('Audio system initialized successfully');

        } catch (error) {
            this.logger.error('Failed to initialize audio system:', error);
            this.isInitialized = false;
            throw error;
        }
    }

    /**
     * Check if audio systems are healthy and restart if needed
     * @returns {boolean} True if systems are healthy or successfully restarted
     */
    async checkAndRestartProcesses() {
        if (!this.isInitialized) {
            this.logger.debug('AudioManager not initialized, skipping health check');
            return false;
        }

        let systemsHealthy = true;

        for (const [id, bed] of this.backgrounds) {
            if (bed.process && bed.process.killed) {
                this.logger.warn(`Background music process crashed (${id}), attempting restart...`);
                try {
                    if (id === 'default') {
                        await this._initializeBackgroundMusic();
                    } else {
                        const restarted = await this._ensureBackgroundInstance(id);
                        if (bed.file) {
                            await this._loadBackgroundOnBed(restarted, bed.file, bed.volume, bed.loop, { displayFile: bed.displayFile });
                        }
                    }
                    this.logger.info(`Background music system restarted successfully (${id})`);
                } catch (error) {
                    this.logger.error(`Failed to restart background music system (${id}):`, error);
                    systemsHealthy = false;
                }
            }
        }

        // but we can ensure the socket is available when needed
        if (this.speechProcess && this.speechProcess.killed) {
            this.logger.warn('Speech process crashed, attempting restart...');
            try {
                await this._initializeSpeech();
                this.logger.info('Speech system restarted successfully');
            } catch (error) {
                this.logger.error('Failed to restart speech system:', error);
                systemsHealthy = false;
            }
        }

        return systemsHealthy;
    }

    /**
     * Play background music with optional looping
     * @param {string} filePath - Path to music file
     * @param {number} volume - Volume level (0-150), optional
     * @param {boolean|object} loop - Whether to loop the file, or options object
     * @param {object} [options]
     * @param {string} [options.id] - Bed identifier (default: "default")
     * @param {string} [options.displayFile] - Relative/original file path for status
     * @returns {Promise<{success: boolean, error?: string, warning?: boolean, warning_type?: string, id?: string, background_count?: number, background_ids?: string[]}>}
     */
    async playBackgroundMusic(filePath, volume = null, loop = false, options = {}) {
        if (loop && typeof loop === 'object') {
            options = loop;
            loop = !!options.loop;
        }
        options = options || {};

        if (!this.isInitialized) {
            return { success: false, error: 'AudioManager not initialized' };
        }

        if (!fs.existsSync(filePath)) {
            this.logger.warn(`Background music file not found: ${filePath}`);
            return { success: false, error: `Background music file not found: ${filePath}` };
        }

        const id = this._resolveBackgroundId(options.id);
        const targetVolume = volume || this.backgroundMusicVolume;
        const displayFile = options.displayFile || this._toDisplayFile(filePath);
        const shouldLoop = !!loop;

        // Coalesce overlapping identical starts for the same bed id (MQTT echo / double fire).
        const inFlight = this._backgroundPlayInFlight.get(id);
        if (inFlight && inFlight.file === filePath && inFlight.loop === shouldLoop) {
            this.logger.debug(`Coalescing in-flight playBackground for id=${id}`);
            return inFlight.promise;
        }
        if (inFlight) {
            // Different file/loop for this id — wait for the current start, then replace.
            try { await inFlight.promise; } catch (_) { /* continue to replace */ }
        }

        // Short-window identical replay: same id + file just started successfully.
        const last = this._lastBackgroundPlay.get(id);
        if (
            last
            && last.file === filePath
            && last.loop === shouldLoop
            && (Date.now() - last.at) < this._backgroundDedupMs
        ) {
            this.logger.debug(`Ignoring duplicate playBackground for id=${id} file=${filePath}`);
            return {
                success: true,
                id,
                info: 'Duplicate ignored',
                background_count: this._activeBackgroundIds().length,
                background_ids: this._activeBackgroundIds()
            };
        }

        let resolvePlay;
        let rejectPlay;
        const playPromise = new Promise((resolve, reject) => {
            resolvePlay = resolve;
            rejectPlay = reject;
        });
        // Register before starting work so a concurrent identical call coalesces.
        this._backgroundPlayInFlight.set(id, { file: filePath, loop: shouldLoop, promise: playPromise });
        this._playBackgroundMusicOnce(filePath, targetVolume, shouldLoop, {
            id,
            displayFile
        }).then(resolvePlay, rejectPlay);

        try {
            const result = await playPromise;
            if (result && result.success) {
                this._lastBackgroundPlay.set(id, {
                    file: filePath,
                    loop: shouldLoop,
                    at: Date.now()
                });
            }
            return result;
        } finally {
            const current = this._backgroundPlayInFlight.get(id);
            if (current && current.promise === playPromise) {
                this._backgroundPlayInFlight.delete(id);
            }
        }
    }

    /**
     * Single playBackground attempt (caller owns in-flight / dedupe bookkeeping).
     * @private
     */
    async _playBackgroundMusicOnce(filePath, targetVolume, shouldLoop, { id, displayFile }) {
        const existing = this.backgrounds.get(id);
        const replacing = !!(existing && existing.file);
        const activeIds = this._activeBackgroundIds();
        const multipleBackgrounds = !replacing && activeIds.length >= 1 && !activeIds.includes(id);

        this.logger.info(`Playing background music: ${filePath} at volume ${targetVolume} (loop: ${shouldLoop}, id: ${id})`);
        this._beforeAudioOutput();

        if (this.zone) {
            try {
                this.zone.publishMessage('events', {
                    background_music_started: true,
                    file: path.basename(filePath),
                    volume: targetVolume,
                    loop: shouldLoop,
                    id,
                    adjust_volume: 0
                });
            } catch (e) {
                this.logger.debug('Failed to publish background start event:', e.message || e);
            }
        }

        try {
            const bed = await this._ensureBackgroundInstance(id);
            await this._loadBackgroundOnBed(bed, filePath, targetVolume, shouldLoop, { displayFile });

            const backgroundIds = this._activeBackgroundIds();
            const result = {
                success: true,
                id,
                background_count: backgroundIds.length,
                background_ids: backgroundIds
            };

            if (multipleBackgrounds) {
                result.warning = true;
                result.warning_type = 'multiple_backgrounds';
                this.logger.warn(`Multiple background beds active (${backgroundIds.length}): ${backgroundIds.join(', ')}`);
            }

            this._refreshAudioStatusSnapshot();
            return result;

        } catch (error) {
            this.logger.error('Failed to play background music:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Stop background music. No selector stops every bed (legacy). `{ id }` or `{ file }` stops that bed only.
     * @param {object} [options]
     * @param {string} [options.id]
     * @param {string} [options.file]
     * @returns {Promise<{success: boolean, stopped: string[], warning?: boolean, warning_type?: string}>}
     */
    async stopBackgroundMusic(options = {}) {
        if (!this.isInitialized) {
            return { success: true, stopped: [] };
        }

        const selector = this._normalizeSelector(options);
        const targeted = !!(selector.id || selector.file);
        const beds = targeted ? this._findBackgrounds(selector) : this._activeBackgroundBeds();

        if (targeted && beds.length === 0) {
            this.logger.warn(`stopBackground: unknown bed id=${selector.id || ''} file=${selector.file || ''}`);
            return { success: true, stopped: [], warning: true, warning_type: 'unknown_background' };
        }

        if (!targeted && beds.length === 0 && !this.backgroundMusicSocket) {
            this.logger.debug('stopBackgroundMusic called with no active beds (noop)');
            return { success: true, stopped: [] };
        }

        const stopped = [];
        if (!targeted && beds.length === 0) {
            await this._stopOneBackground({
                id: 'default',
                socket: this.backgroundMusicSocket,
                monitor: this._backgroundMonitor
            });
            this._lastBackgroundPlay.delete('default');
        } else {
            for (const bed of beds) {
                await this._stopOneBackground(bed);
                stopped.push(bed.id);
                this._lastBackgroundPlay.delete(bed.id);
            }
        }

        this._refreshAudioStatusSnapshot();
        return { success: true, stopped };
    }

    /**
     * Set background music volume on all beds, or a selected bed.
     * @param {number} volume - Volume level (0-150)
     * @param {object} [options]
     * @param {string} [options.id]
     * @param {string} [options.file]
     */
    async setBackgroundMusicVolume(volume, options = {}) {
        if (!this.isInitialized) {
            return;
        }

        const selector = this._normalizeSelector(options);
        const targeted = !!(selector.id || selector.file);
        const beds = targeted ? this._findBackgrounds(selector) : [...this.backgrounds.values()];
        const sockets = beds.length ? beds.map(bed => bed.socket) : [this.backgroundMusicSocket];

        try {
            for (const socket of sockets) {
                const response = await this._sendMpvCommand(socket, {
                    command: ['set_property', 'volume', volume]
                });

                if (response.error && response.error !== 'success') {
                    throw new Error(`MPV error: ${response.error}`);
                }
            }

            for (const bed of beds) {
                bed.volume = volume;
            }

            this.logger.debug(`Background music volume set to ${volume}${targeted ? ` (${selector.id || selector.file})` : ' (all beds)'}`);
        } catch (error) {
            this.logger.error('Failed to set background music volume:', error.message || error);
            throw error;
        }
    }

    /**
     * Fade background music volume over time
     * @param {number} targetVolume - Target volume level (0-150)
     * @param {number} durationMs - Fade duration in milliseconds
     * @param {function} callback - Optional callback when fade completes
     * @returns {Promise<{success: boolean, fadeId?: string, error?: string}>}
     */
    async fadeBackgroundMusic(targetVolume, durationMs, callback = null, options = {}) {
        const selector = this._normalizeSelector(options);
        return this._startVolumeFade({
            activeFadeKey: '_activeBackgroundFade',
            fadeIdPrefix: 'bgm-fade',
            fadeLabel: 'background music',
            durationMs,
            targetVolume,
            callback,
            getCurrentVolume: async () => {
                const beds = this._findBackgrounds(selector);
                const socket = (beds[0] && beds[0].socket) || this.backgroundMusicSocket;
                const currentResponse = await this._sendMpvCommand(socket, {
                    command: ['get_property', 'volume']
                });
                return currentResponse.data || this.backgroundMusicVolume;
            },
            setVolume: async (volume) => (selector.id || selector.file)
                ? this.setBackgroundMusicVolume(volume, selector)
                : this.setBackgroundMusicVolume(volume)
        });
    }

    /**
     * Fade speech volume over time
     * @param {number} targetVolume - Target volume level (0-150)
     * @param {number} durationMs - Fade duration in milliseconds
     * @param {function} callback - Optional callback when fade completes
     * @returns {Promise<{success: boolean, fadeId?: string, error?: string}>}
     */
    async fadeSpeech(targetVolume, durationMs, callback = null) {
        return this._startVolumeFade({
            activeFadeKey: '_activeSpeechFade',
            fadeIdPrefix: 'speech-fade',
            fadeLabel: 'speech',
            durationMs,
            targetVolume,
            callback,
            getCurrentVolume: async () => {
                const currentResponse = await this._sendMpvCommand(this.speechSocket, {
                    command: ['get_property', 'volume']
                });
                return currentResponse.data || this.speechVolume;
            },
            setVolume: async (volume) => this._sendMpvCommand(this.speechSocket, {
                command: ['set_property', 'volume', volume]
            })
        });
    }

    _cancelTrackedFade(activeFadeKey, fadeLabel) {
        const activeFade = this[activeFadeKey];
        if (!activeFade) {
            return;
        }

        clearInterval(activeFade.interval);
        this.logger.info(`Cancelled ${fadeLabel} fade: ${activeFade.id}`);
        this[activeFadeKey] = null;
    }

    async _startVolumeFade({
        activeFadeKey,
        fadeIdPrefix,
        fadeLabel,
        durationMs,
        targetVolume,
        callback,
        getCurrentVolume,
        setVolume
    }) {
        if (!this.isInitialized) {
            return { success: false, error: 'AudioManager not initialized' };
        }

        this._cancelTrackedFade(activeFadeKey, fadeLabel);

        try {
            const startVolume = await getCurrentVolume();
            const steps = Math.max(10, Math.floor(durationMs / 100));
            const volumeStep = (targetVolume - startVolume) / steps;
            const intervalMs = durationMs / steps;
            const fadeId = `${fadeIdPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

            this.logger.info(`Starting ${fadeLabel} fade: ${startVolume} -> ${targetVolume} over ${durationMs}ms (${steps} steps)`);

            let currentStep = 0;
            const fadeInterval = setInterval(async () => {
                try {
                    currentStep++;
                    const nextVolume = Math.max(0, Math.min(150, startVolume + (volumeStep * currentStep)));

                    await setVolume(nextVolume);

                    if (currentStep >= steps) {
                        clearInterval(fadeInterval);
                        this[activeFadeKey] = null;
                        await setVolume(targetVolume);

                        this.logger.info(`${fadeLabel.charAt(0).toUpperCase() + fadeLabel.slice(1)} fade completed: ${fadeId}`);
                        if (callback) {
                            try {
                                await callback();
                            } catch (callbackError) {
                                this.logger.error(`${fadeLabel.charAt(0).toUpperCase() + fadeLabel.slice(1)} fade callback error:`, callbackError);
                            }
                        }
                    }
                } catch (error) {
                    this.logger.error(`Error during ${fadeLabel} fade step:`, error);
                    clearInterval(fadeInterval);
                    this[activeFadeKey] = null;
                }
            }, intervalMs);

            this[activeFadeKey] = {
                id: fadeId,
                interval: fadeInterval,
                startTime: Date.now(),
                duration: durationMs,
                targetVolume
            };

            return { success: true, fadeId };
        } catch (error) {
            this.logger.error(`Failed to start ${fadeLabel} fade:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cancel active background music fade
     */
    cancelBackgroundMusicFade() {
        this._cancelTrackedFade('_activeBackgroundFade', 'background music');
    }

    /**
     * Cancel active speech fade
     */
    cancelSpeechFade() {
        this._cancelTrackedFade('_activeSpeechFade', 'speech');
    }

    /**
     * Pause background music. No selector pauses every bed.
     * @param {object} [options]
     * @returns {Promise<{success: boolean, warning?: boolean, warning_type?: string}>}
     */
    async pauseBackgroundMusic(options = {}) {
        return this._setBackgroundPause(true, options);
    }

    /**
     * Resume background music. No selector resumes every bed.
     * @param {object} [options]
     * @returns {Promise<{success: boolean, warning?: boolean, warning_type?: string}>}
     */
    async resumeBackgroundMusic(options = {}) {
        return this._setBackgroundPause(false, options);
    }

    /**
     * Play sound effect with low latency
     * @param {string} filePath - Path to sound effect file
     * @param {number} volume - Volume level (0-150), optional
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async playSoundEffect(filePath, volume = null) {
        if (!fs.existsSync(filePath)) {
            this.logger.warn(`Sound effect file not found: ${filePath}`);
            return { success: false, error: `Sound effect file not found: ${filePath}` };
        }

        const targetVolume = volume || this.effectsVolume;

        this.logger.debug(`Playing sound effect: ${filePath} at volume ${targetVolume}`);
        this._beforeAudioOutput();

        try {
            // Use fire-and-forget spawn method for low latency and parallelism
            const args = [
                '--no-terminal',
                '--no-video',
                `--volume=${targetVolume}`,
                `--volume-max=${this.maxVolume}`,
                '--audio-buffer=0.02',  // Minimize buffer for low latency
                '--cache=no',           // Disable cache for immediate playback
                filePath
            ];

            // Add audio device and channel layout before the file path argument
            if (this.audioDevice !== 'auto') {
                args.splice(-1, 0, `--audio-device=${this.audioDevice}`);
            }
            if (this.audioChannels) {
                args.splice(-1, 0, `--audio-channels=${this.audioChannels}`);
            }

            const effectProcess = spawn('mpv', args, { detached: false });

            // Log any errors but don't wait for completion
            effectProcess.on('error', (error) => {
                this.logger.error('Sound effect playback error:', error);
            });

            // Optional: Log completion for debugging
            effectProcess.on('exit', (code) => {
                if (code !== 0) {
                    this.logger.warn(`Sound effect process exited with code ${code}`);
                }
            });

            return { success: true };

        } catch (error) {
            this.logger.error('Failed to play sound effect:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Play speech with background music ducking
     * @param {string} filePath - Path to speech file
     * @param {number} volume - Volume level (0-150), optional
     * @param {number} duckVolume - Ducking volume (0-150), optional
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async playSpeech(filePath, { volume = null, duckVolume = 30, id = null, displayFile = null } = {}) {
        if (!this.isInitialized) {
            this.logger.error('AudioManager not initialized, cannot play speech.');
            return { success: false, error: 'AudioManager not initialized' };
        }

        const resolvedPath = this.resolveMediaPath(filePath);
        if (!fs.existsSync(resolvedPath)) {
            this.logger.error(`Speech file not found: ${resolvedPath}`);
            return { success: false, error: `Speech file not found: ${resolvedPath}` };
        }

        // De-duplication: Prevent adding the same speech file if it's currently playing or is the last in queue.
        const lastInQueue = this.speechQueue.length > 0 ? this.speechQueue[this.speechQueue.length - 1].filePath : null;
        if (this.currentSpeechFile === resolvedPath || lastInQueue === resolvedPath) {
            this.logger.debug(`Ignoring duplicate speech request for: ${resolvedPath}`);
            return { success: true, info: 'Duplicate ignored' };
        }

        const targetVolume = volume || this.speechVolume;
        const speechId = (id && String(id).trim()) || path.basename(resolvedPath);
        const speechDisplay = displayFile || this._toDisplayFile(resolvedPath);
        this.logger.info(`Queueing speech: ${resolvedPath} (id: ${speechId})`);
        // Create a deferred promise so the caller can await completion of this specific speech item
        let resolveFn, rejectFn;
        const completionPromise = new Promise((resolve, reject) => { resolveFn = resolve; rejectFn = reject; });

        // Add to speech queue with completion resolver
        this.speechQueue.push({
            id: speechId,
            filePath: resolvedPath,
            displayFile: speechDisplay,
            volume: targetVolume,
            duckVolume,
            _resolve: resolveFn,
            _reject: rejectFn,
            _settled: false
        });
        this._refreshAudioStatusSnapshot();
        // Process queue if not already processing
        if (!this.isProcessingSpeech) {
            this._processSpeechQueue();
        }
        // Return a promise that resolves when playback completes
        return completionPromise;
    }

    /**
     * Clear speech queue and stop current speech
     */
    async clearSpeechQueue() {
        this.logger.info('Clearing speech queue');

        const queuedItems = this.speechQueue.splice(0);
        for (const item of queuedItems) {
            if (item && !item._settled) {
                item._settled = true;
                if (typeof item._reject === 'function') {
                    try { item._reject({ success: false, error: 'speech_queue_cleared' }); } catch (e) { this.logger.debug('Speech queue reject error:', e.message || e); }
                }
            }
        }

        if (this._currentSpeechItem && !this._currentSpeechItem._settled) {
            this._currentSpeechItem._settled = true;
            if (typeof this._currentSpeechItem._reject === 'function') {
                try { this._currentSpeechItem._reject({ success: false, error: 'speech_interrupted' }); } catch (e) { this.logger.debug('Active speech reject error:', e.message || e); }
            }
        }
        this._currentSpeechItem = null;

        this.currentSpeechFile = null; // Reset current speech file
        if (this._speechMonitor) {
            try { this._speechMonitor.interrupt('clear'); } catch (e) { this.logger.debug('Speech monitor interrupt error:', e.message || e); }
            this._speechMonitor = null;
        }

        if (this.isProcessingSpeech) {
            if (!this.isShuttingDown) {
                try {
                    const response = await this._sendMpvCommand(this.speechSocket, {
                        command: ['stop']
                    });

                    if (response.error && response.error !== 'success') {
                        this.logger.warn(`MPV stop warning: ${response.error}`);
                    }

                    this.isProcessingSpeech = false;
                } catch (error) {
                    this.logger.error('Failed to stop current speech:', error.message || error);
                    // Don't throw here, just log and continue
                    this.isProcessingSpeech = false;
                }
            } else {
                this.logger.debug('Skipping speech stop command during shutdown.');
                this.isProcessingSpeech = false;
            }
        }
        this._refreshAudioStatusSnapshot();
    }

    /**
     * Pause current speech
     */
    async pauseSpeech() {
        if (!this.isInitialized || !this.isProcessingSpeech) {
            return;
        }

        this.logger.info('Pausing speech');

        try {
            await this._sendMpvCommand(this.speechSocket, { command: ['set_property', 'pause', true] });
            if (this._speechMonitor) this._speechMonitor.pause();
        } catch (error) {
            this.logger.error('Failed to pause speech:', error);
        }
    }

    /**
     * Resume current speech
     */
    async resumeSpeech() {
        if (!this.isInitialized) {
            return;
        }

        this.logger.info('Resuming speech');

        try {
            await this._sendMpvCommand(this.speechSocket, { command: ['set_property', 'pause', false] });
            if (this._speechMonitor) this._speechMonitor.resume();
        } catch (error) {
            this.logger.error('Failed to resume speech:', error);
        }
    }

    /**
     * Stop current speech, or a matching item when `{ id }` / `{ file }` is given.
     * No selector keeps the legacy "stop current, continue queue" behaviour.
     * @param {object} [options]
     * @returns {Promise<{success: boolean, warning?: boolean, warning_type?: string, stopped?: string}>}
     */
    async stopSpeech(options = {}) {
        const selector = this._normalizeSelector(options);
        if (selector.id || selector.file) {
            return this._stopSpeechItem(selector);
        }

        if (!this.isInitialized || !this.isProcessingSpeech) {
            return { success: true };
        }

        this.logger.info('Stopping current speech');

        try {
            await this._sendMpvCommand(this.speechSocket, {
                command: ['stop']
            });
            this._refreshAudioStatusSnapshot();
            return { success: true };
        } catch (error) {
            this.logger.error('Failed to stop current speech:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Skip current speech, or drop/skip a matching item when `{ id }` / `{ file }` is given.
     * @param {object} [options]
     */
    async skipSpeech(options = {}) {
        const selector = this._normalizeSelector(options);
        if (selector.id || selector.file) {
            return this._skipSpeechItem(selector);
        }

        if (!this.isInitialized || !this.isProcessingSpeech) {
            return { success: true };
        }

        this.logger.info('Skipping current speech');

        try {
            await this._sendMpvCommand(this.speechSocket, {
                command: ['playlist-next']
            });
            this._refreshAudioStatusSnapshot();
            return { success: true };
        } catch (error) {
            this.logger.error('Failed to skip speech:', error);
            await this.stopSpeech();
            return { success: true };
        }
    }

    /**
     * Pause all audio (background music and speech)
     */
    async pauseAll() {
        await Promise.all([
            this.pauseBackgroundMusic(),
            this.pauseSpeech()
        ]);
    }

    /**
     * Resume all audio (background music and speech)
     */
    async resumeAll() {
        await Promise.all([
            this.resumeBackgroundMusic(),
            this.resumeSpeech()
        ]);
    }    /**
     * Shutdown the audio system
     */
    async shutdown() {
        if (this.isShuttingDown) {
            return;
        }

        this.isShuttingDown = true;
        this._activeSpeechCompletionEvents.clear();
        this._activeSpeechStartEvents.clear();
        this.logger.info('Shutting down audio system...');

        try {
            // Cancel any active fades
            this.cancelBackgroundMusicFade();
            this.cancelSpeechFade();

            // Clear speech queue
            await this.clearSpeechQueue();

            // Stop background music
            if (this._backgroundMonitor) { try { this._backgroundMonitor.interrupt('shutdown'); } catch (_) { } this._backgroundMonitor = null; }
            await this.stopBackgroundMusic();

            const backgroundSockets = this._backgroundSockets();
            await Promise.all([
                ...backgroundSockets.map(socket => this._sendMpvCommand(socket, { command: ['quit'] }).catch(() => { })),
                this._sendMpvCommand(this.speechSocket, { command: ['quit'] }).catch(() => { })
            ]).catch(() => { /* ignore */ });

            const backgroundProcs = [...this.backgrounds.values()].map(bed => bed.process).filter(Boolean);
            if (this.backgroundMusic && !backgroundProcs.includes(this.backgroundMusic)) {
                backgroundProcs.push(this.backgroundMusic);
            }
            const speechProc = this.speechProcess;
            await Promise.all([
                ...backgroundProcs.map((proc, index) => this._terminateProcess(proc, `background:${index}`)),
                this._terminateProcess(speechProc, 'speech')
            ]);
            this.backgrounds.clear();
            this.backgroundMusic = null;
            this.speechProcess = null;

            // Clean up socket files
            this._cleanupSockets();

            // Force-close any lingering MPV IPC clients/timeouts to avoid open handles in tests
            try {
                for (const client of Array.from(this._activeMpvClients)) {
                    try { client.destroy(); } catch (e) { /* ignore */ }
                }
                this._activeMpvClients.clear();
                for (const t of Array.from(this._activeMpvTimeouts)) {
                    try { clearTimeout(t); } catch (e) { /* ignore */ }
                }
                this._activeMpvTimeouts.clear();
            } catch (e) {
                this.logger.debug('Error while force-closing MPV clients:', e.message || e);
            }

            this.logger.info('Audio system shutdown complete');

        } catch (error) {
            this.logger.error('Error during audio system shutdown:', error);
        }
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Initialize background music system
     * @private
     */
    async _initializeBackgroundMusic() {
        this.logger.info('Initializing background music system...');

        // For dual output mode, create a combined sink first
        if (this.dualOutputMode) {
            await this._createCombinedSink();
        }

        await this._initializeSingleBackgroundMusic();
        this.logger.info('Background music system ready');
    }

    async _createCombinedSink() {
        const { spawn } = require('child_process');

        this.logger.info('Setting up PulseAudio combined sink for dual output...');

        // Create a combined sink that outputs to both HDMI devices
        const combinedSinkName = 'paradox_dual_output';

        // First check if the sink already exists
        try {
            const checkSinkExists = await new Promise((resolve, reject) => {
                const process = spawn('pactl', ['list', 'short', 'sinks'], { stdio: 'pipe' });
                let output = '';

                process.stdout.on('data', (data) => {
                    output += data.toString();
                });

                process.on('exit', (code) => {
                    if (code === 0) {
                        const sinkExists = output.includes(combinedSinkName);
                        resolve(sinkExists);
                    } else {
                        reject(new Error(`Failed to check existing sinks, exit code: ${code}`));
                    }
                });

                process.on('error', reject);
            });

            if (checkSinkExists) {
                this.logger.info('Combined sink already exists, using it');
                this.audioDevice = `pulse/${combinedSinkName}`;
                return;
            }
        } catch (error) {
            this.logger.warn('Failed to check existing sinks:', error.message);
        }

        // Create the combined sink if it doesn't exist
        // Remove 'pulse/' prefix from device names for the pactl command
        const primaryDeviceClean = this.primaryDevice.replace('pulse/', '');
        const secondaryDeviceClean = this.secondaryDevice.replace('pulse/', '');
        const sinkCmd = `pactl load-module module-combine-sink sink_name=${combinedSinkName} slaves="${primaryDeviceClean},${secondaryDeviceClean}"`;

        this.logger.info(`Creating combined sink with command: ${sinkCmd}`);

        try {
            await new Promise((resolve, reject) => {
                const process = spawn('sh', ['-c', sinkCmd], { stdio: 'pipe' });

                let stderr = '';
                process.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                process.on('exit', (code) => {
                    if (code === 0) {
                        this.logger.info('Combined sink created successfully');
                        // Update audio device to use the combined sink
                        this.audioDevice = `pulse/${combinedSinkName}`;
                        resolve();
                    } else {
                        this.logger.error(`Failed to create combined sink, exit code: ${code}, stderr: ${stderr}`);
                        reject(new Error(`Failed to create combined sink, exit code: ${code}`));
                    }
                });

                process.on('error', reject);
            });
        } catch (error) {
            this.logger.warn('Failed to create combined sink, falling back to primary device:', error.message);
            this.audioDevice = this.primaryDevice;
        }
    }

    async _initializeSingleBackgroundMusic() {
        await this._ensureBackgroundInstance('default');
    }

    /**
     * Initialize speech system
     * @private
     */
    async _initializeSpeech() {
        this.logger.info('Initializing speech system...');

        const args = [
            '--idle=yes',
            `--input-ipc-server=${this.speechSocket}`,
            '--no-terminal',
            '--no-video',
            `--volume=${this.speechVolume}`,
            `--volume-max=${this.maxVolume}`,
            '--keep-open=yes',
            '--cache=yes',
            '--msg-level=all=info'
        ];

        // Add audio device if specified
        if (this.audioDevice !== 'auto') {
            args.push(`--audio-device=${this.audioDevice}`);
        }
        if (this.audioChannels) {
            args.push(`--audio-channels=${this.audioChannels}`);
        }

        this.logger.debug(`Starting speech MPV with args: ${args.join(' ')}`);
        this.speechProcess = spawn('mpv', args, { detached: false });

        // Capture stdout for diagnostics
        this.speechProcess.stdout?.on('data', (data) => {
            this.logger.debug(`Speech MPV stdout: ${data.toString().trim()}`);
        });

        // Capture stderr for error diagnostics
        this.speechProcess.stderr?.on('data', (data) => {
            const message = data.toString().trim();
            this.logger.warn(`Speech MPV stderr: ${message}`);
        });

        this.speechProcess.on('error', (error) => {
            this.logger.error('Speech process error:', error);
        });

        this.speechProcess.on('exit', (code, signal) => {
            this.logger.warn(`Speech process exited with code ${code}, signal ${signal}`);
            this.speechProcess = null;
        });

        // Wait for socket to be ready
        await this._waitForSocket(this.speechSocket);
        this.logger.info('Speech system ready');
    }

    /**
     * Monitor background music completion for non-looping tracks
     * @private
     */
    async _monitorBackgroundMusicCompletion(filePath) {
        try {
            this.logger.debug(`Monitoring background music completion for: ${filePath}`);

            // Monitor for EOF event
            const defaultBed = this.backgrounds.get('default');
            const socket = (defaultBed && defaultBed.socket) || this.backgroundMusicSocket;
            await this._monitorProperty(socket, 'eof-reached', true);

            // Publish completion event
            const path = require('path');
            const filename = path.basename(filePath);
            this.zone.publishEvent({
                type: 'background',
                state: 'ended',
                file: filename
            });
            this.logger.info(`🎵 Published background music completion event for: ${filename}`);

        } catch (error) {
            this.logger.error(`Error monitoring background music completion for ${filePath}:`, error.message || error);
        }
    }

    /**
     * Process speech queue with background music ducking
     * @private
     */
    async _processSpeechQueue() {
        if (this.isProcessingSpeech || this.speechQueue.length === 0) {
            if (this.isProcessingSpeech) this.logger.debug('Speech queue processor busy.');
            return;
        }

        this.isProcessingSpeech = true;
        this.logger.debug('Speech queue processor started.');

        while (this.speechQueue.length > 0) {
            const speechItem = this.speechQueue.shift();
            this.currentSpeechFile = speechItem.filePath;
            this._currentSpeechItem = speechItem;

            try {
                this.logger.info(`Processing speech: ${speechItem.filePath}`);
                this._beforeAudioOutput();

                // Background ducking is managed by the Zone layer; AudioManager only plays speech.

                this.logger.debug('Sending loadfile command to speech player.');
                await this._sendMpvCommand(this.speechSocket, {
                    command: ['loadfile', speechItem.filePath, 'replace']
                });

                this.logger.debug(`Setting speech volume to ${speechItem.volume}.`);
                await this._sendMpvCommand(this.speechSocket, {
                    command: ['set_property', 'volume', speechItem.volume]
                });

                // Un-pause the player to ensure it starts playing
                this.logger.debug('Ensuring speech player is not paused.');
                await this._sendMpvCommand(this.speechSocket, {
                    command: ['set_property', 'pause', false]
                });

                if (this.zone) {
                    const filename = path.basename(speechItem.filePath);
                    const previousStart = this._activeSpeechStartEvents.get(filename);
                    if (previousStart) {
                        previousStart.speech_started_actual = null;
                    }
                    const startMessage = this.zone.publishMessage('events', {
                        command: 'playSpeech',
                        speech_started_actual: filename,
                        file: filename,
                        volume: speechItem.volume
                    });
                    this._activeSpeechStartEvents.set(filename, startMessage);
                    this.logger.info(`Published speech start for: ${filename}`);
                }

                // Attempt to fetch duration with a few short retries (mpv may not populate immediately)
                let durationMs = null;
                for (let attempt = 0; attempt < 12 && durationMs == null; attempt++) {
                    try {
                        const resp = await this._sendMpvCommand(this.speechSocket, { command: ['get_property', 'duration'] });
                        if (resp && typeof resp.data === 'number') {
                            durationMs = Math.round(resp.data * 1000);
                            break;
                        }
                    } catch (e) {
                        // ignore between retries
                    }
                    if (durationMs == null) await new Promise(r => setTimeout(r, 100));
                }
                if (!durationMs) {
                    this.logger.warn('Speech duration unavailable; timing-based completion disabled for this item (no completion event will fire).');
                }

                const naturalCompletionPromise = new Promise((resolveNatural) => {
                    if (!durationMs) return resolveNatural(false);
                    this._speechMonitor = new PlaybackMonitor({
                        expectedDurationMs: durationMs,
                        onComplete: () => resolveNatural(true),
                        onInterrupt: () => resolveNatural(false)
                    });
                    this._speechMonitor.start();
                });

                // Wait for natural completion or interruption
                const natural = await naturalCompletionPromise;
                const startedAt = this._speechMonitor && this._speechMonitor._startedAt ? this._speechMonitor._startedAt : null;
                const elapsedMs = startedAt ? (Date.now() - startedAt - (this._speechMonitor ? this._speechMonitor._accumulatedPause : 0)) : null;
                this.logger.info(`Finished speech: ${speechItem.filePath} (natural=${natural})`);

                if (this.zone) {
                    const filename = path.basename(speechItem.filePath);
                    // Publish consolidated event for both natural and interrupted endings
                    if (natural) {
                        this._expirePriorSpeechCompletion(filename);
                        const eventMessage = this.zone.publishMessage('events', {
                            command: 'playSpeech',
                            file: filename,
                            speech_completed: true,
                            completed_naturally: true,
                            done: true,
                            message: 'Full file played'
                        });
                        this._activeSpeechCompletionEvents.set(filename, eventMessage);
                        this.logger.info(`Published speech completion (full) for: ${filename}`);
                    } else {
                        // Interrupted path retains elapsed timestamp if available
                        let human = null;
                        if (elapsedMs != null) {
                            const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
                            const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
                            const ss = String(totalSec % 60).padStart(2, '0');
                            human = `${mm}:${ss}`;
                        }
                        this._expirePriorSpeechCompletion(filename);
                        const eventMessage = this.zone.publishMessage('events', {
                            command: 'playSpeech',
                            file: filename,
                            speech_completed: false,
                            completed_naturally: false,
                            done: true,
                            message: human ? `Interrupted at ${human}` : 'Interrupted'
                        });
                        this._activeSpeechCompletionEvents.set(filename, eventMessage);
                        this.logger.info(`Published speech completion (interrupted) for: ${filename}`);
                    }
                }

                // Resolve per-item completion promise if present
                if (!speechItem._settled && typeof speechItem._resolve === 'function') {
                    speechItem._settled = true;
                    try { speechItem._resolve({ success: true, natural }); } catch (e) { this.logger.debug('Speech resolve error', e); }
                }

            } catch (error) {
                this.logger.error(`Error playing speech file ${speechItem.filePath}:`, error.message || error);
                // Reject per-item completion promise if present
                if (!speechItem._settled && typeof speechItem._reject === 'function') {
                    speechItem._settled = true;
                    try { speechItem._reject({ success: false, error: error.message || error }); } catch (e) { this.logger.debug('Speech reject error', e); }
                }
                // We still want to continue to the finally block to restore volume and continue the queue
            } finally {
                if (this._speechMonitor) { this._speechMonitor.interrupt('advance'); this._speechMonitor = null; }
                this.currentSpeechFile = null; // Clear current file
                this._currentSpeechItem = null;
                this._refreshAudioStatusSnapshot();
                this.logger.debug('Speech item processing finished.');
            }
            // Small delay between speech items
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        this.isProcessingSpeech = false;
        this.logger.debug('Speech queue is empty. Processor is stopping.');
    }

    expirePriorSpeechCompletion(filename) {
        this._expirePriorSpeechCompletion(filename);
    }

    _expirePriorSpeechCompletion(filename) {
        if (!filename) return;
        const previous = this._activeSpeechCompletionEvents.get(filename);
        if (previous) {
            previous.speech_completed = false;
            if (previous.completed_naturally !== undefined) {
                previous.completed_naturally = false;
            }
        }
    }

    async _terminateProcess(proc, label = 'process') {
        if (!proc) return;

        if (typeof proc.unref === 'function') {
            try { proc.unref(); } catch (_) { /* ignore */ }
        }

        await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                try { clearTimeout(timeout); } catch (_) { /* ignore */ }
                resolve();
            };
            const timeout = setTimeout(() => {
                this.logger.debug(`Force terminating ${label} process after timeout.`);
                try { proc.kill('SIGKILL'); } catch (_) { /* ignore */ }
                finish();
            }, 3000);

            proc.once('exit', finish);
            proc.once('error', finish);

            try {
                if (!proc.killed) {
                    proc.kill('SIGTERM');
                }
            } catch (error) {
                this.logger.debug(`Failed to send SIGTERM to ${label} process:`, error.message || error);
                finish();
            }
        });
    }

    /**
     * Send IPC command to MPV instance
     * @private
     */
    _sendMpvCommand(socketPath, cmdObj) {
        return new Promise((resolve, reject) => {
            if (this.isShuttingDown) return reject(new Error('Shutting down'));

            const client = net.createConnection(socketPath, () => {
                const cmdString = JSON.stringify(cmdObj) + '\n';
                this.logger.debug(`Sending MPV command to ${socketPath}: ${cmdString.trim()}`);
                client.write(cmdString);
            });

            let buffer = '';
            const timeout = setTimeout(() => {
                try { client.destroy(); } catch (e) { /* ignore */ }
                this._activeMpvTimeouts.delete(timeout);
                reject(new Error(`Command timed out: ${JSON.stringify(cmdObj)}`));
            }, 5000);
            // track active client/timeout so shutdown can force-close them
            this._activeMpvClients.add(client);
            this._activeMpvTimeouts.add(timeout);

            client.on('data', (chunk) => {
                buffer += chunk.toString();

                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.substring(0, newlineIndex);
                    buffer = buffer.substring(newlineIndex + 1);

                    if (line.trim() === '') continue;

                    try {
                        const responseJson = JSON.parse(line);
                        this.logger.debug('MPV response JSON:', responseJson);
                        if (responseJson.error !== undefined) {
                            clearTimeout(timeout);
                            client.end();
                            resolve(responseJson);
                            return;
                        }
                    } catch (parseError) {
                        // Ignore parsing errors for events, but log them for debugging
                        this.logger.debug('IPC parse error:', parseError.message, 'Line:', line);
                    }
                }
            });

            client.on('end', () => {
                this.logger.debug(`MPV client socket ${socketPath} ended.`);
                try { clearTimeout(timeout); } catch (e) { /* ignore */ }
                this._activeMpvClients.delete(client);
                this._activeMpvTimeouts.delete(timeout);
            });
            client.on('close', () => {
                this.logger.debug(`MPV client socket ${socketPath} closed.`);
                try { clearTimeout(timeout); } catch (e) { /* ignore */ }
                this._activeMpvClients.delete(client);
                this._activeMpvTimeouts.delete(timeout);
            });
            client.on('error', (err) => {
                try { clearTimeout(timeout); } catch (e) { /* ignore */ }
                this._activeMpvClients.delete(client);
                this._activeMpvTimeouts.delete(timeout);
                reject(new Error(`IPC connection error: ${err.message}`));
            });
        });
    }

    /**
     * Monitor MPV property for changes
     * @private
     */
    async _monitorProperty(socketPath, property, targetValue) {
        this.logger.debug(`Monitoring property '${property}' for target value '${targetValue}' on socket ${socketPath}`);
        // First, try to get the current value. If it already matches, we're done.
        try {
            const response = await this._sendMpvCommand(socketPath, {
                command: ['get_property', property]
            });
            this.logger.debug(`Initial value of property '${property}' is '${response.data}'`);
            if (response.data === targetValue) {
                this.logger.debug(`Property '${property}' already has target value '${targetValue}'.`);
                return;
            }
        } catch (e) {
            this.logger.warn(`Could not get initial value for property '${property}', proceeding to observe. Error: ${e.message}`);
        }

        // If the value doesn't match, we start observing for the change.
        return new Promise((resolve, reject) => {
            if (this.isShuttingDown) return reject(new Error('Shutting down'));

            const client = net.createConnection(socketPath, () => {
                const observeCmd = JSON.stringify({ command: ['observe_property', 1, property] }) + '\n';
                this.logger.debug(`Observing property '${property}'...`);
                client.write(observeCmd);
            });

            let buffer = '';
            const timeout = setTimeout(() => {
                try { client.destroy(); } catch (e) { /* ignore */ }
                this._activeMpvTimeouts.delete(timeout);
                this.logger.error(`Property monitoring timed out for ${property}`);
                reject(new Error(`Property monitoring timed out for ${property}`));
            }, 30000); // 30 second timeout

            // track active client/timeout so shutdown can force-close them
            this._activeMpvClients.add(client);
            this._activeMpvTimeouts.add(timeout);

            client.on('data', (chunk) => {
                buffer += chunk.toString();
                this.logger.debug(`Property monitor received data: ${buffer}`);

                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.substring(0, newlineIndex);
                    buffer = buffer.substring(newlineIndex + 1);

                    if (line.trim() === '') continue;

                    try {
                        const responseJson = JSON.parse(line);
                        this.logger.debug(`Parsed property data:`, responseJson);

                        if (responseJson.event === 'property-change' &&
                            responseJson.name === property &&
                            responseJson.data === targetValue) {

                            this.logger.debug(`Property '${property}' changed to target value '${targetValue}'.`);
                            // Unobserve the property before closing
                            const unobserveCmd = JSON.stringify({ command: ['unobserve_property', 1] }) + '\n';
                            client.write(unobserveCmd);

                            try { clearTimeout(timeout); } catch (e) { /* ignore */ }
                            client.end();
                            this._activeMpvClients.delete(client);
                            this._activeMpvTimeouts.delete(timeout);
                            resolve();
                            return;
                        }
                    } catch (parseError) {
                        this.logger.debug(`Property monitor parse error: ${parseError.message}`);
                    }
                }
            });

            client.on('error', (err) => {
                try { clearTimeout(timeout); } catch (e) { /* ignore */ }
                this._activeMpvClients.delete(client);
                this._activeMpvTimeouts.delete(timeout);
                this.logger.error(`Property monitoring socket error: ${err.message}`);
                reject(new Error(`Property monitoring error: ${err.message}`));
            });

            client.on('close', () => {
                this.logger.debug(`Property monitor socket closed.`);
                try { clearTimeout(timeout); } catch (e) { /* ignore */ }
                this._activeMpvClients.delete(client);
                this._activeMpvTimeouts.delete(timeout);
            });
        });
    }

    /**
     * Wait for MPV socket to be ready
     * @private
     */
    async _waitForSocket(socketPath, maxRetries = 80) {
        for (let i = 0; i < maxRetries; i++) {
            if (fs.existsSync(socketPath)) {
                this.logger.debug(`Socket ready at ${socketPath}`);
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        throw new Error(`Socket not ready after ${maxRetries} attempts: ${socketPath}`);
    }

    /**
     * Clean up socket files
     * @private
     */
    _cleanupSockets() {
        const sockets = new Set([this.backgroundMusicSocket, this.speechSocket, ...this._backgroundSockets()]);
        sockets.forEach(socket => {
            try {
                if (socket && fs.existsSync(socket)) {
                    fs.unlinkSync(socket);
                }
            } catch (error) {
                // Ignore errors during cleanup
            }
        });
    }

    /**
     * Snapshot of every bed and speech item (sync; timings may be stale until getAudioStatus).
     * @returns {{backgrounds: object[], speech: {current: object|null, queue: object[]}}}
     */
    getAudioStatusSnapshot() {
        if (this._audioStatusCache) {
            return this._audioStatusCache;
        }
        return this._refreshAudioStatusSnapshot();
    }

    /**
     * Query mpv for pause / time-pos / duration and return current audio status.
     * @returns {Promise<{backgrounds: object[], speech: {current: object|null, queue: object[]}}>}
     */
    async getAudioStatus() {
        const backgrounds = [];
        for (const bed of this.backgrounds.values()) {
            if (!bed.file) continue;
            const timing = await this._queryPlaybackTiming(bed.socket);
            backgrounds.push(this._backgroundStatusItem(bed, timing));
        }

        let current = null;
        if (this.currentSpeechFile) {
            const item = this._currentSpeechItem;
            const timing = await this._queryPlaybackTiming(this.speechSocket);
            current = {
                id: (item && item.id) || path.basename(this.currentSpeechFile),
                file: (item && item.displayFile) || this._toDisplayFile(this.currentSpeechFile),
                state: timing.paused ? 'paused' : 'playing',
                time_left_s: timing.time_left_s,
                duration_s: timing.duration_s
            };
        }

        const queue = this.speechQueue.map(item => ({
            id: item.id || path.basename(item.filePath),
            file: item.displayFile || this._toDisplayFile(item.filePath),
            state: 'queued',
            time_left_s: null,
            duration_s: null
        }));

        this._audioStatusCache = { backgrounds, speech: { current, queue } };
        return this._audioStatusCache;
    }

    async refreshAudioStatus() {
        return this.getAudioStatus();
    }

    hasActiveBackground() {
        return this._activeBackgroundBeds().length > 0;
    }

    hasBackgroundSelector(options = {}) {
        const selector = this._normalizeSelector(options);
        if (!selector.id && !selector.file) {
            return true;
        }
        return this._findBackgrounds(selector).length > 0;
    }

    hasSpeechSelector(options = {}) {
        const selector = this._normalizeSelector(options);
        if (!selector.id && !selector.file) {
            return true;
        }
        if (this._currentSpeechItem && this._speechMatches(this._currentSpeechItem, selector)) {
            return true;
        }
        return this.speechQueue.some(item => this._speechMatches(item, selector));
    }

    _resolveBackgroundId(id) {
        if (id === undefined || id === null || String(id).trim() === '') {
            return 'default';
        }
        return String(id).trim();
    }

    _normalizeSelector(options) {
        if (!options || typeof options !== 'object') {
            return {};
        }
        const id = options.id !== undefined && options.id !== null && String(options.id).trim() !== ''
            ? String(options.id).trim()
            : undefined;
        const file = options.file !== undefined && options.file !== null && String(options.file).trim() !== ''
            ? String(options.file).trim()
            : undefined;
        return { id, file };
    }

    _toDisplayFile(filePath) {
        if (!filePath) return null;
        const base = this.config && this.config.baseMediaPath;
        if (base) {
            const resolvedBase = path.resolve(base);
            const resolvedFile = path.resolve(filePath);
            if (resolvedFile.startsWith(resolvedBase + path.sep) || resolvedFile === resolvedBase) {
                return path.relative(resolvedBase, resolvedFile);
            }
        }
        return path.basename(filePath);
    }

    _fileMatches(storedPath, storedDisplay, selector) {
        if (!selector) return false;
        const sel = String(selector);
        const candidates = [storedPath, storedDisplay]
            .filter(Boolean)
            .flatMap(value => [value, path.basename(value)]);
        return candidates.some(candidate => candidate === sel || candidate.endsWith(sel) || path.basename(candidate) === path.basename(sel));
    }

    _findBackgrounds({ id, file } = {}) {
        if (id) {
            const bed = this.backgrounds.get(id);
            return bed ? [bed] : [];
        }
        if (file) {
            return [...this.backgrounds.values()].filter(bed => this._fileMatches(bed.file, bed.displayFile, file));
        }
        return [...this.backgrounds.values()];
    }

    _activeBackgroundBeds() {
        return [...this.backgrounds.values()].filter(bed => bed.file);
    }

    _activeBackgroundIds() {
        return this._activeBackgroundBeds().map(bed => bed.id);
    }

    _backgroundSockets() {
        const sockets = [...this.backgrounds.values()].map(bed => bed.socket).filter(Boolean);
        if (this.backgroundMusicSocket && !sockets.includes(this.backgroundMusicSocket)) {
            sockets.push(this.backgroundMusicSocket);
        }
        return sockets;
    }

    _backgroundSocketPath(id) {
        if (id === 'default') {
            return this.backgroundMusicSocket;
        }
        return `/tmp/pfx-background-music-${this._safeZoneId}-${Utils.sanitizeFilename(id)}.sock`;
    }

    async _ensureBackgroundInstance(id) {
        const existing = this.backgrounds.get(id);
        if (existing && existing.process && !existing.process.killed) {
            return existing;
        }

        const inFlight = this._backgroundEnsureInFlight.get(id);
        if (inFlight) {
            return inFlight;
        }

        const ensurePromise = this._spawnBackgroundInstance(id);
        this._backgroundEnsureInFlight.set(id, ensurePromise);
        try {
            return await ensurePromise;
        } finally {
            if (this._backgroundEnsureInFlight.get(id) === ensurePromise) {
                this._backgroundEnsureInFlight.delete(id);
            }
        }
    }

    /**
     * Spawn (or recreate) the idle mpv for one background bed id.
     * @private
     */
    async _spawnBackgroundInstance(id) {
        const existing = this.backgrounds.get(id);
        const socket = (existing && existing.socket) || this._backgroundSocketPath(id);
        try {
            if (fs.existsSync(socket)) {
                fs.unlinkSync(socket);
            }
        } catch (_) { /* ignore */ }

        const proc = await this._spawnIdleMpv(socket, `background:${id}`);
        const bed = {
            id,
            process: proc,
            socket,
            file: existing ? existing.file : null,
            displayFile: existing ? existing.displayFile : null,
            volume: existing ? existing.volume : this.backgroundMusicVolume,
            loop: existing ? existing.loop : false,
            monitor: existing ? existing.monitor : null
        };
        this.backgrounds.set(id, bed);
        if (id === 'default') {
            this.backgroundMusic = proc;
        }
        return bed;
    }

    async _spawnIdleMpv(socketPath, label) {
        const args = [
            '--idle=yes',
            `--input-ipc-server=${socketPath}`,
            '--no-terminal',
            '--no-video',
            `--volume=${this.backgroundMusicVolume}`,
            `--volume-max=${this.maxVolume}`,
            '--cache=yes',
            '--msg-level=all=info'
        ];

        if (this.audioDevice !== 'auto') {
            args.push(`--audio-device=${this.audioDevice}`);
        }
        if (this.audioChannels) {
            args.push(`--audio-channels=${this.audioChannels}`);
        }

        this.logger.debug(`Starting ${label} MPV with args: ${args.join(' ')}`);
        const proc = spawn('mpv', args, { detached: false });

        proc.stdout?.on('data', (data) => {
            this.logger.debug(`${label} MPV stdout: ${data.toString().trim()}`);
        });
        proc.stderr?.on('data', (data) => {
            this.logger.warn(`${label} MPV stderr: ${data.toString().trim()}`);
        });
        proc.on('error', (error) => {
            this.logger.error(`${label} process error:`, error);
        });
        proc.on('exit', (code, signal) => {
            this.logger.warn(`${label} process exited with code ${code}, signal ${signal}`);
            if (label === 'background:default' || socketPath === this.backgroundMusicSocket) {
                this.backgroundMusic = null;
            }
            for (const bed of this.backgrounds.values()) {
                if (bed.process === proc) {
                    bed.process = null;
                }
            }
        });

        await this._waitForSocket(socketPath);
        return proc;
    }

    async _loadBackgroundOnBed(bed, filePath, volume, loop, { displayFile } = {}) {
        if (bed.monitor) {
            try { bed.monitor.interrupt('replace'); } catch (_) { }
            bed.monitor = null;
        }
        if (bed.id === 'default' && this._backgroundMonitor) {
            try { this._backgroundMonitor.interrupt('replace'); } catch (_) { }
            this._backgroundMonitor = null;
        }

        await this._sendMpvCommand(bed.socket, {
            command: ['loadfile', filePath, 'replace']
        });
        await this._sendMpvCommand(bed.socket, {
            command: ['set_property', 'loop-file', loop ? 'inf' : 'no']
        });
        await this._sendMpvCommand(bed.socket, {
            command: ['set_property', 'volume', volume]
        });
        await this._sendMpvCommand(bed.socket, {
            command: ['set_property', 'pause', false]
        }).catch(() => { });

        bed.file = filePath;
        bed.displayFile = displayFile || this._toDisplayFile(filePath);
        bed.volume = volume;
        bed.loop = !!loop;

        this.logger.info(`Background music started successfully (loop: ${loop}, id: ${bed.id})`);
        this._startBackgroundMonitor(bed, filePath, loop);
    }

    _startBackgroundMonitor(bed, filePath, loop) {
        if (!this.zone) {
            return;
        }

        const startMonitor = async () => {
            let durationMs = null;
            for (let attempt = 0; attempt < 12 && durationMs == null; attempt++) {
                try {
                    const resp = await this._sendMpvCommand(bed.socket, { command: ['get_property', 'duration'] });
                    if (resp && typeof resp.data === 'number') {
                        durationMs = Math.round(resp.data * 1000);
                        break;
                    }
                } catch (_) { }
                if (durationMs == null) await new Promise(r => setTimeout(r, 100));
            }
            if (!durationMs) {
                this.logger.warn('Background duration unavailable; completion events disabled for this track.');
                return;
            }

            const createLoopMonitor = () => {
                const m = new PlaybackMonitor({
                    expectedDurationMs: durationMs,
                    onComplete: () => {
                        if (!loop) {
                            this.zone.publishMessage('events', {
                                command: 'playBackground',
                                file: path.basename(filePath),
                                id: bed.id,
                                done: true,
                                message: 'Full file played'
                            });
                        } else {
                            this.zone.publishMessage('events', {
                                command: 'playBackground',
                                file: path.basename(filePath),
                                id: bed.id,
                                done: false,
                                message: 'File looped, starting over'
                            });
                            if (!this.isShuttingDown) {
                                createLoopMonitor();
                            }
                        }
                    },
                    onInterrupt: () => {
                        let human = null;
                        try {
                            const startedAt = m._startedAt;
                            const elapsed = startedAt ? (Date.now() - startedAt - m._accumulatedPause) : null;
                            if (elapsed != null) {
                                const totalSec = Math.max(0, Math.floor(elapsed / 1000));
                                const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
                                const ss = String(totalSec % 60).padStart(2, '0');
                                human = `${mm}:${ss}`;
                            }
                        } catch (_) { /* ignore */ }
                        this.zone.publishMessage('events', {
                            command: 'playBackground',
                            file: path.basename(filePath),
                            id: bed.id,
                            done: true,
                            message: human ? `File playback interrupted at ${human}` : 'File playback interrupted'
                        });
                    }
                });
                bed.monitor = m;
                if (bed.id === 'default') {
                    this._backgroundMonitor = m;
                }
                m.start();
            };
            createLoopMonitor();
        };

        startMonitor().catch(error => {
            this.logger.debug('Background monitor setup failed:', error.message || error);
        });
    }

    async _stopOneBackground(bed) {
        this.logger.info(`Stopping background music (${bed.id || 'default'})`);
        if (bed.monitor) {
            try { bed.monitor.interrupt('stop'); } catch (_) { }
            bed.monitor = null;
        }
        if ((bed.id === 'default' || !bed.id) && this._backgroundMonitor) {
            try { this._backgroundMonitor.interrupt('stop'); } catch (_) { }
            this._backgroundMonitor = null;
        }

        if (bed.socket) {
            try {
                await this._sendMpvCommand(bed.socket, { command: ['stop'] });
            } catch (error) {
                this.logger.debug('Background music stop noop or error (ignored):', error && (error.message || error));
            }
        }

        bed.file = null;
        bed.displayFile = null;
        bed.loop = false;

        if (bed.id && bed.id !== 'default') {
            try {
                await this._sendMpvCommand(bed.socket, { command: ['quit'] }).catch(() => { });
            } catch (_) { /* ignore */ }
            await this._terminateProcess(bed.process, `background:${bed.id}`);
            this.backgrounds.delete(bed.id);
        }
    }

    async _setBackgroundPause(paused, options = {}) {
        if (!this.isInitialized) {
            return { success: true };
        }

        const selector = this._normalizeSelector(options);
        const targeted = !!(selector.id || selector.file);
        const beds = targeted ? this._findBackgrounds(selector) : this._activeBackgroundBeds();

        if (targeted && beds.length === 0) {
            this.logger.warn(`${paused ? 'pause' : 'resume'}Background: unknown bed id=${selector.id || ''} file=${selector.file || ''}`);
            return { success: true, warning: true, warning_type: 'unknown_background' };
        }

        const targets = beds.length ? beds : [{ socket: this.backgroundMusicSocket, id: 'default' }];
        this.logger.info(`${paused ? 'Pausing' : 'Resuming'} background music${targeted ? ` (${targets.map(b => b.id).join(', ')})` : ''}`);

        try {
            for (const bed of targets) {
                await this._sendMpvCommand(bed.socket, {
                    command: ['set_property', 'pause', paused]
                });
            }
            this._refreshAudioStatusSnapshot();
            return { success: true };
        } catch (error) {
            this.logger.error(`Failed to ${paused ? 'pause' : 'resume'} background music:`, error);
            return { success: false, error: error.message };
        }
    }

    _speechMatches(item, { id, file } = {}) {
        if (!item) return false;
        if (id && item.id === id) return true;
        if (file) {
            return this._fileMatches(item.filePath, item.displayFile, file)
                || item.id === path.basename(file, path.extname(file));
        }
        return false;
    }

    _rejectSpeechItem(item, reason) {
        if (item && !item._settled) {
            item._settled = true;
            if (typeof item._reject === 'function') {
                try { item._reject({ success: false, error: reason }); } catch (e) { this.logger.debug('Speech reject error:', e.message || e); }
            }
        }
    }

    async _stopSpeechItem(selector) {
        if (this._currentSpeechItem && this._speechMatches(this._currentSpeechItem, selector)) {
            this.logger.info(`Stopping matching current speech (${this._currentSpeechItem.id})`);
            this._rejectSpeechItem(this._currentSpeechItem, 'speech_interrupted');
            try {
                await this._sendMpvCommand(this.speechSocket, { command: ['stop'] });
            } catch (error) {
                this.logger.error('Failed to stop matching speech:', error);
            }
            this._refreshAudioStatusSnapshot();
            return { success: true, stopped: this._currentSpeechItem.id };
        }

        const index = this.speechQueue.findIndex(item => this._speechMatches(item, selector));
        if (index === -1) {
            this.logger.warn(`stopSpeech: unknown item id=${selector.id || ''} file=${selector.file || ''}`);
            return { success: true, warning: true, warning_type: 'unknown_speech' };
        }

        const [removed] = this.speechQueue.splice(index, 1);
        this._rejectSpeechItem(removed, 'speech_interrupted');
        this.logger.info(`Dropped queued speech (${removed.id})`);
        this._refreshAudioStatusSnapshot();
        return { success: true, stopped: removed.id };
    }

    async _skipSpeechItem(selector) {
        if (this._currentSpeechItem && this._speechMatches(this._currentSpeechItem, selector)) {
            return this.skipSpeech();
        }

        const index = this.speechQueue.findIndex(item => this._speechMatches(item, selector));
        if (index === -1) {
            this.logger.warn(`skipSpeech: unknown item id=${selector.id || ''} file=${selector.file || ''}`);
            return { success: true, warning: true, warning_type: 'unknown_speech' };
        }

        const [removed] = this.speechQueue.splice(index, 1);
        this._rejectSpeechItem(removed, 'speech_interrupted');
        this.logger.info(`Skipped queued speech (${removed.id})`);
        this._refreshAudioStatusSnapshot();
        return { success: true, skipped: removed.id };
    }

    async _queryPlaybackTiming(socket) {
        let paused = false;
        let timePos = null;
        let duration = null;

        try {
            const pauseResp = await this._sendMpvCommand(socket, { command: ['get_property', 'pause'] });
            paused = !!pauseResp.data;
        } catch (_) { /* ignore */ }
        try {
            const timeResp = await this._sendMpvCommand(socket, { command: ['get_property', 'time-pos'] });
            if (typeof timeResp.data === 'number') timePos = timeResp.data;
        } catch (_) { /* ignore */ }
        try {
            const durationResp = await this._sendMpvCommand(socket, { command: ['get_property', 'duration'] });
            if (typeof durationResp.data === 'number') duration = durationResp.data;
        } catch (_) { /* ignore */ }

        let timeLeft = null;
        if (duration != null && timePos != null) {
            timeLeft = Math.max(0, duration - timePos);
        }

        return {
            paused,
            time_left_s: timeLeft == null ? null : Math.round(timeLeft * 10) / 10,
            duration_s: duration == null ? null : Math.round(duration * 10) / 10
        };
    }

    _backgroundStatusItem(bed, timing = {}) {
        return {
            id: bed.id,
            file: bed.displayFile || this._toDisplayFile(bed.file),
            state: timing.paused ? 'paused' : 'playing',
            time_left_s: timing.time_left_s != null ? timing.time_left_s : null,
            duration_s: timing.duration_s != null ? timing.duration_s : null,
            loop: !!bed.loop
        };
    }

    _refreshAudioStatusSnapshot() {
        const backgrounds = this._activeBackgroundBeds().map(bed => this._backgroundStatusItem(bed));
        let current = null;
        if (this.currentSpeechFile) {
            const item = this._currentSpeechItem;
            current = {
                id: (item && item.id) || path.basename(this.currentSpeechFile),
                file: (item && item.displayFile) || this._toDisplayFile(this.currentSpeechFile),
                state: 'playing',
                time_left_s: null,
                duration_s: null
            };
        }
        const queue = this.speechQueue.map(item => ({
            id: item.id || path.basename(item.filePath),
            file: item.displayFile || this._toDisplayFile(item.filePath),
            state: 'queued',
            time_left_s: null,
            duration_s: null
        }));
        this._audioStatusCache = { backgrounds, speech: { current, queue } };
        return this._audioStatusCache;
    }
}

module.exports = AudioManager;
