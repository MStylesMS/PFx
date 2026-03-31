const dgram = require('dgram');
const Logger = require('../../utils/logger');

const DEFAULT_LIFX_PORT = 56700;

// Unique source identifier for PFx in LIFX binary frames — 'Para' in ASCII (LE).
const LIFX_SOURCE_ID = 0x61726150;

// LIFX uses HSBK colour (Hue 0-65535, Saturation 0-65535, Brightness 0-65535, Kelvin 1500-9000).
// Scene entries use r/g/b (0-255) or kelvin — converted to HSBK at send time.
// Names match the WiZ/Hue/Shelly scene sets for drop-in cross-backend compatibility.
const LIFX_DEFAULT_SCENES = {
    normal:      { on: true, r: 255, g: 255, b: 255, brightness: 80  },
    dim:         { on: true,                          brightness: 35  },
    red:         { on: true, r: 255, g: 0,   b: 0,   brightness: 80  },
    blue:        { on: true, r: 0,   g: 70,  b: 255, brightness: 75  },
    green:       { on: true, r: 0,   g: 255, b: 90,  brightness: 75  },
    yellow:      { on: true, r: 255, g: 220, b: 0,   brightness: 80  },
    orange:      { on: true, r: 255, g: 110, b: 0,   brightness: 80  },
    purple:      { on: true, r: 170, g: 60,  b: 255, brightness: 75  },
    pink:        { on: true, r: 255, g: 105, b: 180, brightness: 75  },
    cyan:        { on: true, r: 0,   g: 220, b: 255, brightness: 75  },
    magenta:     { on: true, r: 255, g: 0,   b: 200, brightness: 75  },
    white:       { on: true, kelvin: 4000,            brightness: 75  },
    softWhite:   { on: true, kelvin: 2700,            brightness: 70  },
    softwhite:   { on: true, kelvin: 2700,            brightness: 70  },
    brightWhite: { on: true, kelvin: 6500,            brightness: 100 },
    brightwhite: { on: true, kelvin: 6500,            brightness: 100 },
    warmWhite:   { on: true, kelvin: 2200,            brightness: 80  },
    warmwhite:   { on: true, kelvin: 2200,            brightness: 80  },
    coolWhite:   { on: true, kelvin: 6000,            brightness: 85  },
    coolwhite:   { on: true, kelvin: 6000,            brightness: 85  },
    off:         { on: false }
};

// LIFX device.SetPower (instant on/off) and Light.SetColor (HSBK + duration).
const MSG_SET_POWER       = 21;
const MSG_LIGHT_SET_COLOR = 102;

class LifxBackend {
    constructor(config) {
        this.config = config;
        this.logger = new Logger(`LifxBackend:${config.name}`);
        this.lightIp = config.bulbIp || config.lightIp || config.ip || null;
        this.port = Number.parseInt(config.lifxPort ?? DEFAULT_LIFX_PORT, 10) || DEFAULT_LIFX_PORT;
        this.defaultKelvin = Math.max(1500, Math.min(9000,
            Number.parseInt(config.lifxKelvin ?? 3500, 10) || 3500));
        this.socket = null;
        this._seq = 0;
        this.sceneMap = {
            ...LIFX_DEFAULT_SCENES,
            ...(config.sceneMap || {})
        };
    }

    async initialize() {
        if (!this.lightIp) {
            throw new Error('LIFX backend requires bulb_ip / light_ip / ip in config');
        }
        this.socket = dgram.createSocket('udp4');
        this.logger.info(`LIFX backend ready — ${this.lightIp}:${this.port}`);
    }

