jest.mock('../../lib/utils/logger');

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
});