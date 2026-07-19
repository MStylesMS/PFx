/**
 * Configuration Loader
 * 
 * Loads and parses the pfx.ini configuration file.
 */

const fs = require('fs').promises;
const path = require('path');
const ini = require('ini');
const Logger = require('../utils/logger');

const SUPPORTED_DEVICE_TYPES = new Set(['screen', 'audio', 'combined_audio']);

class ConfigLoader {
    constructor() {
        this.logger = new Logger('ConfigLoader');
    }

    /**
     * Load configuration from INI file
     * @param {string} filePath - Path to the INI file
     * @returns {Object} Parsed configuration object
     */
    static async load(filePath, options = {}) {
        const loader = new ConfigLoader();
        return await loader._load(filePath, options);
    }

    async _load(filePath, options = {}) {
        try {
            this.logger.info(`Loading configuration from ${filePath}`);

            const fileContent = await fs.readFile(filePath, 'utf8');
            let rawConfig = ini.parse(fileContent);

            // Separate global config and mqtt config from device configs
            const { global, mqtt, ...devices } = rawConfig;

            if (!global) {
                throw new Error('No [global] section found in configuration file');
            }

            // Handle both old and new config formats
            const mqttConfig = mqtt || {};

            // Validate configuration
            this._validateConfig(global, mqttConfig);

            // Process device configurations
            const processedDevices = {};
            for (const [deviceName, deviceConfig] of Object.entries(devices)) {
                processedDevices[deviceName] = this._processDeviceConfig(deviceName, deviceConfig);
            }

            const config = {
                global: this._processGlobalConfig(global, mqttConfig),
                devices: processedDevices
            };

            this.logger.info(`Configuration loaded successfully: ${Object.keys(devices).length} devices`);
            return config;

        } catch (error) {
            this.logger.error('Failed to load configuration:', error);
            throw error;
        }
    }

    _validateConfig(global, mqtt) {
        // Check for required fields in either old or new format
        const hasOldFormat = global.MQTT_SERVER && global.HEARTBEAT_TOPIC;
        const hasNewFormat = mqtt.broker && global.heartbeat_topic;

        if (!hasOldFormat && !hasNewFormat) {
            if (!mqtt.broker && !global.MQTT_SERVER) {
                // Keep error message compatible with existing unit tests
                throw new Error('Required global configuration field missing: MQTT_SERVER');
            }
            if (!global.heartbeat_topic && !global.HEARTBEAT_TOPIC) {
                throw new Error('Heartbeat topic missing: need [global] heartbeat_topic or HEARTBEAT_TOPIC');
            }
        }
    }

    _processGlobalConfig(global, mqtt = {}) {
        // Support both old and new config formats, and normalize new advanced MQTT keys.
        const env = process.env;

        // Helper to parse int safely
        const toInt = (v) => {
            if (v === undefined || v === null || v === '') return undefined;
            const n = parseInt(v, 10);
            return isNaN(n) ? undefined : n;
        };

        // Accept snake_case (INI), UPPER_SNAKE (legacy env), or camelCase (programmatic) for new keys
        const mqttMaxAttempts = toInt(
            mqtt.max_attempts ?? global.mqtt_max_attempts ?? env.MQTT_MAX_ATTEMPTS
        );
        const mqttConnectTimeoutMs = toInt(
            mqtt.connect_timeout_ms ?? global.connect_timeout_ms ?? env.MQTT_CONNECT_TIMEOUT_MS
        );
        const mqttOverallTimeoutMs = toInt(
            mqtt.overall_timeout_ms ?? global.overall_timeout_ms ?? env.MQTT_OVERALL_TIMEOUT_MS
        );

        const cfg = {
            mqttServer: mqtt.broker || global.MQTT_SERVER || 'localhost',
            mqttPort: toInt(mqtt.port) || toInt(global.MQTT_PORT) || 1883,
            mqttUsername: mqtt.username || global.MQTT_USERNAME || null,
            mqttPassword: mqtt.password || global.MQTT_PASSWORD || null,
            mqttClientId: mqtt.client_id || global.MQTT_CLIENT_ID || 'pfx-client',
            mqttKeepAlive: toInt(mqtt.keepalive) || toInt(global.MQTT_KEEPALIVE) || 60,
            mqttCleanSession: mqtt.clean_session !== undefined ? mqtt.clean_session : (global.MQTT_CLEAN_SESSION !== undefined ? global.MQTT_CLEAN_SESSION : true),
            mqttReconnectPeriod: parseInt(mqtt.reconnect_period) || 1500, // milliseconds, default 1500ms
            baseTopic: mqtt.base_topic || global.BASE_TOPIC || 'paradox',
            deviceName: global.device_name || global.DEVICE_NAME || 'pfx-device',
            heartbeatTopic: global.heartbeat_topic || global.HEARTBEAT_TOPIC || 'paradox/heartbeat',
            heartbeatInterval: toInt(global.heartbeat_interval) || toInt(global.HEARTBEAT_INTERVAL_MS) || 10000,
            heartbeatEnabled: global.heartbeat_enabled !== undefined ? global.heartbeat_enabled : (global.HEARTBEAT_ENABLED !== undefined ? global.HEARTBEAT_ENABLED : true),
            logLevel: global.log_level || global.LOG_LEVEL || 'info',
            log_directory: global.log_directory || global.LOG_DIRECTORY || null,
            // NOTE: global media_base_path deprecated — per-device media resolution uses each device's `media_dir`.
            duckingVolume: toInt(global.ducking_volume) || 30,
            // Global ducking defaults (optional)
            speechDucking: global.speech_ducking !== undefined ? toInt(global.speech_ducking) : undefined,
            videoDucking: global.video_ducking !== undefined ? toInt(global.video_ducking) : undefined,
            // New normalized advanced MQTT options (may be undefined if not supplied)
            mqttMaxAttempts,
            mqttConnectTimeoutMs,
            mqttOverallTimeoutMs,
            // PulseAudio readiness wait configuration
            pulseAudioWaitMs: toInt(global.pulseaudio_wait_ms) || 6000,
            pulseAudioWaitIntervalMs: toInt(global.pulseaudio_wait_interval_ms) || 500
        };

        return cfg;
    }

