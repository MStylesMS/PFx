const https = require('https');
const Logger = require('../../utils/logger');

// Gamut B triangle vertices — covers the majority of Hue color bulbs
const GAMUT_B = {
    r: { x: 0.675, y: 0.322 },
    g: { x: 0.409, y: 0.518 },
    b: { x: 0.167, y: 0.040 }
};

/**
 * Default scene definitions — RGB values and kelvin are converted to Hue v2
 * payloads at runtime according to the zone's hue_profile (color / ct / dim).
 * Names match the WiZ scene name set for drop-in compatibility.
 */
const HUE_DEFAULT_SCENES = {
    normal:      { on: true, r: 255, g: 255, b: 255, brightness: 80 },
    dim:         { on: true, brightness: 35 },
    red:         { on: true, r: 255, g: 0,   b: 0,   brightness: 80 },
    blue:        { on: true, r: 0,   g: 70,  b: 255, brightness: 75 },
    green:       { on: true, r: 0,   g: 255, b: 90,  brightness: 75 },
    yellow:      { on: true, r: 255, g: 220, b: 0,   brightness: 80 },
    orange:      { on: true, r: 255, g: 110, b: 0,   brightness: 80 },
    purple:      { on: true, r: 170, g: 60,  b: 255, brightness: 75 },
    pink:        { on: true, r: 255, g: 105, b: 180, brightness: 75 },
    cyan:        { on: true, r: 0,   g: 220, b: 255, brightness: 75 },
    magenta:     { on: true, r: 255, g: 0,   b: 200, brightness: 75 },
    white:       { on: true, kelvin: 4000,   brightness: 75 },
    softWhite:   { on: true, kelvin: 2700,   brightness: 70 },
    softwhite:   { on: true, kelvin: 2700,   brightness: 70 },
    brightWhite: { on: true, kelvin: 6500,   brightness: 100 },
    brightwhite: { on: true, kelvin: 6500,   brightness: 100 },
    warmWhite:   { on: true, kelvin: 2200,   brightness: 80 },
    warmwhite:   { on: true, kelvin: 2200,   brightness: 80 },
    coolWhite:   { on: true, kelvin: 6000,   brightness: 85 },
    coolwhite:   { on: true, kelvin: 6000,   brightness: 85 },
    off:         { on: false }
};

class HueBackend {
    constructor(config) {
        this.config = config;
        this.logger = new Logger(`HueBackend:${config.name}`);

        this.bridgeHost = config.hueBridgeHost || null;
        this.appKey = config.hueAppKey || null;
        this.resourceId = config.hueResourceId || null;
        this.resourceType = (config.hueResourceType || 'room').toLowerCase();
        this.profile = (config.hueProfile || 'color').toLowerCase();
        this.timeoutMs = Number.parseInt(config.httpTimeoutMs ?? 5000, 10) || 5000;

        this.agent = new https.Agent({ rejectUnauthorized: false });

        this.sceneMap = {
            ...HUE_DEFAULT_SCENES,
            ...(config.sceneMap || {})
        };
    }

    async initialize() {
        if (!this.bridgeHost) {
            throw new Error('Hue backend requires hue_bridge_host in config');
        }
        if (!this.appKey) {
            throw new Error('Hue backend requires hue_app_key in config');
        }
        if (!this.resourceId) {
            throw new Error('Hue backend requires hue_resource_id in config');
        }

        // Probe the resource to validate connectivity
        try {
            const path = this._resourcePath();
            await this._request('GET', path);
            this.logger.info(`Hue backend ready — ${this.resourceType} profile=${this.profile} host=${this.bridgeHost}`);
        } catch (err) {
            throw new Error(`Hue backend initialization failed: ${err.message}`);
        }
    }

    async shutdown() {
        this.agent.destroy();
    }

