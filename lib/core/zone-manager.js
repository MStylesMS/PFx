/**
 * Zone Manager
 * 
 * Mana    async initialize() {
        this.logger.info('Initializing all zones…');
        for (const deviceConfig of this.devices) {
            try {
                await this._createZone(deviceConfig.name, deviceConfig);
            } catch (error) {
                this.logger.error(`Zone "${deviceConfig.name}" failed to initialize: ${error.message}`);
                this.logger.debug(error.stack);
                throw error;
            }
        }
        this.isInitialized = true;in the ParadoxFX system with unified command interface.
 * Replaces the previous DeviceManager with zone-centric architecture.
 */

const ScreenZone = require('../zones/screen-zone');
const AudioZone = require('../zones/audio-zone');
const Logger = require('../utils/logger');

class ZoneManager {
    constructor(config, mqttClient) {
        this.config = config;
        // Convert devices object to array for iteration
        this.devices = Array.isArray(config.devices)
            ? config.devices
            : Object.values(config.devices || {});

        this.mqttClient = mqttClient;
        this.logger = new Logger('ZoneManager');

        // Map<zoneName,Zone>
        this.zones = new Map();
        // Map<topic,{zoneName,zone}>
        this.commandSubscriptions = new Map();
    }

    /**
     * Initialize all zones
     */
    async initialize() {
        this.logger.info('Initializing all zones…');

        // Set zone manager reference in mqtt client for enhanced heartbeat
        this.mqttClient.setZoneManager(this);

        const failedZones = [];
        
        for (const deviceConfig of this.devices) {
            try {
                // Delegate zone creation and initialization to _createZone()
                await this._createZone(deviceConfig.name, deviceConfig);
            } catch (error) {
                this.logger.error(`❌ Zone "${deviceConfig.name}" failed to initialize: ${error.message}`);
                this.logger.debug(error.stack);
                failedZones.push({ name: deviceConfig.name, error: error.message });
                // Continue to next zone instead of throwing
            }
        }
        
        // Check if at least one zone initialized successfully
        if (this.zones.size === 0) {
            const errorMsg = 'FATAL: No zones initialized successfully. Cannot continue.';
            this.logger.error(errorMsg);
            this.logger.error('Failed zones:', failedZones);
            throw new Error(errorMsg);
        }
        
        // Report summary
        if (failedZones.length > 0) {
            this.logger.warn(`⚠️  ${failedZones.length} zone(s) failed to initialize: ${failedZones.map(z => z.name).join(', ')}`);
        }
        this.logger.info(`✅ Successfully initialized ${this.zones.size} zone(s)`);
        
        // Set up MQTT command routing after all zones are initialized
        this._setupMqttRouting();
        this.isInitialized = true;

        // Publish MQTT discovery and per-zone schemas for external integrations (Node-RED, etc.)
        this._publishDiscovery();
        this._publishZoneSchemas();
    }

    /**
     * Create a zone based on its type
     * @private
     */
    async _createZone(zoneName, zoneConfig) {
        this.logger.debug(`Creating ${zoneConfig.type} zone: ${zoneName}`);

        // Merge global configuration into zone config
        const mergedConfig = {
            ...zoneConfig,
            // Do NOT inject deprecated global mediaBasePath — zones resolve media from media_dir only.
            // Add other global properties that zones might need
            logLevel: this.config.global.logLevel
        };

        let zone;
        switch (zoneConfig.type) {
            case 'screen':
                zone = new ScreenZone(mergedConfig, this.mqttClient, this);
                break;
            case 'audio':
            case 'combined-audio':
                // Use AudioZone for both single and combined audio zones
                // Combined audio functionality can be implemented within AudioZone
                zone = new AudioZone(mergedConfig, this.mqttClient, this);
                break;
            default:
                throw new Error(`Unknown zone type: ${zoneConfig.type} for zone ${zoneName}`);
        }

        // Initialize the zone
        await zone.initialize();

        // Store the zone
        this.zones.set(zoneName, zone);
        this.logger.info(`Initialized ${zoneConfig.type} zone: ${zoneName}`);

        return zone;
    }

    /**
     * Set up MQTT command routing for all zones
     * @private
     */
    _setupMqttRouting() {
        this.logger.info('Setting up MQTT command routing...');

        for (const [zoneName, zone] of this.zones) {
            const commandTopic = `${zone.config.baseTopic}/commands`;

            this.logger.debug(`Subscribing to zone commands: ${commandTopic}`);

            // Create handler for this zone
            const handler = async (topic, message) => {
                await this._handleZoneCommand(zoneName, zone, message);
            };

            // Subscribe with handler
            this.mqttClient.subscribe(commandTopic, handler);

            // Store subscription mapping
            this.commandSubscriptions.set(commandTopic, { zoneName, zone });
        }
    }

