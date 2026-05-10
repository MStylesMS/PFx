#!/usr/bin/env node

/**
 * Paradox Effects (ParadoxFX) - Main Application Entry Point
 * 
 * Multi-modal media and effect controller for interactive installations.
 * Supports screen and audio zones via MQTT commands.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const minimist = require('minimist');
const ZoneManager = require('./lib/core/zone-manager');
const ConfigLoader = require('./lib/core/config-loader');
const MqttClient = require('./lib/core/mqtt-client');
const Logger = require('./lib/utils/logger');

class PFxApplication {
    constructor() {
        this.logger = new Logger('PFx');
        this.config = null;
        this.zoneManager = null;
        this.mqttClient = null;
    }

    async start() {
        try {
            // Parse command line for --config/-c or positional argument
            const argv = minimist(process.argv.slice(2));
            const configFile = argv.config || argv.c || argv._[0] || 'pfx.ini';
            const configPath = path.resolve(configFile);
            const logDirOverride = argv['log-dir'] || argv.logDir || argv['log-directory'] || argv.logDirectory || null;

            // Load version first (needed for startup message)
            let version = '0.0.0';
            try {
                const pkg = require('./package.json');
                version = pkg.version || version;
            } catch (err) {
                // ignore; fallback version already set
            }

            console.log('****************************************');
            this.logger.info(`PFx Starting Paradox Effects application v${version} ...`);
            console.log('****************************************');
            this.logger.info(`Using configuration: ${configPath}`);
            if (!fs.existsSync(configPath)) {
                this.logger.error(`Configuration file not found: ${configPath}`);
                this.logger.error('Copy pfx.ini.example to pfx.ini and customize your settings.');
                process.exit(1);
            }
            
            // Load configuration
            this.config = await ConfigLoader.load(configPath, {});

            if (logDirOverride) {
                this.config.global.log_directory = path.resolve(logDirOverride);
                this.logger.info(`Overriding log directory from CLI: ${this.config.global.log_directory}`);
            }

            // Set up file logging if log_directory is configured
            let logStream = null;
            if (this.config.global.log_directory) {
                const logDir = path.resolve(this.config.global.log_directory);
                fs.mkdirSync(logDir, { recursive: true });

                // Clean up old logs on startup
                const LogCleanup = require('./lib/utils/log-cleanup');
                const cleanupResult = await LogCleanup.cleanup(logDir, {
                    maxAgeDays: 30,
                    maxSizeMB: 100,
                    excludeFiles: ['pfx-latest.log']
                });
                if (cleanupResult.deleted > 0) {
                    this.logger.info(`Cleaned up ${cleanupResult.deleted} old log files (kept ${cleanupResult.kept}, total ${cleanupResult.totalSize}MB)`);
                }

                // Create timestamped log file for this session
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
                const logFile = path.join(logDir, `pfx-${timestamp}.log`);
                logStream = fs.createWriteStream(logFile, { flags: 'a' });

                // Also create/update the latest log symlink
                const latestLogFile = path.join(logDir, 'pfx-latest.log');
                try {
                        // Remove existing path even if it's a dangling symlink.
                        try {
                            fs.lstatSync(latestLogFile);
                            fs.unlinkSync(latestLogFile);
                        } catch (_) {
                            // Path does not exist; nothing to remove.
                        }
                    fs.symlinkSync(path.basename(logFile), latestLogFile);
                } catch (err) {
                    // Ignore symlink errors, just use timestamped file
                }

                // Redirect console output to log file
                const origLog = console.log;
                const origError = console.error;
                const origWarn = console.warn;
                console.log = (...args) => {
                    origLog(...args);
                    logStream.write(args.join(' ') + '\n');
                };
                console.error = (...args) => {
                    origError(...args);
                    logStream.write(args.join(' ') + '\n');
                };
                console.warn = (...args) => {
                    origWarn(...args);
                    logStream.write(args.join(' ') + '\n');
                };

                this.logger.info(`Logging to: ${logFile}`);
            } else {
                this.logger.info('File logging disabled (no log_directory configured)');
            }
            this.logger.info(`Loaded configuration for ${Object.keys(this.config.devices).length} devices`);

            // Detect OS and log system information
            const { getOSDetection } = require('./lib/utils/os-detection');
            const osInfo = getOSDetection();
            this.logger.info(`Running on ${osInfo.toString()}`);
            this.logger.info(`Browser command: ${osInfo.getBrowserCommand()}`);
            this.logger.debug(`Window detection config: ${JSON.stringify(osInfo.getWindowDetectionConfig())}`);

            // Ensure XDG_RUNTIME_DIR is set (mpv & PulseAudio rely on it). If absent, attempt to infer for current user.
            if (!process.env.XDG_RUNTIME_DIR) {
                try {
                    const uid = process.getuid && process.getuid();
                    if (uid !== undefined) {
                        const candidate = `/run/user/${uid}`;
                        if (fs.existsSync(candidate)) {
                            process.env.XDG_RUNTIME_DIR = candidate;
                            this.logger.info(`Set XDG_RUNTIME_DIR fallback to ${candidate}`);
                        } else {
                            this.logger.warn('XDG_RUNTIME_DIR not set and fallback path missing; some audio/video features may warn.');
                        }
                    }
                } catch (e) {
                    this.logger.debug('Could not set XDG_RUNTIME_DIR fallback: ' + e.message);
                }
            }

            // Set up combined audio sinks if configured
            const AudioSetup = require('./lib/utils/audio-setup');
            const audioSetup = new AudioSetup();
            // Optional PulseAudio wait (defaults enabled). Can disable via env PFX_SKIP_PULSE_WAIT=1
            const skipPulseWait = process.env.PFX_SKIP_PULSE_WAIT === '1';
            let pulseReady = false;
            const waitTotal = this.config.global.pulseAudioWaitMs || 6000;
            const waitInterval = this.config.global.pulseAudioWaitIntervalMs || 500;
            if (!skipPulseWait && audioSetup.waitForPulseAudio) {
                pulseReady = await audioSetup.waitForPulseAudio(waitTotal, waitInterval);
            } else {
                pulseReady = await audioSetup.testPulseAudio();
            }
            if (pulseReady) {
                await audioSetup.setupCombinedSinks(this.config.global, Object.values(this.config.devices));
            } else {
                this.logger.warn('PulseAudio not available after initial wait, skipping combined sink setup');
            }

            // Initialize MQTT client
            this.mqttClient = new MqttClient(this.config.global);
            await this.mqttClient.connect();

            // Initialize zone manager
            this.zoneManager = new ZoneManager(this.config, this.mqttClient);
            await this.zoneManager.initialize();

            // Start cursor-hiding helper (unclutter) for relevant displays
            try {
                await this._startUnclutter();
            } catch (err) {
                this.logger.warn('Failed to start unclutter cursor-hider: ' + err.message);
            }

            // Setup graceful shutdown
            this.setupShutdownHandlers();

            console.log('****************************************');
            this.logger.info('Paradox Effects application started successfully');
            console.log('****************************************');

        } catch (error) {
            this.logger.error('Failed to start application:', error.message);
            this.logger.debug(error.stack);
            process.exit(1);
        }
    }

    async shutdown() {
        console.log('****************************************');
        this.logger.info('PFX shutting down politely, which may take a few seconds.');
        console.log('****************************************');

        // Stop unclutter if we started it
        try {
            await this._stopUnclutter();
        } catch (err) {
            this.logger.warn('Error stopping unclutter: ' + err.message);
        }

        if (this.zoneManager) {
            await this.zoneManager.shutdown();
        }

        if (this.mqttClient) {
            await this.mqttClient.disconnect();
        }

        console.log('****************************************');
        this.logger.info('Application shutdown complete');
        console.log('****************************************');
        process.exit(0);
    }

    setupShutdownHandlers() {
        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());
        process.on('uncaughtException', (error) => {
            this.logger.error('Uncaught exception:', error);
            this.shutdown();
        });
        process.on('unhandledRejection', (reason, promise) => {
            this.logger.error('Unhandled rejection at:', promise, 'reason:', reason);
            this.logger.error('Application will continue running. Please check for underlying issues.');
            // Do NOT shutdown on unhandled rejections - this prevents MQTT message errors from crashing the app
        });
    }

    /**
     * Start unclutter for each unique DISPLAY used by zones to hide the mouse cursor.
     * We spawn one unclutter process per DISPLAY and keep references for shutdown.
     */
    async _startUnclutter() {
        // Avoid starting twice
        if (this._unclutterProcs) return;
        this._unclutterProcs = new Map();

        // Discover displays from zone configs — skip audio-only zones (they don't use a display)
        try {
            const displays = new Set();
            for (const deviceName of Object.keys(this.config.devices || {})) {
                const dev = this.config.devices[deviceName];
                if (dev.type !== 'screen') continue;
                const d = dev.display || dev.display_name || process.env.DISPLAY || ':0';
                displays.add(d);
            }

            if (displays.size === 0) {
                this.logger.info('Audio-only config — no display zones; skipping unclutter');
                return;
            }

            for (const display of displays) {
                try {
                    // Spawn unclutter with no delay and explicitly set DISPLAY
                    const env = { ...process.env, DISPLAY: display };
                    // Prefer unclutter binary if available, otherwise try 'unclutter-xfixes'
                    const bin = this._whichSync('unclutter') || this._whichSync('unclutter-xfixes');
                    if (!bin) {
                        this.logger.warn('unclutter binary not found on PATH; cursor will not be hidden');
                        break;
                    }
                    const proc = spawn(bin, ['-idle', '0', '-root'], { env, detached: true, stdio: 'ignore' });
                    proc.unref();
                    this._unclutterProcs.set(display, { proc, bin });
                    this.logger.info(`Started ${bin} on DISPLAY=${display} to hide mouse cursor`);
                } catch (err) {
                    this.logger.warn(`Failed to start unclutter on DISPLAY=${display}: ${err.message}`);
                }
            }
        } catch (err) {
            this.logger.warn('Failed to enumerate displays for unclutter: ' + err.message);
        }
    }

    /**
     * Stop any unclutter processes started by this application
     */
    async _stopUnclutter() {
        if (!this._unclutterProcs) return;
        for (const [display, info] of this._unclutterProcs.entries()) {
            try {
                const proc = info.proc;
                if (proc && !proc.killed) {
                    try { process.kill(proc.pid, 'SIGTERM'); } catch (_) { }
                    try { process.kill(proc.pid, 'SIGKILL'); } catch (_) { }
                    this.logger.info(`Stopped ${info.bin} on DISPLAY=${display}`);
                }
            } catch (err) {
                this.logger.warn(`Error stopping unclutter on DISPLAY=${display}: ${err.message}`);
            }
        }
        this._unclutterProcs.clear();
        this._unclutterProcs = null;
    }

    _whichSync(cmd) {
        try {
            const out = require('child_process').execSync(`command -v ${cmd} 2>/dev/null || true`).toString().trim();
            return out || null;
        } catch {
            return null;
        }
    }
}

// Start the application if this file is run directly
if (require.main === module) {
    const app = new PFxApplication();
    app.start();
}

module.exports = PFxApplication;
