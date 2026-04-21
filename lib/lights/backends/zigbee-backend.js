const Logger = require('../../utils/logger');

// Shared coordinator state per serial port so multiple zones can reuse one coordinator.
const sharedControllers = new Map();

class ZigbeeBackend {
    constructor(config) {
        this.config = config;
        this.logger = new Logger(`ZigbeeBackend:${config.name}`);

        this.mode = (config.zigbeeMode || 'direct').toString().trim().toLowerCase();
        this.port = config.zigbeePort || '/dev/zigbee';
        this.adapter = (config.zigbeeAdapter || 'ember').toString().trim().toLowerCase();
        this.deviceIeee = (config.zigbeeIeee || config.deviceId || '').toString().trim().toLowerCase();
        this.deviceType = (config.zigbeeType || config.profile || 'onoff').toString().trim().toLowerCase();
        this.databasePath = config.zigbeeDbPath || '/opt/paradox/config/zigbee.db';

        this.controllerRef = null;
        this.controller = null;
        this.device = null;
        this.endpoint = null;

        this.lastState = {
            power: 'unknown',
            brightness: null,
            color: null,
            kelvin: null
        };
    }

    async initialize() {
        if (this.mode !== 'direct') {
            throw new Error(`Unsupported Zigbee mode '${this.mode}'. Only 'direct' is implemented.`);
        }
        if (!this.port) {
            throw new Error('Zigbee backend requires zigbee_port');
        }
        if (!this.deviceIeee) {
            throw new Error('Zigbee backend requires zigbee_ieee');
        }

        this.controllerRef = await this._acquireSharedController(this.port);
        this.controller = this.controllerRef.controller;

        const devices = this.controller.getDevices();
        this.device = devices.find((dev) => (dev.ieeeAddr || '').toLowerCase() === this.deviceIeee);
        if (!this.device) {
            throw new Error(`Zigbee device '${this.deviceIeee}' not found on coordinator '${this.port}'`);
        }

        this.endpoint = this._selectControllableEndpoint(this.device);
        if (!this.endpoint) {
            throw new Error(`Zigbee device '${this.deviceIeee}' has no controllable endpoint`);
        }

        this.logger.info(`Zigbee backend ready ieee=${this.deviceIeee} type=${this.deviceType} adapter=${this.adapter}`);
    }

    async shutdown() {
        await this._releaseSharedController();
        this.controllerRef = null;
        this.controller = null;
        this.device = null;
        this.endpoint = null;
    }

    async execute(commandName, payload = {}) {
        switch (commandName) {
            case 'scene':
            case 'setColorScene': {
                const scene = (payload.scene || payload.name || '').toString().trim().toLowerCase();
                if (scene === 'off') return this.execute('off', payload);
                if (scene === 'dim') return this.execute('setBrightness', { brightness: 35 });
                return this.execute('on', payload);
            }
            case 'on': {
                await this._commandOnOff('on');
                if (payload.brightness !== undefined) {
                    await this._commandBrightness(payload.brightness);
                    this.lastState.brightness = this._clampBrightness(payload.brightness);
                }
                this.lastState.power = 'on';
                return { applied: true };
            }
            case 'off': {
                await this._commandOnOff('off');
                this.lastState.power = 'off';
                this.lastState.brightness = 0;
                return { applied: true };
            }
            case 'setBrightness': {
                const brightness = this._clampBrightness(payload.brightness);
                await this._commandBrightness(brightness);
                this.lastState.power = brightness > 0 ? 'on' : 'off';
                this.lastState.brightness = brightness;
                return { applied: true };
            }
            case 'setColor': {
                const rgb = this._parseColor(payload.color);
                const xy = this._rgbToXy(rgb.r, rgb.g, rgb.b);
                const brightness = this._clampBrightness(payload.brightness ?? 100);
                await this.endpoint.command('genOnOff', 'on', {}, this._commandOptions());
                await this.endpoint.command('genLevelCtrl', 'moveToLevelWithOnOff', {
                    level: this._toZigbeeLevel(brightness),
                    transtime: 0
                }, this._commandOptions());
                await this.endpoint.command('lightingColorCtrl', 'moveToColor', {
                    colorx: xy.x,
                    colory: xy.y,
                    transtime: 0
                }, this._commandOptions());
                this.lastState.power = 'on';
                this.lastState.brightness = brightness;
                this.lastState.color = payload.color;
                return { applied: true };
            }
            case 'setColorTemp': {
                const kelvin = this._clampKelvin(payload.kelvin);
                const brightness = this._clampBrightness(payload.brightness ?? 100);
                await this.endpoint.command('genOnOff', 'on', {}, this._commandOptions());
                await this.endpoint.command('genLevelCtrl', 'moveToLevelWithOnOff', {
                    level: this._toZigbeeLevel(brightness),
                    transtime: 0
                }, this._commandOptions());
                await this.endpoint.command('lightingColorCtrl', 'moveToColorTemp', {
                    colortemp: Math.round(1000000 / kelvin),
                    transtime: 0
                }, this._commandOptions());
                this.lastState.power = 'on';
                this.lastState.brightness = brightness;
                this.lastState.kelvin = kelvin;
                return { applied: true };
            }
            case 'fade': {
                const brightness = this._clampBrightness(payload.brightness);
                await this._commandBrightness(brightness);
                this.lastState.power = brightness > 0 ? 'on' : 'off';
                this.lastState.brightness = brightness;
                return {
                    applied: true,
                    warning: 'Zigbee fade duration is not implemented; applied immediate level change'
                };
            }
            case 'getStatus':
            case 'getState': {
                return this._getStatus();
            }
            default:
                throw new Error(`Unsupported Zigbee command: ${commandName}`);
        }
    }

