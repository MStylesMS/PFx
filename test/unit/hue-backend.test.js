/**
 * Unit Tests for HueBackend
 */

const https = require('https');
const HueBackend = require('../../lib/lights/backends/hue-backend');

// Base config used by most tests
const BASE_CONFIG = {
    name: 'test-hue',
    hueBridgeHost: '192.168.1.100',
    hueAppKey: 'test-app-key',
    hueResourceId: 'aaaa-bbbb-cccc-dddd',
    hueResourceType: 'room',
    hueProfile: 'color'
};

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Mock https.request so that tests never make real network calls.
 * @param {number} statusCode - Simulated HTTP status code
 * @param {object|string} responseBody - Response body to return
 */
function mockRequest(statusCode = 200, responseBody = {}) {
    const mockRes = {
        statusCode,
        on: jest.fn((event, cb) => {
            if (event === 'data') cb(JSON.stringify(responseBody));
            if (event === 'end') cb();
            return mockRes;
        })
    };

    const mockReq = {
        on: jest.fn().mockReturnThis(),
        write: jest.fn(),
        end: jest.fn(),
        destroy: jest.fn()
    };

    jest.spyOn(https, 'request').mockImplementation((_opts, resCb) => {
        resCb(mockRes);
        return mockReq;
    });

    return { mockReq, mockRes };
}

