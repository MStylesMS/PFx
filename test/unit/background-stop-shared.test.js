jest.mock('../../lib/media/audio-manager');
jest.mock('../../lib/utils/logger');

const AudioZone = require('../../lib/zones/audio-zone');
const ScreenZone = require('../../lib/zones/screen-zone');
const AudioManager = require('../../lib/media/audio-manager');

function makeMockAudioManager() {
    return {
        initialize: jest.fn().mockResolvedValue(),
        playBackgroundMusic: jest.fn().mockResolvedValue({ success: true }),
        setBackgroundMusicVolume: jest.fn().mockResolvedValue(true),
        pauseBackgroundMusic: jest.fn(),
        resumeBackgroundMusic: jest.fn(),
        stopBackgroundMusic: jest.fn().mockResolvedValue(true),
        fadeBackgroundMusic: jest.fn().mockResolvedValue({ success: true }),
        playSpeech: jest.fn().mockResolvedValue({ success: true }),
        clearSpeechQueue: jest.fn().mockResolvedValue(),
        fadeSpeech: jest.fn(),
        skipSpeech: jest.fn(),
        pauseSpeech: jest.fn(),
        resumeSpeech: jest.fn(),
        checkAndRestartProcesses: jest.fn().mockResolvedValue(true)
    };
}

function makeAudioConfig() {
    return {
        name: 'audio-stop-test',
        type: 'audio',
        baseTopic: 'test/audio',
        volume: 80,
        mediaBasePath: '/opt/paradox/media'
    };
}

function makeScreenConfig() {
    return {
        name: 'screen-stop-test',
        type: 'screen',
        baseTopic: 'test/screen',
        volume: 80,
        mediaBasePath: '/opt/paradox/media'
    };
}

describe('Shared background stop flow', () => {
    beforeEach(() => {
        AudioManager.mockImplementation(makeMockAudioManager);
    });

    test('AudioZone stopBackground resets state and publishes event', async () => {
        const mqtt = { publish: jest.fn() };
        const zone = new AudioZone(makeAudioConfig(), mqtt, null);
        zone.currentState.backgroundMusic = { playing: true, file: 'bg.mp3', volume: 80, isDucked: true };
        zone.mpvInstances.background = { currentFile: 'bg.mp3', status: 'playing' };

        await zone._stopBackgroundMusic(0);

        expect(zone.audioManager.stopBackgroundMusic).toHaveBeenCalledTimes(1);
        expect(zone.currentState.backgroundMusic).toEqual({ playing: false, file: null, volume: 80, isDucked: false });
        expect(zone.mpvInstances.background.status).toBe('idle');
        expect(mqtt.publish).toHaveBeenCalledWith('test/audio/events', expect.objectContaining({ command: 'stopBackground' }), {});
    });

    test('ScreenZone fade stopBackground uses shared fade callback and resets state', async () => {
        const mqtt = { publish: jest.fn() };
        const zone = new ScreenZone(makeScreenConfig(), mqtt, null);
        zone.currentState.backgroundMusic = 'bg.mp3';
        zone.mpvInstances.background = { currentFile: 'bg.mp3', status: 'playing' };
        zone.audioManager.fadeBackgroundMusic.mockImplementation(async (_target, _duration, callback) => {
            await callback();
            return { success: true };
        });

        await zone._stopBackgroundMusic(2);

        expect(zone.audioManager.fadeBackgroundMusic).toHaveBeenCalledWith(0, 2000, expect.any(Function));
        expect(zone.audioManager.stopBackgroundMusic).toHaveBeenCalledTimes(1);
        expect(zone.currentState.backgroundMusic).toBeNull();
        expect(zone.mpvInstances.background.status).toBe('idle');
        expect(mqtt.publish).toHaveBeenCalledWith('test/screen/events', expect.objectContaining({ command: 'stopBackground' }), {});
    });
});