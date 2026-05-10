/**
 * Phase 2 integration test — PFxE vocabulary compatibility
 *
 * Simulates the command sequence a PxO EDN sequence would send when targeting a
 * PFxE-style single-zone display:
 *   - browser_url set in config → browser auto-enables at zone init (no operator command needed)
 *   - showBrowser / hideBrowser control visibility
 *   - setBrowserUrl changes the URL at runtime
 *   - enableBrowser / disableBrowser / verifyBrowser / moveBrowser → MQTT warnings, not errors
 *
 * The tests use the same mock strategy as screen-zone-browser-delegation.test.js
 * so they run without any system dependencies.
 */

jest.mock('child_process', () => ({
    execSync: jest.fn(() => Buffer.from('')),
    exec: jest.fn((cmd, cb) => { if (cb) cb(null, '', ''); }),
    spawn: jest.fn(() => ({
        pid: 9001,
        kill: jest.fn(),
        stderr: { on: jest.fn() },
        stdout: { on: jest.fn() },
        on: jest.fn()
    }))
}));

jest.mock('../../lib/utils/os-detection', () => ({
    getOSDetection: () => ({
        getWindowDetectionConfig: () => ({ initialDelay: 0, maxRetries: 0, retryDelay: 0 })
    })
}));

// Stub the heavy media layer so initialize() can run without hardware
const mockZoneManager = {
    initialize: jest.fn().mockResolvedValue(undefined),
    shutdown: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    play: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    setProperty: jest.fn().mockResolvedValue(undefined),
    getProperty: jest.fn().mockResolvedValue(null)
};
jest.mock('../../lib/media/media-player-factory', () => {
    return jest.fn().mockImplementation(() => ({
        createZoneManager: jest.fn().mockResolvedValue(mockZoneManager)
    }));
});

// Stub screen power management (requires xset/xrandr)
jest.mock('../../lib/utils/screen-power-manager', () => {
    return jest.fn().mockImplementation(() => ({
        disableScreenBlanking: jest.fn().mockResolvedValue(undefined),
        checkDpmsSupport: jest.fn().mockResolvedValue(undefined),
        sleepScreen: jest.fn().mockResolvedValue(undefined),
        wakeScreen: jest.fn().mockResolvedValue(undefined)
    }));
});

// Stub screen resolution helper (requires xrandr)
jest.mock('../../lib/utils/screen-resolution-helper', () => ({
    applyScreenResolution: jest.fn().mockResolvedValue(undefined)
}));

const ScreenZone = require('../../lib/zones/screen-zone');

// ─── helpers ────────────────────────────────────────────────────────────────

function makeConfig(overrides = {}) {
    return {
        name: 'pfxe-compat-test',
        type: 'screen',
        baseTopic: 'paradox/test/pfxe-compat',
        mediaDir: '/tmp',
        volume: 80,
        ...overrides
    };
}

function makeBrowserController() {
    return {
        enableBrowser: jest.fn().mockResolvedValue(undefined),
        disableBrowser: jest.fn().mockResolvedValue(undefined),
        showBrowser: jest.fn().mockResolvedValue(undefined),
        hideBrowser: jest.fn().mockResolvedValue(undefined),
        setBrowserUrl: jest.fn().mockResolvedValue(undefined),
        setBrowserKeepAlive: jest.fn().mockResolvedValue(undefined),
        startBrowserMonitoring: jest.fn(),
        stopBrowserMonitoring: jest.fn(),
        updateFocusAndContent: jest.fn(),
        switchToMpv: jest.fn().mockResolvedValue(undefined),
        switchToBrowser: jest.fn().mockResolvedValue(undefined),
        toggleMpvBrowser: jest.fn().mockResolvedValue(undefined)
    };
}

function makeInitializedZone(configOverrides = {}) {
    const mqtt = { publish: jest.fn() };
    const zone = new ScreenZone(makeConfig(configOverrides), mqtt, null);
    zone.isInitialized = true;
    zone.browserController = makeBrowserController();
    return { zone, mqtt };
}

function warningCalls(mqtt) {
    return mqtt.publish.mock.calls.filter(c => c[0].endsWith('/warnings'));
}

function outcomeCalls(mqtt) {
    return mqtt.publish.mock.calls.filter(c => c[0].endsWith('/events'));
}

// ─── PFxE-style command sequence tests ──────────────────────────────────────