    _normalizeDeviceType(typeValue) {
        if (!typeValue) return typeValue;
        return typeValue.toString().trim().toLowerCase().replace(/-/g, '_');
    }

    _normalizeDeviceName(deviceName, config) {
        const explicitName = config.name || config.NAME;
        if (explicitName) {
            return explicitName.toString().trim();
        }

        const normalized = deviceName.includes(':') ? deviceName.split(':').slice(1).join(':') : deviceName;
        return normalized.trim();
    }

    _parseListValue(value) {
        if (!value) return null;
        if (Array.isArray(value)) return value;
        return value.toString().split(',').map(s => s.trim()).filter(Boolean);
    }

    _parseSceneMap(value) {
        if (!value) return null;
        if (typeof value === 'object') return value;
        try {
            return JSON.parse(value);
        } catch (error) {
            this.logger.warn(`Invalid scene_map JSON, ignoring: ${error.message}`);
            return null;
        }
    }

    _parseJsonValue(value, label) {
        if (value === undefined || value === null || value === '') return null;
        if (typeof value === 'object') return value;
        try {
            return JSON.parse(value);
        } catch (error) {
            this.logger.warn(`Invalid ${label} JSON, ignoring: ${error.message}`);
            return null;
        }
    }

    _processDeviceConfig(deviceName, config) {
        // Support both old and new config formats
        const deviceType = this._normalizeDeviceType(config.type || config.DEVICE_TYPE);
        if (!deviceType) {
            // Old tests expect this exact message
            throw new Error(`Device ${deviceName} missing DEVICE_TYPE`);
        }

        if (!SUPPORTED_DEVICE_TYPES.has(deviceType)) {
            throw new Error(
                `Unsupported device type '${deviceType}' for section ${deviceName}. ` +
                'PFx supports screen and audio zones only.'
            );
        }

        const processed = {
            name: this._normalizeDeviceName(deviceName, config),
            type: deviceType,
            baseTopic: config.topic || config.TOPIC || config.base_topic || config.BASE_TOPIC,
            statusTopic: config.status_topic || config.STATUS_TOPIC || config.state_topic || config.STATE_TOPIC
        };

        // Add type-specific configuration
        switch (deviceType) {
            case 'screen':
                processed.display = config.display || config.DISPLAY || ':0';

                // Use target_monitor for screen targeting
                processed.targetMonitor = parseInt(config.target_monitor || config.TARGET_MONITOR) || 0;

                // Normalize device media dir and compute a device-local media base path.
                const deviceMediaDirRaw = config.media_dir || config.MEDIA_DIR || '';
                // Keep device.mediaDir as provided (absolute or relative).
                // Do not inherit a global media base path; per-device media_base_path may be provided.
                processed.mediaDir = deviceMediaDirRaw;
                processed.audioDevice = config.audio_device || config.AUDIO_DEVICE || 'default';
                processed.playerType = config.player_type || config.PLAYER_TYPE || 'mpv';
                processed.volume = parseInt(config.volume || config.VOLUME) || 70;
                processed.maxVolume = parseInt(config.max_volume || config.maxVolume) || 150;
                processed.defaultImage = config.default_image || config.DEFAULT_IMAGE || 'default.png';
                processed.videoQueueMax = parseInt(config.video_queue_max || config.VIDEO_QUEUE_MAX) || 5;
                processed.audioQueueMax = parseInt(config.audio_queue_max || config.AUDIO_QUEUE_MAX) || 5;
                processed.mpvVideoOptions = config.mpv_video_options || config.MPV_VIDEO_OPTIONS;
                processed.mpvVideoProfile = config.mpv_video_profile || config.MPV_VIDEO_PROFILE;
                processed.transitionDelay = parseInt(config.TRANSITION_DELAY_MS) || 100;

                // Optional display resolution control
                processed.outputName = config.output_name || config.outputName || config.OUTPUT_NAME || null;
                processed.resolutionMode = config.resolution_mode || config.resolutionMode || config.RESOLUTION_MODE || null;
                processed.resolutionFallback = config.resolution_fallback || config.resolutionFallback || config.RESOLUTION_FALLBACK || null;

                // Monitor on/off control (sleepScreen / wakeScreen / auto-wake)
                const MONITOR_METHODS = new Set(['none', 'xrandr', 'dpms', 'cec', 'ddc']);
                const rawMethod = (config.monitor_control_method || config.monitorControlMethod || config.MONITOR_CONTROL_METHOD || 'none');
                const method = String(rawMethod).trim().toLowerCase();
                if (!MONITOR_METHODS.has(method)) {
                    this.logger.warn(`Invalid monitor_control_method '${rawMethod}' for ${deviceName}; using 'none'`);
                    processed.monitorControlMethod = 'none';
                } else {
                    processed.monitorControlMethod = method;
                }
                const cecDev = config.monitor_cec_device || config.monitorCecDevice || config.MONITOR_CEC_DEVICE || null;
                processed.monitorCecDevice = cecDev && String(cecDev).trim() ? String(cecDev).trim() : null;
                const i2cRaw = config.monitor_i2c_bus || config.monitorI2cBus || config.MONITOR_I2C_BUS;
                if (i2cRaw !== undefined && i2cRaw !== null && String(i2cRaw).trim() !== '') {
                    const bus = parseInt(i2cRaw, 10);
                    processed.monitorI2cBus = Number.isFinite(bus) ? bus : null;
                    if (!Number.isFinite(bus)) {
                        this.logger.warn(`Invalid monitor_i2c_bus '${i2cRaw}' for ${deviceName}; ignoring`);
                    }
                } else {
                    processed.monitorI2cBus = null;
                }

                // Optional browser URL — if set, the browser is auto-enabled at zone startup
                processed.browserUrl = config.browser_url || config.BROWSER_URL || null;

                // Optional multi-channel audio layout (passed to mpv --audio-channels)
                processed.audioChannels = config.audio_channels || config.AUDIO_CHANNELS || null;

                if (processed.outputName && typeof processed.outputName === 'string') {
                    processed.outputName = processed.outputName.trim();
                }
                if (processed.resolutionMode && typeof processed.resolutionMode === 'string') {
                    processed.resolutionMode = processed.resolutionMode.trim();
                }
                if (processed.resolutionFallback && typeof processed.resolutionFallback === 'string') {
                    processed.resolutionFallback = processed.resolutionFallback.trim();
                }

                // Combined sink configuration for screen devices
                if (config.combined_sinks) {
                    try {
                        processed.combinedSinks = typeof config.combined_sinks === 'string'
                            ? JSON.parse(config.combined_sinks)
                            : config.combined_sinks;
                        processed.combinedSinkName = config.combined_sink_name || 'combined_output';
                        processed.combinedSinkDescription = config.combined_sink_description || 'Combined Audio Output';
                    } catch (error) {
                        this.logger.warn(`Invalid combined_sinks JSON for ${deviceName}: ${error.message}`);
                    }
                }

                // Per-zone ducking configuration. If not set per-zone, inherit global defaults (if present).
                if (config.speech_ducking !== undefined) {
                    processed.speechDucking = parseInt(config.speech_ducking);
                } else if (global && global.speechDucking !== undefined) {
                    processed.speechDucking = global.speechDucking;
                } else {
                    processed.speechDucking = undefined;
                }

                if (config.video_ducking !== undefined) {
                    processed.videoDucking = parseInt(config.video_ducking);
                } else if (global && global.videoDucking !== undefined) {
                    processed.videoDucking = global.videoDucking;
                } else {
                    processed.videoDucking = undefined;
                }
                break;

            case 'audio':
                processed.mediaDir = config.media_dir || config.MEDIA_DIR || '';
                processed.audioDevice = config.audio_device || config.AUDIO_DEVICE || 'auto';
                processed.volume = parseInt(config.volume || config.VOLUME) || 80;
                processed.maxVolume = parseInt(config.max_volume || config.maxVolume) || 150;
                processed.dualOutputMode = config.dual_output_mode === true || config.dual_output_mode === 'true';
                processed.primaryDevice = config.primary_device || config.PRIMARY_DEVICE || null;
                processed.secondaryDevice = config.secondary_device || config.SECONDARY_DEVICE || null;

                // Combined sink configuration
                if (config.combined_sinks) {
                    try {
                        processed.combinedSinks = typeof config.combined_sinks === 'string'
                            ? JSON.parse(config.combined_sinks)
                            : config.combined_sinks;
                        processed.combinedSinkName = config.combined_sink_name || 'combined_output';
                        processed.combinedSinkDescription = config.combined_sink_description || 'Combined Audio Output';
                    } catch (error) {
                        this.logger.warn(`Invalid combined_sinks JSON for ${deviceName}: ${error.message}`);
                    }
                }

                // Per-zone ducking configuration
                processed.speechDucking = config.speech_ducking !== undefined ? parseInt(config.speech_ducking) : undefined;
                processed.videoDucking = config.video_ducking !== undefined ? parseInt(config.video_ducking) : undefined;

                // Optional multi-channel audio layout (passed to mpv --audio-channels)
                processed.audioChannels = config.audio_channels || config.AUDIO_CHANNELS || null;
                break;
        }

        // =====================================================================
        // Phase 1 (PR-VOLUME): Attach new unified volume model fields
        // NOTE: This is preparatory only; runtime logic will migrate in later phases.
        // =====================================================================
        const clamp = (val, min, max) => {
            if (val === undefined || val === null || isNaN(val)) return undefined;
            return Math.min(max, Math.max(min, val));
        };

        // Helper to parse an absolute base volume key (0-200) with fallback
        const parseBase = (raw) => {
            if (raw === undefined || raw === null || raw === '') return undefined;
            const n = parseInt(raw, 10);
            return isNaN(n) ? undefined : clamp(n, 0, 200);
        };

        // New per-type keys (kebab_case) expected going forward
        const backgroundVol = parseBase(config.background_volume || config.background_music_volume);
        const speechVol = parseBase(config.speech_volume);
        const effectsVol = parseBase(config.effects_volume || config.effect_volume);
        const videoVol = deviceType === 'screen' ? parseBase(config.video_volume) : undefined;

        // Legacy single volume fallback (already parsed above into processed.volume) — only apply
        // if specific per-type keys were not supplied. Spec default is 100 when omitted.
        const legacyBase = processed.volume !== undefined ? clamp(parseInt(processed.volume, 10), 0, 200) : undefined;

        processed.baseVolumes = {
            background: backgroundVol !== undefined ? backgroundVol : (legacyBase !== undefined ? legacyBase : 100),
            speech: speechVol !== undefined ? speechVol : (legacyBase !== undefined ? legacyBase : 100),
            effects: effectsVol !== undefined ? effectsVol : (legacyBase !== undefined ? legacyBase : 100),
            // Only meaningful for screen zones; for audio zones default to background fallback if not given
            video: deviceType === 'screen' ? (videoVol !== undefined ? videoVol : (legacyBase !== undefined ? legacyBase : 100)) : undefined
        };

        // New ducking adjustment key (percentage -100..0). If absent default 0 (no reduction).
        const rawAdjust = config.ducking_adjust !== undefined ? parseInt(config.ducking_adjust, 10) : undefined;
        let duckingAdjust = rawAdjust;
        if (duckingAdjust === undefined && config.ducking_volume !== undefined) {
            // Heuristic translation (legacy ducking_volume 0-100 -> target absolute level). We map it to a negative
            // percentage reduction relative to 100. Example: ducking_volume=70 -> -30 (reduce by 30%).
            const legacy = parseInt(config.ducking_volume, 10);
            if (!isNaN(legacy)) {
                duckingAdjust = -(100 - Math.min(100, Math.max(0, legacy)));
                this.logger.warn(`(PR-VOLUME) Translated legacy 'ducking_volume=${legacy}' to 'ducking_adjust=${duckingAdjust}'. Update config to use ducking_adjust (-100..0).`);
            }
        }
        if (duckingAdjust === undefined || isNaN(duckingAdjust)) duckingAdjust = 0;
        if (duckingAdjust > 0) {
            this.logger.warn(`(PR-VOLUME) ducking_adjust positive (${duckingAdjust}) not allowed; forcing 0`);
            duckingAdjust = 0;
        }
        if (duckingAdjust < -100) {
            this.logger.warn(`(PR-VOLUME) ducking_adjust ${duckingAdjust} below -100; capping at -100`);
            duckingAdjust = -100;
        }
        processed.duckingAdjust = duckingAdjust;

        // Ensure maxVolume is clamped to 0..200 (retain existing default behavior for now: default 150 if absent)
        processed.maxVolume = clamp(processed.maxVolume, 0, 200) || 150;

        // Provide a forward-compatible container for future resolver state without altering existing logic
        processed._volumeModelPhase = 1;

        return processed;
    }
}

module.exports = ConfigLoader;
