const Logger = require('../../utils/logger');

// Shelly RGBW uses direct R/G/B/W channels (0–255) — no XY gamut conversion needed.
// Channel clamping (0–255) is the Shelly equivalent of XY gamut clamping.
// White channel (w) is only meaningful for RGBW profile; switch/dimmer profiles ignore it.

/**
 * Default scene definitions. Entries include r/g/b/w (0–255) and brightness (0–100).
 * Names match the WiZ and Hue backend scene sets for drop-in cross-backend compatibility.
 */
const SHELLY_DEFAULT_SCENES = {
    normal:      { on: true,  brightness: 80  },
    dim:         { on: true,  brightness: 35  },
    red:         { on: true,  brightness: 80,  r: 255, g: 0,   b: 0,   w: 0 },
    blue:        { on: true,  brightness: 75,  r: 0,   g: 70,  b: 255, w: 0 },
    green:       { on: true,  brightness: 75,  r: 0,   g: 255, b: 90,  w: 0 },
    yellow:      { on: true,  brightness: 80,  r: 255, g: 220, b: 0,   w: 0 },
    orange:      { on: true,  brightness: 80,  r: 255, g: 110, b: 0,   w: 0 },
    purple:      { on: true,  brightness: 75,  r: 170, g: 60,  b: 255, w: 0 },
    pink:        { on: true,  brightness: 75,  r: 255, g: 105, b: 180, w: 0 },
    cyan:        { on: true,  brightness: 75,  r: 0,   g: 220, b: 255, w: 0 },
    magenta:     { on: true,  brightness: 75,  r: 255, g: 0,   b: 200, w: 0 },
    white:       { on: true,  brightness: 80,  r: 255, g: 255, b: 255, w: 255 },
    softWhite:   { on: true,  brightness: 70,  r: 255, g: 214, b: 170, w: 180 },
    brightWhite: { on: true,  brightness: 100, r: 255, g: 255, b: 255, w: 255 },
    warmWhite:   { on: true,  brightness: 80,  r: 255, g: 200, b: 140, w: 200 },
    coolWhite:   { on: true,  brightness: 85,  r: 225, g: 240, b: 255, w: 220 },
    off:         { on: false }
};

class ShellyBackend {
    constructor(config) {
        this.config = config;
        this.logger = new Logger(`ShellyBackend:${config.name}`);

        this.generation = `${config.generation || config.shellyGeneration || '1'}`;
        this.profile = (config.profile || config.deviceProfile || 'switch').toString().toLowerCase();
        this.model = (config.model || config.deviceModel || '').toString().toLowerCase();

        this.host = config.shellyHost || config.host || config.ip || null;
        this.channel = Number.parseInt(config.channel ?? config.shellyChannel ?? 0, 10) || 0;
        this.username = config.shellyAuthUser || config.username || null;
        this.password = config.shellyAuthPass || config.password || null;
        this.timeoutMs = Number.parseInt(config.httpTimeoutMs ?? config.shellyTimeoutMs ?? 4000, 10) || 4000;

        this.sceneMap = {
            ...SHELLY_DEFAULT_SCENES,
            ...(config.sceneMap || {})
        };

        this.rpcMethodOverride = config.shellyRpcMethod || null;
    }

    async initialize() {
        if (!this.host) {
            throw new Error('Shelly backend requires shelly_host/host/ip in config');
        }
        this.logger.info(`Shelly backend ready (${this.generation}/${this.profile}) at ${this.host}`);
    }

    async shutdown() {
        // Stateless backend.
    }

