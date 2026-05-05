/**
 * MPV Zone Manager
 * 
 * Manages a single MPV instance per zone with IPC control for seamless media transitions.
 * Handles images, videos, and audio through one persistent MPV process.
 */

const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const Logger = require('../utils/logger');

// MPV Profile Manager
class MpvProfileManager {
    constructor() {
        this.profiles = null;
        this.detectedProfile = null;
        this.logger = new Logger('MpvProfileManager');
    }

    async loadProfiles() {
        try {
            const profilePath = path.join(__dirname, '../../config/mpv-profiles.json');
            const profileData = await fs.readFile(profilePath, 'utf8');
            this.profiles = JSON.parse(profileData);
            this.logger.info('MPV profiles loaded successfully');
            return this.profiles;
        } catch (error) {
            this.logger.error('Failed to load MPV profiles:', error);
            throw new Error('Could not load MPV profiles configuration');
        }
    }

    async detectProfile() {
        if (!this.profiles) {
            await this.loadProfiles();
        }

        this.logger.info('Detecting hardware profile...');

        for (const rule of this.profiles.autoDetection.rules) {
            try {
                if (await this._checkRule(rule)) {
                    this.detectedProfile = rule.profile;
                    this.logger.info(`Detected profile: ${rule.profile} (${rule.description})`);
                    return rule.profile;
                }
            } catch (error) {
                this.logger.debug(`Profile detection rule failed: ${rule.description}`, error);
            }
        }

        // Fallback to default
        this.detectedProfile = this.profiles.autoDetection.fallback;
        this.logger.warn(`No specific hardware detected, using fallback: ${this.detectedProfile}`);
        return this.detectedProfile;
    }

    async _checkRule(rule) {
        const { conditions } = rule;

        // Check CPU info
        if (conditions.cpuInfo) {
            try {
                const cpuInfo = await fs.readFile('/proc/cpuinfo', 'utf8');
                const matches = conditions.cpuInfo.some(pattern => cpuInfo.includes(pattern));
                if (!matches) return false;
            } catch (error) {
                return false;
            }
        }

        // Check device tree
        if (conditions.deviceTree && conditions.deviceTreeContent) {
            try {
                for (const dtPath of conditions.deviceTree) {
                    const dtContent = await fs.readFile(dtPath, 'utf8');
                    const matches = conditions.deviceTreeContent.some(pattern =>
                        dtContent.includes(pattern)
                    );
                    if (matches) return true;
                }
                return false;
            } catch (error) {
                return false;
            }
        }

        return true;
    }

    getProfile(profileName) {
        if (!this.profiles) {
            throw new Error('Profiles not loaded');
        }

        if (profileName && this.profiles.profiles[profileName]) {
            return this.profiles.profiles[profileName];
        }

        // Use detected profile
        if (this.detectedProfile && this.profiles.profiles[this.detectedProfile]) {
            return this.profiles.profiles[this.detectedProfile];
        }

        // Final fallback
        return this.profiles.profiles[this.profiles.autoDetection.fallback];
    }

