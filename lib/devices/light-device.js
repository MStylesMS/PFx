/**
 * Light Device
 * 
 * Controls individual lights through various controllers.
 * Supports brightness, color, and effect control.
 */

const Logger = require('../utils/logger');

class LightDevice {
    constructor(config, mqttClient) {
        this.config = config;
        this.mqttClient = mqttClient;
        this.logger = new Logger(`LightDevice:${config.name}`);

        // Initialize state with defaults from config
        this.currentState = {
            status: 'offline',
            brightness: parseInt(config.defaultBrightness) || 0,
            color: config.defaultColor || null,
            effect: null,
            transition: parseInt(config.defaultTransition) || 300,
            lastUpdate: null
        };

        // Controller instance will be set during initialization
        this.controller = null;

        // Store command topic for responses
        this.commandTopic = `pfx/${config.deviceId}/commands`;
        this.stateTopic = `pfx/${config.deviceId}/state`;
    }

    async initialize() {
        this.logger.info(`Initializing light device: ${this.config.deviceId} (${this.config.controller})`);

        try {
            // Initialize controller based on type
            await this._initializeController();

            // Subscribe to command topic
            this.mqttClient.subscribe(this.commandTopic, this.handleCommand.bind(this));

            this.currentState.status = 'ready';
            this.currentState.lastUpdate = new Date().toISOString();
            this._publishState();

            this.logger.info('Light device initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize light device:', error);
            this.currentState.status = 'error';
            this._publishState();
            throw error;
        }
    }

    async _initializeController() {
        switch (this.config.controller?.toLowerCase()) {
            case 'hue':
                // Hue v2 is handled by HueBackend via LightZone — this legacy path is superseded.
                throw new Error('Hue controller via light-device is no longer supported. Use backend=hue in a [light:*] zone section instead.');

            case 'wiz':
                const WizController = require('../controllers/wiz-controller');
                this.controller = new WizController({
                    ip: this.config.ip,
                    mac: this.config.mac
                });
                break;

            case 'zigbee':
                const ZigbeeController = require('../controllers/zigbee-controller');
                this.controller = new ZigbeeController({
                    coordinator: this.config.coordinator,
                    deviceId: this.config.zigbeeId
                });
                break;

            case 'zwave':
                const ZwaveController = require('../controllers/zwave-controller');
                this.controller = new ZwaveController({
                    nodeId: this.config.nodeId,
                    endpoint: this.config.endpoint
                });
                break;

            default:
                // Use mock controller for testing/development
                this.controller = new MockLightController();
                this.logger.warn(`Using mock controller for ${this.config.controller}`);
        }

        if (this.controller.initialize) {
            await this.controller.initialize();
        }
    }

    async shutdown() {
        this.logger.info('Shutting down light device...');

        try {
            // Turn off light gracefully
            if (this.currentState.status === 'ready') {
                await this.setBrightness(0);
            }

            // Cleanup controller connections
            if (this.controller && this.controller.shutdown) {
                await this.controller.shutdown();
            }

            this.currentState.status = 'offline';
            this._publishState();

            this.logger.info('Light device shutdown complete');
        } catch (error) {
            this.logger.error('Error during shutdown:', error);
        }
    }

    async handleCommand(topic, command) {
        this.logger.debug(`Handling light command: ${command.command}`);

        if (this.currentState.status !== 'ready') {
            this.logger.warn(`Rejecting command ${command.command}: device not ready`);
            this._publishError('DEVICE_NOT_READY', 'Light device is not ready');
            return;
        }

        try {
            const transition = command.transition || this.currentState.transition;

            switch (command.command) {
                case 'setColor':
                    await this.setColor(command.color, command.brightness, transition);
                    break;

                case 'setBrightness':
                    await this.setBrightness(command.brightness, transition);
                    break;

                case 'setEffect':
                    await this.setEffect(command.effect, command.parameters, transition);
                    break;

                case 'turnOn':
                    await this.turnOn(command.brightness, transition);
                    break;

                case 'turnOff':
                    await this.turnOff(transition);
                    break;

                case 'toggle':
                    await this.toggle(transition);
                    break;

                case 'pulse':
                    await this.pulse(command.duration, command.color, command.brightness);
                    break;

                case 'fade':
                    await this.fade(command.fromBrightness, command.toBrightness, command.duration);
                    break;

                case 'getStatus':
                    this._publishState();
                    break;

                case 'setConfig':
                    await this.setConfig(command.config);
                    break;

                default:
                    throw new Error(`Unknown light command: ${command.command}`);
            }

            // Update last command timestamp
            this.currentState.lastUpdate = new Date().toISOString();
            this._publishState();

        } catch (error) {
            this.logger.error(`Light command failed: ${command.command}`, error);
            this._publishError('COMMAND_FAILED', `${command.command}: ${error.message}`);
            throw error;
        }
    }

    // Public API methods
    async setColor(color, brightness = null, transition = 300) {
        this.logger.info(`Setting color: ${color}, brightness: ${brightness}`);

        if (this.controller && this.controller.setColor) {
            await this.controller.setColor(color, brightness, transition);
        }

        this.currentState.color = color;
        if (brightness !== null) {
            this.currentState.brightness = Math.max(0, Math.min(100, brightness));
        }
        this.currentState.transition = transition;

        return this.currentState;
    }

