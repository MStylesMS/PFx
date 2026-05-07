/**
 * Integration test for per-zone ducking scenarios
 * Tests zone isolation and overlapping ducking behavior
 */

const BaseZone = require('../../lib/zones/base-zone');

// Mock implementation for testing zone isolation
class MockAudioZone extends BaseZone {
    constructor(config, mqttClient) {
        super(config, mqttClient);
        this.backgroundVolume = config.volume || 80;
        this.backgroundMusicPlaying = false;
    }

    async initialize() {
        this.isInitialized = true;
    }

    async handleCommand(command) {
        if (command.command === 'playSpeech') {
            await this.playSpeech(command.file, command.volume, command.ducking);
        }
    }

    async shutdown() {
        this.isInitialized = false;
    }

    _setBackgroundVolume(volume) {
        this.backgroundVolume = volume;
    }

    _getCurrentBackgroundVolume() {
        return this.backgroundVolume;
    }

    async playSpeech(audioPath, volume, ducking = -26) {
        const duckId = `speech-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        if (ducking < 0) {
            this._applyDucking(duckId, ducking);
        }
        
        // Simulate speech duration
        setTimeout(() => {
            if (ducking < 0) {
                this._removeDucking(duckId);
            }
        }, 100);

        return { success: true, duckId };
    }

    playBackgroundMusic() {
        this.backgroundMusicPlaying = true;
        this.backgroundVolume = this.config.volume || 80;
    }

    stopBackgroundMusic() {
        this.backgroundMusicPlaying = false;
    }
}

describe('Per-Zone Ducking Integration', () => {
    let zone1, zone2, zone3;
    let mockMqttClient;

    beforeEach(() => {
        mockMqttClient = {
            publish: jest.fn()
        };

        zone1 = new MockAudioZone({
            name: 'living-room',
            type: 'audio',
            volume: 80
        }, mockMqttClient);

        zone2 = new MockAudioZone({
            name: 'kitchen',
            type: 'audio', 
            volume: 70
        }, mockMqttClient);

        zone3 = new MockAudioZone({
            name: 'bedroom',
            type: 'audio',
            volume: 90
        }, mockMqttClient);
    });

    describe('Zone Isolation', () => {
        test('ducking in one zone should not affect other zones', async () => {
            // All zones start with their own volumes
            expect(zone1.backgroundVolume).toBe(80);
            expect(zone2.backgroundVolume).toBe(70);
            expect(zone3.backgroundVolume).toBe(90);

            // Apply ducking only to zone1
            zone1._applyDucking('speech-1', -30);

            // Zone1 should be ducked, others unaffected
            expect(zone1.backgroundVolume).toBe(50); // 80 + (-30)
            expect(zone2.backgroundVolume).toBe(70); // unchanged
            expect(zone3.backgroundVolume).toBe(90); // unchanged
        });

        test('multiple zones can have independent ducking', async () => {
            // Apply different ducking levels to different zones
            zone1._applyDucking('speech-1', -20);
            zone2._applyDucking('video-1', -40);
            zone3._applyDucking('speech-2', -60);

            // Each zone should have its own ducking applied
            expect(zone1.backgroundVolume).toBe(60); // 80 + (-20)
            expect(zone2.backgroundVolume).toBe(30); // 70 + (-40)  
            expect(zone3.backgroundVolume).toBe(30); // 90 + (-60)
        });
    });

    describe('Overlapping Ducking Within Zone', () => {
        test('should use maximum ducking level across overlapping requests', async () => {
            // Start with background music
            zone1.playBackgroundMusic();

            // Apply multiple overlapping ducking requests
            const result1 = await zone1.playSpeech('hint1.mp3', 80, -20);
            zone1._applyDucking('video-1', -40);
            const result2 = await zone1.playSpeech('hint2.mp3', 80, -10);

            // Should use the maximum ducking level (most negative: -40)
            expect(zone1.backgroundVolume).toBe(40); // 80 + (-40)

            // Remove the highest ducker
            zone1._removeDucking('video-1');

            // Should now use the next highest (-20)
            expect(zone1.backgroundVolume).toBe(60); // 80 + (-20)
        });

        test('should restore original volume when all duckers removed', async () => {
            const originalVolume = zone1.backgroundVolume;

            // Apply multiple duckers
            zone1._applyDucking('speech-1', -25);
            zone1._applyDucking('video-1', -50);
            zone1._applyDucking('speech-2', -15);

            expect(zone1.backgroundVolume).not.toBe(originalVolume);

            // Remove all duckers
            zone1._removeDucking('speech-1');
            zone1._removeDucking('video-1');
            zone1._removeDucking('speech-2');

            // Should restore original volume
            expect(zone1.backgroundVolume).toBe(originalVolume);
            expect(zone1._baseBackgroundVolume).toBe(null);
        });
    });

    describe('Real-world Scenarios', () => {
        test('should handle speech interrupting video in same zone', async () => {
            // Start background music
            zone1.playBackgroundMusic();
            expect(zone1.backgroundVolume).toBe(80);

            // Start video with ducking
            zone1._applyDucking('video-1', -20);
            expect(zone1.backgroundVolume).toBe(60); // 80 + (-20)

            // Speech interrupts with higher ducking
            const speechResult = await zone1.playSpeech('urgent.mp3', 90, -50);
            expect(zone1.backgroundVolume).toBe(30); // 80 + (-50) (most negative level)

            // Speech ends
            zone1._removeDucking(speechResult.duckId);
            expect(zone1.backgroundVolume).toBe(60); // Back to video level (80 + (-20))

            // Video ends
            zone1._removeDucking('video-1');
            expect(zone1.backgroundVolume).toBe(80); // Restored
        });

        test('should handle concurrent speech in multiple zones', async () => {
            // All zones playing background music
            zone1.playBackgroundMusic();
            zone2.playBackgroundMusic();
            zone3.playBackgroundMusic();

            // Concurrent speech in all zones with different ducking levels
            await zone1.playSpeech('announce1.mp3', 80, -30);
            await zone2.playSpeech('announce2.mp3', 80, -40);
            await zone3.playSpeech('announce3.mp3', 80, -15);

            // Each zone should have its own ducking level
            expect(zone1.backgroundVolume).toBe(50); // 80 + (-30)
            expect(zone2.backgroundVolume).toBe(30); // 70 + (-40)
            expect(zone3.backgroundVolume).toBe(75); // 90 + (-15)

            // Zones should be independent
            zone1._removeDucking(Object.keys(zone1._getDuckingStatus().activeDucks)[0]);
            expect(zone1.backgroundVolume).toBe(80); // Restored
            expect(zone2.backgroundVolume).toBe(30); // Still ducked
            expect(zone3.backgroundVolume).toBe(75); // Still ducked
        });

        test('should handle rapid fire ducking requests', async () => {
            // Simulate rapid fire sound effects and speech
            for (let i = 0; i < 10; i++) {
                zone1._applyDucking(`effect-${i}`, -(Math.random() * 80 + 5)); // Random negative values -5 to -85
            }

            // Should handle all requests
            expect(zone1._activeDucks.size).toBe(10);

            // Remove all
            const duckIds = Array.from(zone1._activeDucks.keys());
            duckIds.forEach(id => zone1._removeDucking(id));

            // Should be clean
            expect(zone1._activeDucks.size).toBe(0);
            expect(zone1._baseBackgroundVolume).toBe(null);
        });
    });

    describe('Edge Cases', () => {
        test('should handle zone with no background music', async () => {
            // Zone without background music
            zone1.backgroundMusicPlaying = false;

            // Apply ducking - should work but have no effect
            zone1._applyDucking('speech-1', -30);
            
            // Volume methods should still be called safely
            expect(() => zone1._setBackgroundVolume(40)).not.toThrow();
        });

        test('should handle removing duckers in different order than added', async () => {
            // Add duckers in one order
            zone1._applyDucking('first', -20);
            zone1._applyDucking('second', -40);
            zone1._applyDucking('third', -10);
            zone1._applyDucking('fourth', -60);

            expect(zone1.backgroundVolume).toBe(20); // 80 + (-60) (most negative)

            // Remove in different order
            zone1._removeDucking('second');
            expect(zone1.backgroundVolume).toBe(20); // Still using most negative (-60)

            zone1._removeDucking('fourth');
            expect(zone1.backgroundVolume).toBe(60); // Now using -20

            zone1._removeDucking('first');
            expect(zone1.backgroundVolume).toBe(70); // Now using -10

            zone1._removeDucking('third');
            expect(zone1.backgroundVolume).toBe(80); // Restored
        });
    });
});