    buildMpvArgs(profileName, audioDevice, targetMonitor) {
        const profile = this.getProfile(profileName);
        const useWayland = process.env.XDG_SESSION_TYPE &&
            process.env.XDG_SESSION_TYPE.toLowerCase() === 'wayland';

        this.logger.info(`Building MPV args for profile: ${profile.name}`);

        let mpvArgs = [
            // Base arguments from profile
            ...profile.baseArgs,

            // Display-specific arguments
            ...(useWayland ? profile.displayArgs.wayland : profile.displayArgs.x11),

            // Audio device
            `--audio-device=${audioDevice}`,
            '--volume=70',

            // Display targeting - try multiple approaches
            `--fs-screen=${targetMonitor}`,
            `--screen=${targetMonitor}`,           // Set windowed screen too
            '--force-window=immediate',           // Force window creation immediately

            // Standard ParadoxFX settings
            '--title=ParadoxMPV',
            '--fullscreen',
            '--no-border',
            '--ontop',
            '--no-osd-bar',
            // '--really-quiet' (left commented for verbose MPV logs during troubleshooting)
            '--idle=yes'
            // keep-open and no-terminal settings are now handled in profiles
        ];

        // Add volume-max if configured in zone config
        if (this.config && this.config.maxVolume !== undefined) {
            const maxVolume = Math.max(0, Math.min(200, this.config.maxVolume));
            mpvArgs.push(`--volume-max=${maxVolume}`);
            this.logger.info(`Setting MPV volume-max to: ${maxVolume}`);
        }

        // Add performance profile if specified
        if (profile.performance.profile) {
            mpvArgs.push(`--profile=${profile.performance.profile}`);
        }

        // Add extra performance args
        if (profile.performance.extraArgs) {
            mpvArgs.push(...profile.performance.extraArgs);
        }

        this.logger.debug('MPV args built:', mpvArgs);
        return mpvArgs;
    }
}

