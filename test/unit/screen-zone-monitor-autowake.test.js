/**
 * Auto-wake-on-media uses configured monitor_control_method.
 */

jest.mock('../../lib/utils/screen-power-manager', () => {
    const normalizeMethod = (method) => {
        const m = String(method || 'none').trim().toLowerCase();
        return ['none', 'xrandr', 'dpms', 'cec', 'ddc'].includes(m) ? m : 'none';
    };
    class ScreenPowerManager {
        constructor() {
            this.wakeOutput = jest.fn().mockResolvedValue({ applied: true, method: 'cec' });
            this.sleepOutput = jest.fn().mockResolvedValue({ applied: true, method: 'cec' });
        }
        static normalizeMethod = normalizeMethod;
    }
    return ScreenPowerManager;
});

jest.mock('../../lib/media/media-player-factory', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../lib/media/audio-manager', () => jest.fn().mockImplementation(() => ({
    speechQueue: []
})));
jest.mock('../../lib/utils/window-manager', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../lib/utils/screen-resolution-helper', () => ({
    applyScreenResolution: jest.fn().mockResolvedValue({ applied: false, skipped: true })
}));
jest.mock('../../lib/zones/screen-zone-browser-controller', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../lib/zones/screen-zone-playback-controller', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../lib/zones/screen-zone-video-queue-controller', () => jest.fn().mockImplementation(() => ({})));

const ScreenZone = require('../../lib/zones/screen-zone');

function makeZone(overrides = {}) {
    const mqtt = { publish: jest.fn(), subscribe: jest.fn() };
    const config = {
        name: 'picture',
        type: 'screen',
        display: ':0',
        targetMonitor: 1,
        monitorControlMethod: 'none',
        baseTopic: 'paradox/test/picture',
        mediaDir: '/tmp',
        ...overrides
    };
    return new ScreenZone(config, mqtt, null);
}

describe('ScreenZone monitor auto-wake', () => {
    test('skips wakeOutput when method is none', async () => {
        const zone = makeZone({ monitorControlMethod: 'none' });
        await zone._autoWakeForMedia('image');
        expect(zone.screenPowerManager.wakeOutput).not.toHaveBeenCalled();
    });

    test('calls wakeOutput when method is cec', async () => {
        const zone = makeZone({
            monitorControlMethod: 'cec',
            monitorCecDevice: '/dev/cec1'
        });
        await zone._autoWakeForMedia('video');
        expect(zone.screenPowerManager.wakeOutput).toHaveBeenCalledWith({
            method: 'cec',
            targetMonitor: 1,
            outputName: null,
            cecDevice: '/dev/cec1',
            i2cBus: null
        });
        expect(zone.currentState.screenAwake).toBe(true);
    });
});