    async _commandOnOff(action) {
        await this.endpoint.command('genOnOff', action, {}, this._commandOptions());
    }

    async _commandBrightness(brightnessRaw) {
        const brightness = this._clampBrightness(brightnessRaw);
        await this.endpoint.command('genLevelCtrl', 'moveToLevelWithOnOff', {
            level: this._toZigbeeLevel(brightness),
            transtime: 0
        }, this._commandOptions());
    }

    _getStatus() {
        return {
            ieee: this.deviceIeee,
            mode: this.mode,
            adapter: this.adapter,
            type: this.deviceType,
            power: this.lastState.power,
            brightness: this.lastState.brightness,
            color: this.lastState.color,
            kelvin: this.lastState.kelvin
        };
    }

    _commandOptions() {
        return { disableDefaultResponse: true };
    }

    _selectControllableEndpoint(device) {
        if (!device || !Array.isArray(device.endpoints)) return null;

        // Most lighting devices expose endpoint 1 for control.
        const preferred = device.endpoints.find((ep) => ep && ep.ID === 1);
        if (preferred) return preferred;

        return device.endpoints.find((ep) => ep && typeof ep.command === 'function') || null;
    }

    _clampBrightness(value) {
        const numeric = Number.parseInt(value, 10);
        if (Number.isNaN(numeric)) return 100;
        return Math.max(0, Math.min(100, numeric));
    }

    _clampKelvin(value) {
        const numeric = Number.parseInt(value, 10);
        if (Number.isNaN(numeric)) return 4000;
        return Math.max(1500, Math.min(6500, numeric));
    }

    _toZigbeeLevel(brightness) {
        return Math.max(0, Math.min(254, Math.round((brightness / 100) * 254)));
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

    // Returns integer xy in Zigbee 0..65535 range.
    _rgbToXy(r, g, b) {
        const toLinear = (v) => {
            const x = v / 255;
            return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        };

        const rl = toLinear(r);
        const gl = toLinear(g);
        const bl = toLinear(b);

        const X = rl * 0.664511 + gl * 0.154324 + bl * 0.162028;
        const Y = rl * 0.283881 + gl * 0.668433 + bl * 0.047685;
        const Z = rl * 0.000088 + gl * 0.07231 + bl * 0.986039;

        const sum = X + Y + Z;
        const x = sum > 0 ? X / sum : 0.3127;
        const y = sum > 0 ? Y / sum : 0.329;

        return {
            x: Math.max(0, Math.min(65535, Math.round(x * 65535))),
            y: Math.max(0, Math.min(65535, Math.round(y * 65535)))
        };
    }

    async _acquireSharedController(port) {
        let ref = sharedControllers.get(port);

        if (!ref) {
            ref = {
                controller: null,
                startPromise: null,
                refCount: 0
            };

            ref.startPromise = this._startController(port)
                .then((controller) => {
                    ref.controller = controller;
                    return controller;
                })
                .catch((error) => {
                    sharedControllers.delete(port);
                    throw error;
                });

            sharedControllers.set(port, ref);
        }

        await ref.startPromise;
        ref.refCount += 1;
        return ref;
    }

    async _releaseSharedController() {
        const port = this.port;
        if (!port) return;

        const ref = sharedControllers.get(port);
        if (!ref) return;

        ref.refCount = Math.max(0, ref.refCount - 1);
        if (ref.refCount > 0) return;

        sharedControllers.delete(port);
        if (ref.controller && typeof ref.controller.stop === 'function') {
            await ref.controller.stop();
        }
    }

    async _startController(port) {
        let Controller;
        try {
            ({ Controller } = require('zigbee-herdsman'));
        } catch (error) {
            throw new Error(`zigbee-herdsman dependency is missing. Run 'npm install'. (${error.message})`);
        }

        const controller = new Controller({
            serialPort: {
                path: port,
                adapter: this.adapter
            },
            databasePath: this.databasePath,
            databaseBackupPath: `${this.databasePath}.backup`,
            backupPath: `${this.databasePath}.network.backup`,
            network: {
                panID: 0x1a62,
                extendedPanID: [0xdd, 0xdd, 0xdd, 0xdd, 0xdd, 0xdd, 0xdd, 0xdd],
                channelList: [11],
                networkKey: [
                    1, 3, 5, 7, 9, 11, 13, 15,
                    0, 2, 4, 6, 8, 10, 12, 13
                ]
            },
            acceptJoining: false
        });

        controller.on('deviceJoined', (device) => {
            this.logger.info(`Zigbee device joined: ${device.ieeeAddr || 'unknown'}`);
        });
        controller.on('deviceLeave', (device) => {
            this.logger.warn(`Zigbee device left: ${device.ieeeAddr || 'unknown'}`);
        });

        await controller.start();
        return controller;
    }
}

module.exports = ZigbeeBackend;