    async execute(commandName, payload = {}) {
        switch (commandName) {
            case 'scene':
            case 'setColorScene': {
                const sceneName = payload.scene || payload.name;
                return this._applyScene(sceneName);
            }
            case 'on':
                return this._applyOutput({ on: true, brightness: this._clampBrightness(payload.brightness ?? 100) });
            case 'off':
                return this._applyOutput({ on: false });
            case 'setBrightness':
                return this._applyOutput({ on: true, brightness: this._clampBrightness(payload.brightness) });
            case 'setColor': {
                const rgb = this._parseColor(payload.color);
                return this._applyOutput({
                    on: true,
                    brightness: this._clampBrightness(payload.brightness ?? 100),
                    ...rgb
                });
            }
            case 'setColorTemp': {
                const kelvin = Math.max(2700, Math.min(6500, Number.parseInt(payload.kelvin, 10) || 4000));
                const rgbw = this._kelvinToRgbw(kelvin);
                return this._applyOutput({
                    on: true,
                    brightness: this._clampBrightness(payload.brightness ?? 100),
                    ...rgbw
                });
            }
            case 'fade': {
                const response = await this._applyOutput({ on: payload.brightness > 0, brightness: this._clampBrightness(payload.brightness) });
                response.warning = 'Shelly fade duration not implemented yet; applied immediate level change';
                return response;
            }
            default:
                throw new Error(`Unsupported Shelly command: ${commandName}`);
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
        const result = await this._applyOutput(scene);
        result.scene = sceneName;
        return result;
    }

    async _applyOutput(state) {
        if (this.generation === '1') {
            return this._callGen1(state);
        }
        return this._callGen2(state);
    }

    async _callGen1(state) {
        const profilePath = this.profile === 'switch' ? 'relay' : (this.profile === 'dimmer' ? 'light' : 'color');
        const params = new URLSearchParams();

        if (typeof state.on === 'boolean') {
            params.set('turn', state.on ? 'on' : 'off');
        }
        if (state.brightness !== undefined) {
            params.set('brightness', `${this._clampBrightness(state.brightness)}`);
        }

        if (this.profile === 'rgbw') {
            if (state.r !== undefined) params.set('red', `${this._clampChannel(state.r)}`);
            if (state.g !== undefined) params.set('green', `${this._clampChannel(state.g)}`);
            if (state.b !== undefined) params.set('blue', `${this._clampChannel(state.b)}`);
            if (state.w !== undefined) params.set('white', `${this._clampChannel(state.w)}`);
        }

        const path = `/${profilePath}/${this.channel}?${params.toString()}`;
        await this._request(path);
        return { applied: true };
    }

    async _callGen2(state) {
        const rpcMethod = this.rpcMethodOverride || this._defaultRpcMethodForProfile();
        const params = { id: this.channel };

        if (typeof state.on === 'boolean') {
            params.on = state.on;
        }
        if (state.brightness !== undefined) {
            params.brightness = this._clampBrightness(state.brightness);
        }

        if (this.profile === 'rgbw') {
            if (state.r !== undefined) params.red = this._clampChannel(state.r);
            if (state.g !== undefined) params.green = this._clampChannel(state.g);
            if (state.b !== undefined) params.blue = this._clampChannel(state.b);
            if (state.w !== undefined) params.white = this._clampChannel(state.w);
        }

        await this._request('/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: Date.now(),
                src: 'paradoxfx',
                method: rpcMethod,
                params
            })
        });

        return { applied: true };
    }

    _defaultRpcMethodForProfile() {
        switch (this.profile) {
            case 'switch':
                return 'Switch.Set';
            case 'dimmer':
                return 'Light.Set';
            case 'rgbw':
                return 'Light.Set';
            default:
                return 'Switch.Set';
        }
    }

    async _request(path, options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const auth = this.username
                ? `${encodeURIComponent(this.username)}:${encodeURIComponent(this.password || '')}@`
                : '';

            const url = `http://${auth}${this.host}${path}`;
            const response = await fetch(url, {
                method: options.method || 'GET',
                headers: options.headers || {},
                body: options.body,
                signal: controller.signal
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Shelly HTTP ${response.status}: ${text}`);
            }

            return response;
        } catch (error) {
            if (error && error.name === 'AbortError') {
                throw new Error(`Shelly request timeout after ${this.timeoutMs}ms`);
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Approximate a colour temperature (kelvin) as RGBW channel values.
     * Uses the Tanner Helland algorithm for R/G/B and maps the W (warm white)
     * channel proportionally: full W at 2700 K, zero W at or above 5000 K.
     * For switch/dimmer profiles the r/g/b/w fields are silently ignored.
     */
    _kelvinToRgbw(kelvin) {
        const temp = kelvin / 100;
        let r, g, b;

        if (temp <= 66) {
            r = 255;
            g = Math.round(99.4708025861 * Math.log(temp) - 161.1195681661);
            b = temp <= 19 ? 0 : Math.round(138.5177312231 * Math.log(temp - 10) - 305.0447927307);
        } else {
            r = Math.round(329.698727446 * Math.pow(temp - 60, -0.1332047592));
            g = Math.round(288.1221695283 * Math.pow(temp - 60, -0.0755148492));
            b = 255;
        }

        // White channel: full at warm temps, fades to zero at 5000 K and above
        const w = Math.round(Math.max(0, 1 - (kelvin - 2700) / (5000 - 2700)) * 255);

        return {
            r: Math.max(0, Math.min(255, r)),
            g: Math.max(0, Math.min(255, g)),
            b: Math.max(0, Math.min(255, b)),
            w: Math.max(0, Math.min(255, w))
        };
    }

    _clampBrightness(value) {
        const n = Number.parseInt(value, 10);
        if (Number.isNaN(n)) return 100;
        return Math.max(0, Math.min(100, n));
    }

    /** Clamp an R/G/B/W channel value to the valid Shelly range 0–255. */
    _clampChannel(value) {
        const n = Number.parseInt(value, 10);
        if (Number.isNaN(n)) return 0;
        return Math.max(0, Math.min(255, n));
    }

    _parseColor(color) {
        if (!color || typeof color !== 'string') {
            return { r: 255, g: 255, b: 255, w: 0 };
        }

        const hex = color.trim().replace('#', '');
        if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
            throw new Error(`Invalid color '${color}', expected #RRGGBB`);
        }

        return {
            r: Number.parseInt(hex.slice(0, 2), 16),
            g: Number.parseInt(hex.slice(2, 4), 16),
            b: Number.parseInt(hex.slice(4, 6), 16),
            w: 0
        };
    }
}

module.exports = ShellyBackend;
