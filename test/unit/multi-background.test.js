const fs = require('fs');
const AudioManager = require('../../lib/media/audio-manager');
const AudioZone = require('../../lib/zones/audio-zone');

jest.mock('../../lib/utils/logger');

function fakeProcess() {
    return {
        killed: false,
        stdout: null,
        stderr: null,
        on: jest.fn(),
        once: jest.fn((event, handler) => {
            if (event === 'exit') {
                setImmediate(handler);
            }
        }),
        unref: jest.fn(),
        kill: jest.fn()
    };
}

function mockMpv(manager) {
    manager._sendMpvCommand = jest.fn().mockImplementation(async (_socket, cmd) => {
        const [name, prop] = cmd.command;
        if (name === 'get_property') {
            if (prop === 'pause') return { data: false, error: 'success' };
            if (prop === 'time-pos') return { data: 12, error: 'success' };
            if (prop === 'duration') return { data: 24, error: 'success' };
            if (prop === 'volume') return { data: 70, error: 'success' };
        }
        return { error: 'success' };
    });
    manager._waitForSocket = jest.fn().mockResolvedValue(true);
    manager._spawnIdleMpv = jest.fn().mockImplementation(async (socket) => {
        const proc = fakeProcess();
        proc.socket = socket;
        return proc;
    });
}

function makeManager() {
    const manager = new AudioManager({
        zoneId: 'multi-bg',
        baseMediaPath: '/opt/paradox/media'
    });
    manager.isInitialized = true;
    mockMpv(manager);
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    return manager;
}

