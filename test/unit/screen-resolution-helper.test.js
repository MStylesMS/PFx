/**
 * Unit tests for applyScreenResolution helper.
 */

const { EventEmitter } = require('events');

jest.mock('child_process', () => ({
    spawn: jest.fn()
}));

jest.mock('../../lib/utils/logger', () =>
    jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }))
);

const { spawn } = require('child_process');
const { applyScreenResolution } = require('../../lib/utils/screen-resolution-helper');

function setupSpawnQueue(queue) {
    spawn.mockImplementation((command, args) => {
        expect(command).toBe('xrandr');
        const behavior = queue.shift();
        if (!behavior) {
            throw new Error(`Unexpected spawn call for args: ${args.join(' ')}`);
        }
        if (behavior.args) {
            expect(args).toEqual(behavior.args);
        } else if (behavior.matchArgs) {
            expect(behavior.matchArgs(args)).toBe(true);
        }

        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();

        process.nextTick(() => {
            if (behavior.error) {
                child.emit('error', behavior.error);
                return;
            }
            if (behavior.stdout) {
                child.stdout.emit('data', Buffer.from(behavior.stdout));
            }
            if (behavior.stderr) {
                child.stderr.emit('data', Buffer.from(behavior.stderr));
            }
            child.emit('close', behavior.exitCode !== undefined ? behavior.exitCode : 0);
        });

        return child;
    });
}

describe('applyScreenResolution', () => {
    afterEach(() => {
        spawn.mockReset();
    });

    test('skips when no resolution mode is configured', async () => {
        const result = await applyScreenResolution({ resolutionMode: null });
        expect(result).toEqual({ applied: false, skipped: true, reason: 'no_mode' });
        expect(spawn).not.toHaveBeenCalled();
    });

    test('reports already_set when current mode matches desired', async () => {
        const queue = [
            {
                args: ['--query'],
                stdout: `HDMI-1 connected primary 1920x1080+0+0 (0x48)\n   640x480     60.00*\n`
            }
        ];
        setupSpawnQueue(queue);

        const result = await applyScreenResolution({
            outputName: 'HDMI-1',
            resolutionMode: '640x480@60'
        });

        expect(result).toEqual({ applied: false, skipped: true, reason: 'already_set' });
        expect(queue.length).toBe(0);
    });

    test('uses fallback mode when primary fails to apply', async () => {
        const queue = [
            {
                args: ['--query'],
                stdout: `HDMI-1 connected 1280x720+0+0\n   1280x720    60.00*\n`
            },
            {
                args: ['--output', 'HDMI-1', '--mode', '1920x1080', '--rate', '60'],
                stderr: 'xrandr: cannot find mode 1920x1080@60',
                exitCode: 1
            },
            {
                args: ['--output', 'HDMI-1', '--mode', '1280x720', '--rate', '60'],
                stdout: ''
            }
        ];
        setupSpawnQueue(queue);

        const result = await applyScreenResolution({
            outputName: 'HDMI-1',
            resolutionMode: '1920x1080@60',
            resolutionFallback: '1280x720@60'
        });

        expect(result.applied).toBe(true);
        expect(result.fallbackUsed).toBe(true);
        expect(queue.length).toBe(0);
    });

    test('returns no_output when output cannot be resolved from target monitor', async () => {
        const queue = [
            {
                args: ['--listmonitors'],
                stdout: 'Monitors: 2\n 0: +*HDMI-1 1920/520x1080/290+0+0  HDMI-1\n 1: +HDMI-2 1920/520x1080/290+1920+0  HDMI-2\n'
            },
            {
                args: ['--query'],
                stdout: 'HDMI-1 connected 1920x1080+0+0\nHDMI-2 connected 1920x1080+1920+0\n'
            }
        ];
        setupSpawnQueue(queue);

        const result = await applyScreenResolution({
            targetMonitor: 3,
            resolutionMode: '800x600@60'
        });

        expect(result).toEqual({ applied: false, skipped: true, reason: 'no_output' });
        expect(queue.length).toBe(0);
    });

    test('propagates error details when xrandr is missing', async () => {
        const enoentError = Object.assign(new Error('spawn xrandr ENOENT'), { code: 'ENOENT' });
        const queue = [
            {
                args: ['--query'],
                stdout: 'HDMI-1 connected 1280x720+0+0\n   1280x720    60.00*\n'
            },
            {
                args: ['--output', 'HDMI-1', '--mode', '1920x1080', '--rate', '60'],
                error: enoentError
            }
        ];
        setupSpawnQueue(queue);

        const result = await applyScreenResolution({
            outputName: 'HDMI-1',
            resolutionMode: '1920x1080@60'
        });

        expect(result.applied).toBe(false);
        expect(result.reason).toBe('apply_failed');
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('xrandr binary not found. Install x11-xserver-utils.');
        expect(queue.length).toBe(0);
    });
});
