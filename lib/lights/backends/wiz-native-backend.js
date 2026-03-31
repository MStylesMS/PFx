const dgram = require('dgram');
const Logger = require('../../utils/logger');

const DEFAULT_WIZ_PORT = 38899;

// WiZ uses direct R/G/B (0–255) over UDP — no XY gamut conversion is needed.
// Channel clamping (0–255) is the WiZ equivalent of XY gamut clamping.

/**
 * Default scene definitions. Each entry maps directly to a WiZ setPilot payload.
 * `state` controls power, `dimming` is brightness (0–100), r/g/b are 0–255.
 * Names match the Hue backend scene set for drop-in cross-backend compatibility.
 */
const WIZ_DEFAULT_SCENES = {
    normal:      { state: true,  dimming: 80,  sceneId: 0 },
    dim:         { state: true,  dimming: 35,  sceneId: 0 },
    red:         { state: true,  r: 255, g: 0,   b: 0,   dimming: 80 },
    blue:        { state: true,  r: 0,   g: 70,  b: 255, dimming: 75 },
    green:       { state: true,  r: 0,   g: 255, b: 90,  dimming: 75 },
    yellow:      { state: true,  r: 255, g: 220, b: 0,   dimming: 80 },
    orange:      { state: true,  r: 255, g: 110, b: 0,   dimming: 80 },
    purple:      { state: true,  r: 170, g: 60,  b: 255, dimming: 75 },
    pink:        { state: true,  r: 255, g: 105, b: 180, dimming: 75 },
    cyan:        { state: true,  r: 0,   g: 220, b: 255, dimming: 75 },
    magenta:     { state: true,  r: 255, g: 0,   b: 200, dimming: 75 },
    white:       { state: true,  r: 255, g: 255, b: 255, dimming: 75 },
    softWhite:   { state: true,  r: 255, g: 214, b: 170, dimming: 70 },
    brightWhite: { state: true,  r: 255, g: 255, b: 255, dimming: 100 },
    warmWhite:   { state: true,  r: 255, g: 200, b: 140, dimming: 80 },
    coolWhite:   { state: true,  r: 225, g: 240, b: 255, dimming: 85 },
    off:         { state: false }
};

class WizNativeBackend {
    constructor(config) {
        this.config = config;
        this.logger = new Logger(`WizNativeBackend:${config.name}`);
        this.lightIp = config.bulbIp || config.lightIp || config.ip || null;
        this.port = config.wizPort || DEFAULT_WIZ_PORT;
        this.socket = null;
        this.sceneMap = {
            ...WIZ_DEFAULT_SCENES,
            ...(config.sceneMap || {})
        };
    }

    async initialize() {
        if (!this.lightIp) {
            throw new Error('WiZ backend requires bulb_ip/light_ip/ip in config');
        }

        this.socket = dgram.createSocket('udp4');
        this.logger.info(`WiZ backend ready for ${this.lightIp}:${this.port}`);
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
            case 'on':
                return this._sendPilot({ state: true, dimming: this._clampBrightness(payload.brightness ?? 100) });
            case 'off':
                return this._sendPilot({ state: false });
            case 'setBrightness':
                return this._sendPilot({ state: true, dimming: this._clampBrightness(payload.brightness) });
            case 'setColor': {
                const rgb = this._parseColor(payload.color);
                return this._sendPilot({
                    state: true,
                    dimming: this._clampBrightness(payload.brightness ?? 100),
                    r: this._clampChannel(rgb.r),
                    g: this._clampChannel(rgb.g),
                    b: this._clampChannel(rgb.b)
                });
            }
            case 'fade': {
                const dimming = this._clampBrightness(payload.brightness);
                const result = await this._sendPilot({ state: dimming > 0, dimming });
                result.warning = 'WiZ fade duration is not natively supported; applied immediate level change';
                return result;
            }
            default:
                throw new Error(`Unsupported WiZ command: ${commandName}`);
        }
    }

    async _applyScene(sceneName) {
        if (!sceneName) {
            throw new Error('Scene command missing scene name');
        }
        const scene = this.sceneMap[sceneName]
            ?? this.sceneMap[Object.keys(this.sceneMap).find(k => k.toLowerCase() === sceneName.toLowerCase())];
        if (!scene) {
            throw new Error(`Unknown scene '${sceneName}'`);
        }
        const result = await this._sendPilot(scene);
        result.scene = sceneName;
        return result;
    }

    async _sendPilot(params) {
        const command = {
            method: 'setPilot',
            params
        };

        await this._sendUdp(command);
        return { applied: true };
    }

    async _sendUdp(message) {
        if (!this.socket) {
            throw new Error('WiZ backend not initialized');
        }

        const payload = Buffer.from(JSON.stringify(message));

        await new Promise((resolve, reject) => {
            this.socket.send(payload, this.port, this.lightIp, (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }

    _clampBrightness(value) {
        const numeric = Number.parseInt(value, 10);
        if (Number.isNaN(numeric)) return 100;
        return Math.max(0, Math.min(100, numeric));
    }

    /** Clamp an R/G/B channel value to the valid WiZ range 0–255. */
    _clampChannel(value) {
        const n = Number.parseInt(value, 10);
        if (Number.isNaN(n)) return 0;
        return Math.max(0, Math.min(255, n));
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

module.exports = WizNativeBackend;
