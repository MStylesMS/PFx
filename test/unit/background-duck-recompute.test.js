/**
 * Background Duck Recompute Integration (Unit-Level) Test
 *
 * Verifies Phase 8 runtime behavior:
 *  - Background volume resolved via resolver.
 *  - Speech trigger activates duckLifecycle, recomputes background effective volume.
 *  - After speech ends, background recomputes back to pre-duck value.
 *  - adjustVolume precedence & skipDucking honored.
 */

const AudioZone = require('../../lib/zones/audio-zone');

// Mocks
jest.mock('../../lib/media/audio-manager');
jest.mock('../../lib/utils/logger');

const AudioManager = require('../../lib/media/audio-manager');

function makeMockAudioManager() {
    return {
        initialize: jest.fn().mockResolvedValue(),
        playBackgroundMusic: jest.fn().mockResolvedValue({ success: true }),
        setBackgroundMusicVolume: jest.fn().mockResolvedValue(true),
        pauseBackgroundMusic: jest.fn(),
        resumeBackgroundMusic: jest.fn(),
        stopBackgroundMusic: jest.fn(),
        fadeBackgroundMusic: jest.fn(),
        playSpeech: jest.fn().mockResolvedValue({ success: true }),
        clearSpeechQueue: jest.fn().mockResolvedValue(),
        fadeSpeech: jest.fn(),
        skipSpeech: jest.fn(),
        pauseSpeech: jest.fn(),
        resumeSpeech: jest.fn(),
        checkAndRestartProcesses: jest.fn().mockResolvedValue(true)
    };
}

describe('Phase 8 Background Duck Recompute', () => {
    let zone; let mockMqtt;
    beforeEach(async () => {
        AudioManager.mockImplementation(makeMockAudioManager);
        mockMqtt = { publish: jest.fn() };
        zone = new AudioZone({
            name: 'zone-test',
            baseTopic: 'test/zone',
            background_volume: 100,
            speech_volume: 90,
            effects_volume: 80,
            ducking_adjust: -50, // 50% reduction when ducked
            max_volume: 150
        }, mockMqtt, {});

        // Bypass file existence check
        zone._validateMediaFile = jest.fn().mockResolvedValue({ exists: true, path: '/tmp/audio.mp3' });

        await zone.initialize();
    });

    test('background volume recomputes on speech duck lifecycle', async () => {
        // Start background music with adjustVolume -20% (should yield 80 pre-duck, then maybe duck to 40 when speech starts)
        await zone._playBackgroundMusic('/tmp/audio.mp3', { adjustVolume: -20 });

        // Capture pre-duck call volume (last call to playBackgroundMusic)
        const mgr = zone.audioManager;
        const initialSetCalls = mgr.playBackgroundMusic.mock.calls;
        expect(initialSetCalls.length).toBe(1);
        // final requested volume from resolver
        const initialResolvedVolume = initialSetCalls[0][1];
        expect(initialResolvedVolume).toBe(80); // 100 base * 0.8

        // Spy on setBackgroundMusicVolume for recompute adjustments
        const setVolSpy = mgr.setBackgroundMusicVolume;

        // Play speech which should trigger ducking (default code path adds duck trigger)
        await zone._playSpeech('/tmp/audio.mp3', undefined, -26); // explicit negative duck to ensure trigger

    // Allow queued microtasks (speech completion cleanup) to publish restore event
    await new Promise(resolve => setImmediate(resolve));

    // Expect a recompute event publishing ducked volume 40 and then restoration event to 80
    const publishPayloads = mockMqtt.publish.mock.calls.map(c => c[1]);
        const duckEvent = publishPayloads.find(p => p && p.background_volume_recomputed && p.effective_volume === 40);
        expect(duckEvent).toBeTruthy();
        const restoreEvent = publishPayloads.reverse().find(p => p && p.background_volume_recomputed && p.effective_volume === 80);
        expect(restoreEvent).toBeTruthy();
    });

    test('skipDucking keeps background at pre-duck volume during speech', async () => {
        await zone._playBackgroundMusic('/tmp/audio.mp3', { adjustVolume: -10 }); // 100 -> 90
        const mgr = zone.audioManager;
        const setVolSpy = mgr.setBackgroundMusicVolume;

        // Speech with skipDucking: implement by giving ducking param >=0 (no trigger)
        await zone._playSpeech('/tmp/audio.mp3', undefined, 0);

        // No recompute call to a ducked value (e.g., 45) should exist
        const anyDucked = setVolSpy.mock.calls.find(c => c[0] < 80); // would indicate ducking applied
        expect(anyDucked).toBeFalsy();
    });

    test('absolute volume overrides adjustVolume warning path (volume wins)', async () => {
        // Provide both volume and adjustVolume; resolver should ignore adjustVolume and use absolute
        await zone._playBackgroundMusic('/tmp/audio.mp3', { volume: 120, adjustVolume: -30 });
        const mgr = zone.audioManager;
        const playCall = mgr.playBackgroundMusic.mock.calls.pop();
        const usedVolume = playCall[1];
        expect(usedVolume).toBe(120); // absolute wins
    });
});
