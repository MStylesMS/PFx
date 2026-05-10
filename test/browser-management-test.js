#!/usr/bin/env node

/**
 * Browser Management Integration Test
 * 
 * Tests the browser management functionality with MPV-Chromium switching
 * This script simulates MQTT commands to test the browser management features
 */

const path = require('path');
const { execSync } = require('child_process');

// Add project root to require path
process.env.NODE_PATH = path.resolve(__dirname, '..');
require('module')._initPaths();

const MqttClient = require('../lib/core/mqtt-client');
const ZoneManager = require('../lib/core/zone-manager');
const Logger = require('../lib/utils/logger');

class BrowserManagementTest {
    constructor() {
        this.logger = new Logger('BrowserManagementTest');
        this.mqttClient = null;
        this.zoneManager = null;
        this.testConfig = this._getTestConfig();
    }

    _getTestConfig() {
        return {
            mqttServer: 'localhost',
            mqttPort: 1883,
            baseTopic: 'paradox',
            heartbeatTopic: 'paradox/system/heartbeat',
            heartbeatInterval: 10000, // 10 seconds for testing
            global: {
                mediaBasePath: '/opt/paradox/media'
            },
            devices: {
                'screen1': {
                    name: 'screen1',
                    type: 'screen',
                    display: ':0',
                    targetMonitor: 0,
                    volume: 80,
                    baseTopic: 'paradox',
                    browserUrl: 'http://localhost/clock/'
                }
            }
        };
    }

    async initialize() {
        this.logger.info('Initializing browser management test...');

        // Create MQTT client
        this.mqttClient = new MqttClient(this.testConfig);
        
        // Create zone manager  
        this.zoneManager = new ZoneManager(this.testConfig, this.mqttClient);

        try {
            // Connect to MQTT
            await this.mqttClient.connect();
            this.logger.info('Connected to MQTT broker');

            // Initialize zones
            await this.zoneManager.initialize();
            this.logger.info('Zone manager initialized');

            return true;
        } catch (error) {
            this.logger.error('Initialization failed:', error.message);
            return false;
        }
    }

    async runTests() {
        this.logger.info('Starting browser management tests...');

        const zone = this.zoneManager.zones.get('screen1');
        if (!zone) {
            throw new Error('Test zone not found');
        }

        try {
            // Browser is auto-enabled at zone init via browser_url config — see _getTestConfig().
            // Test 1: Show browser
            this.logger.info('Test 1: Show browser (pure window management)');
            await zone.handleCommand({
                command: 'showBrowser'
            });
            await this._delay(3000);

            // Test 2: Hide browser (back to MPV)
            this.logger.info('Test 2: Hide browser (pure window management)');
            await zone.handleCommand({
                command: 'hideBrowser'
            });
            await this._delay(3000);

            // Test 3: Change browser URL
            this.logger.info('Test 3: Set browser URL');
            await zone.handleCommand({
                command: 'setBrowserUrl',
                url: 'https://www.google.com'
            });
            await this._delay(2000);

            // Test 4: Show browser again with new URL
            this.logger.info('Test 4: Show browser with new URL');
            await zone.handleCommand({
                command: 'showBrowser'
            });
            await this._delay(3000);

            this.logger.info('All tests completed successfully!');

            // Display final status
            this.logger.info('Final zone status:', JSON.stringify(zone.currentState, null, 2));

        } catch (error) {
            this.logger.error('Test failed:', error.message);
            this.logger.debug(error.stack);
            throw error;
        }
    }

    async cleanup() {
        this.logger.info('Cleaning up test environment...');

        if (this.zoneManager) {
            try {
                await this.zoneManager.shutdown();
            } catch (error) {
                this.logger.warn('Zone manager shutdown error:', error.message);
            }
        }

        if (this.mqttClient) {
            try {
                await this.mqttClient.disconnect();
            } catch (error) {
                this.logger.warn('MQTT client disconnect error:', error.message);
            }
        }

        this.logger.info('Cleanup completed');
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Main execution
async function main() {
    const test = new BrowserManagementTest();
    
    try {
        // Initialize
        const initialized = await test.initialize();
        if (!initialized) {
            console.error('Failed to initialize test environment');
            process.exit(1);
        }

        // Run tests
        await test.runTests();
        
        console.log('\\n✅ Browser management tests completed successfully!');
        
    } catch (error) {
        console.error('\\n❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await test.cleanup();
    }
}

// Handle cleanup on exit
process.on('SIGINT', async () => {
    console.log('\\nReceived SIGINT, cleaning up...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\\nReceived SIGTERM, cleaning up...');
    process.exit(0);
});

if (require.main === module) {
    main();
}

module.exports = BrowserManagementTest;
