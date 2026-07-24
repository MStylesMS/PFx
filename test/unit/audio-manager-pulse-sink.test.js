jest.mock('child_process', () => ({
    spawn: jest.fn(),
    spawnSync: jest.fn()
}));

const { spawnSync } = require('child_process');
const AudioManager = require('../../lib/media/audio-manager');

const SINK = 'alsa_output.platform-fe00b840.mailbox.stereo-fallback';

function sinkListOutput(state) {
    return `Sink #0
\tState: ${state}
\tName: ${SINK}
`;
}

describe('AudioManager PulseAudio sink wake', () => {
    let manager;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-23T20:00:00Z'));
        spawnSync.mockReset();

        manager = new AudioManager({
            zoneId: 'pulse-sink-test',
            baseMediaPath: '/tmp',
            audioDevice: `pulse/${SINK}`
        });
        manager.logger = {
            debug: jest.fn(),
            warn: jest.fn(),
            info: jest.fn(),
            error: jest.fn()
        };
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('force wake runs pactl suspend and set-default-sink', () => {
        spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });

        manager._beforeAudioOutput({ force: true });

        expect(spawnSync).toHaveBeenCalledTimes(2);
        expect(spawnSync).toHaveBeenCalledWith('pactl', ['suspend-sink', SINK, '0'], expect.any(Object));
        expect(spawnSync).toHaveBeenCalledWith('pactl', ['set-default-sink', SINK], expect.any(Object));
    });

    test('skips pactl entirely during cooldown', () => {
        spawnSync.mockReturnValue({ status: 0, stdout: sinkListOutput('SUSPENDED'), stderr: '' });

        manager._beforeAudioOutput();
        spawnSync.mockClear();

        manager._beforeAudioOutput();

        expect(spawnSync).not.toHaveBeenCalled();
    });

    test('after cooldown, checks state but does not wake a RUNNING sink', () => {
        spawnSync.mockReturnValue({ status: 0, stdout: sinkListOutput('SUSPENDED'), stderr: '' });
        manager._beforeAudioOutput();
        expect(spawnSync).toHaveBeenCalledTimes(3);

        jest.advanceTimersByTime(5 * 60 * 1000 + 1);
        spawnSync.mockClear();
        spawnSync.mockReturnValue({ status: 0, stdout: sinkListOutput('RUNNING'), stderr: '' });

        manager._beforeAudioOutput();

        expect(spawnSync).toHaveBeenCalledTimes(1);
        expect(spawnSync).toHaveBeenCalledWith('pactl', ['list', 'sinks'], expect.any(Object));
    });

    test('no-op when audio device is not pulse', () => {
        manager.audioDevice = 'auto';

        manager._beforeAudioOutput({ force: true });

        expect(spawnSync).not.toHaveBeenCalled();
    });
});
