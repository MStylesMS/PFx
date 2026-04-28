/**
 * Unit Tests for LifxBackend
 */

const dgram = require('dgram');
const LifxBackend = require('../../lib/lights/backends/lifx-backend');

const BASE_CONFIG = {
    name: 'test-lifx',
    bulbIp: '192.168.1.50'
};

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Mock dgram.createSocket so tests never make real UDP sends.
 * Returns { mockSock, sentMessages } where sentMessages accumulates copies
 * of each Buffer passed to socket.send().
 */
function mockSocket() {
    const sentMessages = [];
    const mockSock = {
        send: jest.fn((msg, _port, _host, cb) => {
            sentMessages.push(Buffer.from(msg));
            cb(null);
        }),
        close: jest.fn()
    };
    jest.spyOn(dgram, 'createSocket').mockReturnValue(mockSock);
    return { mockSock, sentMessages };
}

function mockSocketError(err) {
    const mockSock = {
        send: jest.fn((_msg, _port, _host, cb) => cb(err)),
        close: jest.fn()
    };
    jest.spyOn(dgram, 'createSocket').mockReturnValue(mockSock);
    return mockSock;
}

afterEach(() => jest.restoreAllMocks());

// Helper: read message type from a sent LIFX packet (offset 32, uint16le)
function msgType(buf)       { return buf.readUInt16LE(32); }
// Helper: read power level from SetPower payload (offset 36, uint16le)
function powerLevel(buf)    { return buf.readUInt16LE(36); }
// Helper: read HSBK from LightSetColor payload
function readHsbk(buf) {
    return {
        h: buf.readUInt16LE(37),
        s: buf.readUInt16LE(39),
        b: buf.readUInt16LE(41),
        k: buf.readUInt16LE(43)
    };
}

// ─── initialize ───────────────────────────────────────────────────────────────

describe('LifxBackend.initialize()', () => {
    it('throws when bulbIp is missing', async () => {
        const backend = new LifxBackend({ name: 'no-ip' });
        mockSocket();
        await expect(backend.initialize()).rejects.toThrow(/bulb_ip/);
    });

    it('creates a UDP socket on initialize', async () => {
        const backend = new LifxBackend(BASE_CONFIG);
        const { mockSock } = mockSocket();
        await backend.initialize();
        expect(dgram.createSocket).toHaveBeenCalledWith('udp4');
        expect(backend.socket).toBe(mockSock);
    });

    it('shutdown() closes the socket', async () => {
        const backend = new LifxBackend(BASE_CONFIG);
        const { mockSock } = mockSocket();
        await backend.initialize();
        await backend.shutdown();
        expect(mockSock.close).toHaveBeenCalled();
        expect(backend.socket).toBeNull();
    });

    it('rejects when not initialized', async () => {
        const backend = new LifxBackend(BASE_CONFIG);
        await expect(backend.execute('on')).rejects.toThrow(/not initialized/);
    });
});

// ─── on / off ─────────────────────────────────────────────────────────────────

describe('LifxBackend on/off commands', () => {
    let backend, sentMessages;

    beforeEach(async () => {
        backend = new LifxBackend(BASE_CONFIG);
        ({ sentMessages } = mockSocket());
        await backend.initialize();
    });

    it('sends SetPower(on) for "on" command', async () => {
        const result = await backend.execute('on');
        expect(result.applied).toBe(true);
        expect(sentMessages).toHaveLength(1);
        const msg = sentMessages[0];
        expect(msgType(msg)).toBe(21);              // MSG_SET_POWER
        expect(powerLevel(msg)).toBe(65535);
    });

    it('sends SetPower(off) for "off" command', async () => {
        await backend.execute('off');
        const msg = sentMessages[0];
        expect(msgType(msg)).toBe(21);
        expect(powerLevel(msg)).toBe(0);
    });

    it('"on" with brightness sends LightSetColor instead', async () => {
        await backend.execute('on', { brightness: 50 });
        const msg = sentMessages[0];
        expect(msgType(msg)).toBe(102);             // MSG_LIGHT_SET_COLOR
        const hsbk = readHsbk(msg);
        expect(hsbk.s).toBe(0);                     // white
        expect(hsbk.b).toBeCloseTo(32768, -2);      // ~50%
    });
});