    /**
     * Handle incoming MQTT command for a specific zone
     * @private
     */
    async _handleZoneCommand(zoneName, zone, message) {
        let command = null;
        let rawMessage = null;

        try {
            // Store raw message for error reporting
            rawMessage = typeof message === 'string' ? message : JSON.stringify(message);

            // Parse message if needed
            if (typeof message === 'string') {
                try {
                    command = JSON.parse(message);
                } catch (parseError) {
                    this.logger.warn(`Zone ${zoneName} received malformed JSON:`, message);

                    // Publish event for invalid command (malformed JSON)
                    try {
                        zone.publishMessage('events', {
                            command_received: 'unknown',
                            valid: false,
                            error: 'malformed_json',
                            error_message: parseError.message
                        });
                    } catch (eventError) {
                        this.logger.warn(`Failed to publish malformed JSON event for zone ${zoneName}:`, eventError);
                    }

                    zone.publishMessage('warning', {
                        message: 'Invalid JSON format in command',
                        raw_message: message,
                        error: parseError.message
                    });
                    return; // Exit early for malformed JSON
                }
            } else {
                command = message;
            }

            // Validate command structure
            const validationError = this._validateCommand(command);
            if (validationError) {
                this.logger.warn(`Zone ${zoneName} received invalid command:`, validationError);

                // Publish event for invalid command structure
                const commandName = command?.Command || command?.command || 'unknown';
                try {
                    zone.publishMessage('events', {
                        command_received: commandName,
                        valid: false,
                        error: 'validation_error',
                        validation_error: validationError
                    });
                } catch (eventError) {
                    this.logger.warn(`Failed to publish validation error event for zone ${zoneName}:`, eventError);
                }

                zone.publishMessage('warning', {
                    message: 'Invalid command structure',
                    raw_message: rawMessage,
                    validation_error: validationError,
                    received_command: command
                });
                return; // Exit early for invalid commands
            }

            // Log the command at INFO level for better visibility, including parameters for playVideo
            const commandName = command.Command || command.command;
            // Build detailed log message
            let logMessage = `Zone ${zoneName} received valid command: ${commandName}`;
            const mediaPath = command.file || command.audio || command.video || command.image;
            const commandsWithMediaPath = new Set(['playAudioFX', 'playVideo', 'setImage', 'playSpeech']);
            if (commandsWithMediaPath.has(commandName) && typeof mediaPath === 'string' && mediaPath.length > 0) {
                logMessage += ` file=${mediaPath}`;
            }
            if (commandName === 'playVideo' && command.length != null) {
                logMessage += ` length=${command.length}`;
            }
            this.logger.info(logMessage);

            // Publish a received event for telemetry/monitoring before executing the command
            try {
                const eventPayload = { command_received: commandName, valid: true };
                if (commandName === 'playSpeech') {
                    if (command.file) {
                        eventPayload.file = command.file;
                    } else if (command.audio) {
                        eventPayload.file = command.audio;
                    }
                    ['loop', 'adjustVolume', 'volume', 'ducking', 'skipDucking', 'skip_ducking'].forEach(key => {
                        if (command[key] !== undefined) {
                            eventPayload[key] = command[key];
                        }
                    });
                }
                zone.publishMessage('events', eventPayload);
            } catch (eventError) {
                this.logger.warn(`Failed to publish command received event for zone ${zoneName}:`, eventError);
            }

            // Handle the command with timeout to prevent hanging
            const commandPromise = zone.handleCommand(command);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Command execution timeout (30s)')), 30000);
            });

