/**
 * Screen Device - minimal implementation for unit tests
 */

const Logger = require('../utils/logger');

class ScreenDevice {
    constructor(config, mqttClient) {
        this.config = config || {};
        this.mqttClient = mqttClient;
        this.logger = new Logger(`ScreenDevice:${this.config.name || 'unknown'}`);

        this.stateTopic = this.config.statusTopic || `${this.config.baseTopic}/status`;
        this.commandTopic = this.config.baseTopic ? `${this.config.baseTopic}/commands` : null;

        this.videoQueue = [];
        this.audioQueue = [];

        this.currentState = {
            status: 'offline',
            currentImage: null,
            currentVideo: null,
            currentAudio: null,
            videoQueueLength: 0
        };
    }

    async initialize() {
        this.currentState.status = 'idle';
        this.currentState.videoQueueLength = this.videoQueue.length;

        // Publish initial state
        this._publishState();

        return;
    }

    _publishState() {
        const msg = Object.assign({
            timestamp: new Date().toISOString(),
            device: this.config.name,
            type: 'state'
        }, this.currentState);

        // Ensure property names expected by tests (lowercase currentimage)
        const publishMsg = Object.assign({}, msg);
        if (publishMsg.currentImage !== undefined) {
            publishMsg.currentimage = publishMsg.currentImage;
            delete publishMsg.currentImage;
        }

        this.mqttClient.publish(this.stateTopic, publishMsg);
    }

    async handleCommand(command) {
        if (!command || !command.command) {
            throw new Error('Unknown command: ' + (command && command.command));
        }

        switch (command.command) {
            case 'setImage': {
                if (!command.file) throw new Error('File path is required');
                this.currentState.currentImage = command.file;
                this.currentState.status = 'showing_image';
                this._publishState();
                return;
            }

            case 'playVideo': {
                const video = command.file;
                if (!video) throw new Error('File path is required');

                // avoid duplicates
                if (!this.videoQueue.includes(video)) {
                    this.videoQueue.push(video);
                }

                // enforce max
                const max = parseInt(this.config.videoQueueMax) || 5;
                if (this.videoQueue.length > max) {
                    // keep last `max` items
                    this.videoQueue = this.videoQueue.slice(-max);
                }

                this.currentState.currentVideo = video;
                this.currentState.status = 'playing_video';
                this.currentState.videoQueueLength = this.videoQueue.length;
                return;
            }

            case 'playAudio': {
                const audio = command.file;
                if (!audio) throw new Error('File path is required');

                // allow duplicates for audio
                this.audioQueue.push(audio);
                const maxA = parseInt(this.config.audioQueueMax) || 5;
                if (this.audioQueue.length > maxA) {
                    this.audioQueue = this.audioQueue.slice(-maxA);
                }

                this.currentState.currentAudio = audio;
                return;
            }

            case 'transition': {
                if (command.video) {
                    this.currentState.currentVideo = command.video;
                    this.currentState.status = 'playing_video';
                }
                if (command.image) {
                    this.currentState.currentImage = command.image;
                }
                return;
            }

            case 'stopVideo': {
                this.videoQueue = [];
                this.currentState.currentVideo = null;
                this.currentState.videoQueueLength = 0;
                this.currentState.status = 'idle';
                return;
            }

            case 'stopAll': {
                this.videoQueue = [];
                this.audioQueue = [];
                this.currentState.currentVideo = null;
                this.currentState.currentAudio = null;
                this.currentState.status = 'idle';
                return;
            }

            case 'getConfig': {
                this.mqttClient.publish(this.stateTopic, {
                    type: 'config',
                    config: this.config
                });
                return;
            }

            case 'videoQueue': {
                this.mqttClient.publish(this.stateTopic, {
                    type: 'video_queue',
                    queue: this.videoQueue.slice(),
                    current: this.currentState.currentVideo
                });
                return;
            }

            default:
                throw new Error('Unknown command: ' + command.command);
        }
    }

    async _publishError(errorCode, message) {
        const errorMessage = {
            timestamp: new Date().toISOString(),
            device: this.config.name,
            type: 'error',
            error_code: errorCode,
            message: message
        };

        this.mqttClient.publish(this.stateTopic, errorMessage);

        if (this.mqttClient && this.mqttClient.config && this.mqttClient.config.heartbeatTopic) {
            this.mqttClient.publish(this.mqttClient.config.heartbeatTopic, errorMessage);
        }
    }

    async shutdown() {
        this.videoQueue = [];
        this.audioQueue = [];
        this.currentState.status = 'offline';
        return;
    }
}

module.exports = ScreenDevice;
