const ScreenZone = require('../../lib/zones/screen-zone');

function makeConfig() {
    return {
        name: 'screen-zone-test',
        type: 'screen',
        baseTopic: 'paradox/test/screen-zone',
        mediaDir: '/tmp',
        volume: 80
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

describe('ScreenZone browser command delegation', () => {
    test('handleCommand emits MQTT warning for removed enableBrowser command', async () => {
        const mqtt = { publish: jest.fn() };
        const zone = new ScreenZone(makeConfig(), mqtt, null);
        zone.isInitialized = true;
        zone.browserController = makeBrowserController();

        await zone.handleCommand({ command: 'enableBrowser', url: 'http://localhost/clock/' });

        expect(zone.browserController.enableBrowser).not.toHaveBeenCalled();
        const warningCall = mqtt.publish.mock.calls.find(c => c[0].endsWith('/warnings'));
        expect(warningCall).toBeDefined();
        expect(warningCall[1].message).toMatch(/enableBrowser/);
        expect(warningCall[1].message).toMatch(/removed/i);
    });

    test('handleCommand emits MQTT warning for removed disableBrowser command', async () => {
        const mqtt = { publish: jest.fn() };
        const zone = new ScreenZone(makeConfig(), mqtt, null);
        zone.isInitialized = true;
        zone.browserController = makeBrowserController();

        await zone.handleCommand({ command: 'disableBrowser' });

        expect(zone.browserController.disableBrowser).not.toHaveBeenCalled();
        const warningCall = mqtt.publish.mock.calls.find(c => c[0].endsWith('/warnings'));
        expect(warningCall).toBeDefined();
        expect(warningCall[1].message).toMatch(/disableBrowser/);
    });

    test('handleCommand emits MQTT warning for removed verifyBrowser command', async () => {
        const mqtt = { publish: jest.fn() };
        const zone = new ScreenZone(makeConfig(), mqtt, null);
        zone.isInitialized = true;
        zone.browserController = makeBrowserController();

        await zone.handleCommand({ command: 'verifyBrowser' });

        const warningCall = mqtt.publish.mock.calls.find(c => c[0].endsWith('/warnings'));
        expect(warningCall).toBeDefined();
        expect(warningCall[1].message).toMatch(/verifyBrowser/);
    });

    test('handleCommand emits MQTT warning for moveBrowser (not supported on PFx)', async () => {
        const mqtt = { publish: jest.fn() };
        const zone = new ScreenZone(makeConfig(), mqtt, null);
        zone.isInitialized = true;
        zone.browserController = makeBrowserController();

        await zone.handleCommand({ command: 'moveBrowser', x: 0, y: 0, width: 1920, height: 1080 });

        const warningCall = mqtt.publish.mock.calls.find(c => c[0].endsWith('/warnings'));
        expect(warningCall).toBeDefined();
        expect(warningCall[1].message).toMatch(/moveBrowser/);
        expect(warningCall[1].message).toMatch(/full-screen/i);
    });

    test('handleCommand delegates showBrowser to browser controller', async () => {
        const mqtt = { publish: jest.fn() };
        const zone = new ScreenZone(makeConfig(), mqtt, null);
        zone.isInitialized = true;
        zone.browserController = makeBrowserController();

        await zone.handleCommand({ command: 'showBrowser' });

        expect(zone.browserController.showBrowser).toHaveBeenCalled();
    });

    test('enableBrowser and disableBrowser not listed in getSupportedCommands', () => {
        const zone = new ScreenZone(makeConfig(), { publish: jest.fn() }, null);
        const commands = zone.getSupportedCommands();
        expect(commands).not.toContain('enableBrowser');
        expect(commands).not.toContain('disableBrowser');
        expect(commands).not.toContain('verifyBrowser');
        expect(commands).not.toContain('moveBrowser');
    });
});