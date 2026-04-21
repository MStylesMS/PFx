/**
 * Light Zone
 *
 * Handles zone-scoped lighting commands. Supports backend selection via config:
 * - passthrough: forwards normalized commands to another topic
 * - wiz: native WiZ UDP control
 */

const BaseZone = require('./base-zone');
const PassthroughBackend = require('../lights/backends/passthrough-backend');
const WizNativeBackend = require('../lights/backends/wiz-native-backend');
const ShellyBackend = require('../lights/backends/shelly-backend');
const HueBackend = require('../lights/backends/hue-backend');
const LifxBackend = require('../lights/backends/lifx-backend');
const ZwaveBackend = require('../lights/backends/zwave-backend');
const ZigbeeBackend = require('../lights/backends/zigbee-backend');
const MultiTargetBackend = require('../lights/backends/multi-target-backend');

class LightZone extends BaseZone {
    constructor(config, mqttClient, zoneManager) {
        super(config, mqttClient);
        this.zoneManager = zoneManager;
        this.backend = null;

        this.backendType = (config.backend || config.BACKEND || config.controller || 'passthrough')
            .toString()
            .toLowerCase();
        this.isGroupZone = config.type === 'light_group' || config.type === 'light-group';

        this.currentState = {
            ...this.currentState,
            backend: this.backendType,
            activeScene: null,
            power: 'unknown',
            brightness: null,
            color: null
        };
    }

    async initialize() {
        this.backend = this._createBackend();
        await this.backend.initialize();

        this.isInitialized = true;
        this.currentState.status = 'ready';
        this.publishStatus();
        this._startPeriodicStatus();
        this.logger.info(`Light zone initialized with backend '${this.backendType}'`);
    }

    async handleCommand(command) {
        if (!this.isInitialized) {
            throw new Error('Light zone not initialized');
        }

        const commandName = command.command || command.Command;
        this.currentState.lastCommand = commandName;

        if (!this._isCommandSupported(commandName)) {
            this._handleUnsupportedCommand(commandName);
            return;
        }

        const parameters = Object.keys(command)
            .filter(k => k !== 'Command' && k !== 'command')
            .reduce((acc, k) => { acc[k] = command[k]; return acc; }, {});

        try {
            const normalized = this._normalizeCommand(commandName, parameters);
            const result = await this.backend.execute(normalized.command, normalized.payload);
            this._updateStateFromCommand(normalized.command, normalized.payload);
            this.publishStatus();

            const outcome = result && result.warning ? 'warning' : 'success';
            this.publishCommandOutcome({
                command: commandName,
                outcome,
                parameters,
                warning_type: result && result.warning ? 'backend_limitation' : undefined,
                message: result && result.warning
                    ? `Command '${commandName}' executed with warning: ${result.warning}`
                    : `Command '${commandName}' executed successfully`
            });
        } catch (error) {
            this.publishCommandOutcome({
                command: commandName,
                outcome: 'failed',
                parameters,
                error_type: 'execution_error',
                error_message: error.message,
                message: `Command '${commandName}' failed: ${error.message}`
            });
            throw error;
        }
    }

    getSupportedCommands() {
        return ['scene', 'setColorScene', 'on', 'off', 'setColor', 'setBrightness', 'fade', 'getStatus', 'getState'];
    }

    async shutdown() {
        this._stopPeriodicStatus();
        if (this.backend && this.backend.shutdown) {
            await this.backend.shutdown();
        }
        this.currentState.status = 'offline';
        this.isInitialized = false;
        this.publishStatus();
    }

    _createBackend() {
        if (this.isGroupZone) {
            const targets = this._resolveGroupTargets();
            if (targets.length === 0) {
                throw new Error(`Light group '${this.config.name}' has no resolvable targets`);
            }
            return new MultiTargetBackend(this.config, targets);
        }

        return this._createBackendForConfig(this.config);
    }

