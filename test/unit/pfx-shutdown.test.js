jest.mock('../../lib/utils/logger');

const PFxApplication = require('../../pfx');

describe('PFxApplication shutdown guards', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('shutdown only runs once even if called repeatedly', async () => {
        const app = new PFxApplication();
        app.logger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        };
        app._stopUnclutter = jest.fn().mockResolvedValue();
        app.zoneManager = { shutdown: jest.fn().mockResolvedValue() };
        app.mqttClient = { disconnect: jest.fn().mockResolvedValue() };

        const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);

        await app.shutdown();
        await app.shutdown();

        expect(app._stopUnclutter).toHaveBeenCalledTimes(1);
        expect(app.zoneManager.shutdown).toHaveBeenCalledTimes(1);
        expect(app.mqttClient.disconnect).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledTimes(1);
    });

    test('uncaught EPIPE does not trigger shutdown', () => {
        const app = new PFxApplication();
        const handlers = {};

        app.logger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        };
        app.shutdown = jest.fn();

        const onSpy = jest.spyOn(process, 'on').mockImplementation((event, handler) => {
            handlers[event] = handler;
            return process;
        });

        app.setupShutdownHandlers();
        expect(onSpy).toHaveBeenCalled();

        handlers.uncaughtException({ code: 'EPIPE', message: 'broken pipe' });

        expect(app.shutdown).not.toHaveBeenCalled();
        expect(app.logger.warn).toHaveBeenCalledWith(expect.stringContaining('EPIPE on IPC socket'));
    });
});