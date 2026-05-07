jest.mock('child_process', () => ({
    execSync: jest.fn(() => Buffer.from(''))
}));

jest.mock('../../lib/utils/os-detection', () => ({
    getOSDetection: () => ({
        getWindowDetectionConfig: () => ({
            initialDelay: 0,
            maxRetries: 0,
            retryDelay: 0
        })
    })
}));

const ScreenZoneBrowserController = require('../../lib/zones/screen-zone-browser-controller');

function createZone(overrides = {}) {
    return {
        logger: {
            info: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            error: jest.fn()
        },
        display: ':0',
        targetMonitor: 0,
        browserManager: {
            process: null,
            windowId: null,
            url: null,
            enabled: false,
            keepAlive: false,
            profilePath: '/tmp/pfx-browser-screen1',
            className: 'ParadoxBrowser'
        },
        windowManager: {
            safeRemoveDir: jest.fn(),
            getDisplays: jest.fn(() => [{ name: 'HDMI-1', width: 1920, height: 1080, x: 0, y: 0 }]),
            pickTargetDisplay: jest.fn(() => ({ name: 'HDMI-1', width: 1920, height: 1080, x: 0, y: 0 })),
            launchChromium: jest.fn(() => ({ pid: 1234 })),
            waitForWindowByClass: jest.fn().mockResolvedValue('101'),
            findChromiumWindowId: jest.fn(() => '101'),
            moveWindow: jest.fn(),
            fullscreenWindow: jest.fn(),
            getActiveDesktop: jest.fn(() => 0),
            moveToDesktop: jest.fn(),
            addWindowState: jest.fn(),
            removeWindowState: jest.fn(),
            getWindowIdByNameExact: jest.fn(() => '55'),
            activateWindow: jest.fn(() => true),
            killProcess: jest.fn().mockResolvedValue(undefined),
            isWindowActive: jest.fn(() => false)
        },
        currentState: {
            currentVideo: null,
            currentImage: 'default.png',
            focus: 'mpv',
            content: 'default.png',
            browser: {}
        },
        publishStatus: jest.fn(),
        publishEvent: jest.fn(),
        publishError: jest.fn(),
        ...overrides
    };
}

describe('ScreenZoneBrowserController', () => {
    test('enableBrowser launches Chromium hidden behind MPV and publishes state', async () => {
        const zone = createZone();
        const controller = new ScreenZoneBrowserController(zone);

        await controller.enableBrowser('http://localhost/clock/');

        expect(zone.browserManager.enabled).toBe(true);
        expect(zone.browserManager.url).toBe('http://localhost/clock/');
        expect(zone.browserManager.windowId).toBe('101');
        expect(zone.windowManager.launchChromium).toHaveBeenCalledWith(expect.objectContaining({
            url: 'http://localhost/clock/',
            className: 'ParadoxBrowser'
        }));
        expect(zone.windowManager.moveWindow).toHaveBeenCalledWith('101', 0, 0);
        expect(zone.publishStatus).toHaveBeenCalled();
        expect(zone.publishEvent).toHaveBeenCalledWith(expect.objectContaining({
            browser_enabled: true,
            focused: false,
            window_id: '101'
        }));
    });

    test('setBrowserUrl relaunches and restores focus when browser was foregrounded', async () => {
        const zone = createZone({
            browserManager: {
                process: { pid: 1234 },
                windowId: '101',
                url: 'http://old',
                enabled: true,
                keepAlive: false,
                profilePath: '/tmp/pfx-browser-screen1',
                className: 'ParadoxBrowser'
            },
            currentState: {
                currentVideo: null,
                currentImage: 'default.png',
                focus: 'chromium',
                content: 'http://old',
                browser: {}
            }
        });
        const controller = new ScreenZoneBrowserController(zone);
        const disableSpy = jest.spyOn(controller, 'disableBrowser').mockResolvedValue(undefined);
        const enableSpy = jest.spyOn(controller, 'enableBrowser').mockResolvedValue(undefined);
        const showSpy = jest.spyOn(controller, 'showBrowser').mockResolvedValue(undefined);

        await controller.setBrowserUrl('http://new');

        expect(disableSpy).toHaveBeenCalled();
        expect(enableSpy).toHaveBeenCalledWith('http://new');
        expect(showSpy).toHaveBeenCalled();
        expect(zone.publishEvent).toHaveBeenCalledWith({ browser_url_set: 'http://new' });
    });

    test('updateFocusAndContent marks browser foreground when stored window is active', () => {
        const zone = createZone({
            browserManager: {
                process: { pid: 1234 },
                windowId: '101',
                url: 'http://clock',
                enabled: true,
                keepAlive: false,
                profilePath: '/tmp/pfx-browser-screen1',
                className: 'ParadoxBrowser'
            }
        });
        zone.windowManager.isWindowActive.mockImplementation((windowId) => windowId === '101');
        const controller = new ScreenZoneBrowserController(zone);

        controller.updateFocusAndContent();

        expect(zone.currentState.focus).toBe('chromium');
        expect(zone.currentState.content).toBe('http://clock');
        expect(zone.currentState.browser).toEqual({
            enabled: true,
            url: 'http://clock',
            process_id: 1234,
            window_id: '101',
            foreground: true
        });
    });
});