function captureRequestBody() {
    const bodies = [];
    const mockRes = {
        statusCode: 200,
        on: jest.fn((event, cb) => {
            if (event === 'data') cb('{}');
            if (event === 'end') cb();
            return mockRes;
        })
    };
    const mockReq = {
        on: jest.fn().mockReturnThis(),
        write: jest.fn((data) => bodies.push(JSON.parse(data))),
        end: jest.fn(),
        destroy: jest.fn()
    };
    jest.spyOn(https, 'request').mockImplementation((_opts, resCb) => {
        resCb(mockRes);
        return mockReq;
    });
    return bodies;
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('HueBackend', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // ── initialization ────────────────────────────────────────────────────────

    describe('initialize()', () => {
        test('succeeds when bridge responds 200', async () => {
            mockRequest(200, {});
            const backend = new HueBackend(BASE_CONFIG);
            await expect(backend.initialize()).resolves.toBeUndefined();
        });

        test('throws if hueBridgeHost is missing', async () => {
            const backend = new HueBackend({ ...BASE_CONFIG, hueBridgeHost: null });
            await expect(backend.initialize()).rejects.toThrow('hue_bridge_host');
        });

        test('throws if hueAppKey is missing', async () => {
            const backend = new HueBackend({ ...BASE_CONFIG, hueAppKey: null });
            await expect(backend.initialize()).rejects.toThrow('hue_app_key');
        });

        test('throws if hueResourceId is missing', async () => {
            const backend = new HueBackend({ ...BASE_CONFIG, hueResourceId: null });
            await expect(backend.initialize()).rejects.toThrow('hue_resource_id');
        });

        test('throws when bridge responds non-2xx', async () => {
            mockRequest(401, { errors: [{ description: 'unauthorized' }] });
            const backend = new HueBackend(BASE_CONFIG);
            await expect(backend.initialize()).rejects.toThrow('initialization failed');
        });
    });

    // ── basic commands ────────────────────────────────────────────────────────

    describe('execute() — on/off/brightness', () => {
        test('on sends {"on":{"on":true}}', async () => {
            const bodies = captureRequestBody();
            const backend = new HueBackend(BASE_CONFIG);
            await backend.execute('on');
            expect(bodies[0]).toMatchObject({ on: { on: true } });
        });

        test('on with brightness includes dimming', async () => {
            const bodies = captureRequestBody();
            const backend = new HueBackend(BASE_CONFIG);
            await backend.execute('on', { brightness: 60 });
            expect(bodies[0]).toMatchObject({ on: { on: true }, dimming: { brightness: 60 } });
        });

        test('off sends {"on":{"on":false}}', async () => {
            const bodies = captureRequestBody();
            const backend = new HueBackend(BASE_CONFIG);
            await backend.execute('off');
            expect(bodies[0]).toMatchObject({ on: { on: false } });
        });

        test('setBrightness sends correct dimming value', async () => {
            const bodies = captureRequestBody();
            const backend = new HueBackend(BASE_CONFIG);
            await backend.execute('setBrightness', { brightness: 45 });
            expect(bodies[0]).toMatchObject({ dimming: { brightness: 45 } });
        });

        test('setBrightness(0) turns off', async () => {
            const bodies = captureRequestBody();
            const backend = new HueBackend(BASE_CONFIG);
            await backend.execute('setBrightness', { brightness: 0 });
            expect(bodies[0]).toMatchObject({ on: { on: false } });
        });

        test('throws on unknown command', async () => {
            const backend = new HueBackend(BASE_CONFIG);
            await expect(backend.execute('unknownCmd')).rejects.toThrow('Unsupported Hue command');
        });
    });

    // ── scene → XY payload ────────────────────────────────────────────────────

    describe('execute() — scene → color (profile=color)', () => {
        test('red scene sends XY color payload', async () => {
            const bodies = captureRequestBody();
            const backend = new HueBackend(BASE_CONFIG);
            await backend.execute('scene', { scene: 'red' });
            expect(bodies[0].on).toEqual({ on: true });
            expect(bodies[0].color).toBeDefined();
            expect(bodies[0].color.xy.x).toBeCloseTo(0.700, 1);
            expect(bodies[0].color.xy.y).toBeCloseTo(0.299, 1);
        });

        test('blue scene sends XY color payload', async () => {
            const bodies = captureRequestBody();
            const backend = new HueBackend(BASE_CONFIG);
            await backend.execute('scene', { scene: 'blue' });
            expect(bodies[0].color).toBeDefined();
            const xy = bodies[0].color.xy;
            // Blue XY should be towards lower-right of gamut
            expect(xy.x).toBeLessThan(0.30);
        });

        test('setColorScene alias works', async () => {
            const bodies = captureRequestBody();
            const backend = new HueBackend(BASE_CONFIG);
            await backend.execute('setColorScene', { scene: 'green' });
            expect(bodies[0].color).toBeDefined();
        });

        test('off scene sends power-off body', async () => {
            const bodies = captureRequestBody();
            const backend = new HueBackend(BASE_CONFIG);
            await backend.execute('scene', { scene: 'off' });
            expect(bodies[0]).toEqual({ on: { on: false } });
        });

        test('scene includes brightness in dimming', async () => {
            const bodies = captureRequestBody();
            const backend = new HueBackend(BASE_CONFIG);
            await backend.execute('scene', { scene: 'normal' });
            expect(bodies[0].dimming).toBeDefined();
            expect(bodies[0].dimming.brightness).toBe(80);
        });
    });

    // ── scene → mirek payload ─────────────────────────────────────────────────

    describe('execute() — scene → CT (profile=ct)', () => {
        const CT_CONFIG = { ...BASE_CONFIG, hueProfile: 'ct' };

        test('softWhite scene sends mirek payload', async () => {
            const bodies = captureRequestBody();
            const backend = new HueBackend(CT_CONFIG);
            await backend.execute('scene', { scene: 'softWhite' });
            expect(bodies[0].color_temperature).toBeDefined();
            // softWhite = 2700 K → mirek = round(1,000,000/2700) = 370
            expect(bodies[0].color_temperature.mirek).toBe(370);
        });

        test('coolWhite scene sends lower mirek value', async () => {
            const bodies = captureRequestBody();
            const backend = new HueBackend(CT_CONFIG);
            await backend.execute('scene', { scene: 'coolWhite' });
            expect(bodies[0].color_temperature.mirek).toBeLessThan(200); // 6000K ≈ 167
        });

        test('CT profile does not send color.xy', async () => {
            const bodies = captureRequestBody();
            const backend = new HueBackend(CT_CONFIG);
            await backend.execute('scene', { scene: 'warmWhite' });
            expect(bodies[0].color).toBeUndefined();
        });
    });

    // ── dim-only profile ──────────────────────────────────────────────────────

    describe('execute() — dim profile', () => {
        const DIM_CONFIG = { ...BASE_CONFIG, hueProfile: 'dim' };

        test('dim profile never sends color or color_temperature', async () => {
            const bodies = captureRequestBody();
            const backend = new HueBackend(DIM_CONFIG);
            await backend.execute('scene', { scene: 'red' });
            expect(bodies[0].color).toBeUndefined();
            expect(bodies[0].color_temperature).toBeUndefined();
            expect(bodies[0].dimming).toBeDefined();
        });
    });

    // ── unknown scene ─────────────────────────────────────────────────────────

    describe('execute() — unknown scene', () => {
        test('unknown scene sends on-only and returns warning (no throw)', async () => {
            mockRequest(200, {});
            const backend = new HueBackend(BASE_CONFIG);
            const result = await backend.execute('scene', { scene: 'unicorn' });
            expect(result.warning).toMatch(/unicorn/);
            expect(result.applied).toBe(true);
        });
    });

    // ── HTTP error handling ───────────────────────────────────────────────────

    describe('HTTP error handling', () => {
        test('non-2xx response throws with status code', async () => {
            mockRequest(503, { message: 'Service Unavailable' });
            const backend = new HueBackend(BASE_CONFIG);
            await expect(backend.execute('on')).rejects.toThrow('503');
        });
    });

    // ── setColor command ──────────────────────────────────────────────────────

    describe('execute() — setColor', () => {
        test('setColor #ff0000 sends red XY', async () => {
            const bodies = captureRequestBody();
            const backend = new HueBackend(BASE_CONFIG);
            await backend.execute('setColor', { color: '#ff0000', brightness: 80 });
            expect(bodies[0].color).toBeDefined();
            expect(bodies[0].color.xy.x).toBeCloseTo(0.700, 1);
        });

        test('setColor throws on invalid hex', async () => {
            const backend = new HueBackend(BASE_CONFIG);
            await expect(backend.execute('setColor', { color: 'notahex' })).rejects.toThrow('Invalid color');
        });
    });

    // ── resource path routing ─────────────────────────────────────────────────

    describe('resource path', () => {
        test('room resource type uses grouped_light path', async () => {
            mockRequest(200, {});
            const backend = new HueBackend(BASE_CONFIG);
            await backend.execute('on');
            const call = https.request.mock.calls[0][0];
            expect(call.path).toBe(`/clip/v2/resource/grouped_light/${BASE_CONFIG.hueResourceId}`);
        });

        test('light resource type uses light path', async () => {
            mockRequest(200, {});
            const backend = new HueBackend({ ...BASE_CONFIG, hueResourceType: 'light' });
            await backend.execute('on');
            const call = https.request.mock.calls[0][0];
            expect(call.path).toBe(`/clip/v2/resource/light/${BASE_CONFIG.hueResourceId}`);
        });

        test('zone resource type uses grouped_light path', async () => {
            mockRequest(200, {});
            const backend = new HueBackend({ ...BASE_CONFIG, hueResourceType: 'zone' });
            await backend.execute('on');
            const call = https.request.mock.calls[0][0];
            expect(call.path).toContain('grouped_light');
        });
    });

    // ── scene_map override ────────────────────────────────────────────────────

    describe('scene_map override', () => {
        test('custom scene map entry overrides default', async () => {
            const bodies = captureRequestBody();
            const backend = new HueBackend({
                ...BASE_CONFIG,
                sceneMap: {
                    myScene: { on: true, r: 128, g: 0, b: 128, brightness: 50 }
                }
            });
            await backend.execute('scene', { scene: 'myScene' });
            expect(bodies[0].on).toEqual({ on: true });
            expect(bodies[0].dimming.brightness).toBe(50);
        });
    });

    // ── colour math ───────────────────────────────────────────────────────────

    describe('_rgbToXy()', () => {
        test('pure red maps to ~(0.700, 0.299)', () => {
            const backend = new HueBackend(BASE_CONFIG);
            const xy = backend._rgbToXy(255, 0, 0);
            expect(xy.x).toBeCloseTo(0.700, 1);
            expect(xy.y).toBeCloseTo(0.299, 1);
        });

        test('pure green maps to expected gamut region', () => {
            const backend = new HueBackend(BASE_CONFIG);
            const xy = backend._rgbToXy(0, 255, 0);
            expect(xy.x).toBeGreaterThan(0.1);
            expect(xy.y).toBeGreaterThan(0.5);
        });

        test('black (0,0,0) returns D65 white point', () => {
            const backend = new HueBackend(BASE_CONFIG);
            const xy = backend._rgbToXy(0, 0, 0);
            expect(xy.x).toBeCloseTo(0.3127, 3);
            expect(xy.y).toBeCloseTo(0.3290, 3);
        });

        test('XY values are within gamut B bounds', () => {
            const backend = new HueBackend(BASE_CONFIG);
            // Deep blue would be out of gamut-B without clamping
            const xy = backend._rgbToXy(0, 0, 255);
            expect(xy.x).toBeGreaterThanOrEqual(0.1);
            expect(xy.y).toBeGreaterThanOrEqual(0.01);
        });
    });

    describe('_kelvinToMirek()', () => {
        test('2700 K → 370 mirek', () => {
            const backend = new HueBackend(BASE_CONFIG);
            expect(backend._kelvinToMirek(2700)).toBe(370);
        });

        test('6500 K → 154 mirek', () => {
            const backend = new HueBackend(BASE_CONFIG);
            expect(backend._kelvinToMirek(6500)).toBe(154);
        });

        test('clamps below 153 to 153', () => {
            const backend = new HueBackend(BASE_CONFIG);
            expect(backend._kelvinToMirek(100000)).toBe(153);
        });

        test('clamps above 500 to 500', () => {
            const backend = new HueBackend(BASE_CONFIG);
            expect(backend._kelvinToMirek(1000)).toBe(500);
        });
    });
});