// ─── setBrightness ────────────────────────────────────────────────────────────

describe('LifxBackend setBrightness', () => {
    let backend, sentMessages;

    beforeEach(async () => {
        backend = new LifxBackend(BASE_CONFIG);
        ({ sentMessages } = mockSocket());
        await backend.initialize();
    });

    it('100% sends max brightness', async () => {
        await backend.execute('setBrightness', { brightness: 100 });
        expect(msgType(sentMessages[0])).toBe(102);
        expect(readHsbk(sentMessages[0]).b).toBe(65535);
    });

    it('0% sends SetPower(off)', async () => {
        await backend.execute('setBrightness', { brightness: 0 });
        expect(msgType(sentMessages[0])).toBe(21);
        expect(powerLevel(sentMessages[0])).toBe(0);
    });

    it('50% sends ~32768 brightness', async () => {
        await backend.execute('setBrightness', { brightness: 50 });
        const hsbk = readHsbk(sentMessages[0]);
        expect(hsbk.b).toBeCloseTo(32768, -2);
    });
});

// ─── setColor ─────────────────────────────────────────────────────────────────

describe('LifxBackend setColor', () => {
    let backend, sentMessages;

    beforeEach(async () => {
        backend = new LifxBackend(BASE_CONFIG);
        ({ sentMessages } = mockSocket());
        await backend.initialize();
    });

    it('sends LightSetColor for #ff0000 (red)', async () => {
        await backend.execute('setColor', { color: '#ff0000' });
        const msg = sentMessages[0];
        expect(msgType(msg)).toBe(102);
        const hsbk = readHsbk(msg);
        expect(hsbk.h).toBe(0);                    // hue 0° = red
        expect(hsbk.s).toBe(65535);                // fully saturated
    });

    it('accepts color without # prefix', async () => {
        await backend.execute('setColor', { color: 'ff0000' });
        expect(msgType(sentMessages[0])).toBe(102);
    });

    it('overrides brightness when provided', async () => {
        await backend.execute('setColor', { color: '#ff0000', brightness: 50 });
        const hsbk = readHsbk(sentMessages[0]);
        expect(hsbk.b).toBeCloseTo(32768, -2);
    });

    it('throws on invalid color format', async () => {
        await expect(backend.execute('setColor', { color: 'notahex' }))
            .rejects.toThrow(/Invalid color/);
    });
});

// ─── scene ────────────────────────────────────────────────────────────────────