    async setBrightness(brightness, transition = 300) {
        this.logger.info(`Setting brightness: ${brightness}`);

        brightness = Math.max(0, Math.min(100, brightness));

        if (this.controller && this.controller.setBrightness) {
            await this.controller.setBrightness(brightness, transition);
        }

        this.currentState.brightness = brightness;
        this.currentState.transition = transition;

        return this.currentState;
    }

    async setEffect(effect, parameters = {}, transition = 300) {
        this.logger.info(`Setting effect: ${effect}`);

        if (this.controller && this.controller.setEffect) {
            await this.controller.setEffect(effect, parameters, transition);
        }

        this.currentState.effect = effect;
        this.currentState.transition = transition;

        return this.currentState;
    }

    async turnOn(brightness = null, transition = 300) {
        this.logger.info('Turning light on');

        brightness = brightness || this.currentState.brightness || 100;

        if (this.controller && this.controller.turnOn) {
            await this.controller.turnOn(brightness, transition);
        }

        this.currentState.brightness = brightness;
        this.currentState.transition = transition;

        return this.currentState;
    }

    async turnOff(transition = 300) {
        this.logger.info('Turning light off');

        if (this.controller && this.controller.turnOff) {
            await this.controller.turnOff(transition);
        }

        this.currentState.brightness = 0;
        this.currentState.transition = transition;

        return this.currentState;
    }

    async toggle(transition = 300) {
        this.logger.info('Toggling light');

        if (this.currentState.brightness > 0) {
            return await this.turnOff(transition);
        } else {
            return await this.turnOn(null, transition);
        }
    }

    async pulse(duration = 1000, color = null, brightness = null) {
        this.logger.info(`Pulsing light for ${duration}ms`);

        const originalBrightness = this.currentState.brightness;
        const originalColor = this.currentState.color;

        try {
            // Set pulse parameters
            if (color) await this.setColor(color, brightness || 100, 100);
            else if (brightness) await this.setBrightness(brightness, 100);

            // Wait for pulse duration
            await new Promise(resolve => setTimeout(resolve, duration));

            // Restore original state
            if (color && originalColor) {
                await this.setColor(originalColor, originalBrightness, 100);
            } else {
                await this.setBrightness(originalBrightness, 100);
            }
        } catch (error) {
            this.logger.error('Pulse effect failed:', error);
            throw error;
        }

        return this.currentState;
    }

    async fade(fromBrightness, toBrightness, duration = 3000) {
        this.logger.info(`Fading from ${fromBrightness} to ${toBrightness} over ${duration}ms`);

        if (this.controller && this.controller.fade) {
            await this.controller.fade(fromBrightness, toBrightness, duration);
        } else {
            // Simple fade implementation
            await this.setBrightness(fromBrightness, 100);
            await new Promise(resolve => setTimeout(resolve, 100));
            await this.setBrightness(toBrightness, duration);
        }

        this.currentState.brightness = toBrightness;

        return this.currentState;
    }

    async setConfig(config) {
        this.logger.info('Updating configuration');

        // Merge new config with existing
        Object.assign(this.config, config);

        // Apply immediate changes
        if (config.defaultBrightness !== undefined) {
            this.currentState.brightness = parseInt(config.defaultBrightness);
        }
        if (config.defaultColor !== undefined) {
            this.currentState.color = config.defaultColor;
        }
        if (config.defaultTransition !== undefined) {
            this.currentState.transition = parseInt(config.defaultTransition);
        }

        return this.currentState;
    }

    _publishState() {
        const stateMessage = {
            timestamp: new Date().toISOString(),
            device: this.config.name,
            type: 'state',
            controller: this.config.controller,
            device_id: this.config.deviceId,
            ...this.currentState
        };

        this.mqttClient.publish(this.stateTopic, stateMessage);
    }

    _publishError(errorCode, message) {
        const errorMessage = {
            timestamp: new Date().toISOString(),
            device: this.config.name,
            type: 'error',
            error_code: errorCode,
            message: message,
            source_topic: this.commandTopic
        };

        this.mqttClient.publish(this.stateTopic, errorMessage);
        this.mqttClient.publish(this.mqttClient.config.heartbeatTopic, errorMessage);
    }
}

/**
 * Mock Light Controller for testing and development
 */
class MockLightController {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger('MockLightController');
    }

    async initialize() {
        this.logger.debug('Mock light controller initialized');
    }

    async shutdown() {
        this.logger.debug('Mock light controller shutdown');
    }

    async setColor(color, brightness, transition) {
        this.logger.debug(`Mock setColor: ${color}, brightness: ${brightness}, transition: ${transition}ms`);
        await this._delay(transition / 10); // Simulate transition time
    }

    async setBrightness(brightness, transition) {
        this.logger.debug(`Mock setBrightness: ${brightness}, transition: ${transition}ms`);
        await this._delay(transition / 10);
    }

    async setEffect(effect, parameters, transition) {
        this.logger.debug(`Mock setEffect: ${effect}, transition: ${transition}ms`);
        await this._delay(transition / 10);
    }

    async turnOn(brightness, transition) {
        this.logger.debug(`Mock turnOn: brightness: ${brightness}, transition: ${transition}ms`);
        await this._delay(transition / 10);
    }

    async turnOff(transition) {
        this.logger.debug(`Mock turnOff: transition: ${transition}ms`);
        await this._delay(transition / 10);
    }

    async fade(fromBrightness, toBrightness, duration) {
        this.logger.debug(`Mock fade: ${fromBrightness} -> ${toBrightness} over ${duration}ms`);
        await this._delay(duration / 10);
    }

    async _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, Math.max(1, ms)));
    }
}

module.exports = LightDevice;
