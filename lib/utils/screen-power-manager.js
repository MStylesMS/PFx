/**
 * Screen Power Manager
 *
 * Manages display power states via configurable methods:
 * none | xrandr | dpms | cec | ddc
 */

const fs = require('fs');
const path = require('path');
const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const Logger = require('../utils/logger');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const VALID_METHODS = new Set(['none', 'xrandr', 'dpms', 'cec', 'ddc']);

class ScreenPowerManager {
    constructor(display = ':0') {
        this.display = display;
        this.logger = new Logger('ScreenPowerManager');
        this.isAsleep = false;
    }

    /**
     * Normalize method string; invalid values become 'none'.
     * @param {string} method
     * @returns {string}
     */
    static normalizeMethod(method) {
        const m = String(method || 'none').trim().toLowerCase();
        return VALID_METHODS.has(m) ? m : 'none';
    }

    /**
     * Derive /dev/cecN from output_name (HDMI-N) or target_monitor index.
     */
    static deriveCecDevice({ outputName, targetMonitor, cecDevice } = {}) {
        if (cecDevice) return cecDevice;
        if (outputName) {
            const m = /^HDMI-(\d+)$/i.exec(String(outputName).trim());
            if (m) return `/dev/cec${Number(m[1]) - 1}`;
        }
        const idx = Number.isInteger(targetMonitor) ? targetMonitor : parseInt(targetMonitor, 10);
        if (Number.isFinite(idx) && idx >= 0) return `/dev/cec${idx}`;
        return null;
    }

    /**
     * Best-effort I2C bus from DRM HDMI connector sysfs.
     */
    static deriveI2cBus({ outputName, targetMonitor, i2cBus } = {}) {
        if (i2cBus != null && i2cBus !== '') {
            const n = parseInt(i2cBus, 10);
            return Number.isFinite(n) ? n : null;
        }
        let portNum = null;
        if (outputName) {
            const m = /^HDMI-(\d+)$/i.exec(String(outputName).trim());
            if (m) portNum = Number(m[1]);
        }
        if (portNum == null) {
            const idx = Number.isInteger(targetMonitor) ? targetMonitor : parseInt(targetMonitor, 10);
            if (Number.isFinite(idx) && idx >= 0) portNum = idx + 1; // target 0 → HDMI-1
        }
        if (portNum == null) return null;
        try {
            const drmRoot = '/sys/class/drm';
            const names = fs.readdirSync(drmRoot).filter((n) => n.endsWith(`HDMI-A-${portNum}`));
            for (const name of names) {
                const ddc = path.join(drmRoot, name, 'ddc');
                try {
                    const real = fs.realpathSync(ddc);
                    const bus = path.basename(real); // i2c-21
                    const bm = /^i2c-(\d+)$/.exec(bus);
                    if (bm) return Number(bm[1]);
                } catch {
                    /* continue */
                }
            }
        } catch {
            /* ignore */
        }
        return null;
    }

    /**
     * Put all connected displays to sleep using DPMS
     */
    async sleepScreens() {
        try {
            this.logger.info('Putting all displays to sleep via DPMS');
            
            // Send DPMS standby command to turn off displays
            await execAsync(`DISPLAY=${this.display} xset dpms force standby`);
            
            this.isAsleep = true;
            this.logger.info('✅ All displays are now asleep');
            
        } catch (error) {
            this.logger.error('Failed to put displays to sleep:', error.message);
            throw new Error(`Screen sleep failed: ${error.message}`);
        }
    }

    /**
     * Wake all connected displays from sleep using DPMS
     */
    async wakeScreens() {
        try {
            this.logger.info('Waking all displays from sleep via DPMS');
            
            // Send DPMS on command to wake displays
            await execAsync(`DISPLAY=${this.display} xset dpms force on`);
            
            // Also send a mouse movement to ensure wake
            await execAsync(`DISPLAY=${this.display} xdotool mousemove_relative 1 0`).catch(() => {
                // xdotool might not be available, but that's OK
                this.logger.debug('xdotool not available for mouse wake assist');
            });
            
            // After waking all displays, ensure proper positioning
            await this.ensureProperDisplayPositioning();
            
            this.isAsleep = false;
            this.logger.info('✅ All displays are now awake');
            
        } catch (error) {
            this.logger.error('Failed to wake displays:', error.message);
            throw new Error(`Screen wake failed: ${error.message}`);
        }
    }