describe('AudioManager multiple backgrounds', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('second playBackground with a new id starts and warns', async () => {
        const manager = makeManager();

        const first = await manager.playBackgroundMusic('/opt/paradox/media/generator/background.mp3', 70, true, { id: 'room' });
        const second = await manager.playBackgroundMusic('/opt/paradox/media/generator/gen_loop.mp3', 70, true, { id: 'generator' });

        expect(first.success).toBe(true);
        expect(first.warning).toBeUndefined();
        expect(second.success).toBe(true);
        expect(second.warning).toBe(true);
        expect(second.warning_type).toBe('multiple_backgrounds');
        expect(second.background_count).toBe(2);
        expect(second.background_ids).toEqual(expect.arrayContaining(['room', 'generator']));
        expect(manager.backgrounds.size).toBe(2);
    });

    test('same id replaces with no warning', async () => {
        const manager = makeManager();

        await manager.playBackgroundMusic('/opt/paradox/media/generator/background.mp3', 70, true, { id: 'room' });
        const replaced = await manager.playBackgroundMusic('/opt/paradox/media/generator/other.mp3', 60, true, { id: 'room' });

        expect(replaced.success).toBe(true);
        expect(replaced.warning).toBeUndefined();
        expect(manager.backgrounds.size).toBe(1);
        expect(manager.backgrounds.get('room').file).toBe('/opt/paradox/media/generator/other.mp3');
    });

    test('overlapping identical playBackground coalesces to one spawn', async () => {
        const manager = makeManager();
        let releaseSpawn;
        const spawnGate = new Promise((resolve) => { releaseSpawn = resolve; });
        let spawnCalls = 0;
        manager._spawnIdleMpv = jest.fn().mockImplementation(async (socket) => {
            spawnCalls += 1;
            await spawnGate;
            const proc = fakeProcess();
            proc.socket = socket;
            return proc;
        });

        const first = manager.playBackgroundMusic('/opt/paradox/media/generator/gen_loop.mp3', 70, true, { id: 'generator' });
        const second = manager.playBackgroundMusic('/opt/paradox/media/generator/gen_loop.mp3', 70, true, { id: 'generator' });
        // Let both enter playBackground before the spawn finishes.
        await Promise.resolve();
        expect(spawnCalls).toBe(1);
        releaseSpawn();

        const [a, b] = await Promise.all([first, second]);
        expect(a.success).toBe(true);
        expect(b.success).toBe(true);
        expect(manager._spawnIdleMpv).toHaveBeenCalledTimes(1);
        expect(manager.backgrounds.size).toBe(1);
    });

    test('identical playBackground within dedupe window is ignored', async () => {
        const manager = makeManager();
        manager._backgroundDedupMs = 1000;

        await manager.playBackgroundMusic('/opt/paradox/media/generator/gen_loop.mp3', 70, true, { id: 'generator' });
        const loadCallsAfterFirst = manager._sendMpvCommand.mock.calls.filter(
            ([, cmd]) => cmd.command && cmd.command[0] === 'loadfile'
        ).length;

        const dup = await manager.playBackgroundMusic('/opt/paradox/media/generator/gen_loop.mp3', 70, true, { id: 'generator' });
        const loadCallsAfterDup = manager._sendMpvCommand.mock.calls.filter(
            ([, cmd]) => cmd.command && cmd.command[0] === 'loadfile'
        ).length;

        expect(dup.success).toBe(true);
        expect(dup.info).toBe('Duplicate ignored');
        expect(loadCallsAfterDup).toBe(loadCallsAfterFirst);
        expect(manager._spawnIdleMpv).toHaveBeenCalledTimes(1);
    });

    test('same id with a different file still replaces after first start', async () => {
        const manager = makeManager();
        await manager.playBackgroundMusic('/opt/paradox/media/generator/gen_loop.mp3', 70, true, { id: 'generator' });
        const replaced = await manager.playBackgroundMusic('/opt/paradox/media/generator/other.mp3', 70, true, { id: 'generator' });

        expect(replaced.success).toBe(true);
        expect(replaced.info).toBeUndefined();
        expect(manager.backgrounds.get('generator').file).toBe('/opt/paradox/media/generator/other.mp3');
        expect(manager._spawnIdleMpv).toHaveBeenCalledTimes(1);
    });

    test('omitted id uses default and still works as a single bed', async () => {
        const manager = makeManager();

        const result = await manager.playBackgroundMusic('/opt/paradox/media/ambient.mp3', 70, true);
        expect(result.success).toBe(true);
        expect(result.id).toBe('default');
        expect(result.warning).toBeUndefined();
        expect(manager.backgrounds.has('default')).toBe(true);
    });

    test('stopBackground {id} leaves the other bed', async () => {
        const manager = makeManager();
        await manager.playBackgroundMusic('/opt/paradox/media/generator/background.mp3', 70, true, { id: 'room' });
        await manager.playBackgroundMusic('/opt/paradox/media/generator/gen_loop.mp3', 70, true, { id: 'generator' });

        const result = await manager.stopBackgroundMusic({ id: 'generator' });

        expect(result.warning).toBeUndefined();
        expect(result.stopped).toEqual(['generator']);
        expect(manager.backgrounds.has('room')).toBe(true);
        expect(manager.backgrounds.get('room').file).toBe('/opt/paradox/media/generator/background.mp3');
        expect(manager.backgrounds.has('generator')).toBe(false);
    });

    test('stopBackground with no id stops all', async () => {
        const manager = makeManager();
        await manager.playBackgroundMusic('/opt/paradox/media/generator/background.mp3', 70, true, { id: 'room' });
        await manager.playBackgroundMusic('/opt/paradox/media/generator/gen_loop.mp3', 70, true, { id: 'generator' });

        const result = await manager.stopBackgroundMusic();

        expect(result.stopped).toEqual(expect.arrayContaining(['room', 'generator']));
        expect(manager._activeBackgroundBeds()).toHaveLength(0);
    });

    test('duck applies to both beds', async () => {
        const manager = makeManager();
        await manager.playBackgroundMusic('/opt/paradox/media/generator/background.mp3', 70, true, { id: 'room' });
        await manager.playBackgroundMusic('/opt/paradox/media/generator/gen_loop.mp3', 70, true, { id: 'generator' });

        await manager.setBackgroundMusicVolume(40);

        const volumeSets = manager._sendMpvCommand.mock.calls.filter(call =>
            call[1].command[0] === 'set_property' && call[1].command[1] === 'volume' && call[1].command[2] === 40
        );
        const sockets = volumeSets.map(call => call[0]);
        expect(sockets).toEqual(expect.arrayContaining([
            manager.backgrounds.get('room').socket,
            manager.backgrounds.get('generator').socket
        ]));
    });

    test('audioStatus lists both beds plus current speech and queue', async () => {
        const manager = makeManager();
        await manager.playBackgroundMusic('/opt/paradox/media/generator/background.mp3', 70, true, {
            id: 'room',
            displayFile: 'generator/background.mp3'
        });
        await manager.playBackgroundMusic('/opt/paradox/media/generator/gen_loop.mp3', 70, true, {
            id: 'generator',
            displayFile: 'generator/gen_loop.mp3'
        });

        manager.currentSpeechFile = '/opt/paradox/media/generator/genStart.mp3';
        manager._currentSpeechItem = {
            id: 'genStart',
            filePath: '/opt/paradox/media/generator/genStart.mp3',
            displayFile: 'generator/genStart.mp3'
        };
        manager.speechQueue = [{
            id: 'hurry',
            filePath: '/opt/paradox/media/generator/hurry.mp3',
            displayFile: 'generator/hurry.mp3'
        }];

        const status = await manager.getAudioStatus();

        expect(status.backgrounds).toHaveLength(2);
        expect(status.backgrounds.map(bed => bed.id)).toEqual(expect.arrayContaining(['room', 'generator']));
        expect(status.backgrounds[0]).toEqual(expect.objectContaining({
            state: 'playing',
            time_left_s: 12,
            duration_s: 24,
            loop: true
        }));
        expect(status.speech.current).toEqual(expect.objectContaining({
            id: 'genStart',
            file: 'generator/genStart.mp3',
            state: 'playing',
            time_left_s: 12,
            duration_s: 24
        }));
        expect(status.speech.queue).toEqual([
            expect.objectContaining({
                id: 'hurry',
                file: 'generator/hurry.mp3',
                state: 'queued',
                time_left_s: null,
                duration_s: null
            })
        ]);
    });

    test('stopSpeech {file} drops one queued item without clearing the rest', async () => {
        const manager = makeManager();
        manager.speechQueue = [
            {
                id: 'hurry',
                filePath: '/opt/paradox/media/generator/hurry.mp3',
                displayFile: 'generator/hurry.mp3',
                _settled: false,
                _reject: jest.fn()
            },
            {
                id: 'later',
                filePath: '/opt/paradox/media/generator/later.mp3',
                displayFile: 'generator/later.mp3',
                _settled: false,
                _reject: jest.fn()
            }
        ];

        const result = await manager.stopSpeech({ file: 'generator/hurry.mp3' });

        expect(result.success).toBe(true);
        expect(result.stopped).toBe('hurry');
        expect(manager.speechQueue).toHaveLength(1);
        expect(manager.speechQueue[0].id).toBe('later');
    });

    test('unknown stopBackground id warns and changes nothing', async () => {
        const manager = makeManager();
        await manager.playBackgroundMusic('/opt/paradox/media/generator/background.mp3', 70, true, { id: 'room' });

        const result = await manager.stopBackgroundMusic({ id: 'missing' });

        expect(result.warning).toBe(true);
        expect(result.warning_type).toBe('unknown_background');
        expect(manager.backgrounds.get('room').file).toBeTruthy();
    });
});

