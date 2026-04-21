const Logger = require('../../utils/logger');

// Shared driver state per serial port so multiple zones can reuse one controller.
const sharedDrivers = new Map();

class ZwaveBackend {
    constructor(config) {
        this.config = config;
        this.logger = new Logger(`ZwaveBackend:${config.name}`);

        this.mode = (config.zwaveMode || 'direct').toString().trim().toLowerCase();
        this.port = config.zwavePort || '/dev/zwave';
        this.nodeId = Number.parseInt(config.zwaveNodeId || config.nodeId || config.deviceId, 10);
        this.deviceType = (config.zwaveType || config.profile || 'binary_switch').toString().trim().toLowerCase();
        this.securityMode = (config.zwaveSecurityMode || 'none').toString().trim().toLowerCase();

        this.driverRef = null;
        this.driver = null;
        this.node = null;
        this.commandClasses = null;
        this.lastState = {
            power: 'unknown',
            brightness: null
        };
    }

    async initialize() {
        if (this.mode !== 'direct') {
            throw new Error(`Unsupported Z-Wave mode '${this.mode}'. Only 'direct' is implemented.`);
        }
        if (!this.port) {
            throw new Error('Z-Wave backend requires zwave_port');
        }
        if (!Number.isInteger(this.nodeId)) {
            throw new Error('Z-Wave backend requires zwave_node_id (integer)');
        }

        this.driverRef = await this._acquireSharedDriver(this.port);
        this.driver = this.driverRef.driver;

        const controller = this.driver.controller;
        if (!controller || !controller.nodes) {
            throw new Error('Z-Wave controller not available after driver startup');
        }

        this.node = controller.nodes.get(this.nodeId);
        if (!this.node) {
            throw new Error(`Z-Wave node ${this.nodeId} not found on controller '${this.port}'`);
        }

        this.commandClasses = this.node.commandClasses || {};
        this.logger.info(`Z-Wave backend ready node=${this.nodeId} type=${this.deviceType} mode=${this.mode}`);
    }

    async shutdown() {
        await this._releaseSharedDriver();
        this.driverRef = null;
        this.driver = null;
        this.node = null;
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
                const bri = payload.brightness !== undefined ? this._clampBrightness(payload.brightness) : 100;
                await this._setPower(true, bri);
                this.lastState.power = 'on';
                if (this._isLevelType()) this.lastState.brightness = bri;
                return { applied: true };
            }
            case 'off': {
                await this._setPower(false, 0);
                this.lastState.power = 'off';
                this.lastState.brightness = 0;
                return { applied: true };
            }
            case 'setBrightness': {
                const bri = this._clampBrightness(payload.brightness);
                await this._setBrightness(bri);
                this.lastState.power = bri > 0 ? 'on' : 'off';
                this.lastState.brightness = bri;
                return { applied: true };
            }
            case 'setColor':
            case 'setColorTemp': {
                return {
                    applied: false,
                    warning: `Command '${commandName}' is not implemented for Z-Wave backend yet`
                };
            }
            case 'fade': {
                const bri = this._clampBrightness(payload.brightness);
                await this._setBrightness(bri);
                this.lastState.power = bri > 0 ? 'on' : 'off';
                this.lastState.brightness = bri;
                return {
                    applied: true,
                    warning: 'Z-Wave fade duration is not implemented; applied immediate level change'
                };
            }
            case 'getStatus':
            case 'getState': {
                return this._getStatus();
            }
            default:
                throw new Error(`Unsupported Z-Wave command: ${commandName}`);
        }
    }

    async _setPower(on, brightness) {
        if (this._isLevelType()) {
            return this._setBrightness(on ? brightness : 0);
        }

        const binaryCc = this._resolveCommandClass([
            'Binary Switch',
            'binarySwitch',
            'switchBinary'
        ]);
        if (!binaryCc || typeof binaryCc.set !== 'function') {
            throw new Error(`Node ${this.nodeId} does not expose Binary Switch command class`);
        }

        await binaryCc.set(!!on);
    }

    async _setBrightness(brightness) {
        const normalized = this._clampBrightness(brightness);

        if (!this._isLevelType()) {
            return this._setPower(normalized > 0, normalized);
        }

        const levelCc = this._resolveCommandClass([
            'Multilevel Switch',
            'multilevelSwitch',
            'switchMultilevel'
        ]);
        if (!levelCc || typeof levelCc.set !== 'function') {
            throw new Error(`Node ${this.nodeId} does not expose Multilevel Switch command class`);
        }

        // Z-Wave multilevel values are commonly 0..99.
        const level = Math.max(0, Math.min(99, Math.round((normalized / 100) * 99)));
        await levelCc.set(level);
    }

    _getStatus() {
        return {
            nodeId: this.nodeId,
            mode: this.mode,
            type: this.deviceType,
            securityMode: this.securityMode,
            power: this.lastState.power,
            brightness: this.lastState.brightness
        };
    }

    _isLevelType() {
        return this.deviceType === 'multilevel_switch' || this.deviceType === 'color_dimmer' || this.deviceType === 'dimmer';
    }

    _resolveCommandClass(candidateKeys) {
        for (const key of candidateKeys) {
            if (this.commandClasses[key]) return this.commandClasses[key];
        }
        return null;
    }

    _clampBrightness(value) {
        const numeric = Number.parseInt(value, 10);
        if (Number.isNaN(numeric)) return 100;
        return Math.max(0, Math.min(100, numeric));
    }

    async _acquireSharedDriver(port) {
        let ref = sharedDrivers.get(port);

        if (!ref) {
            ref = {
                driver: null,
                startPromise: null,
                refCount: 0
            };

            ref.startPromise = this._startDriver(port)
                .then((driver) => {
                    ref.driver = driver;
                    return driver;
                })
                .catch((error) => {
                    sharedDrivers.delete(port);
                    throw error;
                });

            sharedDrivers.set(port, ref);
        }

        await ref.startPromise;
        ref.refCount += 1;
        return ref;
    }

    async _releaseSharedDriver() {
        const port = this.port;
        if (!port) return;

        const ref = sharedDrivers.get(port);
        if (!ref) return;

        ref.refCount = Math.max(0, ref.refCount - 1);
        if (ref.refCount > 0) return;

        sharedDrivers.delete(port);
        if (ref.driver && typeof ref.driver.destroy === 'function') {
            await ref.driver.destroy();
        }
    }

    async _startDriver(port) {
        let Driver;
        try {
            ({ Driver } = require('zwave-js'));
        } catch (error) {
            throw new Error(`zwave-js dependency is missing. Run 'npm install'. (${error.message})`);
        }

        const driver = new Driver(port, {
            securityKeys: {},
            interview: {
                queryAllUserCodes: false
            }
        });

        driver.on('error', (err) => {
            this.logger.error(`Z-Wave driver error on ${port}:`, err);
        });

        await driver.start();
        return driver;
    }
}

module.exports = ZwaveBackend;