    async execute(commandName, payload = {}) {
        switch (commandName) {
            case 'scene':
            case 'setColorScene': {
                const sceneName = payload.scene || payload.name;
                return this._applyScene(sceneName);
            }
            case 'on': {
                const body = { on: { on: true } };
                if (payload.brightness !== undefined) {
                    body.dimming = { brightness: this._clampBrightness(payload.brightness) };
                }
                await this._put(body);
                return { applied: true };
            }
            case 'off': {
                await this._put({ on: { on: false } });
                return { applied: true };
            }
            case 'setBrightness': {
                const bri = this._clampBrightness(payload.brightness);
                await this._put({ on: { on: bri > 0 }, dimming: { brightness: bri } });
                return { applied: true };
            }
            case 'setColor': {
                const rgb = this._parseColor(payload.color);
                const body = this._buildColorPayload(rgb.r, rgb.g, rgb.b, payload.brightness ?? 100);
                await this._put(body);
                return { applied: true };
            }
            case 'fade': {
                const bri = this._clampBrightness(payload.brightness);
                await this._put({ on: { on: bri > 0 }, dimming: { brightness: bri } });
                const result = { applied: true };
                result.warning = 'Hue fade duration not implemented in Phase 1; applied immediate level change';
                return result;
            }
            default:
                throw new Error(`Unsupported Hue command: ${commandName}`);
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
            this.logger.warn(`Unknown Hue scene '${sceneName}' — sending on only`);
            await this._put({ on: { on: true } });
            return { applied: true, warning: `Unknown scene '${sceneName}'; sent on only` };
        }

        if (!scene.on) {
            await this._put({ on: { on: false } });
            return { applied: true, scene: sceneName };
        }

        const body = this._buildScenePayload(scene);
        await this._put(body);
        return { applied: true, scene: sceneName };
    }

    /**
     * Builds a Hue v2 PUT body from a scene definition, respecting the zone profile.
     */
    _buildScenePayload(scene) {
        const body = { on: { on: true } };

        const bri = scene.brightness !== undefined ? this._clampBrightness(scene.brightness) : undefined;
        if (bri !== undefined) {
            body.dimming = { brightness: bri };
        }

        if (this.profile === 'dim') {
            return body;
        }

        // CT profile: prefer kelvin field; fall back to approximate from RGB
        if (this.profile === 'ct') {
            const kelvin = scene.kelvin ?? this._rgbToKelvin(scene.r, scene.g, scene.b);
            if (kelvin !== undefined) {
                body.color_temperature = { mirek: this._kelvinToMirek(kelvin) };
            }
            return body;
        }

        // Color profile (default): prefer r/g/b; fall back to approximate from kelvin
        if (scene.r !== undefined && scene.g !== undefined && scene.b !== undefined) {
            const xy = this._rgbToXy(scene.r, scene.g, scene.b);
            body.color = { xy };
        } else if (scene.kelvin !== undefined) {
            // Warm/cool white expressed as kelvin — convert to approximate RGB then XY
            const rgb = this._kelvinToRgb(scene.kelvin);
            const xy = this._rgbToXy(rgb.r, rgb.g, rgb.b);
            body.color = { xy };
        }

        return body;
    }

    _buildColorPayload(r, g, b, briRaw) {
        const body = { on: { on: true } };
        const bri = this._clampBrightness(briRaw);
        body.dimming = { brightness: bri };

        if (this.profile === 'dim') return body;
        if (this.profile === 'ct') {
            const kelvin = this._rgbToKelvin(r, g, b);
            if (kelvin !== undefined) {
                body.color_temperature = { mirek: this._kelvinToMirek(kelvin) };
            }
            return body;
        }

        const xy = this._rgbToXy(r, g, b);
        body.color = { xy };
        return body;
    }

    _resourcePath() {
        // Individual light uses /light, rooms and zones both target the grouped_light service RID
        if (this.resourceType === 'light') {
            return `/clip/v2/resource/light/${this.resourceId}`;
        }
        return `/clip/v2/resource/grouped_light/${this.resourceId}`;
    }

    async _put(body) {
        return this._request('PUT', this._resourcePath(), body);
    }