describe('AudioZone multiple background command outcomes', () => {
    function makeZone() {
        const mqtt = { publish: jest.fn() };
        const zone = new AudioZone({
            name: 'audio-multi',
            baseTopic: 'test/audio-multi',
            volume: 80,
            mediaBasePath: '/opt/paradox/media'
        }, mqtt, null);
        zone.audioManager.playBackgroundMusic = jest.fn()
            .mockResolvedValueOnce({ success: true, id: 'room', background_count: 1, background_ids: ['room'] })
            .mockResolvedValueOnce({
                success: true,
                id: 'generator',
                warning: true,
                warning_type: 'multiple_backgrounds',
                background_count: 2,
                background_ids: ['room', 'generator']
            });
        zone.audioManager.getAudioStatusSnapshot = jest.fn().mockReturnValue({
            backgrounds: [
                { id: 'room', file: 'generator/background.mp3', state: 'playing', time_left_s: 41.2, duration_s: 180, loop: true },
                { id: 'generator', file: 'generator/gen_loop.mp3', state: 'playing', time_left_s: 12, duration_s: 24, loop: true }
            ],
            speech: { current: null, queue: [] }
        });
        zone.audioManager.getAudioStatus = jest.fn().mockImplementation(async () => zone.audioManager.getAudioStatusSnapshot());
        zone.audioManager.setBackgroundMusicVolume = jest.fn().mockResolvedValue();
        zone.audioManager.hasActiveBackground = jest.fn().mockReturnValue(true);
        zone._validateMediaFile = jest.fn().mockResolvedValue({ exists: true, path: '/opt/paradox/media/generator/file.mp3' });
        zone.isInitialized = true;
        zone.mpvInstances.background = { status: 'idle', currentFile: null };
        return { zone, mqtt };
    }

    test('second bed publishes multiple_backgrounds warning and still starts', async () => {
        const { zone, mqtt } = makeZone();

        await zone.handleCommand({ command: 'playBackground', file: 'generator/background.mp3', id: 'room', loop: true });
        await zone.handleCommand({ command: 'playBackground', file: 'generator/gen_loop.mp3', id: 'generator', loop: true });

        const warning = mqtt.publish.mock.calls
            .map(call => call[1])
            .find(payload => payload && payload.warning_type === 'multiple_backgrounds');
        expect(warning).toBeTruthy();
        expect(warning.outcome).toBe('warning');
        expect(warning.error_type).toBe('multiple_backgrounds');
        expect(warning.parameters.background_count).toBe(2);
        expect(warning.parameters.background_ids).toEqual(['room', 'generator']);
        expect(zone.audioManager.playBackgroundMusic).toHaveBeenCalledTimes(2);
    });

    test('audioStatus publishes backgrounds and speech', async () => {
        const { zone, mqtt } = makeZone();

        await zone.handleCommand({ command: 'audioStatus' });

        const event = mqtt.publish.mock.calls
            .map(call => call[1])
            .find(payload => payload && payload.audio_status);
        expect(event.audio_status.backgrounds).toHaveLength(2);
        expect(event.audio_status.speech).toEqual({ current: null, queue: [] });
    });

    test('retained state includes derived backgroundMusic and backgrounds', () => {
        const { zone, mqtt } = makeZone();
        zone.publishStatus();

        const state = mqtt.publish.mock.calls
            .map(call => call[1])
            .find(payload => payload && payload.current_state);
        expect(state.current_state.backgrounds).toHaveLength(2);
        expect(state.current_state.backgroundMusic).toBe('generator/background.mp3');
        expect(state.current_state.speechQueueLength).toBe(0);
        expect(state.backgrounds).toHaveLength(2);
    });
});