            await Promise.race([commandPromise, timeoutPromise]);

        } catch (error) {
            this.logger.error(`Error handling command for zone ${zoneName}:`, error);

            // Determine error type and publish appropriate message
            let errorType = 'unknown';
            let errorMessage = error.message || 'Unknown error occurred';

            if (error instanceof SyntaxError) {
                errorType = 'json_parse_error';
                errorMessage = 'Invalid JSON format in command';
            } else if (error.code === 'ENOENT') {
                errorType = 'file_not_found';
                errorMessage = 'Requested file not found';
            } else if (error.message && error.message.includes('timeout')) {
                errorType = 'command_timeout';
                errorMessage = 'Command execution timed out';
            } else if (error.name && error.name.includes('ValidationError')) {
                errorType = 'validation_error';
                errorMessage = 'Command validation failed';
            }

            // Publish event for command execution failure
            const failedCommandName = command?.Command || command?.command || 'unknown';
            try {
                zone.publishMessage('events', {
                    command_received: failedCommandName,
                    valid: false,
                    error: 'execution_error',
                    error_type: errorType,
                    error_message: errorMessage
                });
            } catch (eventError) {
                this.logger.warn(`Failed to publish execution error event for zone ${zoneName}:`, eventError);
            }

            // Safely publish error message
            try {
                zone.publishMessage('warning', {
                    message: errorMessage,
                    command: failedCommandName,
                    error_type: errorType,
                    raw_message: rawMessage,
                    timestamp: new Date().toISOString()
                });
            } catch (publishError) {
                this.logger.error(`Failed to publish error message for zone ${zoneName}:`, publishError);
            }

            // Do not re-throw error to prevent app crash
        }
    }

    /**
     * Validate command structure
     * @private
     */
    _validateCommand(command) {
        if (!command || typeof command !== 'object') {
            return 'Command must be a valid object';
        }

        // Check if Command or command field exists
        const hasCommand = 'Command' in command;
        const hasLowerCommand = 'command' in command;

        if (!hasCommand && !hasLowerCommand) {
            return 'Command must have a valid "Command" or "command" field';
        }

        const commandName = hasCommand ? command.Command : command.command;

        if (typeof commandName !== 'string') {
            return 'Command name must be a string';
        }

        if (commandName.trim() === '') {
            return 'Command name cannot be empty';
        }

        // Check for common required fields based on command type
        if (commandName.toLowerCase().includes('play') || commandName.toLowerCase().includes('audio') || commandName.toLowerCase().includes('video')) {
            const filePath = command.filePath || command.file || command.audio || command.video || command.image;
            if (filePath && typeof filePath !== 'string') {
                return 'File path must be a string';
            }
        }

        // Check volume parameter if present
        if (command.volume !== undefined) {
            const volume = parseFloat(command.volume);
            if (isNaN(volume) || volume < 0 || volume > 150) {
                return 'Volume must be a number between 0 and 150';
            }
        }

        return null; // No validation errors
    }

    /**
     * Get zone by name
     */
    getZone(zoneName) {
        return this.zones.get(zoneName);
    }

    /**
     * Get all zones
     */
    getAllZones() {
        return Array.from(this.zones.values());
    }

    /**
     * Get zones by type
     */
    getZonesByType(type) {
        return Array.from(this.zones.values()).filter(zone => zone.config.type === type);
    }

    /**
     * Duck audio in all audio zones
     * @param {string} originatingZoneName - The name of the zone requesting the ducking
     */
    duck(originatingZoneName) {
        this.logger.info(`Ducking audio for all zones (requested by ${originatingZoneName})`);
        const audioZones = this.getZonesByType('audio');
        for (const zone of audioZones) {
            if (zone.config.name !== originatingZoneName) {
                zone.duck();
            }
        }
    }

    /**
     * Unduck audio in all audio zones
     * @param {string} originatingZoneName - The name of the zone requesting the unducking
     */
    unduck(originatingZoneName) {
        this.logger.info(`Unducking audio for all zones (requested by ${originatingZoneName})`);
        const audioZones = this.getZonesByType('audio');
        for (const zone of audioZones) {
            if (zone.config.name !== originatingZoneName) {
                zone.unduck();
            }
        }
    }

    /**
     * Shutdown all zones
     */
    async shutdown() {
        if (!this.isInitialized) {
            return;
        }

        this.logger.info('Shutting down zone manager...');

        try {
            // Shutdown all zones
            const shutdownPromises = Array.from(this.zones.values()).map(zone => zone.shutdown());
            await Promise.all(shutdownPromises);

            // Unsubscribe from MQTT topics
            for (const commandTopic of this.commandSubscriptions.keys()) {
                this.mqttClient.unsubscribe(commandTopic);
            }
            this.commandSubscriptions.clear();

            this.zones.clear();
            this.isInitialized = false;

            this.logger.info('Zone manager shutdown complete');

        } catch (error) {
            this.logger.error('Error during zone manager shutdown:', error);
            throw error;
        }
    }

    /**
     * Publish a retained discovery message listing all initialized zones.
     * Topic: {global.baseTopic}/discovery
     * @private
     */
    _publishDiscovery() {
        const baseTopic = this.config.global && this.config.global.baseTopic;
        if (!baseTopic) {
            this.logger.debug('No global baseTopic configured; skipping discovery publish');
            return;
        }

        const zones = [];
        for (const [zoneName, zone] of this.zones) {
            zones.push({
                name: zoneName,
                type: zone.config.type,
                baseTopic: zone.config.baseTopic,
                commandsTopic: `${zone.config.baseTopic}/commands`,
                stateTopic: `${zone.config.baseTopic}/state`,
                schemaTopic: `${zone.config.baseTopic}/schema`
            });
        }

        const payload = {
            application: 'pfx',
            timestamp: new Date().toISOString(),
            zones
        };

        const topic = `${baseTopic}/discovery`;
        this.mqttClient.publish(topic, payload, { retain: true });
        this.logger.info(`Published discovery for ${zones.length} zone(s) to ${topic}`);
    }

    /**
     * Publish a retained schema message for each zone listing its supported commands.
     * Topic: {zone.baseTopic}/schema
     * @private
     */
    _publishZoneSchemas() {
        for (const [zoneName, zone] of this.zones) {
            if (!zone.config.baseTopic) continue;
            const topic = `${zone.config.baseTopic}/schema`;
            const payload = {
                application: 'pfx',
                zone: zoneName,
                type: zone.config.type,
                commandsTopic: `${zone.config.baseTopic}/commands`,
                commands: zone.getSupportedCommands()
            };

            if (typeof zone.getSchemaMetadata === 'function') {
                const metadata = zone.getSchemaMetadata();
                if (metadata && typeof metadata === 'object') {
                    Object.assign(payload, metadata);
                }
            }
            this.mqttClient.publish(topic, payload, { retain: true });
            this.logger.debug(`Published schema for zone '${zoneName}' to ${topic}`);
        }
        this.logger.info(`Published schemas for ${this.zones.size} zone(s)`);
    }
}

module.exports = ZoneManager;
