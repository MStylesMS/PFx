/**
 * Screen Zone
 * 
 * Handles screen zones with full multimedia capabilities:
 * - Image display
 * - Video playback  
 * - Audio playback (background music, speech, sound effects)
 * - Screen power management
 */

const { execSync } = require('child_process');
const BaseZone = require('./base-zone');
const MediaPlayerFactory = require('../media/media-player-factory');
const ScreenPowerManager = require('../utils/screen-power-manager');
const AudioManager = require('../media/audio-manager');
const WindowManager = require('../utils/window-manager');
const { applyScreenResolution } = require('../utils/screen-resolution-helper');
const { resolveEffectiveVolume } = require('../audio/resolve-effective-volume'); // PR-VOLUME Phase 8
// Unified video queue implementation helpers (ffprobe + pause-aware tracker)
const { VideoPlaybackTracker } = require('../media/video-playback-tracker');
const { probeDurationSeconds } = require('../media/ffprobe-duration');

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

    // Helper duplicated (temporary) from audio-zone until consolidated into BaseZone
    _resolveDeviceMediaDir(config) {
        const path = require('path');
        const deviceMediaDir = config.mediaDir || config.media_dir || '';
        if (deviceMediaDir && path.isAbsolute(deviceMediaDir)) return deviceMediaDir;
        // Use default base path for relative media_dir values; do not rely on media_base_path
        return path.join('/opt/paradox/media', deviceMediaDir);
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
                this.publishCommandOutcome({
                    command: 'internal:mpv',
                    outcome: 'warning',
                    parameters: { event: 'mpv_exited', code: info.code, signal: info.signal, attempts: info.attempts },
                    warning_type: 'mpv_exited',
                    message: `MPV process exited (code=${info.code}, signal=${info.signal}).`
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
                    await this._playAudio(command.file || command.audio, { adjustVolume: command.adjustVolume, channel: command.channel, volume: command.volume });
                    break;
                case 'playBackground':
                    await this._playBackgroundMusic(command.file || command.audio, {
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
                    await this._playSpeech(command.file || command.audio, command.volume, command.ducking, { adjustVolume: command.adjustVolume });
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
                    await this._playSoundEffect(command.file || command.audio, { volume: command.volume, adjustVolume: command.adjustVolume });
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

                // Browser/Clock commands
                case 'enableBrowser':
                    await this._enableBrowser(command.url);
                    break;
                case 'disableBrowser':
                    await this._disableBrowser();
                    break;
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
            'enableBrowser', 'disableBrowser', 'showBrowser', 'hideBrowser', 'setBrowserUrl', 'setBrowserKeepAlive'
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
        const imagePath = command.file || command.image; // Support both 'file' and legacy 'image'
        if (!imagePath) {
            throw new Error('Image path is required');
        }

        // Validate file exists before proceeding
        const fileValidation = await this._validateMediaFile(imagePath);
        if (!fileValidation.exists) {
            this.publishMessage('warning', {
                message: fileValidation.error,
                command: 'setImage',
                file: imagePath
            });
            this.logger.warn(fileValidation.error);
            return; // Don't update state if file doesn't exist
        }

        await this.screenPowerManager.autoWakeForMedia('image');

        const fullPath = fileValidation.path;

        // Smart media handling: Check if this is actually a video file
        const isVideo = this._isVideoFile(imagePath);

        if (isVideo) {
            this.logger.info(`🎬 Smart setImage: Detected video file, loading and pausing on first frame: ${imagePath}`);

            // Load video and pause on first frame
            await this.mpvZoneManager.loadMedia(fullPath);

            // Give MPV a moment to load the video, then pause it
            await new Promise(resolve => setTimeout(resolve, 100));
            await this.mpvZoneManager.pause();

            // Update smart media state
            this.smartMediaState.lastCommand = 'setImage';
            this.smartMediaState.lastMediaPath = imagePath;
            this.smartMediaState.currentLoadedPath = imagePath;
            this.smartMediaState.isVideoPaused = true;

            // Update zone state as if it's an image
            this.currentState.currentImage = imagePath;
            this.currentState.currentVideo = null;
            this.currentState.status = 'showing_image';
            this.mpvInstances.media.currentFile = imagePath;
        } else {
            // Regular image handling
            this.logger.info(`🖼️ Smart setImage: Loading image file: ${imagePath}`);
            await this.mpvZoneManager.loadMedia(fullPath);

            // Update smart media state for images too
            this.smartMediaState.lastCommand = 'setImage';
            this.smartMediaState.lastMediaPath = imagePath;
            this.smartMediaState.currentLoadedPath = imagePath;
            this.smartMediaState.isVideoPaused = false;

            // Update zone state
            this.currentState.currentImage = imagePath;
            this.currentState.currentVideo = null;
            this.currentState.status = 'showing_image';
            this.mpvInstances.media.currentFile = imagePath;
        }

        this.publishStatus();
        // Emit unified start-shaped event for setImage requests, including video-first-frame semantics
        this.publishEvent({
            command: 'setImage',
            file: imagePath,
            started: true,
            media_type: isVideo ? 'video' : 'image',
            paused_first_frame: isVideo ? true : undefined,
            queue_remaining: this.videoQueue.length,
            ts: new Date().toISOString()
        });
        this.logger.debug(`Image set: ${imagePath} (${isVideo ? 'video paused on first frame' : 'static image'})`);
    }

    async _setDefaultImage() {
        try {
            // Validate file exists before proceeding
            const fileValidation = await this._validateMediaFile(this.defaultImage);
            if (!fileValidation.exists) {
                this.logger.warn(`Default image not found: ${fileValidation.error}`);
                // Don't fail initialization, just log the warning
                return;
            }

            const imagePath = fileValidation.path;
            await this.mpvZoneManager.loadMedia(imagePath, 'image');

            this.currentState.currentImage = this.defaultImage;
            this.currentState.status = 'showing_image';
            this.mpvInstances.media.currentFile = this.defaultImage;

            this.logger.debug(`Default image set: ${this.defaultImage}`);
        } catch (error) {
            this.logger.warn(`Failed to set default image ${this.defaultImage}:`, error.message);
        }
    }

    async _playVideo(command) {
        const videoPath = command.file || command.video; // Support both 'file' and legacy 'video'
        const { volume, adjustVolume, channel, ducking, loop } = command;
        const skipDucking = command.skipDucking || command.skip_ducking;
        if (!videoPath) {
            throw new Error('Video path is required');
        }

        // Wake screen early in the process to avoid timing conflicts
        await this.screenPowerManager.autoWakeForMedia('video');

        // Validate file exists before proceeding
        const fileValidation = await this._validateMediaFile(videoPath);
        if (!fileValidation.exists) {
            this.publishCommandOutcome({
                command: 'playVideo',
                outcome: 'failed',
                parameters: { file: videoPath },
                error_type: 'file_not_found',
                error_message: fileValidation.error,
                message: `Media file not found for playVideo: ${videoPath}`
            });
            this.logger.warn(fileValidation.error);
            return; // Don't update state if file doesn't exist
        }

        const fullPath = fileValidation.path;

        const isVideo = this._isVideoFile(videoPath);

        // Handle ducking parameter for video files - use zone config or default to -24 for videos, 0 for images
        const defaultVideoDucking = this.config.videoDucking !== undefined ? this.config.videoDucking : (isVideo ? -24 : 0);
        // If skipDucking explicitly requested, neutralize ducking level
        const duckingLevel = skipDucking ? 0 : (ducking !== undefined ? ducking : defaultVideoDucking);
        let duckId = null;

        if (isVideo && duckingLevel < 0) {
            duckId = `video-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            this.currentState.currentVideoDuckId = duckId;
            this.duckLifecycle.addTrigger(duckId, 'video');
            await this._recomputeBackgroundAfterDuckChange();
            this.logger.info(`Video duck trigger added: ${duckId} level=${duckingLevel}`);
        }

        // Smart media handling: Check if we should resume existing media
        const shouldResume = this._shouldResumeExistingMedia(videoPath, 'playVideo');

        // Probe duration early (non-fatal)
        let probedDuration = null;
        try { probedDuration = await probeDurationSeconds(fullPath).catch(() => null); } catch (_) { /* ignore */ }

        // Resolve video effective volume (treat as its own bucket; video itself is never ducked by background lifecycle)
        let resolvedVideo = null;
        const commandPayload = {};
        if (volume !== undefined) commandPayload.volume = volume;
        const adj = adjustVolume;
        if (adj !== undefined) commandPayload.adjustVolume = adj;
        if (Object.keys(commandPayload).length) {
            try {
                resolvedVideo = resolveEffectiveVolume({ type: 'video', zoneModel: this.volumeModel, command: commandPayload, duckActive: false });
            } catch (e) {
                this.logger.warn('Video volume resolution failed: ' + e.message);
            }
        }
        if (shouldResume) {
            this.logger.info(`🎬 Smart playVideo: Resuming paused video instead of reloading: ${videoPath}`);
            await this.mpvZoneManager.play();
            this.smartMediaState.lastCommand = 'playVideo';
            this.smartMediaState.isVideoPaused = false;
        } else {
            this.logger.info(`🎬 Smart playVideo: Loading and auto-playing video: ${videoPath}`);
            const options = {};
            if (resolvedVideo && resolvedVideo.final !== undefined) options.volume = resolvedVideo.final;
            try { await this.mpvZoneManager.stop(); } catch (_) { }
            await this.mpvZoneManager.loadMedia(videoPath, 'video', options);
            await this.mpvZoneManager.play();
            this.smartMediaState.lastCommand = 'playVideo';
            this.smartMediaState.lastMediaPath = videoPath;
            this.smartMediaState.currentLoadedPath = videoPath;
            this.smartMediaState.isVideoPaused = false;
        }

        // Update zone state
        this.currentState.currentVideo = videoPath;
        this.currentState.currentImage = null;
        this.currentState.status = 'playing_video';
        this.mpvInstances.media.currentFile = videoPath;

        // Store duck ID for cleanup when video ends
        if (duckId) {
            this.currentState.currentVideoDuckId = duckId;
        }

        // Update queue length from our application-level queue (not MPV playlist)
        this.currentState.videoQueueLength = this.videoQueue.length;

        // Determine if looping should be activated (only if queue will be empty after this video)
        const shouldLoop = isVideo && loop === true && this.videoQueue.length === 0;
        if (shouldLoop) {
            this.loopState.isLooping = true;
            this.loopState.loopStartedAt = Date.now();
            this.loopState.loopIterations = 0;
            this.loopState.currentVideoFile = videoPath;
            this.logger.info(`Starting looped video: ${videoPath}`);
        } else {
            this.loopState.isLooping = false;
            this.loopState.currentVideoFile = null;
        }

        this.publishStatus();
        // Initialize playback tracker
        if (this._videoPlaybackTracker) this._videoPlaybackTracker.stop();
        this._videoPlaybackTracker = new VideoPlaybackTracker({
            targetDurationSec: probedDuration != null ? probedDuration : null,
            onNaturalEnd: () => {
                this.logger.info('VIDEO_TRACKER natural end fired');
                if (this.loopState.isLooping) {
                    this._handleLoopRestart().catch(err => {
                        this.logger.error('Loop restart failed:', err);
                        this.loopState.isLooping = false;
                        this._completeCurrentVideo('error', { error: err.message });
                    });
                } else {
                    this._completeCurrentVideo('natural_end');
                }
            }
        });
        this._videoPlaybackTracker.start();
        this.publishEvent({
            command: 'playVideo',
            file: videoPath,
            started: true,
            resumed: shouldResume,
            looping: shouldLoop ? true : undefined,
            media_type: 'video',
            duration_s: probedDuration != null ? probedDuration : null,
            volume: resolvedVideo ? resolvedVideo.final : undefined,
            adjust_volume: adj !== undefined ? adj : undefined,
            ducking_applied: duckingLevel !== 0 ? duckingLevel : undefined,
            queue_remaining: this.videoQueue.length,
            ts: new Date().toISOString()
        });
        if (resolvedVideo) {
            this._lastPlaybackTelemetry = { command: 'playVideo', effective_volume: resolvedVideo.final, pre_duck_volume: resolvedVideo.preDuck, ducked: resolvedVideo.ducked };
        }
        if (resolvedVideo && resolvedVideo.warnings && resolvedVideo.warnings.length) {
            this.publishCommandOutcome({ command: 'playVideo', outcome: 'warning', parameters: { file: videoPath, volume: resolvedVideo.final, warnings: resolvedVideo.warnings.map(w => w.code), effective_volume: resolvedVideo.final, pre_duck_volume: resolvedVideo.preDuck, ducked: resolvedVideo.ducked }, warning_type: 'volume_resolution_warning', message: 'Video playback started with volume resolution warnings' });
        }

        this.logger.debug(`Video playing: ${videoPath} (${shouldResume ? 'resumed' : 'loaded'})`);
    }

    /**
     * Unified video completion (natural end, stopped, queue cleared, error, heuristic_eof)
     * @param {('natural_end'|'stopped'|'queue_cleared'|'error'|'heuristic_eof')} reason
     * @param {Object} [opts]
     * @param {string} [opts.error] optional error message
     */
    _completeCurrentVideo(reason, opts = {}) {
        if (!this.currentState.currentVideo) return; // nothing to complete

        const file = this.currentState.currentVideo;
        // Capture loop stats before clearing
        const wasLooping = this.loopState.isLooping;
        const loopIterations = this.loopState.loopIterations;

        // Stop tracker & capture watched time
        let watched = null; let duration = null;
        if (this._videoPlaybackTracker) {
            try { this._videoPlaybackTracker.stop(); } catch (_) { /* ignore */ }
            watched = this._videoPlaybackTracker.getWatchedSeconds();
        }
        // Attempt to derive duration if probed earlier
        try {
            const cached = require('../media/ffprobe-duration').ffprobeDurationCache.get ? require('../media/ffprobe-duration').ffprobeDurationCache.get(file) : null; // lazy require to avoid circular
            if (cached != null) duration = cached;
        } catch (_) { /* ignore */ }

        // Clean up any duck trigger associated with this video
        if (this.currentState.currentVideoDuckId) {
            try {
                this.duckLifecycle.removeTrigger(this.currentState.currentVideoDuckId);
                this._recomputeBackgroundAfterDuckChange().catch(() => { });
            } catch (_) { /* swallow */ }
            delete this.currentState.currentVideoDuckId;
        }

        // Attempt to pause on final frame (best-effort so last frame remains displayed)
        try { this.mpvZoneManager.pause(); } catch (_) { /* ignore */ }

        // Build message
        let message;
        switch (reason) {
            case 'natural_end': message = 'Video completed (natural end)'; break;
            case 'stopped': message = 'Video stopped'; break;
            case 'queue_cleared': message = 'Video interrupted by queue clear'; break;
            case 'heuristic_eof': message = 'Video ended (heuristic EOF)'; break;
            case 'error': message = opts.error || 'Video error'; break;
            default: message = reason;
        }

        // Emit unified final event
        this.publishEvent({
            command: 'playVideo',
            file,
            done: true,
            reason,
            message,
            watched_s: watched != null ? parseFloat(watched.toFixed(3)) : undefined,
            duration_s: duration != null ? duration : undefined,
            loop_iterations: wasLooping ? loopIterations : undefined,
            queue_remaining: this.videoQueue.length,
            ts: new Date().toISOString()
        });

        // Reset current video state but retain last frame shown as image-equivalent
        this.currentState.currentVideo = null;
        this.currentState.status = 'showing_image';

        // Clear loop state
        this.loopState.isLooping = false;
        this.loopState.loopStartedAt = null;
        this.loopState.loopIterations = 0;
        this.loopState.currentVideoFile = null;
        this.loopState.isRestarting = false;

        this.publishStatus();

        // Allow next queued item to process
        this.isProcessingVideoQueue = false;
        if (this.videoQueue.length > 0) {
            // Defer to next tick to avoid re-entrancy
            setTimeout(() => this._processVideoQueue(), 10);
        }
    }

    /**
     * Handle video loop restart (called when natural end occurs on a looping video)
     * @private
     */
    async _handleLoopRestart() {
        const videoPath = this.loopState.currentVideoFile;
        if (!videoPath || !this.loopState.isLooping) {
            this.logger.warn('Loop restart called but no loop active');
            return;
        }

        // Guard against concurrent restarts
        if (this.loopState.isRestarting) {
            this.logger.warn('Loop restart already in progress, ignoring duplicate call');
            return;
        }
        this.loopState.isRestarting = true;

        this.loopState.loopIterations++;
        this.logger.info(`Loop iteration ${this.loopState.loopIterations} for ${videoPath}`);

        // Stop current tracker
        if (this._videoPlaybackTracker) {
            try { this._videoPlaybackTracker.stop(); } catch (_) { /* ignore */ }
        }

        // Clear any EOF handlers
        this._clearEofHandlers();

        // Restart video playback with timeout protection
        try {
            // Helper to add timeout to promises
            const withTimeout = (promise, ms, operation) => {
                return Promise.race([
                    promise,
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error(`${operation} timeout after ${ms}ms`)), ms)
                    )
                ]);
            };

            await withTimeout(this.mpvZoneManager.stop(), 2000, 'MPV stop');
            await withTimeout(this.mpvZoneManager.loadMedia(videoPath, 'video'), 3000, 'MPV loadMedia');
            await withTimeout(this.mpvZoneManager.play(), 2000, 'MPV play');

            // Re-probe duration (use cache if available)
            const probedDuration = await probeDurationSeconds(videoPath).catch(() => null);

            // Restart tracker with same callback
            this._videoPlaybackTracker = new VideoPlaybackTracker({
                targetDurationSec: probedDuration,
                onNaturalEnd: () => {
                    this.logger.info('VIDEO_TRACKER natural end fired (loop iteration)');
                    if (this.loopState.isLooping) {
                        this._handleLoopRestart().catch(err => {
                            this.logger.error('Loop restart failed:', err);
                            this.loopState.isLooping = false;
                            this.loopState.isRestarting = false; // Clear restart flag on error
                            this._completeCurrentVideo('error', { error: err.message });
                        });
                    } else {
                        this._completeCurrentVideo('natural_end');
                    }
                }
            });
            this._videoPlaybackTracker.start();

            // Note: VideoPlaybackTracker handles EOF detection
            // Legacy _setupVideoEof removed to prevent race conditions

            // Optional: Emit loop iteration event for telemetry
            this.publishEvent({
                command: 'playVideo',
                file: videoPath,
                loop_iteration: this.loopState.loopIterations,
                ts: new Date().toISOString()
            });

            // Clear restart flag after successful restart
            this.loopState.isRestarting = false;

        } catch (err) {
            this.logger.error('Loop restart failed:', err);
            // Break loop on error
            this.loopState.isLooping = false;
            this.loopState.isRestarting = false;
            this._completeCurrentVideo('error', { error: err.message });
        }
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
        if (!audioPath) throw new Error('Background music path is required');
        const { volume, adjustVolume, loop, skipDucking } = params || {};
        const fileValidation = await this._validateMediaFile(audioPath);
        if (!fileValidation.exists) {
            this.publishCommandOutcome({
                command: 'playBackground',
                outcome: 'failed',
                parameters: { file: audioPath, loop },
                error_type: 'file_not_found',
                error_message: fileValidation.error,
                message: `Background music file not found: ${audioPath}`
            });
            return false;
        }
        const processRunning = await this.audioManager.checkAndRestartProcesses();
        if (!processRunning) {
            this.publishCommandOutcome({
                command: 'playBackground',
                outcome: 'failed',
                parameters: { file: audioPath },
                error_type: 'subsystem_unavailable',
                error_message: 'Background system not available',
                message: `Background system not available for file: ${audioPath}`
            });
            return false;
        }
        const commandPayload = {};
        if (volume !== undefined) commandPayload.volume = volume;
        if (adjustVolume !== undefined) commandPayload.adjustVolume = adjustVolume;
        if (skipDucking !== undefined) commandPayload.skipDucking = skipDucking;
        let resolved;
        try {
            resolved = resolveEffectiveVolume({ type: 'background', zoneModel: this.volumeModel, command: commandPayload, duckActive: this.getDuckActive() });
        } catch (e) {
            this.publishCommandOutcome({ command: 'playBackground', outcome: 'failed', parameters: { file: audioPath }, error_type: 'volume_resolution_error', error_message: e.message, message: `Failed to resolve background volume: ${e.message}` });
            return false;
        }
        const targetVolume = resolved.final;
        const shouldLoop = !!loop;
        const result = await this.audioManager.playBackgroundMusic(fileValidation.path, targetVolume, shouldLoop);
        if (!result.success) {
            this.publishCommandOutcome({ command: 'playBackground', outcome: 'failed', parameters: { file: audioPath, loop: shouldLoop, volume: targetVolume }, error_type: 'play_error', error_message: result.error, message: `Failed to start background music: ${result.error}` });
            return false;
        }
        this._backgroundPlayContext = { command: commandPayload, preDuck: resolved.preDuck };
        this.currentState.backgroundMusic = audioPath;
        this.mpvInstances.background.currentFile = audioPath;
        this.mpvInstances.background.status = 'playing';
        this.publishStatus();
        // Start event now emitted by audio-manager with final shape; avoid duplicate here.
        if (resolved.warnings && resolved.warnings.length) {
            this.publishCommandOutcome({ command: 'playBackground', outcome: 'warning', parameters: { file: audioPath, loop: shouldLoop, volume: targetVolume, warnings: resolved.warnings.map(w => w.code) }, warning_type: 'volume_resolution_warning', message: 'Background playback started with volume resolution warnings' });
        }
        return true;
    }

    async _stopBackgroundMusic(fadeTime = 0) {
        if (fadeTime > 0) {
            const durationMs = fadeTime * 1000;
            const fadeResult = await this.audioManager.fadeBackgroundMusic(0, durationMs, async () => {
                await this.audioManager.stopBackgroundMusic();
                this.currentState.backgroundMusic = null;
                this.mpvInstances.background.currentFile = null;
                this.mpvInstances.background.status = 'idle';
                this.publishStatus();
                // Minimal command event (no outcome) per spec
                this.publishEvent({ command: 'stopBackground', message: `Command 'stopBackground' executed successfully` });
                this.logger.info(`Background music stopped with ${fadeTime}s fade`);
            });
            if (!fadeResult.success) {
                this.logger.error('Failed to start background music fade:', fadeResult.error);
                await this.audioManager.stopBackgroundMusic();
                this.currentState.backgroundMusic = null;
                this.mpvInstances.background.currentFile = null;
                this.mpvInstances.background.status = 'idle';
                this.publishStatus();
                this.publishEvent({ command: 'stopBackground', message: `Command 'stopBackground' executed successfully` });
            }
        } else {
            await this.audioManager.stopBackgroundMusic();
            this.currentState.backgroundMusic = null;
            this.mpvInstances.background.currentFile = null;
            this.mpvInstances.background.status = 'idle';
            this.publishStatus();
            this.publishEvent({ command: 'stopBackground', message: `Command 'stopBackground' executed successfully` });
        }
    }

    async _pauseBackgroundMusic() {
        await this.audioManager.pauseBackgroundMusic();

        this.mpvInstances.background.status = 'paused';

        this.publishStatus();
        this.publishEvent({ background_music_paused: true });
        this.logger.info('Background music paused');
    }

    async _resumeBackgroundMusic() {
        await this.audioManager.resumeBackgroundMusic();

        this.mpvInstances.background.status = 'playing';

        this.publishStatus();
        this.publishEvent({ background_music_resumed: true });
        this.logger.info('Background music resumed');
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
        if (!audioPath) throw new Error('Sound effect path is required');
        const { volume, adjustVolume } = opts || {};
        const fileValidation = await this._validateMediaFile(audioPath);
        if (!fileValidation.exists) {
            this.publishCommandOutcome({ command: 'playSoundEffect', outcome: 'failed', parameters: { file: audioPath }, error_type: 'file_not_found', error_message: fileValidation.error, message: `Sound effect file not found: ${audioPath}` });
            return false;
        }
        const commandPayload = {};
        if (volume !== undefined) commandPayload.volume = volume;
        if (adjustVolume !== undefined) commandPayload.adjustVolume = adjustVolume;
        let resolvedFX;
        try { resolvedFX = resolveEffectiveVolume({ type: 'effects', zoneModel: this.volumeModel, command: commandPayload, duckActive: false }); }
        catch (e) {
            this.publishCommandOutcome({ command: 'playSoundEffect', outcome: 'failed', parameters: { file: audioPath }, error_type: 'volume_resolution_error', error_message: e.message, message: `Failed to resolve effect volume: ${e.message}` });
            return false;
        }
        await this.audioManager.playSoundEffect(fileValidation.path, resolvedFX.final);
        this.publishEvent({ sound_effect_played: audioPath, volume: resolvedFX.final, pre_duck: resolvedFX.preDuck, adjust_volume: adjustVolume || 0 });
        if (resolvedFX.warnings && resolvedFX.warnings.length) {
            this.publishCommandOutcome({ command: 'playSoundEffect', outcome: 'warning', parameters: { file: audioPath, volume: resolvedFX.final, warnings: resolvedFX.warnings.map(w => w.code) }, warning_type: 'volume_resolution_warning', message: 'Sound effect played with volume resolution warnings' });
        }
        this.logger.debug(`Sound effect played: ${audioPath} at volume ${resolvedFX.final}`);
        return true;
    }

    async _stopAudio(fadeTime = 0) {
        // Stop background music with fade if specified
        await this._stopBackgroundMusic(fadeTime);

        // Clear speech queue (immediate - speech should stop quickly)
        await this.audioManager.clearSpeechQueue();

        this.publishEvent({ all_audio_stopped: true, fade_time: fadeTime });
        this.logger.info(`All audio stopped${fadeTime > 0 ? ` with ${fadeTime}s fade` : ' immediately'}`);
    }

    async _stopSpeech(fadeTime = 0) {
        if (fadeTime > 0) {
            // Fade out speech over specified time, then stop
            const durationMs = fadeTime * 1000;
            const fadeResult = await this.audioManager.fadeSpeech(0, durationMs, async () => {
                await this.audioManager.clearSpeechQueue();
                this.publishEvent({ speech_stopped: true, fade_time: fadeTime });
                this.logger.info(`Speech stopped with ${fadeTime}s fade`);
            });

            if (!fadeResult.success) {
                this.logger.error('Failed to start speech fade:', fadeResult.error);
                // Fallback to immediate stop
                await this.audioManager.clearSpeechQueue();
                this.publishEvent({ speech_stopped: true });
                this.logger.info('Speech stopped immediately (fade failed)');
            }
        } else {
            // Immediate stop
            await this.audioManager.clearSpeechQueue();
            this.publishEvent({ speech_stopped: true });
            this.logger.info('Speech stopped immediately');
        }
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

    // ========================================================================
    // PR-VOLUME Phase 4: Model mutation command handlers (screen zone)
    // ========================================================================
    async _handleSetVolumeModel(command) {
        const { type, volume, volumes } = command;
        // Single type mode
        if (type) {
            const result = this._setBaseVolumeType(type, volume);
            if (!result.ok) {
                this.publishCommandOutcome({
                    command: 'setVolume',
                    outcome: 'failed',
                    parameters: { type, volume },
                    error_type: result.error_type || 'validation',
                    message: result.message
                });
                return;
            }
            this.publishCommandOutcome({
                command: 'setVolume',
                outcome: result.outcome,
                parameters: { type: result.type, volume: result.final, requested: result.requested },
                message: result.message,
                warning_type: result.warning_type
            });
            this.publishStatus();
            return;
        }
        // Bulk mode
        if (volumes && typeof volumes === 'object') {
            const bulk = this._setBaseVolumesBulk(volumes);
            if (bulk.overall === 'failed') {
                this.publishCommandOutcome({
                    command: 'setVolume',
                    outcome: 'failed',
                    parameters: { volumes },
                    error_type: 'validation',
                    message: bulk.message
                });
                return;
            }
            this.publishCommandOutcome({
                command: 'setVolume',
                outcome: bulk.overall,
                parameters: { volumes: Object.fromEntries(Object.entries(volumes).map(([k, v]) => [k, this.volumeModel.baseVolumes[k]])) },
                message: bulk.message,
                warning_type: bulk.warning_type
            });
            this.publishStatus();
            return;
        }
        // Invalid payload
        this.publishCommandOutcome({
            command: 'setVolume',
            outcome: 'failed',
            parameters: { type, volume, volumes },
            error_type: 'validation',
            message: 'Invalid setVolume payload: expected {type, volume} or {volumes:{...}}'
        });
    }

    async _handleSetDuckingAdjustment(command) {
        const { adjustValue } = command;
        const result = this._setDuckingAdjustment(adjustValue);
        if (!result.ok) {
            this.publishCommandOutcome({
                command: 'setDuckingAdjustment',
                outcome: 'failed',
                parameters: { adjustValue },
                error_type: result.error_type || 'validation',
                message: result.message
            });
            return;
        }
        this.publishCommandOutcome({
            command: 'setDuckingAdjustment',
            outcome: result.outcome,
            parameters: { adjustValue: result.final, requested: result.requested },
            message: result.message,
            warning_type: result.warning_type
        });
        this.publishStatus();
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
        if (!this.currentState.backgroundMusic) return;
        const commandPayload = this._backgroundPlayContext ? (this._backgroundPlayContext.command || {}) : {};
        let resolved;
        try {
            resolved = resolveEffectiveVolume({ type: 'background', zoneModel: this.volumeModel, command: commandPayload, duckActive: this.getDuckActive() });
        } catch (e) {
            this.logger.warn('ScreenZone background recompute failed: ' + e.message);
            return;
        }
        try {
            await this.audioManager.setBackgroundMusicVolume(resolved.final);
            this.publishEvent({ background_volume_recomputed: true, volume: resolved.final, pre_duck: resolved.preDuck, ducked: resolved.ducked, effective_volume: resolved.final, pre_duck_volume: resolved.preDuck });
            this.publishStatus();
        } catch (e) {
            this.logger.warn('Failed applying recomputed background volume: ' + e.message);
        }
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

        this.currentState.status = 'idle';
        this.publishStatus();
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
        const { command: incomingType } = command;
        const mediaPath = command.file || command.video || command.image;
        const mediaType = this._isVideoFile(mediaPath) ? 'video' : 'image';
        const kind = incomingType === 'playVideo' ? 'playVideo' : 'setImage';

        this.logger.debug(`VIDEO_QUEUE_ENQUEUE kind=${kind} file=${mediaPath} qlen=${this.videoQueue.length}`);

        // Ignore duplicate playVideo if already playing same file (no preemption)
        if (kind === 'playVideo' && this.currentState.currentVideo === mediaPath && this.currentState.status === 'playing_video') {
            this.logger.debug(`VIDEO_QUEUE: duplicate playVideo ignored (already playing) ${mediaPath}`);
            return;
        }

        // Suppress duplicate queued item (same kind+file)
        const dup = this.videoQueue.find(i => i.file === mediaPath && i.kind === kind);
        if (dup) {
            this.logger.debug(`VIDEO_QUEUE: duplicate suppressed (already queued) ${mediaPath}`);
            return;
        }

        // Replacement rule: only replace final queued setImage (any media type) with new setImage
        if (kind === 'setImage' && this.videoQueue.length > 0) {
            const last = this.videoQueue[this.videoQueue.length - 1];
            if (last.kind === 'setImage') {
                this.logger.debug('VIDEO_QUEUE: replacing trailing setImage with new setImage');
                this.videoQueue[this.videoQueue.length - 1] = { kind, file: mediaPath, media_type: mediaType, enqueued_at: Date.now(), original: command };
                this.currentState.videoQueueLength = this.videoQueue.length;
                this.publishStatus();
                if (!this.isProcessingVideoQueue) this._processVideoQueue();
                return;
            }
        }

        // New rule: if appending a playVideo and the last queued item is a setImage,
        // drop that trailing setImage so the newly enqueued video will play when its
        // turn arrives (instead of the stale image). This implements the behavior
        // "playVideo A -> setImage B -> playVideo C" where B should be removed so
        // C plays after A.
        if (kind === 'playVideo' && this.videoQueue.length > 0) {
            const last = this.videoQueue[this.videoQueue.length - 1];
            if (last && last.kind === 'setImage') {
                this.logger.debug(`VIDEO_QUEUE: dropping trailing setImage (${last.file}) because playVideo ${mediaPath} appended`);
                this.videoQueue.pop();
            }
        }

        // Append
        this.videoQueue.push({ kind, file: mediaPath, media_type: mediaType, enqueued_at: Date.now(), original: command });

        // Size cap
        const max = this.zoneConfig.videoQueueMax || 5;
        if (this.videoQueue.length > max) {
            this.logger.debug('VIDEO_QUEUE: capacity reached, dropping oldest');
            this.videoQueue.shift();
        }
        this.currentState.videoQueueLength = this.videoQueue.length;

        // Cancel any active loop since queue is no longer empty
        if (this.loopState.isLooping) {
            this.logger.info(`Canceling video loop: new item queued (${mediaPath})`);
            this.loopState.isLooping = false;
            // Loop will naturally end at current iteration and advance to queued item
        }

        this.publishStatus();
        if (!this.isProcessingVideoQueue) this._processVideoQueue();
    }

    /**
     * Process the video/image queue (one at a time)
     */
    async _processVideoQueue() {
        this.logger.debug(`VIDEO_QUEUE_PROCESS start processing=${this.isProcessingVideoQueue} qlen=${this.videoQueue.length}`);
        if (this.isProcessingVideoQueue || this.videoQueue.length === 0) return;
        // Do not start next if a video is currently playing
        if (this.currentState.status === 'playing_video') {
            this.logger.debug('VIDEO_QUEUE_PROCESS: current video playing; will wait for completion');
            return;
        }
        this.isProcessingVideoQueue = true;
        const item = this.videoQueue.shift();
        if (!item) { this.isProcessingVideoQueue = false; return; }
        const { kind, file, media_type, original } = item;
        this.logger.debug(`VIDEO_QUEUE_DEQUEUE kind=${kind} file=${file} remaining=${this.videoQueue.length}`);
        this.currentState.videoQueueLength = this.videoQueue.length;
        this.publishStatus();
        try {
            if (kind === 'setImage') {
                await this._handleSetImageQueue(file, media_type, original);
                // setImage (including video first frame) completes immediately
                this.isProcessingVideoQueue = false;
                if (this.videoQueue.length > 0) this._processVideoQueue();
                return;
            }
            if (kind === 'playVideo') {
                await this._handlePlayVideoQueue(file, media_type, original);
                if (media_type === 'video') {
                    // Normal path waits for unified completion event to clear isProcessing.
                    // If playback never started (e.g., validation failure/early return),
                    // release queue processing so later video commands are not deadlocked.
                    if (this.currentState.status !== 'playing_video') {
                        this.logger.warn(`VIDEO_QUEUE_PROCESS: playVideo did not enter playing_video state for ${file}; releasing queue lock`);
                        this.isProcessingVideoQueue = false;
                        if (this.videoQueue.length > 0) this._processVideoQueue();
                        return;
                    }
                    return;
                }
                // Non-video fallback (image treated as immediate)
                this.isProcessingVideoQueue = false;
                if (this.videoQueue.length > 0) this._processVideoQueue();
                return;
            }
        } catch (err) {
            this.logger.error('VIDEO_QUEUE_PROCESS error:', err);
            this.isProcessingVideoQueue = false;
            if (this.videoQueue.length > 0) setTimeout(() => this._processVideoQueue(), 500);
        }
    }

    /**
     * Handle setImage command in queue
     */
    async _handleSetImageQueue(mediaPath, mediaType, command) {
        if (mediaType === 'image') {
            // Display image
            await this._setImage({ file: mediaPath });
        } else {
            // Video file: load and pause on first frame
            await this._setImage({ file: mediaPath });
        }
    }

    /**
     * Handle playVideo command in queue
     */
    async _handlePlayVideoQueue(mediaPath, mediaType, command) {
        if (mediaType === 'image') {
            await this._playVideo({ file: mediaPath });
        } else {
            const fullPath = mediaPath;
            // Pass the original command to preserve loop and other parameters
            await this._playVideo(command || { file: fullPath });
            // Note: VideoPlaybackTracker (created in _playVideo) handles EOF detection
            // No need for legacy _setupVideoEof which was causing race conditions
        }
    }

    /**
     * Start a simulated EOF timer for a video file
     * @param {string} mediaPath - Path to the video file
     * @param {number|null} remainingDuration - Optional remaining duration in seconds (for resume)
     */
    async _setupVideoEof(mediaPath, remainingDuration = null) {
        // clear existing handlers
        this._clearEofHandlers();

        // Record when video starts (only for new videos, not resume)
        if (remainingDuration === null) {
            this._videoStartedAt = Date.now();
        }

        // gather frame count if available
        let frames = null;
        try {
            frames = await this.mpvZoneManager.getProperty('estimated-frame-count');
        } catch {
            // property not available or unsupported
            frames = null;
        }

        let duration;
        let usedProbe = false;

        // Use provided remaining duration if available, otherwise determine full duration
        if (remainingDuration !== null) {
            duration = remainingDuration;
            this.logger.debug(`Using remaining duration: ${duration}s`);
        } else {
            // determine duration via mpv or ffprobe
            duration = this._videoEofCache.get(mediaPath);
            if (duration === undefined) {
                try {
                    duration = await this.mpvZoneManager.getDuration();
                } catch {
                    try {
                        duration = await this._probeDuration(mediaPath);
                        usedProbe = true;
                        this._videoEofCache.set(mediaPath, duration);
                    } catch (err) {
                        this.logger.warn(`Could not determine video duration: ${err.message}`);
                        duration = null;
                    }
                }
                if (duration != null) {
                    this._videoEofCache.set(mediaPath, duration);
                    // Store original duration for pause/resume calculations
                    this._originalDuration = duration;
                }
            } else {
                // Use cached duration and store as original
                this._originalDuration = duration;
            }
        }
        if (duration != null) {
            // log duration-based EOF detection
            const durationLabel = remainingDuration !== null ? 'remaining time' : (usedProbe ? 'ffprobe fallback' : 'mpv duration');
            this.logger.info(`EOF detection: ${durationLabel} (${duration}s${frames != null ? `, frames=${frames}` : ''})`);
            const timeoutMs = Math.max(0, duration * 1000);
            this._videoEofTimeout = setTimeout(() => {
                this.logger.debug('Video EOF timeout fired (duration-based)');
                this._handleMediaEnd();
            }, timeoutMs);
        } else {
            // log polling-based EOF detection
            this.logger.info(`EOF detection: playback-time polling (tick=50ms, epsilon=100ms)${frames != null ? `, frames=${frames}` : ''}`);
            // fallback to playback-time observer at 50ms tick
            this._observerId = await this.mpvZoneManager.observeProperty('playback-time');
            this.mpvZoneManager.on('property-playback-time', ev => this._onPlaybackTime(ev));
        }
    }

    async _probeDuration(mediaPath) {
        const { spawn } = require('child_process');
        const probePath = this._normalizeMediaPath(mediaPath);
        return new Promise((resolve, reject) => {
            const ffprobe = spawn('ffprobe', [
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                probePath
            ]);
            let output = '';
            let errOutput = '';
            ffprobe.stdout.on('data', data => output += data);
            ffprobe.stderr.on('data', data => errOutput += data);
            ffprobe.on('close', code => {
                if (code === 0) {
                    const dur = parseFloat(output.trim());
                    if (!isNaN(dur)) {
                        resolve(dur);
                    } else {
                        reject(new Error(`ffprobe returned invalid duration for ${probePath}: ${output.trim()}`));
                    }
                } else {
                    reject(new Error(`ffprobe exited with code ${code} on ${probePath}: ${errOutput.trim()}`));
                }
            });
        });
    }

    _clearEofHandlers() {
        if (this._videoEofTimeout) {
            clearTimeout(this._videoEofTimeout);
            this._videoEofTimeout = null;
        }
        if (this._observerId != null) {
            this.mpvZoneManager.unobserveProperty(this._observerId);
            this._observerId = null;
        }
        this._lastPlaybackTime = 0;
        this._stallCount = 0;
    }

    _onPlaybackTime(event) {
        const time = event.data;
        if (time === this._lastPlaybackTime) {
            this._stallCount++;
        } else {
            this._stallCount = 0;
            this._lastPlaybackTime = time;
        }
        // two consecutive stalls (~100ms) => EOF
        if (this._stallCount >= 2) {
            this.logger.debug('Playback-time stalled, assuming EOF');
            this._handleMediaEnd();
        }
    }

    /**
     * Handle end of file (real or simulated)
     */
    _handleMediaEnd() {
        // Deprecated legacy handler body kept minimal until unified final event path implemented.
        this.logger.debug('LEGACY _handleMediaEnd invoked - should be replaced by unified completion path.');
        // Intentionally no event emission here now.
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
    // NOTE: Current implementation has a limitation when multiple screens
    // run an enabled browser concurrently. Window detection heuristics may
    // select the wrong Chromium window when several instances are present.
    // Workaround: enable browser on only one screen at a time. Future work
    // should add per-zone PID->window-id mapping to reliably disambiguate windows.

    /**
     * Enable browser: Launch Chromium in background (hidden behind MPV)
     */
    async _enableBrowser(url = 'http://localhost/clock/') {
        if (this.browserManager.enabled) {
            this.logger.warn('Browser already enabled');
            return;
        }

        this.logger.info(`Enabling browser with URL: ${url} (background launch)`);

        // Clean up any existing browser artifacts
        this.windowManager.safeRemoveDir(this.browserManager.profilePath);

        // Determine target display. Prefer explicit targetMonitor from zone config.
        let targetDisplay;
        try {
            const displays = this.windowManager.getDisplays() || [];
            // Sort displays by X position for deterministic indexing
            displays.sort((a, b) => (a.x || 0) - (b.x || 0));
            if (Array.isArray(displays) && displays.length > 0 && Number.isInteger(this.targetMonitor) && this.targetMonitor >= 0 && this.targetMonitor < displays.length) {
                targetDisplay = displays[this.targetMonitor];
                this.logger.debug(`Browser target display chosen by targetMonitor ${this.targetMonitor}: ${targetDisplay.name} at ${targetDisplay.width}x${targetDisplay.height}+${targetDisplay.x}+${targetDisplay.y}`);
            } else {
                // Fallback to previous selection logic (prefer secondary)
                targetDisplay = this.windowManager.pickTargetDisplay(true);
                if (targetDisplay) this.logger.debug(`Browser target display (fallback): ${targetDisplay.name} at ${targetDisplay.width}x${targetDisplay.height}+${targetDisplay.x}+${targetDisplay.y}`);
            }
        } catch (err) {
            this.logger.warn('Failed to determine target display by index, falling back to pickTargetDisplay: ' + err.message);
            targetDisplay = this.windowManager.pickTargetDisplay(true);
        }

        // Launch browser
        const browserOptions = {
            url,
            profilePath: this.browserManager.profilePath,
            className: this.browserManager.className,
            width: targetDisplay.width,
            height: targetDisplay.height,
            x: targetDisplay.x,
            y: targetDisplay.y
        };

        this.browserManager.process = this.windowManager.launchChromium(browserOptions);
        this.browserManager.url = url;
        this.browserManager.enabled = true;

        // Get OS-specific window detection configuration
        const { getOSDetection } = require('../utils/os-detection');
        const osInfo = getOSDetection();
        const windowConfig = osInfo.getWindowDetectionConfig();

        // Wait for browser window to appear (OS-specific timeout)
        this.browserManager.windowId = await this.windowManager.waitForWindowByClass(
            this.browserManager.className,
            windowConfig.initialDelay + (windowConfig.maxRetries * windowConfig.retryDelay)
        );

        if (!this.browserManager.windowId) {
            // Fallback detection with OS-specific retries
            for (let attempt = 1; attempt <= windowConfig.maxRetries && !this.browserManager.windowId; attempt++) {
                this.logger.debug(`enableBrowser: fallback attempt ${attempt}/${windowConfig.maxRetries} to find Chromium window`);
                this.browserManager.windowId = this.windowManager.findChromiumWindowId(this.browserManager.className);
                if (!this.browserManager.windowId) await new Promise(r => setTimeout(r, windowConfig.retryDelay));
            }
            if (!this.browserManager.windowId) this.browserManager.windowId = this.windowManager.findChromiumWindowId(this.browserManager.className);
        }

        this.logger.info(`enableBrowser result: pid=${this.browserManager.process?.pid || 'unknown'}, windowId=${this.browserManager.windowId || 'not-found'}`);

        // If we have a detected window id, cross-check with a fresh search and log if it changed
        if (this.browserManager.windowId) {
            try {
                const found = this.windowManager.findChromiumWindowId(this.browserManager.className);
                if (found && found !== this.browserManager.windowId) {
                    this.logger.warn(`enableBrowser: detected chromium windowId changed (stored=${this.browserManager.windowId} detected=${found}), updating stored id`);
                    this.browserManager.windowId = found;
                }
            } catch (err) {
                this.logger.debug('enableBrowser: cross-check findChromiumWindowId failed: ' + err.message);
            }
        }

        if (this.browserManager.windowId) {
            // Position and configure window BUT KEEP HIDDEN
            this.windowManager.moveWindow(this.browserManager.windowId, targetDisplay.x, targetDisplay.y);
            this.windowManager.fullscreenWindow(this.browserManager.windowId);

            const desk = this.windowManager.getActiveDesktop();
            this.windowManager.moveToDesktop(this.browserManager.windowId, desk);

            // ALWAYS start browser behind MPV (background launch)
            this.windowManager.addWindowState(this.browserManager.windowId, 'below');

            // CRITICAL: Ensure MPV regains focus after browser window creation
            const mpvWindow = this.windowManager.getWindowIdByNameExact('ParadoxMPV');
            if (mpvWindow) {
                this.windowManager.activateWindow(mpvWindow);
                this.logger.debug('MPV window reactivated after browser launch');
            } else {
                this.logger.warn('MPV window not found - browser may be visible');
            }
        } else {
            this.logger.warn('Browser window not found after launch');
        }

        // Update state (browser starts hidden)
        this.currentState.focus = 'mpv'; // MPV remains focused
        this.currentState.content = this.currentState.currentVideo || this.currentState.currentImage;
        this._updateFocusAndContent();

        this.publishStatus();
        this.publishEvent({
            browser_enabled: true,
            url,
            window_id: this.browserManager.windowId,
            focused: false // Always false - browser starts hidden
        });

        this.logger.info('Browser enabled successfully (hidden in background)');
    }

    /**
     * Disable browser: Terminate browser process and clean up
     */
    async _disableBrowser() {
        if (!this.browserManager.enabled) {
            this.logger.warn('Browser not enabled');
            return;
        }

        this.logger.info(`Disabling browser (stored windowId=${this.browserManager.windowId || 'none'}, pid=${this.browserManager.process?.pid || 'unknown'})`);

        // Kill browser process
        if (this.browserManager.process) {
            await this.windowManager.killProcess(this.browserManager.process);
        }

        // Clean up artifacts
        this.windowManager.safeRemoveDir(this.browserManager.profilePath);

        // Reset state
        this.logger.info(`disableBrowser: killed process, clearing stored window id (was=${this.browserManager.windowId || 'none'})`);
        this.browserManager.process = null;
        this.browserManager.windowId = null;
        this.browserManager.url = null;
        this.browserManager.enabled = false;

        // Update focus back to MPV
        this.currentState.focus = 'mpv';
        this.currentState.content = this.currentState.currentVideo || this.currentState.currentImage;

        this.publishStatus();
        this.publishEvent({ browser_disabled: true });

        this.logger.info('Browser disabled successfully');
    }

    /**
     * Show browser: Pure window management - bring browser to front
     */
    async _showBrowser() {
        if (!this.browserManager.enabled) {
            throw new Error('Browser not enabled. Call enableBrowser first.');
        }

        if (!this.browserManager.windowId) {
            throw new Error('Browser window not found');
        }

        this.logger.info(`Showing browser (pure window management) - Window ID: ${this.browserManager.windowId}`);

        // Lightweight debug instrumentation: record timestamps, window ids and results
        const tsStart = Date.now();
        const browserWin = this.browserManager.windowId;
        let mpvWindow = null;
        try {
            mpvWindow = this.windowManager.getWindowIdByNameExact('ParadoxMPV');
        } catch (err) {
            this.logger.debug('getWindowIdByNameExact threw when checking MPV window:', err.message);
        }

        this.logger.debug(`_showBrowser start ts=${tsStart}, browserWin=${browserWin}, mpvWindow=${mpvWindow}, DISPLAY=${process.env.DISPLAY || 'unset'}`);

        // Refresh stored Chromium window id in case it changed since enableBrowser
        try {
            const fresh = this.windowManager.findChromiumWindowId(this.browserManager.className);
            if (fresh && fresh !== browserWin) {
                this.logger.warn(`_showBrowser: stored browser windowId=${browserWin} is stale, updating to fresh id=${fresh}`);
                this.browserManager.windowId = fresh;
            }
        } catch (err) {
            this.logger.debug(`_showBrowser: findChromiumWindowId threw: ${err.message}`);
        }

        // refresh local variable after possible update
        const browserWinRefreshed = this.browserManager.windowId || browserWin;
        if (browserWinRefreshed !== browserWin) {
            this.logger.debug(`_showBrowser: using browser window id ${browserWinRefreshed} for activation`);
        }

        // Attempt to force browser above MPV. Some MPV instances run with --ontop
        // which keeps them above other windows; try to counter that by setting
        // the browser to 'above' and removing 'above' from MPV before activating.
        try {
            let t0 = Date.now();
            try {
                const res = this.windowManager.addWindowState(browserWin, 'above');
                this.logger.debug(`addWindowState(browser,above) succeeded in ${Date.now() - t0}ms, result=${String(res)}`);
            } catch (errAdd) {
                this.logger.warn(`addWindowState(browser,above) failed: ${errAdd.message}`);
            }

            // Try to unset 'above' on MPV windows to avoid ontop conflicts
            if (mpvWindow) {
                try {
                    t0 = Date.now();
                    const resRem = this.windowManager.removeWindowState(mpvWindow, 'above');
                    this.logger.debug(`removeWindowState(mpv,above) succeeded in ${Date.now() - t0}ms, result=${String(resRem)}`);
                } catch (errRem) {
                    this.logger.warn(`removeWindowState(mpv,above) failed for ${mpvWindow}: ${errRem.message}`);
                }
            } else {
                this.logger.debug('No MPV window id found prior to activate()');
            }

            // Pure window focus switching using Option 6 technique
            try {
                t0 = Date.now();
                const resAct = this.windowManager.activateWindow(browserWin);
                this.logger.debug(`activateWindow(browser) completed in ${Date.now() - t0}ms, result=${String(resAct)}`);
            } catch (errAct) {
                this.logger.warn(`activateWindow(browser) failed: ${errAct.message}`);
            }

            // Verify the browser actually became active. If not, retry and fall back to wmctrl.
            let becameActive = false;
            try {
                becameActive = this.windowManager.isWindowActive(browserWin);
            } catch (err) {
                this.logger.debug('isWindowActive check threw: ' + err.message);
                becameActive = false;
            }

            if (!becameActive) {
                this.logger.warn('Browser did not appear active after first activate(), attempting retries and wmctrl fallback');
                for (let attempt = 1; attempt <= 3 && !becameActive; attempt++) {
                    try {
                        await new Promise(r => setTimeout(r, attempt * 120));
                        const t1 = Date.now();
                        try { this.windowManager.activateWindow(browserWin); } catch (e) { this.logger.debug(`retry activateWindow attempt ${attempt} failed: ${e.message}`); }
                        this.logger.debug(`retry activateWindow attempt ${attempt} took ${Date.now() - t1}ms`);

                        // try wmctrl fallback
                        if (this.windowManager.wmctrlActivate) {
                            try {
                                const t2 = Date.now();
                                this.windowManager.wmctrlActivate(browserWin);
                                this.logger.debug(`wmctrlActivate fallback attempt ${attempt} took ${Date.now() - t2}ms`);
                            } catch (e) {
                                this.logger.debug(`wmctrlActivate attempt ${attempt} failed: ${e.message}`);
                            }
                        }

                        // re-check
                        try {
                            becameActive = this.windowManager.isWindowActive(browserWin);
                        } catch (err) { becameActive = false; }
                        if (becameActive) this.logger.info(`Browser became active on attempt ${attempt}`);
                    } catch (errLoop) {
                        this.logger.debug(`retry loop error: ${errLoop.message}`);
                    }
                }
            }

            if (!becameActive) {
                // Capture additional diagnostics: wmctrl list and xdotool search output
                try {
                    const wmOut = execSync('wmctrl -lG', { env: { ...process.env, DISPLAY: this.display } }).toString().trim();
                    this.logger.debug('wmctrl -lG output:\n' + wmOut);
                } catch (e) {
                    this.logger.debug('Failed to run wmctrl -lG: ' + e.message);
                }
                try {
                    const wmPid = execSync('wmctrl -lp', { env: { ...process.env, DISPLAY: this.display } }).toString().trim();
                    this.logger.debug('wmctrl -lp output:\n' + wmPid);
                } catch (e) {
                    this.logger.debug('Failed to run wmctrl -lp: ' + e.message);
                }
                try {
                    const xd = execSync(`xdotool search --class ${this.browserManager.className} || true`, { env: { ...process.env, DISPLAY: this.display } }).toString().trim();
                    this.logger.debug(`xdotool search --class ${this.browserManager.className} output: ${xd}`);
                } catch (e) {
                    this.logger.debug('xdotool search failed: ' + e.message);
                }

                // Aggressive fallback: try to find any ParadoxBrowser windows and force-map/raise/focus them
                try {
                    const targetPid = this.browserManager.process?.pid || null;
                    // If we have a browser PID, try to find the window associated with that PID first
                    if (targetPid) {
                        try {
                            const wmPidOut = execSync('wmctrl -lp', { env: { ...process.env, DISPLAY: this.display } }).toString();
                            const lines = wmPidOut.split('\n');
                            for (const line of lines) {
                                const m = line.trim().match(/^(0x[0-9a-fA-F]+)\s+\S+\s+(\d+)/);
                                if (m && parseInt(m[2], 10) === targetPid) {
                                    const hexId = m[1];
                                    this.logger.info(`Aggressive fallback: found window ${hexId} for browser PID ${targetPid}, trying to unhide/raise`);
                                    try { execSync(`xdotool windowmap ${hexId}`, { env: { ...process.env, DISPLAY: this.display } }); } catch (_) { }
                                    try { execSync(`xdotool windowraise ${hexId}`, { env: { ...process.env, DISPLAY: this.display } }); } catch (_) { }
                                    try { execSync(`xdotool windowfocus ${hexId}`, { env: { ...process.env, DISPLAY: this.display } }); } catch (_) { }
                                    try { execSync(`wmctrl -i -a ${hexId}`, { env: { ...process.env, DISPLAY: this.display } }); } catch (_) { }
                                    await new Promise(r => setTimeout(r, 120));
                                    try { if (this.windowManager.isWindowActive(hexId)) { becameActive = true; this.browserManager.windowId = hexId; this.logger.info(`Aggressive fallback: browser active via PID matched window ${hexId}`); } } catch (_) { }
                                    if (becameActive) break;
                                }
                            }
                        } catch (e) {
                            this.logger.debug('Aggressive fallback wmctrl -lp parse failed: ' + e.message);
                        }
                    }

                    if (!becameActive) {
                        const raw = execSync(`xdotool search --class ${this.browserManager.className} || true`, { env: { ...process.env, DISPLAY: this.display } }).toString().trim();
                        const ids = raw.split('\n').map(s => s.trim()).filter(Boolean);
                        if (ids.length === 0) {
                            this.logger.debug('Aggressive fallback: no ParadoxBrowser windows found to try');
                        }
                        for (const id of ids) {
                            this.logger.info(`Aggressive fallback: attempting to unhide/raise/focus window ${id}`);
                            try { execSync(`xdotool windowmap ${id}`, { env: { ...process.env, DISPLAY: this.display } }); } catch (e) { this.logger.debug(`windowmap ${id} failed: ${e.message}`); }
                            try { execSync(`xdotool windowraise ${id}`, { env: { ...process.env, DISPLAY: this.display } }); } catch (e) { this.logger.debug(`windowraise ${id} failed: ${e.message}`); }
                            try { execSync(`xdotool windowfocus ${id}`, { env: { ...process.env, DISPLAY: this.display } }); } catch (e) { this.logger.debug(`windowfocus ${id} failed: ${e.message}`); }
                            try { execSync(`wmctrl -i -a ${id}`, { env: { ...process.env, DISPLAY: this.display } }); } catch (e) { this.logger.debug(`wmctrl activate ${id} failed: ${e.message}`); }
                            // Give WM a moment to apply
                            await new Promise(r => setTimeout(r, 120));
                            try {
                                if (this.windowManager.isWindowActive(id)) {
                                    becameActive = true;
                                    this.browserManager.windowId = id;
                                    this.logger.info(`Aggressive fallback: succeeded with window ${id}`);
                                    break;
                                }
                            } catch (e) {
                                this.logger.debug(`isWindowActive check failed for ${id}: ${e.message}`);
                            }
                        }
                    }
                } catch (e) {
                    this.logger.debug('Aggressive fallback encountered an error: ' + e.message);
                }
            }
        } catch (e) {
            this.logger.warn('Robust showBrowser flow failed unexpectedly:', e.message);
        }

        // Update state
        this.currentState.focus = 'chromium';
        this.currentState.content = this.browserManager.url;

        this.publishStatus();
        this.publishEvent({
            browser_shown: true,
            url: this.browserManager.url
        });

        this.logger.info(`Browser shown (end) ts=${Date.now()}, duration=${Date.now() - tsStart}ms`);
    }

    /**
     * Hide browser: Pure window management - return focus to MPV
     */
    async _hideBrowser() {
        if (!this.browserManager.enabled) {
            this.logger.warn('Browser not enabled, nothing to hide');
            return;
        }

        this.logger.info(`Hiding browser (pure window management) - stored windowId=${this.browserManager.windowId || 'none'}`);

        // Pure window focus switching back to MPV
        const mpvWindow = this.windowManager.getWindowIdByNameExact('ParadoxMPV');
        if (mpvWindow) {
            this.logger.debug(`Found MPV window: ${mpvWindow}, activating...`);
            this.windowManager.activateWindow(mpvWindow);
        } else {
            this.logger.warn('MPV window not found - trying alternative detection');
            // Try alternative MPV window detection
            try {
                const mpvWindows = execSync('xdotool search --class mpv', { env: { ...process.env, DISPLAY: ':0' } }).toString().trim().split('\n');
                if (mpvWindows.length > 0 && mpvWindows[0]) {
                    const altMpvWindow = mpvWindows[0];
                    this.logger.debug(`Found MPV window via class search: ${altMpvWindow}, activating...`);
                    this.windowManager.activateWindow(altMpvWindow);
                } else {
                    this.logger.error('No MPV window found - cannot hide browser properly');
                }
            } catch (e) {
                this.logger.error('Failed to find MPV window:', e.message);
            }
        }

        // Update state
        this.currentState.focus = 'mpv';
        this.currentState.content = this.currentState.currentVideo || this.currentState.currentImage;

        this.publishStatus();
        this.publishEvent({
            browser_hidden: true,
            mpv_content: this.currentState.content
        });

        this.logger.info('Browser hidden successfully');
    }

    /**
     * Set browser URL: Update URL and optionally reload/relaunch
     */
    async _setBrowserUrl(url) {
        if (!url) {
            throw new Error('URL is required');
        }

        this.logger.info(`Setting browser URL to: ${url}`);

        if (this.browserManager.enabled) {
            // Browser is running - need to relaunch with new URL
            const wasFocused = this.currentState.focus === 'chromium';
            await this._disableBrowser();
            await this._enableBrowser(url);

            // If browser was focused before, show it again
            if (wasFocused) {
                await this._showBrowser();
            }
        } else {
            // Browser not running - just store the URL for next launch
            this.browserManager.url = url;
        }

        this.publishEvent({ browser_url_set: url });
        this.logger.info('Browser URL updated successfully');
    }

    /**
     * Set browser keep-alive: Enable/disable auto-restart on crash
     */
    async _setBrowserKeepAlive(enabled) {
        this.browserManager.keepAlive = !!enabled;

        this.publishEvent({
            browser_keep_alive_set: enabled
        });

        this.logger.info(`Browser keep-alive ${enabled ? 'enabled' : 'disabled'}`);

        if (enabled) {
            this._startBrowserMonitoring();
        } else {
            this._stopBrowserMonitoring();
        }
    }

    /**
     * Start monitoring browser process for crashes and restart if enabled
     * @private
     */
    _startBrowserMonitoring() {
        if (this._browserMonitorInterval) {
            clearInterval(this._browserMonitorInterval);
        }

        this.logger.debug('Starting browser keep-alive monitoring...');

        this._browserMonitorInterval = setInterval(async () => {
            if (this.browserManager.enabled && this.browserManager.keepAlive && this.browserManager.process) {
                // Check if browser process is still alive
                try {
                    process.kill(this.browserManager.process.pid, 0); // Check if process exists
                } catch (error) {
                    if (error.code === 'ESRCH') {
                        // Process doesn't exist - browser crashed
                        this.logger.warn('Browser process crashed, restarting due to keep-alive setting...');

                        const previousUrl = this.browserManager.url || 'http://localhost/clock/';
                        const wasFocused = this.currentState.focus === 'chromium';

                        try {
                            // Reset browser state
                            this.browserManager.process = null;
                            this.browserManager.windowId = null;
                            this.browserManager.enabled = false;

                            // Restart browser
                            await this._enableBrowser(previousUrl);

                            if (wasFocused) {
                                await this._showBrowser();
                            }

                            this.publishEvent({
                                browser_restarted: true,
                                reason: 'keep_alive_crash_recovery',
                                url: previousUrl
                            });

                        } catch (restartError) {
                            this.logger.error('Failed to restart browser after crash:', restartError);
                            this.publishError('Browser restart failed', {
                                error: restartError.message,
                                url: previousUrl
                            });
                        }
                    }
                }
            }
        }, 5000); // Check every 5 seconds
    }

    /**
     * Stop monitoring browser process
     * @private
     */
    _stopBrowserMonitoring() {
        if (this._browserMonitorInterval) {
            this.logger.debug('Stopping browser keep-alive monitoring...');
            clearInterval(this._browserMonitorInterval);
            this._browserMonitorInterval = null;
        }
    }

    /**
     * Update focus and content tracking based on active window
     */
    _updateFocusAndContent() {
        // Check if browser window is active
        if (this.browserManager.windowId &&
            this.windowManager.isWindowActive(this.browserManager.windowId)) {
            this.currentState.focus = 'chromium';
            this.currentState.content = this.browserManager.url;
        } else {
            // Check if MPV window is active
            const mpvWindow = this.windowManager.getWindowIdByNameExact('ParadoxMPV');
            if (mpvWindow && this.windowManager.isWindowActive(mpvWindow)) {
                this.currentState.focus = 'mpv';
                this.currentState.content = this.currentState.currentVideo || this.currentState.currentImage;
            } else {
                this.currentState.focus = 'none';
                this.currentState.content = 'none';
            }
        }

        // Update browser status (include whether browser window is foreground)
        let browserForeground = false;
        try {
            const wm = this.windowManager;
            if (wm) {
                // Prefer explicit API if available
                if (typeof wm.isWindowActive === 'function') {
                    browserForeground = !!(this.browserManager.windowId && wm.isWindowActive(this.browserManager.windowId));
                } else if (typeof wm.getActiveWindowId === 'function') {
                    const active = wm.getActiveWindowId();
                    if (active != null && this.browserManager.windowId != null) {
                        // Normalize hex/decimal window ids for comparison
                        const a = String(active).replace(/^0x/, '');
                        const b = String(this.browserManager.windowId).replace(/^0x/, '');
                        browserForeground = a === b;
                    }
                } else if (typeof wm.getActiveWindow === 'function') {
                    const aw = wm.getActiveWindow();
                    if (aw && aw.id != null && this.browserManager.windowId != null) {
                        const a = String(aw.id).replace(/^0x/, '');
                        const b = String(this.browserManager.windowId).replace(/^0x/, '');
                        browserForeground = a === b;
                    }
                } else {
                    // As a last resort, use focus field as heuristic
                    browserForeground = this.currentState.focus === 'chromium';
                }
            }
        } catch (err) {
            this.logger.debug('Failed to determine browser foreground state', err);
            browserForeground = false;
        }

        this.currentState.browser = {
            enabled: this.browserManager.enabled,
            url: this.browserManager.url,
            process_id: this.browserManager.process?.pid || null,
            window_id: this.browserManager.windowId,
            foreground: !!browserForeground
        };
    }

    // ========================================================================
    // WINDOW SWITCHING CORE FUNCTIONS
    // ========================================================================

    /**
     * Switch to MPV: Hide browser and show video content (pure window management)
     */
    async _switchToMpv() {
        this.logger.info('Switching to MPV (pure window management)');

        // If browser is enabled and focused, hide it first
        if (this.browserManager.enabled && this.currentState.focus === 'chromium') {
            await this._hideBrowser();
        } else {
            // Direct switch to MPV
            const mpvWindow = this.windowManager.getWindowIdByNameExact('ParadoxMPV');
            if (mpvWindow) {
                this.windowManager.activateWindow(mpvWindow);

                // Update state
                this.currentState.focus = 'mpv';
                this.currentState.content = this.currentState.currentVideo || this.currentState.currentImage;

                this.publishStatus();
                this.publishEvent({
                    switched_to_mpv: true,
                    content: this.currentState.content
                });
            } else {
                this.logger.warn('MPV window not found for switching');
            }
        }

        this.logger.info('Switched to MPV successfully');
    }

    /**
     * Switch to browser: Show browser (pure window management)
     */
    async _switchToBrowser() {
        if (!this.browserManager.enabled) {
            throw new Error('Browser not enabled. Call enableBrowser first.');
        }

        this.logger.info('Switching to browser (pure window management)');

        // If MPV is focused, coordinate transition
        if (this.currentState.focus === 'mpv') {
            // Pure window switching to browser
            this.windowManager.activateWindow(this.browserManager.windowId);

            // Update state
            this.currentState.focus = 'chromium';
            this.currentState.content = this.browserManager.url;

            this.publishStatus();
            this.publishEvent({
                switched_to_browser: true,
                url: this.browserManager.url
            });
        } else {
            // Direct switch to browser (already showing or no current focus)
            await this._showBrowser();
        }

        this.logger.info('Switched to browser successfully');
    }

    /**
     * Smart toggle: Switch between MPV and browser based on current focus
     */
    async _toggleMpvBrowser() {
        this.logger.info('Toggling between MPV and browser (pure window management)');

        if (this.currentState.focus === 'chromium') {
            await this._switchToMpv();
        } else if (this.currentState.focus === 'mpv') {
            if (this.browserManager.enabled) {
                await this._switchToBrowser();
            } else {
                this.logger.warn('Cannot switch to browser - not enabled');
            }
        } else {
            // No clear focus - default to MPV
            await this._switchToMpv();
        }

        this.logger.info('Toggle completed');
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