    /**
     * Get current sleep state
     */
    getState() {
        return {
            isAsleep: this.isAsleep,
            display: this.display
        };
    }

    /**
     * Check if DPMS is available and functional
     */
    async checkDpmsSupport() {
        try {
            const { stdout } = await execAsync(`DISPLAY=${this.display} xset q`);
            
            if (stdout.includes('DPMS is Enabled') || stdout.includes('DPMS is Disabled')) {
                this.logger.info('✅ DPMS support detected');
                return true;
            } else {
                this.logger.warn('⚠️  DPMS support not detected');
                return false;
            }
            
        } catch (error) {
            this.logger.error('Failed to check DPMS support:', error.message);
            return false;
        }
    }

    /**
     * Ensure screen blanking is disabled for ParadoxFX operation
     * This should be called during initialization
     */
    async disableScreenBlanking() {
        try {
            this.logger.info('Disabling screen blanking for continuous operation');
            
            const commands = [
                `DISPLAY=${this.display} xset s off`,          // Disable screensaver
                `DISPLAY=${this.display} xset -dpms`,          // Disable DPMS auto-sleep
                `DISPLAY=${this.display} xset s noblank`,      // Prevent blanking
                `DISPLAY=${this.display} xset dpms 0 0 0`      // Set DPMS timeouts to 0
            ];

            for (const command of commands) {
                await execAsync(command);
            }
            
            this.logger.info('✅ Screen blanking disabled - displays will stay active');
            
        } catch (error) {
            this.logger.error('Failed to disable screen blanking:', error.message);
            throw new Error(`Screen blanking disable failed: ${error.message}`);
        }
    }

