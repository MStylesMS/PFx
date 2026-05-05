const AudioManager = require('../../lib/media/audio-manager');

describe('AudioManager fade helpers', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('fadeBackgroundMusic completes and clears tracked fade state', async () => {
        const manager = new AudioManager({ zoneId: 'audio-fade-test', baseMediaPath: '/tmp' });
        manager.isInitialized = true;
        manager._sendMpvCommand = jest.fn().mockResolvedValue({ data: 80, error: 'success' });

        const setBackgroundMusicVolume = jest.spyOn(manager, 'setBackgroundMusicVolume').mockResolvedValue();
        const callback = jest.fn().mockResolvedValue();

        const result = await manager.fadeBackgroundMusic(20, 1000, callback);

        expect(result.success).toBe(true);
        expect(manager._activeBackgroundFade).not.toBeNull();

        await jest.advanceTimersByTimeAsync(1000);

        expect(setBackgroundMusicVolume).toHaveBeenCalled();
        expect(setBackgroundMusicVolume).toHaveBeenLastCalledWith(20);
        expect(manager._activeBackgroundFade).toBeNull();
        expect(callback).toHaveBeenCalledTimes(1);
    });

    test('fadeSpeech completes and clears tracked fade state', async () => {
        const manager = new AudioManager({ zoneId: 'speech-fade-test', baseMediaPath: '/tmp' });
        manager.isInitialized = true;
        manager._sendMpvCommand = jest.fn()
            .mockResolvedValueOnce({ data: 75, error: 'success' })
            .mockResolvedValue({ error: 'success' });

        const callback = jest.fn().mockResolvedValue();

        const result = await manager.fadeSpeech(15, 1000, callback);

        expect(result.success).toBe(true);
        expect(manager._activeSpeechFade).not.toBeNull();

        await jest.advanceTimersByTimeAsync(1000);

        expect(manager._sendMpvCommand).toHaveBeenLastCalledWith(manager.speechSocket, {
            command: ['set_property', 'volume', 15]
        });
        expect(manager._activeSpeechFade).toBeNull();
        expect(callback).toHaveBeenCalledTimes(1);
    });
});