describe('LifxBackend scene command', () => {
    let backend, sentMessages;

    beforeEach(async () => {
        backend = new LifxBackend(BASE_CONFIG);
        ({ sentMessages } = mockSocket());
        await backend.initialize();
    });

    it('"off" scene sends SetPower(off)', async () => {
        const result = await backend.execute('scene', { scene: 'off' });
        expect(result.applied).toBe(true);
        expect(sentMessages).toHaveLength(1);
        expect(msgType(sentMessages[0])).toBe(21);
        expect(powerLevel(sentMessages[0])).toBe(0);
    });

    it('"red" scene sends LightSetColor with high saturation', async () => {
        await backend.execute('scene', { scene: 'red' });
        const hsbk = readHsbk(sentMessages[0]);
        expect(msgType(sentMessages[0])).toBe(102);
        expect(hsbk.h).toBe(0);                    // red hue
        expect(hsbk.s).toBe(65535);                // fully saturated
    });

    it('"softWhite" scene has s=0 and kelvin 2700', async () => {
        await backend.execute('scene', { scene: 'softWhite' });
        const hsbk = readHsbk(sentMessages[0]);
        expect(hsbk.s).toBe(0);
        expect(hsbk.k).toBe(2700);
    });

    it('"dim" scene sends reduced brightness', async () => {
        await backend.execute('scene', { scene: 'dim' });
        const hsbk = readHsbk(sentMessages[0]);
        expect(msgType(sentMessages[0])).toBe(102);
        expect(hsbk.b).toBeCloseTo(Math.round(35 / 100 * 65535), -2);
    });

    it('"normal" scene sends white at 80% brightness', async () => {
        await backend.execute('scene', { scene: 'normal' });
        const hsbk = readHsbk(sentMessages[0]);
        expect(hsbk.s).toBe(0);
        expect(hsbk.b).toBeCloseTo(Math.round(80 / 100 * 65535), -2);
    });

    it('accepts setColorScene alias', async () => {
        await backend.execute('setColorScene', { scene: 'red' });
        expect(sentMessages).toHaveLength(1);
    });

    it('unknown scene sends on and returns warning', async () => {
        const result = await backend.execute('scene', { scene: 'disco' });
        expect(result.applied).toBe(true);
        expect(result.warning).toMatch(/Unknown scene 'disco'/);
        expect(msgType(sentMessages[0])).toBe(21);
        expect(powerLevel(sentMessages[0])).toBe(65535);
    });

    it('throws when scene name is missing', async () => {
        await expect(backend.execute('scene', {}))
            .rejects.toThrow(/missing scene name/);
    });
});

// ─── fade ─────────────────────────────────────────────────────────────────────

describe('LifxBackend fade command', () => {
    let backend, sentMessages;

    beforeEach(async () => {
        backend = new LifxBackend(BASE_CONFIG);
        ({ sentMessages } = mockSocket());
        await backend.initialize();
    });

    it('applies brightness immediately via SetColor', async () => {
        const result = await backend.execute('fade', { brightness: 50 });
        expect(result.applied).toBe(true);
        expect(msgType(sentMessages[0])).toBe(102);
    });

    it('fade to 0 sends SetPower(off)', async () => {
        await backend.execute('fade', { brightness: 0 });
        expect(msgType(sentMessages[0])).toBe(21);
        expect(powerLevel(sentMessages[0])).toBe(0);
    });
});

// ─── unsupported command ──────────────────────────────────────────────────────

describe('LifxBackend unsupported command', () => {
    it('throws for unknown command', async () => {
        const backend = new LifxBackend(BASE_CONFIG);
        mockSocket();
        await backend.initialize();
        await expect(backend.execute('wiggle')).rejects.toThrow(/Unsupported LIFX command/);
    });
});

// ─── binary message format ────────────────────────────────────────────────────

describe('LifxBackend message format', () => {
    let backend;

    beforeEach(() => {
        backend = new LifxBackend(BASE_CONFIG);
    });

    it('SetPower message has correct size in header', () => {
        const msg = backend._buildSetPowerMessage(true);
        expect(msg.readUInt16LE(0)).toBe(38);       // 36 header + 2 payload
    });

    it('LightSetColor message has correct size in header', () => {
        const hsbk = { h: 0, s: 0, b: 65535, k: 3500 };
        const msg = backend._buildSetColorMessage(hsbk);
        expect(msg.readUInt16LE(0)).toBe(49);       // 36 header + 13 payload
    });

    it('LightSetColor HSBK fields round-trip', () => {
        const hsbk = { h: 12345, s: 32768, b: 65535, k: 4000 };
        const msg = backend._buildSetColorMessage(hsbk);
        expect(readHsbk(msg)).toEqual(hsbk);
    });

    it('LightSetColor kelvin is clamped to LIFX range in scene conversion', () => {
        const scene = { on: true, kelvin: 999, brightness: 50 };
        const hsbk = backend._sceneToHsbk(scene);
        expect(hsbk.k).toBe(1500);                 // clamped to minimum
    });

    it('sequence number increments and wraps at 256', () => {
        for (let i = 1; i <= 255; i++) {
            expect(backend._nextSeq()).toBe(i);
        }
        expect(backend._nextSeq()).toBe(0);
    });
});

