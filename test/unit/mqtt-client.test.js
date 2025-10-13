/**
 * Unit Tests for MqttClient
 */

const MqttClient = require('../../lib/core/mqtt-client');
const mqtt = require('mqtt');
const EventEmitter = require('events');

jest.mock('mqtt');

describe('MqttClient', () => {
    let mqttClient;
    let mockMqttInstance;

    beforeEach(() => {
        // Create a proper mock that extends EventEmitter
        mockMqttInstance = new EventEmitter();
        mockMqttInstance.subscribe = jest.fn((topic, callback) => callback && callback(null));
        mockMqttInstance.unsubscribe = jest.fn();
        mockMqttInstance.publish = jest.fn((topic, message, options, callback) => callback && callback(null));
        mockMqttInstance.end = jest.fn((force, options, callback) => {
            if (callback) callback();
            return mockMqttInstance;
        });

        mqtt.connect.mockReturnValue(mockMqttInstance);

        const config = {
            mqttServer: 'localhost',
            mqttPort: 1883,
            mqttReconnectPeriod: 1500,
            mqttKeepAlive: 60,
            mqttCleanSession: true,
            heartbeatTopic: 'test/heartbeat',
            heartbeatInterval: 1000
        };

        mqttClient = new MqttClient(config);
    });

    afterEach(() => {
        // Clean up heartbeat interval to prevent Jest warnings
        if (mqttClient && mqttClient.heartbeatInterval) {
            clearInterval(mqttClient.heartbeatInterval);
            mqttClient.heartbeatInterval = null;
        }
        jest.clearAllMocks();
    });

    describe('connect', () => {
        test('should connect to MQTT broker successfully', async () => {
            const connectPromise = mqttClient.connect();
            
            // Wait for jitter
            await new Promise(resolve => setTimeout(resolve, 600));

            // Simulate successful connection
            mockMqttInstance.emit('connect');

            await expect(connectPromise).resolves.toBeUndefined();
            expect(mqttClient.connected).toBe(true);
            expect(mqtt.connect).toHaveBeenCalledWith('mqtt://localhost:1883', expect.objectContaining({
                reconnectPeriod: 1500
            }));
        });

        test('should handle connection errors gracefully', async () => {
            const connectPromise = mqttClient.connect();
            
            await new Promise(resolve => setTimeout(resolve, 600));

            // Simulate connection error - should not reject, library handles reconnect
            mockMqttInstance.emit('error', new Error('Connection failed'));

            // Connect should eventually timeout (30s) but not reject
            // For testing, we'll just emit connect after error
            mockMqttInstance.emit('connect');
            
            await expect(connectPromise).resolves.toBeUndefined();
        });

        test('should timeout initial connection after 30s but allow library to continue', async () => {
            const connectPromise = mqttClient.connect();
            
            await new Promise(resolve => setTimeout(resolve, 600));
            
            // Don't emit connect - let the 30s timeout resolve the promise
            await new Promise(resolve => setTimeout(resolve, 30100));

            await expect(connectPromise).resolves.toBeUndefined();
            expect(mqttClient.connected).toBe(false); // Not connected yet, but library keeps trying
        }, 35000);
    });

    describe('subscribe', () => {
        beforeEach(async () => {
            // Connect first
            const connectPromise = mqttClient.connect();
            await new Promise(resolve => setTimeout(resolve, 600));
            mockMqttInstance.emit('connect');
            await connectPromise;
        });

        test('should subscribe to topic with handler', () => {
            const handler = jest.fn();

            mqttClient.subscribe('test/topic', handler);

            expect(mockMqttInstance.subscribe).toHaveBeenCalledWith('test/topic', expect.any(Function));

            // Simulate successful subscription callback
            const subscribeCallback = mockMqttInstance.subscribe.mock.calls[0][1];
            subscribeCallback(null); // null = no error

            // Now verify subscription was registered by triggering a message
            mqttClient._handleMessage('test/topic', JSON.stringify({ test: 'data' }));
            expect(handler).toHaveBeenCalledWith('test/topic', { test: 'data' });
        });

        test('should throw error if not connected', () => {
            mqttClient.connected = false;

            expect(() => {
                mqttClient.subscribe('test/topic', jest.fn());
            }).toThrow('MQTT client not connected');
        });
    });

    describe('publish', () => {
        beforeEach(async () => {
            // Connect first
            const connectPromise = mqttClient.connect();
            await new Promise(resolve => setTimeout(resolve, 600));
            mockMqttInstance.emit('connect');
            await connectPromise;
        });

        test('should publish string message', () => {
            mqttClient.publish('test/topic', 'hello');

            expect(mockMqttInstance.publish).toHaveBeenCalledWith(
                'test/topic',
                'hello',
                expect.any(Object),
                expect.any(Function)
            );
        });

        test('should publish object as JSON', () => {
            const message = { command: 'test' };

            mqttClient.publish('test/topic', message);

            expect(mockMqttInstance.publish).toHaveBeenCalledWith(
                'test/topic',
                JSON.stringify(message),
                expect.any(Object),
                expect.any(Function)
            );
        });

        test('should not publish if not connected', () => {
            mqttClient.connected = false;

            mqttClient.publish('test/topic', 'hello');

            expect(mockMqttInstance.publish).not.toHaveBeenCalled();
        });
    });

    describe('message handling', () => {
        beforeEach(async () => {
            // Connect and get message handler
            const connectPromise = mqttClient.connect();
            await new Promise(resolve => setTimeout(resolve, 600));
            mockMqttInstance.emit('connect');
            await connectPromise;
        });

        test('should handle JSON messages', () => {
            const handler = jest.fn();
            mqttClient.subscribe('test/topic', handler);

            // Simulate successful subscription
            const subscribeCallback = mockMqttInstance.subscribe.mock.calls[0][1];
            subscribeCallback(null);

            // Simulate incoming message
            const message = Buffer.from(JSON.stringify({ command: 'test' }));
            mockMqttInstance.emit('message', 'test/topic', message);

            expect(handler).toHaveBeenCalledWith('test/topic', { command: 'test' });
        });

        test('should handle plain text messages', () => {
            const handler = jest.fn();
            mqttClient.subscribe('test/topic', handler);

            // Simulate successful subscription
            const subscribeCallback = mockMqttInstance.subscribe.mock.calls[0][1];
            subscribeCallback(null);

            // Simulate incoming message
            const message = Buffer.from('plain text');
            mockMqttInstance.emit('message', 'test/topic', message);

            expect(handler).toHaveBeenCalledWith('test/topic', 'plain text');
        });

        test('should handle messages without registered handler', () => {
            const message = Buffer.from('test');

            expect(() => {
                mockMqttInstance.emit('message', 'unknown/topic', message);
            }).not.toThrow();
        });
    });

    describe('disconnect', () => {
        test('should disconnect from broker', async () => {
            mqttClient.client = mockMqttInstance;

            const disconnectPromise = mqttClient.disconnect();

            // Simulate end callback
            const endCallback = mockMqttInstance.end.mock.calls[0][2];
            endCallback();

            await expect(disconnectPromise).resolves.toBeUndefined();
            expect(mqttClient.connected).toBe(false);
        });

        test('should handle disconnect when no client exists', async () => {
            mqttClient.client = null;

            await expect(mqttClient.disconnect()).resolves.toBeUndefined();
        });
    });
});