    /**
     * Get current display information with detailed positioning
     */
    async getDisplayInfo() {
        try {
            const { stdout } = await execAsync(`DISPLAY=${this.display} xrandr --current`);
            
            const displays = [];
            const lines = stdout.split('\n');
            
            for (const line of lines) {
                if (line.includes(' connected')) {
                    // Enhanced regex to capture all connected displays with positioning
                    const match = line.match(/^([A-Z0-9-]+)\s+connected\s+(?:primary\s+)?(?:(\d+x\d+\+\d+\+\d+)|\(normal)/);
                    if (match) {
                        const name = match[1];
                        const geometry = match[2] || null;
                        let width = 0, height = 0, x = 0, y = 0;
                        
                        if (geometry) {
                            const geoMatch = geometry.match(/(\d+)x(\d+)\+(\d+)\+(\d+)/);
                            if (geoMatch) {
                                width = parseInt(geoMatch[1]);
                                height = parseInt(geoMatch[2]);
                                x = parseInt(geoMatch[3]);
                                y = parseInt(geoMatch[4]);
                            }
                        }
                        
                        displays.push({
                            name,
                            connected: true,
                            geometry,
                            width,
                            height,
                            x,
                            y,
                            isPrimary: line.includes('primary')
                        });
                    }
                }
            }
            
            return displays;
            
        } catch (error) {
            this.logger.error('Failed to get display info:', error.message);
            return [];
        }
    }

    /**
     * Detect positioning conflicts where multiple monitors have overlapping coordinates
     * @returns {Array} Array of conflict descriptions
     */
    detectPositionConflicts(displays) {
        const conflicts = [];
        
        for (let i = 0; i < displays.length; i++) {
            for (let j = i + 1; j < displays.length; j++) {
                const display1 = displays[i];
                const display2 = displays[j];
                
                // Check if both displays start at the same position
                if (display1.x === display2.x && display1.y === display2.y) {
                    conflicts.push({
                        type: 'overlapping_position',
                        displays: [display1.name, display2.name],
                        position: `${display1.x},${display1.y}`,
                        description: `${display1.name} and ${display2.name} both positioned at ${display1.x},${display1.y}`
                    });
                }
                
                // Check for partial overlaps
                const overlap = this._calculateOverlap(display1, display2);
                if (overlap.area > 0) {
                    conflicts.push({
                        type: 'partial_overlap',
                        displays: [display1.name, display2.name],
                        overlap_area: overlap.area,
                        description: `${display1.name} and ${display2.name} have overlapping area of ${overlap.area} pixels`
                    });
                }
            }
        }
        
        return conflicts;
    }

    /**
     * Calculate overlap area between two displays
     * @private
     */
    _calculateOverlap(display1, display2) {
        const x1 = Math.max(display1.x, display2.x);
        const y1 = Math.max(display1.y, display2.y);
        const x2 = Math.min(display1.x + display1.width, display2.x + display2.width);
        const y2 = Math.min(display1.y + display1.height, display2.y + display2.height);
        
        const width = Math.max(0, x2 - x1);
        const height = Math.max(0, y2 - y1);
        
        return {
            area: width * height,
            width,
            height,
            x: x1,
            y: y1
        };
    }

    /**
     * Automatically repair display positioning using intelligent layout
     * @param {Array} displays - Array of display objects from getDisplayInfo()
     */
    async repairDisplayPositioning(displays) {
        if (displays.length < 2) {
            this.logger.debug('Only one display, no positioning repair needed');
            return;
        }
        
        this.logger.info('Repairing display positioning...');
        
        // Sort displays by priority: primary first, then by name
        const sortedDisplays = displays.sort((a, b) => {
            if (a.isPrimary && !b.isPrimary) return -1;
            if (!a.isPrimary && b.isPrimary) return 1;
            return a.name.localeCompare(b.name);
        });
        
        // Position displays horizontally from left to right
        let currentX = 0;
        const commands = [];
        
        for (let i = 0; i < sortedDisplays.length; i++) {
            const display = sortedDisplays[i];
            const isPrimary = i === 0 || display.isPrimary;
            
            if (isPrimary) {
                // Primary display at origin
                commands.push(`--output ${display.name} --mode ${display.width}x${display.height} --pos 0x0 --primary`);
                currentX = display.width;
            } else {
                // Secondary displays positioned to the right
                commands.push(`--output ${display.name} --mode ${display.width}x${display.height} --pos ${currentX}x0`);
                currentX += display.width;
            }
        }
        
        // Execute the xrandr command to reposition all displays
        const xrandrCommand = `DISPLAY=${this.display} xrandr ${commands.join(' ')}`;
        
        try {
            this.logger.debug(`Executing positioning repair: ${xrandrCommand}`);
            await execAsync(xrandrCommand);
            this.logger.info('✅ Display positioning repaired successfully');
            
            // Verify the repair worked
            await new Promise(resolve => setTimeout(resolve, 500)); // Give xrandr time to apply changes
            const updatedDisplays = await this.getDisplayInfo();
            const remainingConflicts = this.detectPositionConflicts(updatedDisplays);
            
            if (remainingConflicts.length > 0) {
                this.logger.warn('Some positioning conflicts remain after repair:', remainingConflicts);
            } else {
                this.logger.info('✅ All positioning conflicts resolved');
            }
            
        } catch (error) {
            this.logger.error('Failed to repair display positioning:', error.message);
            throw new Error(`Display positioning repair failed: ${error.message}`);
        }
    }

    /**
     * Ensure all displays have proper positioning (main repair function)
     */
    async ensureProperDisplayPositioning() {
        try {
            const displays = await this.getDisplayInfo();
            const conflicts = this.detectPositionConflicts(displays);
            
            if (conflicts.length > 0) {
                this.logger.warn(`Detected ${conflicts.length} display positioning conflicts:`, conflicts);
                await this.repairDisplayPositioning(displays);
            } else {
                this.logger.debug('Display positioning is correct, no repair needed');
            }
            
        } catch (error) {
            this.logger.error('Failed to ensure proper display positioning:', error.message);
            // Don't throw - this is a safety net, not a critical operation
        }
    }

    /**
     * Auto-wake displays if needed for media commands (legacy DPMS-global path).
     * Prefer wakeOutput() with zone monitor_control_method for per-zone control.
     */
    async autoWakeForMedia(mediaType = 'unknown') {
        if (this.isAsleep) {
            this.logger.info(`Auto-waking displays for ${mediaType} playback`);
            await this.wakeScreens();
        }
    }

    /**
     * Sleep / blank a zone output using the configured monitor_control_method.
     * @param {object} options
     * @param {string} [options.method='none']
     * @param {number} [options.targetMonitor=0]
     * @param {string|null} [options.outputName]
     * @param {string|null} [options.cecDevice]
     * @param {number|null} [options.i2cBus]
     */
    async sleepOutput(options = {}) {
        const method = ScreenPowerManager.normalizeMethod(options.method);
        if (method === 'none') {
            this.logger.info('monitor_control_method=none; sleepOutput no-op');
            return { applied: false, method, reason: 'none' };
        }

        switch (method) {
            case 'xrandr': {
                const index = options.targetMonitor != null ? options.targetMonitor : 0;
                if (options.outputName) {
                    await this._xrandrOutputOff(options.outputName);
                } else {
                    await this.sleepMonitor(index);
                }
                break;
            }
            case 'dpms':
                await execAsync(`DISPLAY=${this.display} xset dpms force off`);
                this.isAsleep = true;
                break;
            case 'cec': {
                const cec = ScreenPowerManager.deriveCecDevice(options);
                if (!cec) throw new Error('CEC sleep requires monitor_cec_device, output_name, or target_monitor');
                await this._cecCommand(cec, 'standby 0');
                this.isAsleep = true;
                break;
            }
            case 'ddc': {
                const bus = ScreenPowerManager.deriveI2cBus(options);
                if (bus == null) throw new Error('DDC sleep requires monitor_i2c_bus or a resolvable HDMI output');
                await this._ddcSetPower(bus, 0x04);
                this.isAsleep = true;
                break;
            }
            default:
                throw new Error(`Unsupported monitor_control_method: ${method}`);
        }

        this.logger.info(`sleepOutput applied via ${method}`);
        return { applied: true, method };
    }

    /**
     * Wake / power on a zone output using the configured monitor_control_method.
     */
    async wakeOutput(options = {}) {
        const method = ScreenPowerManager.normalizeMethod(options.method);
        if (method === 'none') {
            this.logger.info('monitor_control_method=none; wakeOutput no-op');
            return { applied: false, method, reason: 'none' };
        }

        switch (method) {
            case 'xrandr': {
                const index = options.targetMonitor != null ? options.targetMonitor : 0;
                if (options.outputName) {
                    await this._xrandrOutputOn(options.outputName);
                } else {
                    await this.wakeMonitor(index);
                }
                break;
            }
            case 'dpms':
                await execAsync(`DISPLAY=${this.display} xset dpms force on`);
                await execAsync(`DISPLAY=${this.display} xset dpms 0 0 0`).catch(() => {});
                this.isAsleep = false;
                break;
            case 'cec': {
                const cec = ScreenPowerManager.deriveCecDevice(options);
                if (!cec) throw new Error('CEC wake requires monitor_cec_device, output_name, or target_monitor');
                await this._cecCommand(cec, 'on 0');
                await this._cecCommand(cec, 'as').catch((err) => {
                    this.logger.debug(`CEC active-source assist failed: ${err.message}`);
                });
                this.isAsleep = false;
                break;
            }
            case 'ddc': {
                const bus = ScreenPowerManager.deriveI2cBus(options);
                if (bus == null) throw new Error('DDC wake requires monitor_i2c_bus or a resolvable HDMI output');
                await this._ddcSetPower(bus, 0x01);
                this.isAsleep = false;
                break;
            }
            default:
                throw new Error(`Unsupported monitor_control_method: ${method}`);
        }

        this.logger.info(`wakeOutput applied via ${method}`);
        return { applied: true, method };
    }

    async _xrandrOutputOff(outputName) {
        this.logger.info(`Putting display ${outputName} to sleep via xrandr`);
        await execAsync(`DISPLAY=${this.display} xrandr --output ${outputName} --off`);
        this.isAsleep = true;
    }

    async _xrandrOutputOn(outputName) {
        this.logger.info(`Waking display ${outputName} via xrandr`);
        await execAsync(`DISPLAY=${this.display} xrandr --output ${outputName} --auto`);
        await this.ensureProperDisplayPositioning();
        this.isAsleep = false;
    }

    async _cecCommand(cecDevice, commandLine) {
        const script = `printf '%s\\n' '${commandLine.replace(/'/g, `'\\''`)}' | timeout 8 cec-client -s -d 1 '${cecDevice}'`;
        this.logger.debug(`CEC: ${commandLine} on ${cecDevice}`);
        await execAsync(script, { timeout: 12000 });
    }

    async _ddcSetPower(bus, value) {
        const hex = `0x${Number(value).toString(16)}`;
        this.logger.debug(`ddcutil -b ${bus} setvcp 0xD6 ${hex}`);
        await execFileAsync('ddcutil', ['-b', String(bus), 'setvcp', '0xD6', hex], { timeout: 20000 });
    }

    /**
     * Put a specific display (monitor) to sleep by turning it off via xrandr
     * @param {number} index - Monitor index from getDisplayInfo()
     */
    async sleepMonitor(index) {
        const displays = await this.getDisplayInfo();
        if (index < 0 || index >= displays.length) {
            throw new Error(`Invalid monitor index: ${index}`);
        }
        const output = displays[index].name;
        this.logger.info(`Putting display ${output} to sleep via xrandr`);
        await execAsync(`DISPLAY=${this.display} xrandr --output ${output} --off`);
        this.isAsleep = true;
    }

    /**
     * Wake a specific display (monitor) by enabling it via xrandr
     * @param {number} index - Monitor index from getDisplayInfo()
     */
    async wakeMonitor(index) {
        const displays = await this.getDisplayInfo();
        if (index < 0 || index >= displays.length) {
            throw new Error(`Invalid monitor index: ${index}`);
        }
        const output = displays[index].name;
        this.logger.info(`Waking display ${output} via xrandr`);
        await execAsync(`DISPLAY=${this.display} xrandr --output ${output} --auto`);
        
        // After waking a monitor, ensure all displays have proper positioning
        await this.ensureProperDisplayPositioning();
        
        this.isAsleep = false;
    }

    /**
     * Determine if audio device should trigger auto-wake
     * HDMI audio should wake displays, analog audio should not
     */
    shouldWakeForAudio(audioDevice) {
        if (!audioDevice) return false;
        
        // HDMI audio devices should wake displays
        const hdmiPatterns = [
            /hdmi/i,
            /vc4hdmi/i,
            /CARD=/i
        ];
        
        return hdmiPatterns.some(pattern => pattern.test(audioDevice));
    }

    /**
     * Recover all monitors by ensuring they're awake and properly positioned
     * This is a comprehensive recovery method for display issues
     */
    async recoverAllMonitors() {
        try {
            this.logger.info('Performing comprehensive monitor recovery...');
            
            // First, wake all displays
            await this.wakeScreens();
            
            // Give displays time to initialize
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Force positioning repair
            await this.ensureProperDisplayPositioning();
            
            this.logger.info('✅ Monitor recovery completed');
            
        } catch (error) {
            this.logger.error('Monitor recovery failed:', error.message);
            throw new Error(`Monitor recovery failed: ${error.message}`);
        }
    }
}

module.exports = ScreenPowerManager;