// ─── colour math ─────────────────────────────────────────────────────────────

describe('LifxBackend._rgbToHsbk()', () => {
    let backend;
    beforeEach(() => { backend = new LifxBackend(BASE_CONFIG); });

    it('pure red → h=0, s=65535', () => {
        const { h, s } = backend._rgbToHsbk(255, 0, 0, 3500);
        expect(h).toBe(0);
        expect(s).toBe(65535);
    });

    it('pure white → s=0', () => {
        const { s } = backend._rgbToHsbk(255, 255, 255, 3500);
        expect(s).toBe(0);
    });

    it('black → b=0, s=0', () => {
        const { b, s } = backend._rgbToHsbk(0, 0, 0, 3500);
        expect(b).toBe(0);
        expect(s).toBe(0);
    });

    it('kelvin is passed through and clamped', () => {
        expect(backend._rgbToHsbk(255, 0, 0, 2000).k).toBe(2000);
        expect(backend._rgbToHsbk(255, 0, 0, 500).k).toBe(1500);   // min clamp
        expect(backend._rgbToHsbk(255, 0, 0, 10000).k).toBe(9000); // max clamp
    });
});

describe('LifxBackend._brightnessToLifx()', () => {
    let backend;
    beforeEach(() => { backend = new LifxBackend(BASE_CONFIG); });

    it('100 → 65535', () => expect(backend._brightnessToLifx(100)).toBe(65535));
    it('0   → 0',     () => expect(backend._brightnessToLifx(0)).toBe(0));
    it('50  → 32768', () => expect(backend._brightnessToLifx(50)).toBe(32768));
    it('clamps over 100', () => expect(backend._brightnessToLifx(150)).toBe(65535));
});

// ─── custom config ────────────────────────────────────────────────────────────

describe('LifxBackend constructor config', () => {
    it('uses lifxPort from config', () => {
        const backend = new LifxBackend({ ...BASE_CONFIG, lifxPort: 12345 });
        expect(backend.port).toBe(12345);
    });

    it('uses lifxKelvin from config', () => {
        const backend = new LifxBackend({ ...BASE_CONFIG, lifxKelvin: 5000 });
        expect(backend.defaultKelvin).toBe(5000);
    });

    it('clamps lifxKelvin to LIFX range', () => {
        const lo = new LifxBackend({ ...BASE_CONFIG, lifxKelvin: 100 });
        expect(lo.defaultKelvin).toBe(1500);
        const hi = new LifxBackend({ ...BASE_CONFIG, lifxKelvin: 99999 });
        expect(hi.defaultKelvin).toBe(9000);
    });

    it('merges custom sceneMap over defaults', async () => {
        const backend = new LifxBackend({
            ...BASE_CONFIG,
            sceneMap: { myScene: { on: true, r: 100, g: 200, b: 50, brightness: 90 } }
        });
        const { sentMessages } = mockSocket();
        await backend.initialize();
        const result = await backend.execute('scene', { scene: 'myScene' });
        expect(result.applied).toBe(true);
        expect(msgType(sentMessages[0])).toBe(102);
    });

    it('send targets configured IP and port', async () => {
        const backend = new LifxBackend({ ...BASE_CONFIG, bulbIp: '10.0.0.5', lifxPort: 56700 });
        const { mockSock } = mockSocket();
        await backend.initialize();
        await backend.execute('on');
        expect(mockSock.send).toHaveBeenCalledWith(
            expect.any(Buffer), 56700, '10.0.0.5', expect.any(Function)
        );
    });
});

// ─── UDP error propagation ────────────────────────────────────────────────────

describe('LifxBackend UDP error handling', () => {
    it('propagates socket send errors', async () => {
        const backend = new LifxBackend(BASE_CONFIG);
        mockSocketError(new Error('ENETUNREACH'));
        await backend.initialize();
        await expect(backend.execute('on')).rejects.toThrow('ENETUNREACH');
    });
});
