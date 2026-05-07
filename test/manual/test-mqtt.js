/**
 * Manual MQTT Test Script
 * 
 * Tests MQTT connectivity and demonstrates all device commands.
 * This script helps validate MQTT communication and provides examples
 * of all supported commands for each device type.
 */

const mqtt = require('mqtt');
const readline = require('readline');
const ConfigLoader = require('../../lib/core/config-loader');

class MqttTester {
    constructor() {
        this.client = null;
        this.config = null;
        this.testResults = [];
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async initialize(configPath = 'pfx.ini') {
        console.log('🚀 Initializing MQTT Test Suite...\n');

        try {
            // Load configuration
            this.config = await ConfigLoader.load(configPath);
            console.log(`✅ Configuration loaded: ${Object.keys(this.config.devices).length} devices found`);

            // Connect to MQTT broker
            await this.connectMqtt();
            console.log('✅ MQTT connection established\n');

        } catch (error) {
            console.error('❌ Initialization failed:', error.message);
            process.exit(1);
        }
    }

    async connectMqtt() {
        const brokerUrl = `mqtt://${this.config.global.mqttServer}:${this.config.global.mqttPort}`;
        console.log(`🔗 Connecting to MQTT broker: ${brokerUrl}`);

        return new Promise((resolve, reject) => {
            this.client = mqtt.connect(brokerUrl, {
                clientId: `pfx-test-${Date.now()}`,
                clean: true
            });

            this.client.on('connect', () => {
                console.log('✅ Connected to MQTT broker');
                resolve();
            });

            this.client.on('error', (error) => {
                console.error('❌ MQTT connection error:', error.message);
                reject(error);
            });

            this.client.on('message', (topic, message) => {
                try {
                    const payload = JSON.parse(message.toString());
                    console.log(`📨 Received message on ${topic}:`, JSON.stringify(payload, null, 2));
                } catch (error) {
                    console.log(`📨 Received message on ${topic}:`, message.toString());
                }
            });

            // Connection timeout
            setTimeout(() => {
                if (!this.client.connected) {
                    reject(new Error('MQTT connection timeout'));
                }
            }, 10000);
        });
    }

    async testMqttConnectivity() {
        console.log('🔍 Testing MQTT Connectivity...\n');

        const testTopic = 'pfx/test/connectivity';
        const testMessage = {
            test: 'connectivity',
            timestamp: new Date().toISOString(),
            message: 'MQTT test message'
        };

        return new Promise((resolve) => {
            let messageReceived = false;

            // Subscribe to test topic
            this.client.subscribe(testTopic, (error) => {
                if (error) {
                    console.error('❌ Failed to subscribe to test topic:', error.message);
                    resolve(false);
                    return;
                }
                console.log(`📡 Subscribed to: ${testTopic}`);
            });

            // Set up message handler
            const messageHandler = (topic, message) => {
                if (topic === testTopic && !messageReceived) {
                    messageReceived = true;
                    try {
                        const received = JSON.parse(message.toString());
                        if (received.test === testMessage.test) {
                            console.log('✅ MQTT connectivity test PASSED');
                            console.log('📨 Test message received successfully\n');
                            this.testResults.push({ test: 'MQTT Connectivity', result: 'PASS' });
                            resolve(true);
                        }
                    } catch (error) {
                        console.error('❌ Failed to parse received message:', error.message);
                        this.testResults.push({ test: 'MQTT Connectivity', result: 'FAIL' });
                        resolve(false);
                    }
                }
            };

            this.client.on('message', messageHandler);

            // Publish test message after short delay
            setTimeout(() => {
                console.log('📤 Publishing test message...');
                console.log('JSON:', JSON.stringify(testMessage, null, 2));
                this.client.publish(testTopic, JSON.stringify(testMessage));

                // Timeout if no response
                setTimeout(() => {
                    if (!messageReceived) {
                        console.error('❌ MQTT connectivity test FAILED - No response received');
                        this.testResults.push({ test: 'MQTT Connectivity', result: 'FAIL' });
                        resolve(false);
                    }
                }, 5000);
            }, 1000);
        });
    }

    async testDeviceCommands() {
        console.log('🎮 Testing Device Commands...\n');

        for (const [deviceName, deviceConfig] of Object.entries(this.config.devices)) {
            console.log(`\n🔧 Testing Device: ${deviceName} (${deviceConfig.type})`);
            console.log('='.repeat(60));

            await this.testDeviceType(deviceName, deviceConfig);
        }
    }

    async testDeviceType(deviceName, deviceConfig) {
        const commandTopic = `${deviceConfig.baseTopic}/commands`;
        console.log(`📡 Command Topic: ${commandTopic}\n`);

        switch (deviceConfig.type) {
            case 'screen':
                await this.testScreenCommands(deviceName, deviceConfig, commandTopic);
                break;
            case 'light':
                await this.testLightCommands(deviceName, deviceConfig, commandTopic);
                break;
            case 'light_group':
                await this.testLightGroupCommands(deviceName, deviceConfig, commandTopic);
                break;
            case 'relay':
                await this.testRelayCommands(deviceName, deviceConfig, commandTopic);
                break;
            default:
                console.log(`⚠️  Unknown device type: ${deviceConfig.type}`);
        }
    }

    async testScreenCommands(deviceName, deviceConfig, commandTopic) {
        const commands = [
            // Image Commands
            {
                name: 'setImage (minimal)',
                description: 'Display an image file',
                command: { command: 'setImage', file: 'test-image.jpg' }
            },
            {
                name: 'setImage (with subdirectory)',
                description: 'Display an image from subdirectory',
                command: { command: 'setImage', file: 'backgrounds/lobby.jpg' }
            },

            // Video Commands
            {
                name: 'playVideo (minimal)',
                description: 'Play a video file',
                command: { command: 'playVideo', file: 'intro.mp4' }
            },
            {
                name: 'playVideo (full options)',
                description: 'Play a video with volume adjustment and channel',
                command: { command: 'playVideo', file: 'videos/intro.mp4', volumeAdjust: -10, channel: 'default' }
            },
            {
                name: 'stopVideo',
                description: 'Stop current video playback',
                command: { command: 'stopVideo' }
            },
            {
                name: 'pause',
                description: 'Pause current video',
                command: { command: 'pause' }
            },
            {
                name: 'resume',
                description: 'Resume paused video',
                command: { command: 'resume' }
            },
            {
                name: 'skip',
                description: 'Skip to next video in queue',
                command: { command: 'skip' }
            },

            // Audio Commands
            {
                name: 'playAudio (minimal)',
                description: 'Play an audio file',
                command: { command: 'playAudio', file: 'background.mp3' }
            },
            {
                name: 'playAudio (full options)',
                description: 'Play audio with volume adjustment and channel',
                command: { command: 'playAudio', file: 'music/background.mp3', volumeAdjust: 20, channel: 'default' }
            },
            {
                name: 'playAudioFX (minimal)',
                description: 'Play an audio effect',
                command: { command: 'playAudioFX', file: 'doorbell.wav' }
            },
            {
                name: 'playAudioFX (full options)',
                description: 'Play audio effect with all options',
                command: { command: 'playAudioFX', file: 'effects/explosion.wav', type: 'one-shot', volumeAdjust: 10 }
            },
            {
                name: 'playAudioFX (loop)',
                description: 'Play looping audio effect',
                command: { command: 'playAudioFX', file: 'effects/ambient.wav', type: 'loop', volumeAdjust: -30 }
            },
            {
                name: 'stopAudio',
                description: 'Stop current audio playback',
                command: { command: 'stopAudio' }
            },
            {
                name: 'stopAllAudioFx',
                description: 'Stop all audio effects',
                command: { command: 'stopAllAudioFx' }
            },

            // Advanced Commands
            {
                name: 'transition (minimal)',
                description: 'Play video then show image',
                command: { command: 'transition', video: 'intro.mp4', image: 'final.jpg' }
            },
            {
                name: 'transition (with channel)',
                description: 'Play video then show image with channel routing',
                command: { command: 'transition', video: 'transitions/intro.mp4', image: 'backgrounds/final.jpg', channel: 'default' }
            },
            {
                name: 'stopAll',
                description: 'Stop all media playback',
                command: { command: 'stopAll' }
            },

            // Queue Management
            {
                name: 'videoQueue',
                description: 'Get video queue status',
                command: { command: 'videoQueue' }
            },
            {
                name: 'audioQueue',
                description: 'Get audio queue status',
                command: { command: 'audioQueue' }
            },
            {
                name: 'clearQueue',
                description: 'Clear media queue',
                command: { command: 'clearQueue' }
            },

            // Configuration
            {
                name: 'getConfig',
                description: 'Get device configuration',
                command: { command: 'getConfig' }
            }
        ];

        await this.executeCommands(commands, commandTopic, deviceName);
    }

    async testLightCommands(deviceName, deviceConfig, commandTopic) {
        const commands = [
            {
                name: 'on (minimal)',
                description: 'Turn light on',
                command: { command: 'on' }
            },
            {
                name: 'on (with brightness)',
                description: 'Turn light on with specific brightness',
                command: { command: 'on', brightness: 80 }
            },
            {
                name: 'off',
                description: 'Turn light off',
                command: { command: 'off' }
            },
            {
                name: 'setColor (hex)',
                description: 'Set light color using hex code',
                command: { command: 'setColor', color: '#FF6400', brightness: 75 }
            },
            {
                name: 'setColor (RGB)',
                description: 'Set light color using RGB values',
                command: { command: 'setColor', color: { r: 255, g: 100, b: 0 }, brightness: 90 }
            }
        ];

        await this.executeCommands(commands, commandTopic, deviceName);
    }

    async testLightGroupCommands(deviceName, deviceConfig, commandTopic) {
        const commands = [
            {
                name: 'on (group)',
                description: 'Turn all lights in group on',
                command: { command: 'on', brightness: 100 }
            },
            {
                name: 'off (group)',
                description: 'Turn all lights in group off',
                command: { command: 'off' }
            },
            {
                name: 'setGroupColor',
                description: 'Set color for all lights in group',
                command: { command: 'setGroupColor', color: { r: 255, g: 100, b: 0 }, brightness: 80, lights: ['light1', 'light2'] }
            },
            {
                name: 'fade',
                description: 'Fade lights to target brightness',
                command: { command: 'fade', brightness: 50, duration: 10000 }
            }
        ];

        await this.executeCommands(commands, commandTopic, deviceName);
    }

    async testRelayCommands(deviceName, deviceConfig, commandTopic) {
        const commands = [
            {
                name: 'on',
                description: 'Turn relay on',
                command: { command: 'on' }
            },
            {
                name: 'off',
                description: 'Turn relay off',
                command: { command: 'off' }
            },
            {
                name: 'toggle',
                description: 'Toggle relay state',
                command: { command: 'toggle' }
            },
            {
                name: 'pulse (minimal)',
                description: 'Pulse relay with default duration',
                command: { command: 'pulse' }
            },
            {
                name: 'pulse (with duration)',
                description: 'Pulse relay with custom duration',
                command: { command: 'pulse', duration: 5000 }
            }
        ];

        await this.executeCommands(commands, commandTopic, deviceName);
    }

    async executeCommands(commands, commandTopic, deviceName) {
        for (const cmd of commands) {
            console.log(`\n📝 command: ${cmd.name}`);
            console.log(`   Description: ${cmd.description}`);
            console.log(`   Topic: ${commandTopic}`);
            console.log(`   JSON: ${JSON.stringify(cmd.command, null, 2)}`);

            // Subscribe to status topic for responses
            const statusTopic = `${commandTopic.replace('/commands', '/status')}`;
            this.client.subscribe(statusTopic);

            console.log(`\n   Would you like to send this command? (y/n/q to quit): `);
            const response = await this.waitForInput();

            if (response.toLowerCase() === 'q') {
                console.log('🛑 Test terminated by user');
                return;
            }

            if (response.toLowerCase() === 'y') {
                console.log('📤 Publishing command...');
                this.client.publish(commandTopic, JSON.stringify(cmd.command));
                this.testResults.push({
                    test: `${deviceName} - ${cmd.name}`,
                    result: 'SENT',
                    command: cmd.command
                });

                // Wait briefly for any responses
                await this.delay(1000);
            } else {
                console.log('⏭️  Skipped');
                this.testResults.push({
                    test: `${deviceName} - ${cmd.name}`,
                    result: 'SKIPPED'
                });
            }
        }
    }

    waitForInput() {
        return new Promise((resolve) => {
            this.rl.question('', (answer) => {
                resolve(answer);
            });
        });
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    printSummary() {
        console.log('\n' + '='.repeat(60));
        console.log('📊 TEST SUMMARY');
        console.log('='.repeat(60));

        let sent = 0, skipped = 0, passed = 0, failed = 0;

        for (const result of this.testResults) {
            const status = result.result === 'PASS' ? '✅' :
                result.result === 'FAIL' ? '❌' :
                    result.result === 'SENT' ? '📤' : '⏭️';

            console.log(`${status} ${result.test}: ${result.result}`);

            switch (result.result) {
                case 'SENT': sent++; break;
                case 'SKIPPED': skipped++; break;
                case 'PASS': passed++; break;
                case 'FAIL': failed++; break;
            }
        }

        console.log('\n📈 Statistics:');
        console.log(`   Commands Sent: ${sent}`);
        console.log(`   Commands Skipped: ${skipped}`);
        console.log(`   Tests Passed: ${passed}`);
        console.log(`   Tests Failed: ${failed}`);
        console.log(`   Total: ${this.testResults.length}`);

        console.log('\n💡 Note: "SENT" means the command was published to MQTT.');
        console.log('   Check your ParadoxFX application logs to see if commands were processed correctly.');
    }

    async cleanup() {
        console.log('\n🧹 Cleaning up...');

        if (this.client) {
            this.client.end();
            console.log('✅ MQTT client disconnected');
        }

        this.rl.close();
    }

    async run(configPath) {
        try {
            await this.initialize(configPath);

            console.log('🎯 Starting MQTT Test Suite');
            console.log('This will test MQTT connectivity and demonstrate all device commands.\n');

            // Test basic MQTT connectivity
            const connectivityOk = await this.testMqttConnectivity();

            if (!connectivityOk) {
                console.log('❌ MQTT connectivity test failed. Please check your MQTT broker.');
                console.log('   Make sure mosquitto or another MQTT broker is running on localhost:1883');
                await this.cleanup();
                return;
            }

            // Test device commands
            await this.testDeviceCommands();

            // Show summary
            this.printSummary();

        } catch (error) {
            console.error('❌ Test suite failed:', error.message);
        } finally {
            await this.cleanup();
        }
    }
}

// Main execution
async function main() {
    const configPath = process.argv[2] || 'pfx.ini';
    console.log('🧪 ParadoxFX MQTT Test Suite');
    console.log('========================\n');

    const tester = new MqttTester();
    await tester.run(configPath);

    process.exit(0);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Test interrupted by user');
    process.exit(0);
});

if (require.main === module) {
    main().catch(console.error);
}

module.exports = MqttTester;