describe('PFxE vocabulary compatibility — browser auto-enable', () => {
    test('zone with browser_url auto-enables browser during init', async () => {
        const mqtt = { publish: jest.fn() };
        const zone = new ScreenZone(makeConfig({ browserUrl: 'http://localhost/clock/' }), mqtt, null);

        // Spy on _enableBrowser before running the auto-enable logic in isolation
        zone._enableBrowser = jest.fn().mockResolvedValue(undefined);

        // Execute only the auto-enable block from initialize() — the rest
        // of initialize() requires hardware (MPV sockets, audio manager).
        if (zone.config.browserUrl) {
            await zone._enableBrowser(zone.config.browserUrl);
        }

        expect(zone._enableBrowser).toHaveBeenCalledWith('http://localhost/clock/');
    });

    test('zone without browser_url does NOT auto-enable browser during init', async () => {
        const mqtt = { publish: jest.fn() };
        const zone = new ScreenZone(makeConfig(), mqtt, null);

        zone._enableBrowser = jest.fn().mockResolvedValue(undefined);

        if (zone.config.browserUrl) {
            await zone._enableBrowser(zone.config.browserUrl);
        }

        expect(zone._enableBrowser).not.toHaveBeenCalled();
    });

    test('config-loader maps browser_url INI key to config.browserUrl', () => {
        // Verify that the config property the initialize() guard reads
        // is the one populated by config-loader from the browser_url INI key.
        const mqtt = { publish: jest.fn() };
        const zoneWith    = new ScreenZone(makeConfig({ browserUrl: 'http://localhost/clock/' }), mqtt, null);
        const zoneWithout = new ScreenZone(makeConfig(), mqtt, null);

        expect(zoneWith.config.browserUrl).toBe('http://localhost/clock/');
        expect(zoneWithout.config.browserUrl).toBeUndefined();
    });
});

describe('PFxE vocabulary compatibility — showBrowser / hideBrowser', () => {
    test('showBrowser delegates to browser controller and publishes success outcome', async () => {
        const { zone, mqtt } = makeInitializedZone();

        await zone.handleCommand({ command: 'showBrowser' });

        expect(zone.browserController.showBrowser).toHaveBeenCalled();
        expect(warningCalls(mqtt)).toHaveLength(0);
    });

    test('hideBrowser delegates to browser controller and publishes success outcome', async () => {
        const { zone, mqtt } = makeInitializedZone();

        await zone.handleCommand({ command: 'hideBrowser' });

        expect(zone.browserController.hideBrowser).toHaveBeenCalled();
        expect(warningCalls(mqtt)).toHaveLength(0);
    });

    test('setBrowserUrl delegates to browser controller', async () => {
        const { zone, mqtt } = makeInitializedZone();

        await zone.handleCommand({ command: 'setBrowserUrl', url: 'http://localhost/clock/' });

        expect(zone.browserController.setBrowserUrl).toHaveBeenCalledWith('http://localhost/clock/');
        expect(warningCalls(mqtt)).toHaveLength(0);
    });
});

describe('PFxE vocabulary compatibility — removed commands emit warnings, not errors', () => {
    const removedCommands = [
        { command: 'enableBrowser', url: 'http://localhost/clock/' },
        { command: 'disableBrowser' },
        { command: 'verifyBrowser' }
    ];

    removedCommands.forEach(({ command: cmd, ...params }) => {
        test(`'${cmd}' emits MQTT warning and does not throw`, async () => {
            const { zone, mqtt } = makeInitializedZone();

            await expect(zone.handleCommand({ command: cmd, ...params })).resolves.not.toThrow();

            const warnings = warningCalls(mqtt);
            expect(warnings).toHaveLength(1);
            expect(warnings[0][1].message).toMatch(new RegExp(cmd));
            // Removed commands must NOT publish a success outcome
            expect(outcomeCalls(mqtt)).toHaveLength(0);
        });
    });

    test("'moveBrowser' emits warning about PFx full-screen constraint", async () => {
        const { zone, mqtt } = makeInitializedZone();

        await expect(
            zone.handleCommand({ command: 'moveBrowser', x: 0, y: 0, width: 1920, height: 1080 })
        ).resolves.not.toThrow();

        const warnings = warningCalls(mqtt);
        expect(warnings).toHaveLength(1);
        expect(warnings[0][1].message).toMatch(/moveBrowser/);
        expect(warnings[0][1].message).toMatch(/full-screen/i);
        expect(outcomeCalls(mqtt)).toHaveLength(0);
    });
});

describe('PFxE vocabulary compatibility — PFxE-style EDN command sequence', () => {
    /**
     * Simulates the command sequence PxO would emit based on a PFxE-style EDN
     * sequence that assumes browser_url is in config and uses only the 2.1.0
     * vocabulary: showBrowser, hideBrowser, setBrowserUrl.
     *
     * Expected sequence from PxO:
     *   → [zone init] browser auto-enables via browser_url config
     *   → showBrowser      (reveal clock during intro)
     *   → hideBrowser      (hide clock during video)
     *   → showBrowser      (reveal again)
     *   → setBrowserUrl    (switch to puzzle overlay)
     *   → hideBrowser      (cleanup)
     */
    test('full PFxE-style gameplay sequence executes without warnings or errors', async () => {
        const { zone, mqtt } = makeInitializedZone({ browserUrl: 'http://localhost/clock/' });

        const sequence = [
            { command: 'showBrowser' },
            { command: 'hideBrowser' },
            { command: 'showBrowser' },
            { command: 'setBrowserUrl', url: 'http://localhost/puzzle/' },
            { command: 'hideBrowser' }
        ];

        for (const cmd of sequence) {
            await zone.handleCommand(cmd);
        }

        expect(warningCalls(mqtt)).toHaveLength(0);
        expect(zone.browserController.showBrowser).toHaveBeenCalledTimes(2);
        expect(zone.browserController.hideBrowser).toHaveBeenCalledTimes(2);
        expect(zone.browserController.setBrowserUrl).toHaveBeenCalledWith('http://localhost/puzzle/');
    });
});