    async shutdown() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
    }

    async execute(commandName, payload = {}) {
        switch (commandName) {
            case 'scene':
            case 'setColorScene': {
                const sceneName = payload.scene || payload.name;
                return this._applyScene(sceneName);
            }
            case 'on': {
                if (payload.brightness !== undefined) {
                    const hsbk = {
                        h: 0, s: 0,
                        b: this._brightnessToLifx(payload.brightness),
                        k: this.defaultKelvin
                    };
                    await this._sendMessage(this._buildSetColorMessage(hsbk));
                } else {
                    await this._sendMessage(this._buildSetPowerMessage(true));
                }
                return { applied: true };
            }
            case 'off': {
                await this._sendMessage(this._buildSetPowerMessage(false));
                return { applied: true };
            }
            case 'setBrightness': {
                const bri = this._clampBrightness(payload.brightness);
                if (bri === 0) {
                    await this._sendMessage(this._buildSetPowerMessage(false));
                } else {
                    const hsbk = { h: 0, s: 0, b: this._brightnessToLifx(bri), k: this.defaultKelvin };
                    await this._sendMessage(this._buildSetColorMessage(hsbk));
                }
                return { applied: true };
            }
            case 'setColor': {
                const rgb = this._parseColor(payload.color);
                const hsbk = this._rgbToHsbk(rgb.r, rgb.g, rgb.b, this.defaultKelvin);
                if (payload.brightness !== undefined) {
                    hsbk.b = this._brightnessToLifx(payload.brightness);
                }
                await this._sendMessage(this._buildSetColorMessage(hsbk));
                return { applied: true };
            }
            case 'fade': {
                const bri = this._clampBrightness(payload.brightness);
                if (bri === 0) {
                    await this._sendMessage(this._buildSetPowerMessage(false));
                } else {
                    const hsbk = { h: 0, s: 0, b: this._brightnessToLifx(bri), k: this.defaultKelvin };
                    await this._sendMessage(this._buildSetColorMessage(hsbk));
                }
                return { applied: true, warning: 'LIFX fade duration not implemented in Phase 1; applied immediate level change' };
            }
            default:
                throw new Error(`Unsupported LIFX command: ${commandName}`);
        }
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    async _applyScene(sceneName) {
        if (!sceneName) {
            throw new Error('Scene command missing scene name');
        }
        const scene = this.sceneMap[sceneName];
        if (!scene) {
            this.logger.warn(`Unknown LIFX scene '${sceneName}' — sending on only`);
            await this._sendMessage(this._buildSetPowerMessage(true));
            return { applied: true, warning: `Unknown scene '${sceneName}'; sent on only` };
        }

        if (!scene.on) {
            await this._sendMessage(this._buildSetPowerMessage(false));
            return { applied: true, scene: sceneName };
        }

        const hsbk = this._sceneToHsbk(scene);
        await this._sendMessage(this._buildSetColorMessage(hsbk));
        return { applied: true, scene: sceneName };
    }

    _sceneToHsbk(scene) {
        const bri = this._brightnessToLifx(scene.brightness ?? 80);

        if (scene.r !== undefined && scene.g !== undefined && scene.b !== undefined) {
            // RGB scene — convert to HSBK and replace brightness with scene value
            const hsbk = this._rgbToHsbk(scene.r, scene.g, scene.b, this.defaultKelvin);
            hsbk.b = bri;
            return hsbk;
        }

        if (scene.kelvin !== undefined) {
            // Kelvin-only white scene
            return { h: 0, s: 0, b: bri, k: Math.max(1500, Math.min(9000, scene.kelvin)) };
        }

        // Brightness-only (e.g. 'dim') — white at default kelvin
        return { h: 0, s: 0, b: bri, k: this.defaultKelvin };
    }

    // ── LIFX binary protocol ─────────────────────────────────────────────────

    /**
     * Build a 36-byte LIFX header for the given message type and payload size.
     *
     * Frame layout (LIFX LAN protocol v2):
     *   [0:2]   size         uint16le  total message length
     *   [2:4]   frame flags  0x3400    addressable=1, protocol=1024
     *   [4:8]   source       uint32le  LIFX_SOURCE_ID ('Para')
     *   [8:16]  target       zeros     — unicast is handled by destination IP
     *   [16:22] reserved     zeros
     *   [22]    flags        0x00      no ack / response required
     *   [23]    sequence     uint8     per-backend rolling counter
     *   [24:32] reserved     zeros     (protocol header timestamp)
     *   [32:34] type         uint16le  message type
     *   [34:36] reserved     zeros
     */
    _buildHeader(type, payloadLength) {
        const buf = Buffer.alloc(36, 0);
        buf.writeUInt16LE(36 + payloadLength, 0);
        buf.writeUInt16LE(0x3400, 2);
        buf.writeUInt32LE(LIFX_SOURCE_ID, 4);
        buf.writeUInt8(this._nextSeq(), 23);
        buf.writeUInt16LE(type, 32);
        return buf;
    }

    /** device.SetPower (type 21) — immediate on/off, 2-byte payload. */
    _buildSetPowerMessage(on) {
        const header = this._buildHeader(MSG_SET_POWER, 2);
        const payload = Buffer.alloc(2);
        payload.writeUInt16LE(on ? 65535 : 0, 0);
        return Buffer.concat([header, payload]);
    }

    /**
     * Light.SetColor (type 102) — HSBK + duration, 13-byte payload.
     * Payload: [reserved 1B][H 2B][S 2B][B 2B][K 2B][duration 4B]
     */
    _buildSetColorMessage({ h, s, b, k }, duration = 0) {
        const header = this._buildHeader(MSG_LIGHT_SET_COLOR, 13);
        const payload = Buffer.alloc(13, 0);
        payload.writeUInt16LE(h, 1);
        payload.writeUInt16LE(s, 3);
        payload.writeUInt16LE(b, 5);
        payload.writeUInt16LE(k, 7);
        payload.writeUInt32LE(duration, 9);
        return Buffer.concat([header, payload]);
    }

    async _sendMessage(message) {
        if (!this.socket) {
            throw new Error('LIFX backend not initialized');
        }
        await new Promise((resolve, reject) => {
            this.socket.send(message, this.port, this.lightIp, (err) => {
                if (err) { reject(err); } else { resolve(); }
            });
        });
    }

    _nextSeq() {
        this._seq = (this._seq + 1) % 256;
        return this._seq;
    }

    // ── Colour math ──────────────────────────────────────────────────────────

    /** Convert sRGB (0-255) to LIFX HSBK. Kelvin is passed through unchanged. */
    _rgbToHsbk(r, g, b, kelvin = 3500) {
        const rN = r / 255;
        const gN = g / 255;
        const bN = b / 255;

        const max = Math.max(rN, gN, bN);
        const min = Math.min(rN, gN, bN);
        const delta = max - min;

        const saturation = max === 0 ? 0 : delta / max;

        let hue = 0;
        if (delta !== 0) {
            if (max === rN)      hue = 60 * (((gN - bN) / delta) % 6);
            else if (max === gN) hue = 60 * ((bN - rN) / delta + 2);
            else                 hue = 60 * ((rN - gN) / delta + 4);
            if (hue < 0) hue += 360;
        }

        return {
            h: Math.round((hue / 360) * 65535),
            s: Math.round(saturation * 65535),
            b: Math.round(max * 65535),
            k: Math.max(1500, Math.min(9000, kelvin))
        };
    }

    /** Map PFx brightness (0-100) to LIFX brightness (0-65535). */
    _brightnessToLifx(value) {
        return Math.round(this._clampBrightness(value) / 100 * 65535);
    }

    _clampBrightness(value) {
        const n = Number.parseInt(value, 10);
        if (Number.isNaN(n)) return 100;
        return Math.max(0, Math.min(100, n));
    }

    _parseColor(color) {
        if (!color || typeof color !== 'string') {
            return { r: 255, g: 255, b: 255 };
        }
        const hex = color.trim().replace('#', '');
        if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
            throw new Error(`Invalid color '${color}', expected #RRGGBB`);
        }
        return {
            r: Number.parseInt(hex.slice(0, 2), 16),
            g: Number.parseInt(hex.slice(2, 4), 16),
            b: Number.parseInt(hex.slice(4, 6), 16)
        };
    }
}

module.exports = LifxBackend;
module.exports.LIFX_DEFAULT_SCENES = LIFX_DEFAULT_SCENES;