    _request(method, path, body) {
        return new Promise((resolve, reject) => {
            const payload = body ? JSON.stringify(body) : undefined;
            const options = {
                hostname: this.bridgeHost,
                port: 443,
                path,
                method,
                headers: {
                    'hue-application-key': this.appKey,
                    'Content-Type': 'application/json'
                },
                agent: this.agent
            };
            if (payload) {
                options.headers['Content-Length'] = Buffer.byteLength(payload);
            }

            const timer = setTimeout(() => {
                req.destroy(new Error(`Hue request timeout after ${this.timeoutMs}ms`));
            }, this.timeoutMs);

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    clearTimeout(timer);
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        reject(new Error(`Hue HTTP ${res.statusCode}: ${data}`));
                    } else {
                        try {
                            resolve(data ? JSON.parse(data) : {});
                        } catch {
                            resolve({});
                        }
                    }
                });
            });

            req.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });

            if (payload) req.write(payload);
            req.end();
        });
    }

    // -------------------------------------------------------------------------
    // Colour math
    // -------------------------------------------------------------------------

    /**
     * Convert sRGB (0–255) to Hue v2 XY (CIE 1931) with Gamut-B clamp.
     * Uses the Philips Wide-Gamut D65 sRGB→XYZ matrix.
     */
    _rgbToXy(r, g, b) {
        // Gamma-correct to linear
        const toLinear = (c) => {
            const srgb = c / 255;
            return srgb > 0.04045 ? Math.pow((srgb + 0.055) / 1.055, 2.4) : srgb / 12.92;
        };
        const rL = toLinear(r);
        const gL = toLinear(g);
        const bL = toLinear(b);

        // Wide-gamut D65 matrix (Philips recommended)
        const X = rL * 0.664511 + gL * 0.154324 + bL * 0.162028;
        const Y = rL * 0.283881 + gL * 0.668433 + bL * 0.047685;
        const Z = rL * 0.000088 + gL * 0.072310 + bL * 0.986039;

        const sum = X + Y + Z;
        if (sum === 0) return { x: 0.3127, y: 0.3290 }; // D65 white point

        const x = X / sum;
        const y = Y / sum;

        return this._clampToGamutB(x, y);
    }

    /** Clamp XY point to Gamut-B triangle. */
    _clampToGamutB(x, y) {
        const point = { x, y };
        const { r, g, b } = GAMUT_B;

        if (this._isInGamutTriangle(point, r, g, b)) {
            return point;
        }

        const pRG = this._closestPointOnSegment(r, g, point);
        const pGB = this._closestPointOnSegment(g, b, point);
        const pBR = this._closestPointOnSegment(b, r, point);

        const dRG = this._distSq(point, pRG);
        const dGB = this._distSq(point, pGB);
        const dBR = this._distSq(point, pBR);

        if (dRG <= dGB && dRG <= dBR) return pRG;
        if (dGB <= dRG && dGB <= dBR) return pGB;
        return pBR;
    }

    _isInGamutTriangle(p, v1, v2, v3) {
        const d1 = this._crossProduct(p, v1, v2);
        const d2 = this._crossProduct(p, v2, v3);
        const d3 = this._crossProduct(p, v3, v1);
        const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
        const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
        return !(hasNeg && hasPos);
    }

    _crossProduct(p, a, b) {
        return (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
    }

    _closestPointOnSegment(a, b, p) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return a;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
        return { x: a.x + t * dx, y: a.y + t * dy };
    }

    _distSq(a, b) {
        return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    }

    /** Convert colour temperature in Kelvin to Hue mirek, clamped to 153–500. */
    _kelvinToMirek(kelvin) {
        const mirek = Math.round(1_000_000 / kelvin);
        return Math.max(153, Math.min(500, mirek));
    }

    /**
     * Very rough approximation: convert an RGB scene to an equivalent kelvin
     * for use when a colour bulb gets a CT-only scene. Returns undefined if
     * the RGB colour is too saturated to map sensibly to a CT value.
     */
    _rgbToKelvin(r, g, b) {
        if (r === undefined || g === undefined || b === undefined) return undefined;
        // If the colour is highly saturated don't approximate
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max === 0 || (max - min) / max > 0.25) return undefined;
        // Approximate: R-heavy = warm, B-heavy = cool
        const ratio = r / (r + b + 1);
        return Math.round(2000 + ratio * 4500);
    }

    /**
     * Very rough kelvin → RGB approximation (Tanner Helland algorithm, simplified).
     * Used only when upcasting a CT scene to a colour target.
     */
    _kelvinToRgb(kelvin) {
        const temp = kelvin / 100;
        let red, green, blue;

        if (temp <= 66) {
            red = 255;
            green = Math.round(99.4708025861 * Math.log(temp) - 161.1195681661);
            blue = temp <= 19 ? 0 : Math.round(138.5177312231 * Math.log(temp - 10) - 305.0447927307);
        } else {
            red = Math.round(329.698727446 * Math.pow(temp - 60, -0.1332047592));
            green = Math.round(288.1221695283 * Math.pow(temp - 60, -0.0755148492));
            blue = 255;
        }

        return {
            r: Math.max(0, Math.min(255, red)),
            g: Math.max(0, Math.min(255, green)),
            b: Math.max(0, Math.min(255, blue))
        };
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

module.exports = HueBackend;
