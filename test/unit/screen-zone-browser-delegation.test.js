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

describe('ScreenZone browser command delegation', () => {
    test('handleCommand delegates enableBrowser to browser controller', async () => {
        const mqtt = { publish: jest.fn() };
        const zone = new ScreenZone(makeConfig(), mqtt, null);
        zone.isInitialized = true;
        zone.browserController = {
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

        await zone.handleCommand({ command: 'enableBrowser', url: 'http://localhost/clock/' });

        expect(zone.browserController.enableBrowser).toHaveBeenCalledWith('http://localhost/clock/');
    });

    test('handleCommand delegates showBrowser to browser controller', async () => {
        const mqtt = { publish: jest.fn() };
        const zone = new ScreenZone(makeConfig(), mqtt, null);
        zone.isInitialized = true;
        zone.browserController = {
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

        await zone.handleCommand({ command: 'showBrowser' });

        expect(zone.browserController.showBrowser).toHaveBeenCalled();
    });
});