/**
 * Phase 9 Telemetry Tests
 *
 * Verifies that playback command outcomes / events include effective volume telemetry fields.
 */

const AudioZone = require('../../lib/zones/audio-zone');
const ScreenZone = require('../../lib/zones/screen-zone');

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
        playSoundEffect: jest.fn().mockResolvedValue({ success: true }),
        checkAndRestartProcesses: jest.fn().mockResolvedValue(true)
    };
}

// Minimal screen zone supporting only video background recompute patch points.
jest.mock('../../lib/utils/screen-power-manager', () => {
    return jest.fn().mockImplementation(() => ({ autoWakeForMedia: jest.fn().mockResolvedValue() }));
});

jest.mock('../../lib/media/mpv-zone-manager', () => {
    return jest.fn().mockImplementation(() => ({
        loadMedia: jest.fn().mockResolvedValue(true),
        play: jest.fn().mockResolvedValue(true),
        pause: jest.fn().mockResolvedValue(true),
        stop: jest.fn().mockResolvedValue(true),
        setVolume: jest.fn().mockResolvedValue(true)
    }));
});

// Shared helpers
function makeMockMqtt() {
    return { publish: jest.fn() };
}

// Bypass actual file validation
function stubValidate(zone) {
    zone._validateMediaFile = jest.fn().mockImplementation((p) => {
        if (!p) {
            return { exists: false, error: 'Media path is required' };
        }
        return { exists: true, path: p.startsWith('/tmp') ? p : '/tmp/' + p };
    });
}

describe('Phase 9 Telemetry', () => {
    beforeEach(() => {
        AudioManager.mockImplementation(makeMockAudioManager);
    });

    test('AudioZone playBackground telemetry fields present', async () => {
        const mqtt = makeMockMqtt();
        const zone = new AudioZone({ name: 'az', baseTopic: 't/az', background_volume: 100, speech_volume: 90, effects_volume: 80, ducking_adjust: -40 }, mqtt, {});
        stubValidate(zone);
        await zone.initialize();
        await zone.handleCommand({ command: 'playBackground', file: 'music.mp3', adjustVolume: -20 });
        const outcome = mqtt.publish.mock.calls.find(c => JSON.stringify(c[1]).includes('playBackground') && /"outcome":"success"/.test(JSON.stringify(c[1])));
        expect(outcome).toBeTruthy();
        const payload = outcome[1];
        expect(payload.parameters.effective_volume).toBeDefined();
        expect(payload.parameters.pre_duck_volume).toBeDefined();
        expect(payload.parameters.ducked).toBeDefined();
    });

    test('AudioZone speech warning includes telemetry when both volume & adjustVolume', async () => {
        const mqtt = makeMockMqtt();
        const zone = new AudioZone({ name: 'az2', baseTopic: 't/az2', background_volume: 100, speech_volume: 90, ducking_adjust: -30 }, mqtt, {});
        stubValidate(zone);
        await zone.initialize();
        await zone.handleCommand({ command: 'playSpeech', file: 'line1.mp3', volume: 120, adjustVolume: -25 });
        const warning = mqtt.publish.mock.calls.find(c => /playSpeech/.test(JSON.stringify(c[1])) && /"outcome":"warning"/.test(JSON.stringify(c[1])));
        expect(warning).toBeTruthy();
        const payload = warning[1];
        expect(payload.parameters.effective_volume).toBeDefined();
        expect(payload.parameters.pre_duck_volume).toBeDefined();
    });

    test('Sound effect telemetry presence', async () => {
        const mqtt = makeMockMqtt();
        const zone = new AudioZone({ name: 'az3', baseTopic: 't/az3', background_volume: 100, effects_volume: 80 }, mqtt, {});
        stubValidate(zone);
        await zone.initialize();
        await zone.handleCommand({ command: 'playSoundEffect', file: 'boom.mp3', volume: 140 });
        const success = mqtt.publish.mock.calls.find(c => /playSoundEffect/.test(JSON.stringify(c[1])) && /"outcome":"success"/.test(JSON.stringify(c[1])));
        expect(success).toBeTruthy();
        const payload = success[1];
        expect(payload.parameters.effective_volume).toBeDefined();
    });

    test('ScreenZone sound effect telemetry event presence', async () => {
        const mqtt = makeMockMqtt();
        const zone = new ScreenZone({
            name: 'sz1',
            baseTopic: 't/sz1',
            baseVolumes: { background: 100, speech: 90, effects: 80, video: 95 },
            duckingAdjust: -40,
            background_volume: 100,
            speech_volume: 90,
            effects_volume: 80,
            video_volume: 95
        }, mqtt, {});
        stubValidate(zone);
        await zone._playSoundEffect('boom.mp3', { volume: 140 });
        const eventCall = mqtt.publish.mock.calls.find(c => /sound_effect_played/.test(JSON.stringify(c[1])));
        expect(eventCall).toBeTruthy();
        const payload = eventCall[1];
        expect(payload.volume).toBeDefined();
        expect(payload.pre_duck).toBeDefined();
    });

    test('AudioZone ignores deprecated audio field for speech playback', async () => {
        const mqtt = makeMockMqtt();
        const zone = new AudioZone({ name: 'az4', baseTopic: 't/az4', speech_volume: 90 }, mqtt, {});
        stubValidate(zone);
        await zone.initialize();

        await expect(zone.handleCommand({ command: 'playSpeech', audio: 'legacy.mp3', volume: 80 })).rejects.toThrow('Speech path is required');

        expect(zone.audioManager.playSpeech).not.toHaveBeenCalled();
    });

    test('ScreenZone ignores deprecated audio field for sound effect playback', async () => {
        const mqtt = makeMockMqtt();
        const zone = new ScreenZone({ name: 'sz2', baseTopic: 't/sz2', effects_volume: 80 }, mqtt, {});
        stubValidate(zone);
        zone.isInitialized = true;

        await expect(zone.handleCommand({ command: 'playAudioFX', audio: 'legacy.wav', volume: 80 })).rejects.toThrow('Sound effect path is required');

        expect(zone.audioManager.playSoundEffect).not.toHaveBeenCalled();
    });
});
