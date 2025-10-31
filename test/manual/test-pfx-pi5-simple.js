/**
 * Pi5 ParadoxFX Simple Test
 * 
 * Basic test to verify ParadoxFX works on Pi5 with screen 0 configuration
 * Uses minimal setup to avoid event handler issues
 */

const mqtt = require('mqtt');
const ScreenDevice = require('../../lib/devices/screen-device');
const MediaPlayerFactory = require('../../lib/media/media-player-factory');
const Logger = require('../../lib/utils/logger');

// Pi5 Screen 0 Test Configuration (using proven settings)
const pi5TestConfig = {
    // Device identification
    name: 'zone1-hdmi0',
    type: 'screen',
    
    // Pi5 Screen 0 settings (from pfx-pi5-h.ini)
    display: ':0',
    targetMonitor: 0,
    audioDevice: 'alsa/hdmi:CARD=vc4hdmi0,DEV=0',
    
    // Media configuration 
    mediaDir: '/opt/paradox/media/zone1',
    defaultVolume: 80,
    videoQueueMax: 5,
    
    // MQTT settings
    mqttServer: 'localhost',
    mqttPort: 1883,
    baseTopic: 'pi5test/zone1',
    statusTopic: 'pi5test/zone1/status',
    commandTopic: 'pi5test/zone1/commands',
    
    // Pi5 MPV optimizations (as string, space-separated)
    mpvVideoOptions: '--vo=gpu --hwdec=auto --gpu-context=x11egl --cache=yes --cache-secs=10 --demuxer-readahead-secs=5'
};

class Pi5SimpleTest {
    constructor() {
        this.logger = new Logger('Pi5SimpleTest');
        this.mqttClient = null;
        this.mediaFactory = null;
        this.zoneManager = null;
    }

    async initialize() {
        this.logger.info('Initializing Pi5 Simple Test...');
        
        console.log('🎬 Pi5 ParadoxFX Simple Test');
        console.log('==============================\n');
        
        // Display system check
        const displayCheck = `Display system: ${process.env.XDG_SESSION_TYPE || 'unknown'}
Display variable: ${process.env.DISPLAY || 'not set'}
Test media directory: ${pi5TestConfig.mediaDir}
Audio device: ${pi5TestConfig.audioDevice}`;
        
        console.log(`📋 System Check:\n${displayCheck}\n`);

        try {
            // Connect to MQTT
            this.mqttClient = mqtt.connect(`mqtt://${pi5TestConfig.mqttServer}:${pi5TestConfig.mqttPort}`, {
                clientId: `pi5test-${Date.now()}`,
                clean: true
            });

            await new Promise((resolve, reject) => {
                this.mqttClient.on('connect', () => {
                    console.log('✅ MQTT client connected');
                    resolve();
                });
                this.mqttClient.on('error', reject);
            });

            // Initialize Media Factory and Zone Manager directly
            this.mediaFactory = new MediaPlayerFactory(pi5TestConfig);
            this.zoneManager = await this.mediaFactory.createZoneManager(pi5TestConfig);
            
            console.log('✅ MPV Zone Manager initialized');
            console.log('✅ Ready for testing\n');

        } catch (error) {
            this.logger.error(`❌ Initialization failed: ${error.message}`);
            console.log(`❌ Initialization failed: ${error.message}`);
            throw error;
        }
    }

    async runTests() {
        console.log('🧪 Running Pi5 Screen 0 Tests...\n');
        
        try {
            // Test 1: Image Display
            console.log('📸 Test 1: Image Display');
            await this.testImageDisplay();
            
            // Test 2: Video Playback
            console.log('🎬 Test 2: Video Playback');
            await this.testVideoPlayback();
            
            // Test 3: Audio Test
            console.log('🔊 Test 3: Audio Test');
            await this.testAudio();
            
            console.log('✅ All tests completed successfully!');
            
        } catch (error) {
            console.log(`❌ Test failed: ${error.message}`);
            this.logger.error('Test failure:', error);
        }
    }

    async testImageDisplay() {
        try {
            // Just test if we can call MPV methods
            console.log('  Setting test image...');
            
            const imagePath = `${pi5TestConfig.mediaDir}/default.mp4`; // Using video as image for testing
            await this.zoneManager.loadMedia(imagePath, 'image');
            
            console.log('  ✅ Image display command sent');
            await this.sleep(3000);
            
        } catch (error) {
            console.log(`  ❌ Image test failed: ${error.message}`);
            throw error;
        }
    }

    async testVideoPlayback() {
        try {
            console.log('  Playing test video...');
            
            const videoPath = `${pi5TestConfig.mediaDir}/default.mp4`;
            await this.zoneManager.loadMedia(videoPath, 'video');
            
            console.log('  ✅ Video playback started');
            await this.sleep(5000);
            
        } catch (error) {
            console.log(`  ❌ Video test failed: ${error.message}`);
            throw error;
        }
    }

    async testAudio() {
        try {
            console.log('  Testing audio routing...');
            console.log(`  Audio device: ${pi5TestConfig.audioDevice}`);
            
            // Test audio by playing video with sound
            const videoPath = `${pi5TestConfig.mediaDir}/intro_short.mp4`;
            await this.zoneManager.loadMedia(videoPath, 'video');
            
            console.log('  ✅ Audio test started (listen for sound)');
            console.log('  Audio should be routed to HDMI0');
            await this.sleep(5000);
            
        } catch (error) {
            console.log(`  ❌ Audio test failed: ${error.message}`);
            throw error;
        }
    }

    async shutdown() {
        console.log('\n🛑 Shutting down test...');
        
        try {
            if (this.zoneManager) {
                await this.zoneManager.stop();
            }
            if (this.mediaFactory) {
                await this.mediaFactory.shutdown();
            }
            if (this.mqttClient) {
                this.mqttClient.end();
            }
            console.log('✅ Shutdown complete');
        } catch (error) {
            console.log(`⚠️  Shutdown warning: ${error.message}`);
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Run the test
async function runPi5SimpleTest() {
    const test = new Pi5SimpleTest();
    
    // Handle shutdown gracefully
    process.on('SIGINT', async () => {
        console.log('\n🛑 Received interrupt signal...');
        await test.shutdown();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('\n🛑 Received terminate signal...');
        await test.shutdown();
        process.exit(0);
    });

    try {
        await test.initialize();
        await test.runTests();
        
    } catch (error) {
        console.log(`\n❌ TEST FAILED: ${error.message}`);
        console.log('\nTroubleshooting:');
        console.log('1. Ensure MQTT broker is running: sudo systemctl status mosquitto');
        console.log('2. Check media files exist in /opt/paradox/media/zone1/');
        console.log('3. Verify X11 is active: echo $XDG_SESSION_TYPE');
        console.log('4. Check audio device: aplay -l | grep vc4hdmi');
        
    } finally {
        await test.shutdown();
    }
}

if (require.main === module) {
    runPi5SimpleTest();
}

module.exports = { Pi5SimpleTest, pi5TestConfig };
