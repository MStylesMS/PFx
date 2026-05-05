jest.mock('../../lib/utils/logger');

const EventEmitter = require('events');
const net = require('net');
const MpvZoneManager = require('../../lib/media/mpv-zone-manager');

describe('MpvZoneManager startup helpers', () => {
    function makeManager(config = {}) {
        const manager = new MpvZoneManager({
            name: 'screen-test',
            audioDevice: 'auto',
            targetMonitor: 1,
            display: ':99',
            ...config
        });

        manager.profileManager.buildMpvArgs = jest.fn().mockReturnValue([
            '--ontop',
            '--fullscreen',
            '--idle=yes'
        ]);

        return manager;
    }

    test('builds spawn args with IPC socket and strips ontop when disabled', () => {
        const manager = makeManager({ mpvOntop: false, mpvVideoOptions: '--msg-level=all=warn --really-quiet' });
        manager.ipcSocketPath = '/tmp/test-mpv.sock';

        const args = manager._buildSpawnArgs();

        expect(args[0]).toBe('--input-ipc-server=/tmp/test-mpv.sock');
        expect(args).not.toContain('--ontop');
        expect(args).toContain('--fullscreen');
        expect(args).toContain('--msg-level=all=warn');
        expect(args).toContain('--really-quiet');
    });

    test('routes stderr messages according to runtime config', () => {
        const manager = makeManager();
        manager.logger.info = jest.fn();
        manager.logger.debug = jest.fn();

        manager._handleStderrMessage('VDPAU backend warning', { suppressVdpauWarnings: true });
        manager._handleStderrMessage('Cannot load libcuda.so.1', { suppressVdpauWarnings: false });
        manager._handleStderrMessage('generic stderr message', { suppressVdpauWarnings: false });

        expect(manager.logger.debug).toHaveBeenCalledWith('MPV stderr:', 'Cannot load libcuda.so.1');
        expect(manager.logger.info).toHaveBeenCalledWith('MPV stderr:', 'generic stderr message');
        expect(manager.logger.info).not.toHaveBeenCalledWith('MPV stderr:', 'VDPAU backend warning');
    });

    test('restartInternal clears stale IPC session before reconnecting', async () => {
        const manager = makeManager();
        const reject = jest.fn();
        const oldSocket = { destroy: jest.fn() };

        manager.ipcSocket = oldSocket;
        manager.pendingCommands.set(7, { resolve: jest.fn(), reject });
        manager.restartAttempts = 2;
        manager._startMpvProcess = jest.fn().mockResolvedValue();
        manager._waitForIpcSocket = jest.fn().mockResolvedValue();
        manager._connectIpcSocket = jest.fn().mockResolvedValue();

        await manager._restartInternal();

        expect(oldSocket.destroy).toHaveBeenCalledTimes(1);
        expect(reject).toHaveBeenCalledWith(expect.any(Error));
        expect(manager.pendingCommands.size).toBe(0);
        expect(manager._startMpvProcess).toHaveBeenCalledTimes(1);
        expect(manager._waitForIpcSocket).toHaveBeenCalledTimes(1);
        expect(manager._connectIpcSocket).toHaveBeenCalledTimes(1);
        expect(manager.ipcSocketPath).toMatch(/-r2\.sock$/);
    });

    test('late close from previous IPC socket does not clear active socket', async () => {
        const manager = makeManager();
        const oldSocket = new (require('events'))();
        const newSocket = new (require('events'))();

        oldSocket.destroy = jest.fn();
        oldSocket.write = jest.fn();
        newSocket.destroy = jest.fn();
        newSocket.write = jest.fn();

        const createConnection = jest.spyOn(net, 'createConnection')
            .mockReturnValueOnce(oldSocket)
            .mockReturnValueOnce(newSocket);

        const firstConnect = manager._connectIpcSocket();
        oldSocket.emit('connect');
        await firstConnect;

        const secondConnect = manager._connectIpcSocket();
        newSocket.emit('connect');
        await secondConnect;

        oldSocket.emit('close');

        expect(manager.ipcSocket).toBe(newSocket);
        createConnection.mockRestore();
    });

    test('successful IPC responses clear pending command timeout', async () => {
        jest.useFakeTimers();

        try {
            const manager = makeManager();
            manager.ipcSocket = { write: jest.fn() };

            const commandPromise = manager._sendIpcCommand('get_property', ['duration']);

            expect(jest.getTimerCount()).toBe(1);

            manager._handleIpcResponse(Buffer.from(JSON.stringify({
                request_id: 1,
                error: 'success',
                data: 42
            }) + '\n'));

            await expect(commandPromise).resolves.toBe(42);
            expect(manager.pendingCommands.size).toBe(0);
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    test('stop clears simulated playback timer before sending stop command', async () => {
        jest.useFakeTimers();

        try {
            const manager = makeManager();
            manager._sendIpcCommand = jest.fn().mockResolvedValue(true);
            manager._playbackTimer = setTimeout(() => {}, 1000);

            expect(jest.getTimerCount()).toBe(1);

            await manager.stop();

            expect(manager._sendIpcCommand).toHaveBeenCalledWith('stop');
            expect(manager._playbackTimer).toBeNull();
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    test('shutdown clears simulated playback timer', async () => {
        jest.useFakeTimers();

        try {
            const manager = makeManager();
            manager._playbackTimer = setTimeout(() => {}, 1000);
            manager.mpvProcess = { kill: jest.fn(), killed: true };

            expect(jest.getTimerCount()).toBe(1);

            await manager.shutdown();

            expect(manager._playbackTimer).toBeNull();
            expect(jest.getTimerCount()).toBe(1);
        } finally {
            jest.useRealTimers();
        }
    });

    test('shutdown marks manager as shutting down so exit does not restart', async () => {
        jest.useFakeTimers();

        try {
            const manager = makeManager();
            const fakeProcess = new EventEmitter();
            fakeProcess.stdout = new EventEmitter();
            fakeProcess.stderr = new EventEmitter();
            fakeProcess.kill = jest.fn();
            fakeProcess.killed = true;

            manager.mpvProcess = fakeProcess;
            manager._scheduleRestart = jest.fn();
            manager._attachProcessHandlers();

            const shutdownPromise = manager.shutdown();
            fakeProcess.emit('exit', 0, 'SIGTERM');
            await shutdownPromise;

            expect(manager.isShuttingDown).toBe(true);
            expect(manager._scheduleRestart).not.toHaveBeenCalled();

            await jest.runOnlyPendingTimersAsync();
        } finally {
            jest.useRealTimers();
        }
    });

    test('initialize clears stale shuttingDown flag before startup', async () => {
        jest.useFakeTimers();

        try {
            const manager = makeManager();
            manager.isShuttingDown = true;
            manager.profileManager.loadProfiles = jest.fn().mockResolvedValue();
            manager._logProfileSelection = jest.fn();
            manager.getProfileInfo = jest.fn().mockReturnValue({ profileName: 'test' });
            manager._startMpvProcess = jest.fn().mockResolvedValue();
            manager._waitForIpcSocket = jest.fn().mockResolvedValue();
            manager._connectIpcSocket = jest.fn().mockResolvedValue();

            const initializePromise = manager.initialize();
            await jest.advanceTimersByTimeAsync(500);
            await initializePromise;

            expect(manager.isShuttingDown).toBe(false);
            expect(manager.isInitialized).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });
});