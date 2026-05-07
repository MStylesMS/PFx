const ScreenZone = require('../../lib/zones/screen-zone');

jest.mock('../../lib/media/audio-manager');
jest.mock('../../lib/utils/logger');
jest.mock('../../lib/utils/screen-power-manager', () => {
    return jest.fn().mockImplementation(() => ({
        autoWakeForMedia: jest.fn().mockResolvedValue(),
        shouldWakeForAudio: jest.fn().mockReturnValue(false)
    }));
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

const AudioManager = require('../../lib/media/audio-manager');

function makeMockAudioManager() {
    return {
        initialize: jest.fn().mockResolvedValue(),
        playBackgroundMusic: jest.fn().mockResolvedValue({ success: true }),
        setBackgroundMusicVolume: jest.fn().mockResolvedValue(true),
        pauseBackgroundMusic: jest.fn().mockResolvedValue(true),
        resumeBackgroundMusic: jest.fn().mockResolvedValue(true),
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

function makeZone() {
    const mqtt = { publish: jest.fn() };
    const zone = new ScreenZone({
        name: 'screen-parity',
        baseTopic: 'test/screen-parity',
        baseVolumes: {
            background: 100,
            speech: 90,
            effects: 80,
            video: 95
        },
        duckingAdjust: -50,
        background_volume: 100,
        speech_volume: 90,
        effects_volume: 80,
        video_volume: 95,
        ducking_adjust: -50,
        volume: 80,
        max_volume: 150
    }, mqtt, {});

    zone._validateMediaFile = jest.fn().mockResolvedValue({ exists: true, path: '/tmp/audio.mp3' });
    zone.mpvInstances.background = { currentFile: null, status: 'idle' };

    return { zone, mqtt };
}

describe('ScreenZone background parity', () => {
    beforeEach(() => {
        AudioManager.mockImplementation(makeMockAudioManager);
    });

    test('playBackground honors absolute volume over adjustVolume', async () => {
        const { zone } = makeZone();

        await zone._playBackgroundMusic('/tmp/audio.mp3', { volume: 120, adjustVolume: -30 });

        const playCall = zone.audioManager.playBackgroundMusic.mock.calls.pop();
        expect(playCall[1]).toBe(120);
    });

    test('pause and resume background publish lifecycle events', async () => {
        const { zone, mqtt } = makeZone();
        zone.currentState.backgroundMusic = 'bg.mp3';
        zone.mpvInstances.background.currentFile = 'bg.mp3';
        zone.mpvInstances.background.status = 'playing';

        await zone._pauseBackgroundMusic();
        await zone._resumeBackgroundMusic();

        expect(zone.audioManager.pauseBackgroundMusic).toHaveBeenCalledTimes(1);
        expect(zone.audioManager.resumeBackgroundMusic).toHaveBeenCalledTimes(1);

        const payloads = mqtt.publish.mock.calls.map(call => call[1]);
        expect(payloads.find(payload => payload && payload.background_music_paused)).toBeTruthy();
        expect(payloads.find(payload => payload && payload.background_music_resumed)).toBeTruthy();
        expect(zone.mpvInstances.background.status).toBe('playing');
    });

    test('background recompute publishes effective volume telemetry', async () => {
        const { zone, mqtt } = makeZone();
        zone.currentState.backgroundMusic = 'bg.mp3';
        zone.mpvInstances.background.currentFile = 'bg.mp3';
        zone.mpvInstances.background.status = 'playing';
        zone._backgroundPlayContext = { command: { adjustVolume: -20 } };
        zone.getDuckActive = jest.fn().mockReturnValue(true);

        await zone._recomputeBackgroundAfterDuckChange();

        expect(zone.audioManager.setBackgroundMusicVolume).toHaveBeenCalledWith(40);
        const payloads = mqtt.publish.mock.calls.map(call => call[1]);
        expect(payloads.find(payload => payload && payload.background_volume_recomputed && payload.effective_volume === 40)).toBeTruthy();
    });
});