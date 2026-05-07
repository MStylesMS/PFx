/**
 * Pi5 ParadoxFX Screen 0 Test
 * 
 * Tests ParadoxFX on Pi5 with screen 0 only using proven configuration
 * Based on phase1-integration-test.js but updated for Pi5 specifics
 */

const mqtt = require('mqtt');
const MqttClient = require('../../lib/core/mqtt-client');
const ScreenDevice = require('../../lib/devices/screen-device');
const Logger = require('../../lib/utils/logger');

// Pi5 Screen 0 Test Configuration (using proven settings)
const pi5TestConfig = {
    // MQTT settings
    mqttServer: 'localhost',
    mqttPort: 1883,

    // Pi5 Screen 0 settings (from pfx-pi5-h.ini)
    name: 'zone1-hdmi0',
    type: 'screen',
    display: ':0',
    targetMonitor: 0,
    audioDevice: 'alsa/hdmi:CARD=vc4hdmi0,DEV=0',  // Pi5 HDMI0
    mediaDir: '/opt/paradox/media/zone1',
    volume: 80,
    playerType: 'mpv',

    // Topics (matching pfx-pi5-h.ini)
    baseTopic: 'paradox/zone1/screen',
    statusTopic: 'paradox/zone1/screen/status',
    commandTopic: 'paradox/zone1/screen/commands',

    // Queue settings
    videoQueueMax: 3,
    defaultVolume: 80
};

class Pi5Screen0Test {
    constructor() {
        this.logger = new Logger('Pi5Screen0Test', 'info');
        this.mqttClient = null;
        this.screenDevice = null;
        this.testResults = [];
        this.isRunning = false;
    }

    async initialize() {
        this.logger.info('Initializing Pi5 Screen 0 test...');
        
        // Display system check
        const displayCheck = `Display system: ${process.env.XDG_SESSION_TYPE || 'unknown'}
Display variable: ${process.env.DISPLAY || 'not set'}
Test media directory: ${pi5TestConfig.mediaDir}`;
        
        console.log(`📋 System Check:
${displayCheck}
`);

        try {
            // Initialize MQTT client
            this.mqttClient = new MqttClient({
                mqttServer: pi5TestConfig.mqttServer,
                mqttPort: pi5TestConfig.mqttPort,
                heartbeatTopic: 'pi5/test/heartbeat',
                heartbeatInterval: 10000
            });

            await this.mqttClient.connect();
            this.logger.info('✅ MQTT client connected');

            // Set up status monitoring using subscribe method
            await this.mqttClient.subscribe(pi5TestConfig.statusTopic, (message) => {
                this.handleStatusMessage(JSON.parse(message.toString()));
            });

            // Initialize screen device with Pi5 configuration
            this.screenDevice = new ScreenDevice(pi5TestConfig, this.mqttClient);
            await this.screenDevice.initialize();

            this.logger.info('✅ Screen device initialized');
            this.isRunning = true;

        } catch (error) {
            this.logger.error(`❌ Initialization failed: ${error.message}`);
            console.log(`❌ Initialization failed: ${error.message}`);
            throw error;
        }
    }

    handleStatusMessage(status) {
        this.logger.debug('Status received:', status);
        this.testResults.push({
            timestamp: new Date(),
            type: 'status',
            data: status
        });
    }

    async sendCommand(command, description) {
        console.log(`\n▶️  ${description}`);
        console.log(`Command: ${command.Command}`);
        
        this.logger.info(`Sending command: ${command.Command}`);

        try {
            await this.screenDevice.handleCommand(command);

            this.testResults.push({
                timestamp: new Date(),
                type: 'command_sent',
                data: command
            });

            console.log('✅ Command sent successfully');
            return true;

        } catch (error) {
            this.logger.error('Command failed:', error.message);
            console.log('❌ Command failed:', error.message);
            return false;
        }
    }

    async runTests() {
        console.log('🧪 Running Pi5 Screen 0 Tests...');
        console.log('=================================');

        try {
            // Test 1: Display image
            console.log('\n📸 TEST 1: Display Image');
            console.log('------------------------');
            const imageResult = await this.sendCommand({
                Command: 'setImage',
                File: 'default.jpg'  // Relative to media_dir
            }, 'Display test image on screen 0');

            if (imageResult) {
                console.log('Expected: Image should appear on LEFT monitor');
                await this.wait(3000);
            }

            // Test 2: Play video with audio
            console.log('\n🎬 TEST 2: Play Video with Audio');
            console.log('--------------------------------');
            const videoResult = await this.sendCommand({
                Command: 'playVideo',
                File: 'default.mp4',  // Relative to media_dir
                Volume: 80
            }, 'Play test video with audio on screen 0');

            if (videoResult) {
                console.log('Expected: Video on LEFT monitor, audio from LEFT HDMI');
                await this.wait(5000);
            }

            // Test 3: Play audio only
            console.log('\n🔊 TEST 3: Play Audio Only');
            console.log('--------------------------');
            const audioResult = await this.sendCommand({
                Command: 'playAudio',
                File: 'default.mp4',  // Can use video file for audio
                Volume: 70
            }, 'Play audio only to HDMI0');

            if (audioResult) {
                console.log('Expected: Audio from LEFT monitor only, no video');
                await this.wait(3000);
            }

            // Test 4: Stop all
            console.log('\n🛑 TEST 4: Stop All Media');
            console.log('-------------------------');
            const stopResult = await this.sendCommand({
                Command: 'stop'
            }, 'Stop all media playback');

            if (stopResult) {
                console.log('Expected: All media stops, screen goes black');
                await this.wait(1000);
            }

            console.log('\n✅ ALL TESTS COMPLETED!');
            console.log('=======================');
            
            // Results summary
            const successful = this.testResults.filter(r => r.type === 'command_sent').length;
            console.log(`\n📊 Results: ${successful} commands sent successfully`);
            
            console.log('\n🎯 Did you observe the expected behavior?');
            console.log('- Image displayed on LEFT monitor');
            console.log('- Video played on LEFT monitor with audio from LEFT HDMI');
            console.log('- Audio-only played from LEFT monitor');
            console.log('- All media stopped correctly');

        } catch (error) {
            this.logger.error('Test sequence failed:', error);
            console.log('❌ Test sequence failed:', error.message);
            throw error;
        }
    }

    async wait(milliseconds) {
        console.log(`⏱️  Waiting ${milliseconds / 1000} seconds...`);
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    async shutdown() {
        this.logger.info('Shutting down test...');
        console.log('\n🛑 Shutting down ParadoxFX test...');

        if (this.screenDevice) {
            await this.screenDevice.shutdown();
        }

        if (this.mqttClient) {
            await this.mqttClient.disconnect();
        }

        console.log('✅ Shutdown complete');
    }
}

// Main test execution
async function runPi5Screen0Test() {
    const test = new Pi5Screen0Test();

    try {
        await test.initialize();
        await test.runTests();
    } catch (error) {
        console.log('\n❌ TEST FAILED:', error.message);
        console.log('\nTroubleshooting:');
        console.log('1. Ensure MQTT broker is running: sudo systemctl status mosquitto');
        console.log('2. Check media files exist in /opt/paradox/media/zone1/');
        console.log('3. Verify X11 is active: echo $XDG_SESSION_TYPE');
        console.log('4. Check audio device: aplay -l | grep vc4hdmi');
    } finally {
        await test.shutdown();
    }
}

// Run the test if called directly
if (require.main === module) {
    runPi5Screen0Test().catch(console.error);
}

module.exports = Pi5Screen0Test;
