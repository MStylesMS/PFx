/**
 * Unit tests for configurable monitor on/off strategies.
 */

jest.mock('child_process', () => ({
    exec: jest.fn((cmd, opts, cb) => {
        if (typeof opts === 'function') {
            opts(null, { stdout: '', stderr: '' });
            return;
        }
        if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' });
    }),
    execFile: jest.fn((file, args, opts, cb) => {
        if (typeof opts === 'function') {
            opts(null, { stdout: '', stderr: '' });
            return;
        }
        if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' });
    })
}));

const { exec, execFile } = require('child_process');
const ScreenPowerManager = require('../../lib/utils/screen-power-manager');

describe('ScreenPowerManager monitor control', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('normalizeMethod defaults invalid to none', () => {
        expect(ScreenPowerManager.normalizeMethod(undefined)).toBe('none');
        expect(ScreenPowerManager.normalizeMethod('CEC')).toBe('cec');
        expect(ScreenPowerManager.normalizeMethod('bogus')).toBe('none');
    });

    test('deriveCecDevice from output_name and target_monitor', () => {
        expect(ScreenPowerManager.deriveCecDevice({ outputName: 'HDMI-2' })).toBe('/dev/cec1');
        expect(ScreenPowerManager.deriveCecDevice({ targetMonitor: 0 })).toBe('/dev/cec0');
        expect(ScreenPowerManager.deriveCecDevice({ cecDevice: '/dev/cec9' })).toBe('/dev/cec9');
    });

    test('sleepOutput/wakeOutput none are no-ops', async () => {
        const mgr = new ScreenPowerManager(':0');
        const off = await mgr.sleepOutput({ method: 'none' });
        const on = await mgr.wakeOutput({ method: 'none' });
        expect(off).toEqual({ applied: false, method: 'none', reason: 'none' });
        expect(on).toEqual({ applied: false, method: 'none', reason: 'none' });
        expect(exec).not.toHaveBeenCalled();
        expect(execFile).not.toHaveBeenCalled();
    });

    test('dpms sleep/wake invoke xset', async () => {
        const mgr = new ScreenPowerManager(':0');
        await mgr.sleepOutput({ method: 'dpms' });
        await mgr.wakeOutput({ method: 'dpms' });
        const cmds = exec.mock.calls.map((c) => c[0]);
        expect(cmds.some((c) => /xset dpms force off/.test(c))).toBe(true);
        expect(cmds.some((c) => /xset dpms force on/.test(c))).toBe(true);
    });

    test('cec sleep/wake invoke cec-client on derived device', async () => {
        const mgr = new ScreenPowerManager(':0');
        await mgr.sleepOutput({ method: 'cec', outputName: 'HDMI-2' });
        await mgr.wakeOutput({ method: 'cec', outputName: 'HDMI-2' });
        const cmds = exec.mock.calls.map((c) => c[0]).join('\n');
        expect(cmds).toMatch(/cec-client/);
        expect(cmds).toMatch(/\/dev\/cec1/);
        expect(cmds).toMatch(/standby 0/);
        expect(cmds).toMatch(/on 0/);
    });

    test('ddc sleep/wake invoke ddcutil setvcp', async () => {
        const mgr = new ScreenPowerManager(':0');
        await mgr.sleepOutput({ method: 'ddc', i2cBus: 21 });
        await mgr.wakeOutput({ method: 'ddc', i2cBus: 21 });
        expect(execFile).toHaveBeenCalledWith(
            'ddcutil',
            ['-b', '21', 'setvcp', '0xD6', '0x4'],
            expect.any(Object),
            expect.any(Function)
        );
        expect(execFile).toHaveBeenCalledWith(
            'ddcutil',
            ['-b', '21', 'setvcp', '0xD6', '0x1'],
            expect.any(Object),
            expect.any(Function)
        );
    });

    test('xrandr with outputName uses --off/--auto', async () => {
        const mgr = new ScreenPowerManager(':0');
        await mgr.sleepOutput({ method: 'xrandr', outputName: 'HDMI-1' });
        await mgr.wakeOutput({ method: 'xrandr', outputName: 'HDMI-1' });
        const cmds = exec.mock.calls.map((c) => c[0]);
        expect(cmds.some((c) => /xrandr --output HDMI-1 --off/.test(c))).toBe(true);
        expect(cmds.some((c) => /xrandr --output HDMI-1 --auto/.test(c))).toBe(true);
    });
});
