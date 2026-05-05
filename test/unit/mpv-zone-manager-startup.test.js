jest.mock('../../lib/utils/logger');

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
});