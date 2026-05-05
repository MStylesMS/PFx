/**
 * MQTT Client
 * 
 * Manages shared MQTT connection for all devices.
 */

const mqtt = require('mqtt');
const Logger = require('../utils/logger');

class MqttClient {
    constructor(globalConfig) {
        this.logger = new Logger('MqttClient');
        this.config = globalConfig;
        this.client = null;
        this.connected = false;
        this.subscriptions = new Map();
        this.messageHandlers = new Map();
        this.zoneManager = null; // Will be set by zone manager
        this.isDisconnecting = false; // Track intentional disconnection
        this.heartbeatInterval = null; // Store interval reference for cleanup
        this.connectResolver = null; // Promise resolver for initial connect
        this.initialConnectTimeout = null; // Store initial connect timeout for cleanup
    }

    _clearInitialConnectTimeout() {
        if (this.initialConnectTimeout) {
            clearTimeout(this.initialConnectTimeout);
            this.initialConnectTimeout = null;
        }
    }

    async connect() {
        const url = `mqtt://${this.config.mqttServer}:${this.config.mqttPort}`;
        
        // Add startup jitter (0-500ms, ±250ms around 250ms center) to prevent thundering herd
        const jitter = Math.random() * 500;
        this.logger.info(`Applying startup jitter: ${jitter.toFixed(0)}ms`);
        await new Promise(resolve => setTimeout(resolve, jitter));
        
        this.logger.info(`Connecting to MQTT broker at ${url} with reconnectPeriod ${this.config.mqttReconnectPeriod}ms`);

        return new Promise((resolve, reject) => {
            this.connectResolver = resolve;
            
            this.client = mqtt.connect(url, {
                clientId: `pfx-${Date.now()}`,
                clean: this.config.mqttCleanSession,
                reconnectPeriod: this.config.mqttReconnectPeriod, // Use library reconnect
                connectTimeout: 10 * 1000, // 10 second connection timeout
                keepalive: this.config.mqttKeepAlive
            });

            this.client.on('connect', () => {
                this.logger.info('Connected to MQTT broker');
                this.connected = true;
                this._clearInitialConnectTimeout();
                this._startHeartbeat();
                
                // Resolve the initial connect promise
                if (this.connectResolver) {
                    this.connectResolver();
                    this.connectResolver = null;
                }
            });

            this.client.on('error', (error) => {
                this.logger.error('MQTT connection error:', error);
                // Don't reject - let library reconnect handle it
            });

            this.client.on('close', () => {
                this.logger.warn('MQTT connection closed');
                this.connected = false;
                // Library will automatically attempt reconnect if not disconnecting
            });

            this.client.on('disconnect', () => {
                this.logger.warn('Disconnected from MQTT broker');
                this.connected = false;
            });

            this.client.on('message', (topic, message) => {
                this._handleMessage(topic, message);
            });
            
            // Set a timeout for initial connection attempt
            this.initialConnectTimeout = setTimeout(() => {
                if (!this.connected && this.connectResolver) {
                    this.logger.warn('Initial connection timeout, but library will keep trying in background');
                    this.connectResolver();
                    this.connectResolver = null;
                }
                this.initialConnectTimeout = null;
            }, 30000); // 30 second timeout for initial connection

            if (typeof this.initialConnectTimeout.unref === 'function') {
                this.initialConnectTimeout.unref();
            }
        });
    }