class MpvZoneManager extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.logger = new Logger(`MpvZoneManager:${config.name}`);

        // MPV Profile Manager
        this.profileManager = new MpvProfileManager();

        // MPV process and IPC
        this.mpvProcess = null;
        this.ipcSocket = null;
        const { sanitizeFilename } = require('../utils/utils');
        this.ipcSocketPath = path.join(os.tmpdir(), `mpv-${sanitizeFilename(config.name)}-${Date.now()}.sock`);

        // State tracking
        this.isInitialized = false;
        this.isPlaying = false;
        this.currentMedia = null;
        this.commandId = 1;

        // IPC response tracking
        this.pendingCommands = new Map();

        // Configuration
        this.audioDevice = config.audioDevice;
        this.display = config.display || ':0';
        this.targetMonitor = config.targetMonitor || 0;

        // Profile selection staging (will finalize in initialize())
        // Precedence (highest first): ENV override -> explicit zone config -> fallback placeholder (generic-minimal -> later auto-detect)
        const envOverride = process.env.PFX_MPV_PROFILE;
        if (envOverride) {
            this.mpvProfile = envOverride.trim();
            this.mpvProfileOrigin = 'env';
        } else if (config.mpvVideoProfile) {
            this.mpvProfile = config.mpvVideoProfile.trim();
            this.mpvProfileOrigin = 'config';
        } else {
            this.mpvProfile = 'generic-minimal'; // temporary until initialize() decides if detection needed
            this.mpvProfileOrigin = 'default';
        }

        // Timer state for simulated EOF
        this._playbackTimer = null;
        this._playbackStart = null;
        this._playbackRemaining = null;

        this.ipcCommandQueue = [];
        this.isReady = false;

        // Debug logging for target monitor
        this.logger.debug(`🎯 targetMonitor config value: ${config.targetMonitor}, final value: ${this.targetMonitor}`);

        // Resilience / restart tracking
        this.isShuttingDown = false;
        this.restartAttempts = 0;
        this.maxRestartAttempts = config.mpvRestartMaxAttempts || 3;
        this.restartDelayMs = config.mpvRestartDelayMs || 1500;
        this.autoRestartEnabled = config.mpvAutoRestart !== false; // default true
        this.isRestarting = false;
    }

    /**
     * Initialize the MPV instance with IPC control
     */
    async initialize() {
        if (this.isInitialized) {
            this.logger.warn('MPV Zone Manager already initialized');
            return;
        }

        this.isShuttingDown = false;

        this.logger.info('Initializing MPV Zone Manager...');

        try {
            // Load profiles
            await this.profileManager.loadProfiles();

            // If no explicit profile (config/env) supplied, attempt auto-detect
            if (this.mpvProfileOrigin === 'default') {
                try {
                    const detected = await this.profileManager.detectProfile();
                    if (detected) {
                        this.mpvProfile = detected;
                        this.mpvProfileOrigin = 'detected';
                    }
                } catch (err) {
                    this.logger.warn(`Auto-detect failed (${err.message}); staying with fallback profile: ${this.mpvProfile}`);
                }
            }

            // Final logging of selection
            this._logProfileSelection();

            // Log detailed profile information (args built later) for visibility
            const profileInfo = this.getProfileInfo();
            this.logger.info('MPV Profile Configuration:', profileInfo);

            // Start MPV with IPC socket
            await this._startMpvProcess();

            // Wait for IPC socket to be ready (will throw enriched error on failure)
            await this._waitForIpcSocket();

            // Connect to IPC socket
            await this._connectIpcSocket();

            // Give MPV a moment to be fully ready for commands
            await new Promise(resolve => setTimeout(resolve, 500));

            this.isInitialized = true;
            this.logger.info('MPV Zone Manager initialized successfully');

        } catch (error) {
            this.logger.error('Failed to initialize MPV Zone Manager:', error);
            await this.shutdown();
            throw error;
        }
    }

    /**
     * Start the MPV process using profile-based configuration
     */
    async _startMpvProcess() {
        const mpvArgs = this._buildSpawnArgs();

        this.logger.debug('Starting MPV with profile-based args:', mpvArgs);

        this.mpvProcess = spawn('mpv', mpvArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: this._buildSpawnEnv()
        });

        this._attachProcessHandlers();
    }

    _buildSpawnArgs() {
        let mpvArgs = this.profileManager.buildMpvArgs(
            this.mpvProfile,
            this.audioDevice,
            this.targetMonitor
        );

        mpvArgs = [`--input-ipc-server=${this.ipcSocketPath}`, ...mpvArgs];

        if (this.config.mpvVideoOptions) {
            mpvArgs.push(...this.config.mpvVideoOptions.split(' ').filter(Boolean));
        }

        if (this.config && this.config.mpvOntop === false) {
            const filteredArgs = mpvArgs.filter(arg => arg !== '--ontop');
            const removed = mpvArgs.length - filteredArgs.length;
            mpvArgs = filteredArgs;
            this.logger.info(`mpvOntop disabled in config; removed ${removed} --ontop entries from args`);
        }

        return mpvArgs;
    }

    _buildSpawnEnv() {
        const xauthority = process.env.XAUTHORITY || `/home/${process.env.USER}/.Xauthority` || '/home/paradox/.Xauthority';
        return {
            ...process.env,
            DISPLAY: this.display,
            XAUTHORITY: xauthority
        };
    }

    _attachProcessHandlers() {
        const mpvConfig = this._getMpvRuntimeConfig();

        this.mpvProcess.on('error', (error) => {
            this.logger.error('MPV process error:', error);
        });

        this.mpvProcess.on('exit', (code, signal) => {
            this.logger.warn(`MPV process exited with code ${code}, signal ${signal}`);
            this.isInitialized = false;
            this.mpvProcess = null;
            this.emit('mpv_exited', { code, signal, attempts: this.restartAttempts });
            if (!this.isShuttingDown && this.autoRestartEnabled) {
                this._scheduleRestart(code, signal);
            }
        });

        this.mpvProcess.stdout.on('data', (data) => {
            this.logger.info('MPV stdout:', data.toString().trim());
        });

        this.mpvProcess.stderr.on('data', (data) => {
            this._handleStderrMessage(data.toString().trim(), mpvConfig);
        });
    }

    _getMpvRuntimeConfig() {
        const { getOSDetection } = require('../utils/os-detection');
        const osInfo = getOSDetection();
        return osInfo.getMpvConfig();
    }

    _handleStderrMessage(message, mpvConfig = this._getMpvRuntimeConfig()) {
        if (mpvConfig.suppressVdpauWarnings && message.includes('VDPAU')) {
            return;
        }

        if (message.includes('Cannot load libcuda.so.1')) {
            this.logger.debug('MPV stderr:', message);
            return;
        }

        this.logger.info('MPV stderr:', message);
    }

    /**
     * Schedule a restart attempt with backoff and max attempt guard
     */
    _scheduleRestart(code, signal) {
        if (this.isRestarting) {
            this.logger.debug('Restart already in progress, ignoring additional exit event');
            return;
        }
        if (this.restartAttempts >= this.maxRestartAttempts) {
            this.logger.error('Max MPV restart attempts reached; will not attempt further restarts');
            this.emit('mpv_restart_failed', { code, signal, attempts: this.restartAttempts, max: this.maxRestartAttempts });
            return;
        }
        this.restartAttempts += 1;
        const attempt = this.restartAttempts;
        this.isRestarting = true;
        const delay = this.restartDelayMs * attempt; // linear backoff
        this.logger.warn(`Scheduling MPV restart attempt ${attempt}/${this.maxRestartAttempts} in ${delay}ms`);
        this.emit('mpv_restarting', { attempt, delay, code, signal });
        setTimeout(async () => {
            try {
                await this._restartInternal();
                this.isRestarting = false;
                this.emit('mpv_restarted', { attempt, code, signal, socket: this.ipcSocketPath });
            } catch (err) {
                this.isRestarting = false;
                this.logger.error(`MPV restart attempt ${attempt} failed:`, err.message);
                if (this.restartAttempts < this.maxRestartAttempts) {
                    this._scheduleRestart(code, signal);
                } else {
                    this.emit('mpv_restart_failed', { attempt, error: err.message, code, signal, max: this.maxRestartAttempts });
                }
            }
        }, delay);
    }

    /**
     * Internal restart logic (recreate socket, process, and reconnect IPC)
     */
    async _restartInternal() {
        this.logger.warn('Attempting MPV restart...');
        this._resetIpcSession('MPV restarting');
        // Regenerate a fresh IPC socket path to avoid stale files
        const { sanitizeFilename } = require('../utils/utils');
        this.ipcSocketPath = path.join(os.tmpdir(), `mpv-${sanitizeFilename(this.config.name)}-${Date.now()}-r${this.restartAttempts}.sock`);
        try {
            await this._startMpvProcess();
            await this._waitForIpcSocket();
            await this._connectIpcSocket();
            await new Promise(r => setTimeout(r, 300));
            this.isInitialized = true;
            this.logger.info('MPV restart successful');
        } catch (error) {
            this.isInitialized = false;
            throw error;
        }
    }

    /** Mark manager as shutting down to suppress auto-restart */
    _markShuttingDown() {
        this.isShuttingDown = true;
    }

    _resetIpcSession(reason) {
        this._resetPlaybackTimer();

        for (const requestId of Array.from(this.pendingCommands.keys())) {
            const pendingCommand = this._clearPendingCommand(requestId);
            if (pendingCommand) {
                pendingCommand.reject(new Error(reason));
            }
        }

        if (this.ipcSocket) {
            this.ipcSocket.destroy();
            this.ipcSocket = null;
        }
    }

    _clearPendingCommand(requestId) {
        const pendingCommand = this.pendingCommands.get(requestId);
        if (!pendingCommand) {
            return null;
        }

        this.pendingCommands.delete(requestId);

        if (pendingCommand.timeoutHandle) {
            clearTimeout(pendingCommand.timeoutHandle);
        }

        return pendingCommand;
    }

    _resetPlaybackTimer() {
        if (this._playbackTimer) {
            clearTimeout(this._playbackTimer);
            this._playbackTimer = null;
        }
        this._playbackStart = null;
        this._playbackRemaining = null;
    }

    /**
     * Wait for the IPC socket to be created by MPV
     */
    async _waitForIpcSocket(maxRetries = 50, retryDelay = 100) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                await fs.access(this.ipcSocketPath);
                this.logger.debug('IPC socket is ready');
                return;
            } catch (error) {
                // Socket not ready yet, wait and retry
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
        throw new Error('MPV IPC socket creation timeout');
    }

    /**
     * Connect to the MPV IPC socket
     */
    async _connectIpcSocket() {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection(this.ipcSocketPath);
            this.ipcSocket = socket;

            socket.on('connect', () => {
                this.logger.debug('Connected to MPV IPC socket');
                resolve();
            });

            socket.on('error', (error) => {
                this.logger.error('IPC socket error:', error);
                reject(error);
            });

            socket.on('data', (data) => {
                this._handleIpcResponse(data);
            });

            socket.on('close', () => {
                this.logger.warn('IPC socket closed');
                if (this.ipcSocket === socket) {
                    this.ipcSocket = null;
                }
            });
        });
    }

    /**
     * Handle responses from MPV IPC
     */
    _handleIpcResponse(data) {
        const lines = data.toString().split('\n').filter(line => line.trim());

        for (const line of lines) {
            try {
                const response = JSON.parse(line);
                this.logger.debug('MPV IPC response:', response);

                // Handle command responses
                if (response.request_id && this.pendingCommands.has(response.request_id)) {
                    const { resolve, reject } = this._clearPendingCommand(response.request_id);

                    if (response.error !== 'success') {
                        reject(new Error(`MPV command failed: ${response.error}`));
                    } else {
                        resolve(response.data);
                    }
                }

                // Handle events
                if (response.event) {
                    this.emit(response.event, response);
                    this._handleMpvEvent(response);
                }

            } catch (error) {
                this.logger.debug('Failed to parse IPC response:', line);
            }
        }
    }

    /**
     * Handle MPV events
     */
    _handleMpvEvent(event) {
        switch (event.event) {
            case 'playback-restart':
                this.isPlaying = true;
                this.logger.debug('Playback started');
                this._handlePlaybackRestart();
                break;

            case 'end-file':
                this._handleEndFile(event);
                break;

            case 'file-loaded':
                this.logger.debug('Media file loaded:', event);
                break;
        }
    }

    /**
     * Handle playback restart events
     */
    _handlePlaybackRestart() {
        // existing listener for 'playback-restart'
        this.emit('playback-restart');
        // On real restart, query duration and start timer
        this.getProperty('duration').then(duration => {
            this._resetPlaybackTimer();
            this._playbackRemaining = duration;
            this._playbackStart = Date.now();
            // simulate EOF slightly before actual end
            this._playbackTimer = setTimeout(() => this._onSimulatedEnd(), Math.max(0, (this._playbackRemaining * 1000) - 200));
        }).catch(() => { });
    }

    /**
     * Handle end of file events
     */
    /**
     * Handle end of file events
     */
    async _handleEndFile(event) {
        this.logger.debug('End of file event:', event);

        // 'eof' means the file finished playing naturally.
        // 'stop' means it was stopped by a command.
        if (event.reason === 'eof') {
            this.logger.debug('Media finished playing naturally.');
            // After a file ends, MPV might be idle or playing the next item.
            // We can query the current state to be sure.
            try {
                // Use a small delay to allow MPV to update its state
                await new Promise(resolve => setTimeout(resolve, 50));
                const newPath = await this._sendIpcCommand('get_property', ['path']);

                if (newPath) {
                    this.currentMedia = path.basename(newPath);
                    this.isPlaying = true;
                    this.logger.info(`Next in playlist: ${this.currentMedia}`);
                } else {
                    this.currentMedia = null;
                    this.isPlaying = false;
                    this.logger.info('Playlist finished.');
                }
            } catch (error) {
                this.logger.warn('Could not get new path after end-file, assuming idle.', error);
                this.currentMedia = null;
                this.isPlaying = false;
            }
        } else {
            this.logger.debug(`File ended for reason: ${event.reason}. Assuming playback has stopped.`);
            // When we issue a 'stop' or 'loadfile', the reason is 'stop' or 'redirect'.
            // We don't want to clear currentMedia here as it's managed by the calling function.
        }
    }

    /**
     * Send command to MPV via IPC
     */
    async _sendIpcCommand(command, args = []) {
        if (!this.ipcSocket) {
            throw new Error('MPV IPC socket not connected');
        }

        const requestId = this.commandId++;
        const commandObj = {
            command: [command, ...args],
            request_id: requestId
        };

        return new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                const pendingCommand = this._clearPendingCommand(requestId);
                if (pendingCommand) {
                    reject(new Error('MPV command timeout'));
                }
            }, 5000);

            // Store the promise resolvers
            this.pendingCommands.set(requestId, { resolve, reject, timeoutHandle });

            // Send the command
            const commandStr = JSON.stringify(commandObj) + '\n';
            this.ipcSocket.write(commandStr);
        });
    }

    /**
     * Load media (image, video, or audio) into MPV
     */
    async loadMedia(mediaPath, options = {}) {
        if (!this.isInitialized) {
            throw new Error('MPV Zone Manager not initialized');
        }

        const fullPath = this._getMediaPath(mediaPath);

        // Check if file exists
        try {
            await fs.access(fullPath);
        } catch (error) {
            throw new Error(`Media file not found: ${fullPath}`);
        }

        this.logger.info(`Loading media: ${fullPath}`);
        this.currentMedia = mediaPath;

        try {
            // Load the file
            await this._sendIpcCommand('loadfile', [fullPath, 'replace']);

            // Apply any options
            if (options.volume !== undefined) {
                await this.setVolume(options.volume);
            }

            if (options.pause) {
                await this.pause();
            }

            return true;

        } catch (error) {
            this.logger.error('Failed to load media:', error);
            throw error;
        }
    }

    /**
     * Add media to the playlist and start playing if idle
     */
    async addToPlaylist(mediaPath) {
        if (!this.isInitialized) {
            throw new Error('MPV Zone Manager not initialized');
        }

        const fullPath = this._getMediaPath(mediaPath);

        // Check if file exists
        try {
            await fs.access(fullPath);
        } catch (error) {
            throw new Error(`Media file not found: ${fullPath}`);
        }

        this.logger.info(`Adding to playlist: ${fullPath}`);
        // Query current playlist to decide replace vs append
        let playlist = [];
        try {
            playlist = await this._sendIpcCommand('get_property', ['playlist']);
        } catch (err) {
            this.logger.warn('Could not retrieve playlist status, defaulting to append-play', err);
        }
        try {
            if (!playlist || playlist.length <= 1) {
                // First media or only default image loaded: replace
                this.logger.debug('Playlist has one or no items, replacing media');
                await this._sendIpcCommand('loadfile', [fullPath, 'replace']);
                this.currentMedia = mediaPath;
            } else {
                // Already playing media: append
                this.logger.debug('Appending media to playlist');
                await this._sendIpcCommand('loadfile', [fullPath, 'append-play']);
            }
            // Ensure playback resumes
            await this.play();
            this.isPlaying = true;
            return true;
        } catch (error) {
            this.logger.error('Failed to add to playlist:', error);
            throw error;
        }
    }

    /**
     * Queue media for playback after current media ends
     */
    async queueMedia(mediaPath, options = {}) {
        this.logger.warn('queueMedia is deprecated. Use addToPlaylist instead.');
        return this.addToPlaylist(mediaPath);
    }

    /**
     * Play/resume current media
     */
    async play() {
        return await this._sendIpcCommand('set_property', ['pause', false]);
    }

    /**
     * Pause current media
     */
    async pause() {
        return await this._sendIpcCommand('set_property', ['pause', true]);
    }

    /**
     * Stop playback and clear queue
     */
    async stop() {
        this.isPlaying = false;
        this.currentMedia = null;
        this._resetPlaybackTimer();
        // 'stop' clears the playlist
        return await this._sendIpcCommand('stop');
    }

    /**
     * Skip to next item in playlist
     */
    async next() {
        return await this._sendIpcCommand('playlist-next', []);
    }

    /**
     * Set volume (0-150)
     */
    async setVolume(volume) {
        const clampedVolume = Math.max(0, Math.min(150, volume));
        return await this._sendIpcCommand('set_property', ['volume', clampedVolume]);
    }

    /**
     * Get current playback position
     */
    async getPosition() {
        return await this._sendIpcCommand('get_property', ['time-pos']);
    }

    /**
     * Get current media duration
     */
    async getDuration() {
        return await this._sendIpcCommand('get_property', ['duration']);
    }

    /**
     * Get queue status
     */
    async getQueueStatus() {
        const playlist = await this._sendIpcCommand('get_property', ['playlist']);
        const currentPos = await this._sendIpcCommand('get_property', ['playlist-pos']);

        return {
            current: this.currentMedia,
            playlist: playlist.map(item => item.filename),
            playlistCount: playlist.length,
            playlistPosition: currentPos,
            isPlaying: this.isPlaying
        };
    }

    /**
     * Resolve media path (absolute or relative to media directory)
     */
    _getMediaPath(mediaPath) {
        if (path.isAbsolute(mediaPath)) {
            return mediaPath;
        }
        return path.join(this.config.mediaDir || '/opt/paradox/media', mediaPath);
    }

    /**
     * Get current profile information for debugging
     */
    getProfileInfo() {
        const profile = this.profileManager.getProfile(this.mpvProfile);
        return {
            profileName: this.mpvProfile,
            profileDescription: profile?.name || 'unknown',
            profileOrigin: this.mpvProfileOrigin,
            audioDevice: this.audioDevice,
            screen: this.targetMonitor
        };
    }

    /**
     * Internal helper to emit a consistent log line describing how the profile was chosen.
     */
    _logProfileSelection() {
        switch (this.mpvProfileOrigin) {
            case 'env':
                this.logger.info(`Using MPV profile '${this.mpvProfile}' (override from PFX_MPV_PROFILE env var)`);
                break;
            case 'config':
                this.logger.info(`Using MPV profile '${this.mpvProfile}' (explicit from config mpv_video_profile)`);
                break;
            case 'detected':
                this.logger.info(`Using MPV profile '${this.mpvProfile}' (auto-detected hardware match)`);
                break;
            case 'default':
            default:
                this.logger.info(`Using MPV profile '${this.mpvProfile}' (static fallback; no config/env/detection)`);
                break;
        }
    }

    /**
     * Shutdown the MPV instance and cleanup
     */
    async shutdown() {
        this.logger.info('Shutting down MPV Zone Manager...');

        this._markShuttingDown();
        this._resetIpcSession('MPV shutdown');

        // Terminate MPV process
        if (this.mpvProcess) {
            this.mpvProcess.kill('SIGTERM');

            // Wait for graceful exit, then force kill if needed
            setTimeout(() => {
                if (this.mpvProcess && !this.mpvProcess.killed) {
                    this.mpvProcess.kill('SIGKILL');
                }
            }, 5000);
        }

        // Cleanup socket file
        try {
            await fs.unlink(this.ipcSocketPath);
        } catch (error) {
            // Socket file might not exist, ignore error
        }

        this.isInitialized = false;
        this.logger.info('MPV Zone Manager shutdown complete');
    }

    /**
     * Internal: emit simulated end-file event
     */
    _onSimulatedEnd() {
        this._playbackTimer = null;
        this.emit('end-file');
    }

    /**
     * Append media to playlist without replacing current
     * @param {string} mediaPath - relative or absolute path
     */
    async appendMedia(mediaPath) {
        if (!this.isInitialized) {
            throw new Error('MPV Zone Manager not initialized');
        }
        const fullPath = this._getMediaPath(mediaPath);
        // Verify file exists
        try {
            await fs.access(fullPath);
        } catch {
            throw new Error(`Media file not found: ${fullPath}`);
        }
        this.logger.info(`Appending media to playlist: ${fullPath}`);
        await this._sendIpcCommand('loadfile', [fullPath, 'append-play']);
        return true;
    }
}

module.exports = MpvZoneManager;
