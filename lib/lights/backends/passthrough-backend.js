const Logger = require('../../utils/logger');

class PassthroughBackend {
    constructor(config, mqttClient) {
        this.config = config;
        this.mqttClient = mqttClient;
        this.logger = new Logger(`PassthroughBackend:${config.name}`);
        this.forwardTopic = config.forwardTopic || `${config.baseTopic}/backend-commands`;
    }

    async initialize() {
        this.logger.info(`Passthrough backend ready. Forward topic: ${this.forwardTopic}`);
    }

    async shutdown() {
        // No resources to release.
    }

    async execute(commandName, payload = {}) {
        const forwarded = {
            command: commandName,
            ...payload
        };
        this.mqttClient.publish(this.forwardTopic, forwarded);
        return { forwarded: true, topic: this.forwardTopic };
    }
}

module.exports = PassthroughBackend;