    async disconnect() {
        if (this.client) {
            this.logger.info('Disconnecting from MQTT broker');
            this.isDisconnecting = true; // Set flag to prevent reconnection

            // Clean up heartbeat interval
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
            }
            this._clearInitialConnectTimeout();

            return new Promise((resolve) => {
                // Force close and disable library reconnect
                this.client.end(true, {}, () => {
                    this.connected = false;
                    resolve();
                });
            });
        }
    }

    subscribe(topic, handler) {
        if (!this.connected) {
            throw new Error('MQTT client not connected');
        }

        this.logger.debug(`Subscribing to topic: ${topic}`);
        // Register handler before SUBACK so retained messages arriving immediately
        // after subscribe are not dropped.
        this.subscriptions.set(topic, true);
        this.messageHandlers.set(topic, handler);
        this.client.subscribe(topic, (error) => {
            if (error) {
                this.logger.error(`Failed to subscribe to ${topic}:`, error);
                this.subscriptions.delete(topic);
                this.messageHandlers.delete(topic);
            } else {
                this.logger.debug(`Successfully subscribed to ${topic}`);
            }
        });
    }

    unsubscribe(topic) {
        if (!this.connected) {
            return;
        }

        this.logger.debug(`Unsubscribing from topic: ${topic}`);
        this.client.unsubscribe(topic);
        this.subscriptions.delete(topic);
        this.messageHandlers.delete(topic);
    }

    publish(topic, message, options = {}) {
        if (!this.connected) {
            this.logger.warn(`Cannot publish to ${topic}: MQTT client not connected`);
            return;
        }

        const payload = typeof message === 'string' ? message : JSON.stringify(message);
        this.logger.debug(`Publishing to ${topic}:`, payload);

        this.client.publish(topic, payload, {
            qos: options.qos || 0,
            retain: options.retain || false
        }, (error) => {
            if (error) {
                this.logger.error(`Failed to publish to ${topic}:`, error);
            }
        });
    }

    _handleMessage(topic, message) {
        let handler = null;
        let parsedMessage = null;
        let rawPayload = null;

        try {
            handler = this.messageHandlers.get(topic);
            if (!handler) {
                this.logger.warn(`No handler registered for topic: ${topic}`);
                return;
            }

            rawPayload = message.toString();
            this.logger.debug(`Received message on ${topic}:`, rawPayload);

            // Try to parse as JSON, fall back to string
            try {
                parsedMessage = JSON.parse(rawPayload);
            } catch (parseError) {
                // If JSON parsing fails, use the raw string
                parsedMessage = rawPayload;
                this.logger.debug(`Message on ${topic} is not valid JSON, treating as string`);
            }

            // Call handler with defensive error handling
            try {
                handler(topic, parsedMessage);
            } catch (handlerError) {
                this.logger.error(`Message handler error for topic ${topic}:`, handlerError);
                // Don't re-throw to prevent app crash
            }

        } catch (error) {
            this.logger.error(`Critical error handling message on ${topic}:`, error, {
                rawMessage: rawPayload,
                hasHandler: !!handler,
                topic: topic
            });
            // Don't re-throw to prevent app crash
        }
    }

    _startHeartbeat() {
        // Clear any existing heartbeat
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.heartbeatInterval = setInterval(() => {
            if (this.connected) {
                const heartbeat = {
                    timestamp: new Date().toISOString(),
                    application: 'pfx',
                    status: 'online',
                    uptime: process.uptime()
                };

                // Add zone status summary if zone manager is available
                if (this.zoneManager) {
                    heartbeat.zones = this._getZoneStatusSummary();
                }

                this.publish(this.config.heartbeatTopic, heartbeat);
            }
        }, this.config.heartbeatInterval);

        // Allow process to exit naturally when only the interval remains (useful for Jest tests)
        if (typeof this.heartbeatInterval.unref === 'function') {
            this.heartbeatInterval.unref();
        }
    }

    /**
     * Set zone manager reference for enhanced heartbeat reporting
     */
    setZoneManager(zoneManager) {
        this.zoneManager = zoneManager;
    }

    /**
     * Get zone status summary for heartbeat
     */
    _getZoneStatusSummary() {
        if (!this.zoneManager || !this.zoneManager.zones) {
            return {};
        }

        const summary = {};
        for (const [zoneName, zone] of this.zoneManager.zones) {
            const state = zone.currentState || {};
            summary[zoneName] = {
                status: state.status || 'unknown',
                focus: state.focus || 'none',
                content: state.content || 'none',
                browser_enabled: state.browser?.enabled || false
            };
        }
        return summary;
    }
}

module.exports = MqttClient;
