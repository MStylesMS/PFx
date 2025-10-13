/**
 * Unit tests for MqttClient reconnection behavior
 * 
 * Tests the simplified library reconnect approach with startup jitter.
 */

const MqttClient = require('../../lib/core/mqtt-client');
const mqtt = require('mqtt');
const EventEmitter = require('events');

// Mock mqtt.connect
jest.mock('mqtt');

describe('MqttClient Reconnection', () => {
    let mockClient;
    let globalConfig;
    let clientInstances = []; // Track all created client instances

    beforeEach(() => {
        clientInstances = []; // Reset before each test
        
        // Create a mock MQTT client
        mockClient = new EventEmitter();
        mockClient.subscribe = jest.fn((topic, callback) => callback && callback(null));
        mockClient.unsubscribe = jest.fn();
        mockClient.publish = jest.fn((topic, message, options, callback) => callback && callback(null));
        mockClient.end = jest.fn((force, options, callback) => {
            if (callback) callback();
            return mockClient;
        });

        // Mock mqtt.connect to return our mock client
        mqtt.connect.mockReturnValue(mockClient);

        // Default config
        globalConfig = {
            mqttServer: 'localhost',
            mqttPort: 1883,
            mqttReconnectPeriod: 1500,
            mqttKeepAlive: 60,
            mqttCleanSession: true,
            heartbeatTopic: 'test/heartbeat',
            heartbeatInterval: 10000,
            heartbeatEnabled: true
        };

        jest.clearAllTimers();
    });

    afterEach(() => {
        // Clean up all created client instances synchronously
        for (const client of clientInstances) {
            if (client && client.heartbeatInterval) {
                clearInterval(client.heartbeatInterval);
                client.heartbeatInterval = null;
            }
        }
        jest.clearAllMocks();
    });

    test('should pass reconnectPeriod option to mqtt.connect', async () => {
        const client = new MqttClient(globalConfig);
        clientInstances.push(client);
        
        const connectPromise = client.connect();
        
        // Wait a bit for jitter to complete
        await new Promise(resolve => setTimeout(resolve, 600));
        
        expect(mqtt.connect).toHaveBeenCalledWith(
            'mqtt://localhost:1883',
            expect.objectContaining({
                reconnectPeriod: 1500,
                connectTimeout: 10000,
                keepalive: 60,
                clean: true
            })
        );
        
        // Simulate successful connection
        mockClient.emit('connect');
        await connectPromise;
        expect(client.connected).toBe(true);
    });

    test('should use custom reconnect_period from config', async () => {
        globalConfig.mqttReconnectPeriod = 3000;
        const client = new MqttClient(globalConfig);
        clientInstances.push(client);
        
        const connectPromise = client.connect();
        await new Promise(resolve => setTimeout(resolve, 600));
        
        expect(mqtt.connect).toHaveBeenCalledWith(
            'mqtt://localhost:1883',
            expect.objectContaining({
                reconnectPeriod: 3000
            })
        );
        
        mockClient.emit('connect');
        await connectPromise;
    });

    test('should attach event handlers', async () => {
        const client = new MqttClient(globalConfig);
        clientInstances.push(client);
        
        const connectPromise = client.connect();
        await new Promise(resolve => setTimeout(resolve, 600));
        
        // Check that event handlers are attached
        expect(mockClient.listenerCount('connect')).toBeGreaterThan(0);
        expect(mockClient.listenerCount('error')).toBeGreaterThan(0);
        expect(mockClient.listenerCount('close')).toBeGreaterThan(0);
        expect(mockClient.listenerCount('message')).toBeGreaterThan(0);
        
        mockClient.emit('connect');
        await connectPromise;
    });

    test('should handle close event without manual reconnect', async () => {
        const client = new MqttClient(globalConfig);
        clientInstances.push(client);
        
        const connectPromise = client.connect();
        await new Promise(resolve => setTimeout(resolve, 600));
        mockClient.emit('connect');
        await connectPromise;
        
        expect(client.connected).toBe(true);
        
        // Simulate connection close
        mockClient.emit('close');
        
        // Verify connection is marked as closed
        expect(client.connected).toBe(false);
        
        // Verify no custom reconnect timers are set (library handles it)
        // The library will automatically reconnect based on reconnectPeriod
    });

    test('should disable reconnect on intentional disconnect', async () => {
        const client = new MqttClient(globalConfig);
        clientInstances.push(client);
        
        const connectPromise = client.connect();
        await new Promise(resolve => setTimeout(resolve, 600));
        mockClient.emit('connect');
        await connectPromise;
        
        // Disconnect intentionally
        await client.disconnect();
        
        // Verify client.end was called with force=true to disable library reconnect
        expect(mockClient.end).toHaveBeenCalledWith(true, {}, expect.any(Function));
        expect(client.isDisconnecting).toBe(true);
    });

    test('should resolve connect promise on successful connection', async () => {
        const client = new MqttClient(globalConfig);
        clientInstances.push(client);
        
        const connectPromise = client.connect();
        await new Promise(resolve => setTimeout(resolve, 600));
        
        // Simulate successful connection
        mockClient.emit('connect');
        
        await expect(connectPromise).resolves.toBeUndefined();
        expect(client.connected).toBe(true);
    });
});