    _createBackendForConfig(targetConfig) {
        const backendType = (targetConfig.backend || targetConfig.BACKEND || targetConfig.controller || 'passthrough')
            .toString()
            .toLowerCase();

        switch (backendType) {
            case 'wiz':
            case 'wiz-native':
                return new WizNativeBackend(targetConfig, this.mqttClient);
            case 'shelly':
            case 'shelly-rgbw':
            case 'shelly-switch':
            case 'shelly-dimmer':
                return new ShellyBackend(targetConfig, this.mqttClient);
            case 'hue':
                return new HueBackend(targetConfig);
            case 'lifx':
                return new LifxBackend(targetConfig);
            case 'zwave':
                return new ZwaveBackend(targetConfig);
            case 'zigbee':
                return new ZigbeeBackend(targetConfig);
            case 'passthrough':
            case 'pfx-lights':
                return new PassthroughBackend(targetConfig, this.mqttClient);
            default:
                throw new Error(`Unsupported light backend '${backendType}'`);
        }
    }

    _resolveGroupTargets() {
        const configuredTargets = [];
        const devices = this.zoneManager && this.zoneManager.config && this.zoneManager.config.devices
            ? this.zoneManager.config.devices
            : {};

        const requestedIds = Array.isArray(this.config.deviceList) ? this.config.deviceList : [];

        for (const requestedId of requestedIds) {
            const resolved = this._findDeviceConfigById(devices, requestedId);
            if (!resolved) {
                this.logger.warn(`Group member '${requestedId}' not found; skipping`);
                continue;
            }

            const merged = {
                ...resolved,
                sceneMap: resolved.sceneMap || this.config.sceneMap,
                wizPort: resolved.wizPort || this.config.wizPort
            };

            configuredTargets.push({
                id: requestedId,
                backend: this._createBackendForConfig(merged)
            });
        }

        if (configuredTargets.length === 0 && Array.isArray(this.config.bulbIps) && this.config.bulbIps.length > 0) {
            this.config.bulbIps.forEach((ip, index) => {
                const merged = {
                    ...this.config,
                    name: `${this.config.name}-target-${index + 1}`,
                    backend: this.backendType,
                    bulbIp: ip
                };
                configuredTargets.push({
                    id: ip,
                    backend: this._createBackendForConfig(merged)
                });
            });
        }

        if (configuredTargets.length === 0 && Array.isArray(this.config.targetHosts) && this.config.targetHosts.length > 0) {
            this.config.targetHosts.forEach((host, index) => {
                const merged = {
                    ...this.config,
                    name: `${this.config.name}-target-${index + 1}`,
                    backend: this.backendType,
                    shellyHost: host,
                    host
                };
                configuredTargets.push({
                    id: host,
                    backend: this._createBackendForConfig(merged)
                });
            });
        }

        return configuredTargets;
    }

    _findDeviceConfigById(devices, requestedId) {
        const needle = requestedId.toString().trim();

        for (const [sectionName, deviceConfig] of Object.entries(devices)) {
            if (!deviceConfig || deviceConfig.type !== 'light') {
                continue;
            }

            const normalizedSectionName = sectionName.includes(':')
                ? sectionName.split(':').slice(1).join(':').trim()
                : sectionName.trim();

            if (deviceConfig.name === needle || sectionName === needle || normalizedSectionName === needle) {
                return deviceConfig;
            }
        }

        return null;
    }

    _normalizeCommand(commandName, payload) {
        if (commandName === 'scene') {
            return {
                command: 'setColorScene',
                payload: { scene: payload.name || payload.scene }
            };
        }
        return { command: commandName, payload };
    }

    _updateStateFromCommand(commandName, payload) {
        switch (commandName) {
            case 'setColorScene':
                this.currentState.activeScene = payload.scene;
                this.currentState.power = payload.scene === 'off' ? 'off' : 'on';
                break;
            case 'on':
                this.currentState.power = 'on';
                if (payload.brightness !== undefined) {
                    this.currentState.brightness = payload.brightness;
                }
                break;
            case 'off':
                this.currentState.power = 'off';
                this.currentState.brightness = 0;
                break;
            case 'setBrightness':
                this.currentState.power = payload.brightness > 0 ? 'on' : 'off';
                this.currentState.brightness = payload.brightness;
                break;
            case 'setColor':
                this.currentState.color = payload.color;
                if (payload.brightness !== undefined) {
                    this.currentState.brightness = payload.brightness;
                }
                this.currentState.power = 'on';
                break;
            default:
                break;
        }
    }

    _extendStatusPayload(payload) {
        payload.lighting = {
            backend: this.currentState.backend,
            activeScene: this.currentState.activeScene,
            power: this.currentState.power,
            brightness: this.currentState.brightness,
            color: this.currentState.color
        };
    }
}

module.exports = LightZone;
