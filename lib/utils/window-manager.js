/**
 * Window Manager Utility
 * 
 * Provides window management functionality for ParadoxFX zones.
 * Extracted from proven Option 6 proof-of-concept implementation.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const Logger = require('./logger');

class WindowManager {
    constructor(display = ':0') {
        this.display = display;
        this.logger = new Logger('WindowManager');
        this.env = { ...process.env, DISPLAY: display };
    }

    /**
     * Wait for window to appear by class name
     */
    async waitForWindowByClass(className, timeoutMs = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                // Try xdotool search first (returns decimal ids)
                let out = execSync(`xdotool search --class ${className} | tail -n1`, { env: this.env }).toString().trim();
                if (out) return this._normalizeWindowId(out);
                // Fallback to wmctrl parsing (wmctrl uses hex ids)
                out = execSync('wmctrl -lx', { env: this.env }).toString().split('\n').filter(l => new RegExp(className, 'i').test(l)).slice(-1)[0] || '';
                if (out) {
                    const m = out.match(/^(0x[0-9a-fA-F]+)/);
                    if (m) return this._normalizeWindowId(m[1]);
                }
            } catch (_) {}
            await this._sleep(200);
        }
        return null;
    }

    /**
     * Find Chromium window ID with fallback detection
     */
    findChromiumWindowId(customClass = 'ParadoxBrowser', options = {}) {
        const allowGenericFallback = options.allowGenericFallback === true;

        // Try the dedicated class first. For PFx-managed browser windows this should be
        // sufficient, and skipping generic Chromium fallback avoids stealing operator windows.
        if (customClass) {
            try {
                const out = execSync(`xdotool search --class ${customClass} | tail -n1`, { env: this.env }).toString().trim();
                if (out) return this._normalizeWindowId(out.split('\n').slice(-1)[0].trim());
            } catch {}
        }

        if (!allowGenericFallback) {
            return null;
        }
        
        // Fallback to common chromium classes
        for (const cls of ['chromium-browser', 'chromium', 'Chromium']) {
            try {
                const out = execSync(`xdotool search --class ${cls} | tail -n1`, { env: this.env }).toString().trim();
                if (out) return this._normalizeWindowId(out.split('\n').slice(-1)[0].trim());
            } catch {}
        }
        
        // Last resort: parse wmctrl -lx
        try {
            const out = execSync('wmctrl -lx', { env: this.env }).toString();
            const line = out.split('\n').filter(l => /chrom/i.test(l)).slice(-1)[0];
            if (line) {
                const m = line.match(/^(0x[0-9a-fA-F]+)/);
                if (m) return this._normalizeWindowId(m[1]);
            }
        } catch {}
        
        return null;
    }

    /**
     * Find window by exact name match
     */
    getWindowIdByNameExact(name) {
        try {
            const out = execSync(`xdotool search --name '^${name}$' | head -n1`, { env: this.env }).toString().trim();
            return out ? this._normalizeWindowId(out) : null;
        } catch { 
            return null; 
        }
    }

    /**
     * Activate window using Option 6 technique (focus + raise)
     */
    activateWindow(winId) {
        try {
            execSync(`xdotool windowactivate ${winId}`, { env: this.env });
            return true;
        } catch (e) {
            this.logger.warn(`xdotool windowactivate failed: ${e.message}`);
            try {
                execSync(`wmctrl -i -a ${winId}`, { env: this.env });
                return true;
            } catch (e2) {
                this.logger.error(`wmctrl activate failed: ${e2.message}`);
                return false;
            }
        }
    }

    /**
     * Move window to specific position
     */
    moveWindow(winId, x, y) {
        try {
            execSync(`xdotool windowmove ${winId} ${x} ${y}`, { env: this.env });
        } catch (e) {
            this.logger.warn(`windowmove failed: ${e.message}`);
        }
    }

    /**
     * Make window fullscreen
     */
    fullscreenWindow(winId) {
        try {
            execSync(`wmctrl -i -r ${winId} -b add,fullscreen`, { env: this.env });
        } catch (e) {
            this.logger.warn(`wmctrl fullscreen failed: ${e.message}`);
        }
    }

    /**
     * Add window state (above, below, fullscreen, etc.)
     */
    addWindowState(winId, state) {
        try {
            execSync(`wmctrl -i -r ${winId} -b add,${state}`, { env: this.env });
        } catch (e) { 
            this.logger.warn(`wmctrl add ${state} failed: ${e.message}`); 
        }
    }

    /**
     * Remove window state
     */
    removeWindowState(winId, state) {
        try {
            execSync(`wmctrl -i -r ${winId} -b remove,${state}`, { env: this.env });
        } catch (e) { 
            this.logger.warn(`wmctrl remove ${state} failed: ${e.message}`); 
        }
    }

    /**
     * Get active desktop index
     */
    getActiveDesktop() {
        try {
            const out = execSync('wmctrl -d', { env: this.env }).toString();
            const line = out.split('\n').find(l => l.includes('*'));
            if (!line) return 0;
            const idx = parseInt(line.split(' ')[0], 10);
            return Number.isFinite(idx) ? idx : 0;
        } catch { 
            return 0; 
        }
    }

    /**
     * Move window to specific desktop
     */
    moveToDesktop(winId, desktopIdx) {
        try {
            execSync(`wmctrl -i -r ${winId} -t ${desktopIdx}`, { env: this.env });
        } catch (e) { 
            this.logger.warn(`wmctrl move to desktop failed: ${e.message}`); 
        }
    }

    /**
     * Get available displays using xrandr
     */
    getDisplays() {
        try {
            const out = execSync('xrandr --current', { env: this.env }).toString();
            const lines = out.split('\n');
            const displays = [];
            for (const line of lines) {
                const m = line.match(/^(\S+)\s+connected(\s+primary)?\s+(\d+)x(\d+)\+(\d+)\+(\d+)/);
                if (m) {
                    const name = m[1];
                    const isPrimary = !!m[2];
                    const width = parseInt(m[3], 10);
                    const height = parseInt(m[4], 10);
                    const x = parseInt(m[5], 10);
                    const y = parseInt(m[6], 10);
                    displays.push({ name, isPrimary, width, height, x, y });
                }
            }
            // Fallback for Pi with hdmi_force_hotplug: HDMI shows as "disconnected"
            // but the screen is still active. Parse the Screen line for dimensions.
            if (displays.length === 0) {
                const screenM = out.match(/^Screen\s+\d+:.*current\s+(\d+)\s*x\s*(\d+)/m);
                if (screenM) {
                    const width = parseInt(screenM[1], 10);
                    const height = parseInt(screenM[2], 10);
                    this.logger.debug(`getDisplays: no connected outputs found; using Screen fallback ${width}x${height}`);
                    displays.push({ name: 'screen0', isPrimary: true, width, height, x: 0, y: 0 });
                }
            }
            return displays;
        } catch (e) {
            this.logger.error(`Failed to parse xrandr: ${e.message}`);
            return [];
        }
    }

    /**
     * Pick target display (prefer secondary, fallback to primary)
     */
    pickTargetDisplay(preferSecondary = true) {
        const displays = this.getDisplays();
        
        if (preferSecondary) {
            const nonPrimary = displays.filter(d => !d.isPrimary);
            if (nonPrimary.length) {
                nonPrimary.sort((a, b) => a.x - b.x);
                return nonPrimary[nonPrimary.length - 1];
            }
        }
        
        const primary = displays.find(d => d.isPrimary) || displays[0];
        return primary;
    }

    /**
     * Launch Chromium browser with specified options
     */
    launchChromium(options = {}) {
        const {
            url = null,
            profilePath = '/tmp/paradox-browser',
            className = 'ParadoxBrowser',
            display = null,
            width = 1920,
            height = 1080,
            x = 0,
            y = 0
        } = options;

        // Determine chromium binary
        const chromeBin = this._pickChromiumBinary();

        if (!url) {
            throw new Error('launchChromium requires a url — set browser_url in the zone INI config');
        }

        const args = [
            `--user-data-dir=${profilePath}`,
            `--class=${className}`,
            // Clear inherited distro/default V8 flags that can be invalid on newer Chromium.
            '--js-flags=',
            '--no-first-run',
            '--disable-infobars',
            '--disable-session-crashed-bubble',
            '--no-default-browser-check',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling',
            '--autoplay-policy=no-user-gesture-required',
            `--window-position=${x},${y}`,
            `--window-size=${width},${height}`,
            '--start-fullscreen',
            `--app=${url}`
        ];

        const process = spawn(chromeBin, args, { 
            stdio: ['ignore', 'ignore', 'pipe'], 
            env: this.env 
        });

        process.stderr.on('data', (d) => {
            // Log chromium errors but don't spam logs with common warnings
            const msg = d.toString();
            if (!msg.includes('DMA-BUF') && !msg.includes('BadWindow')) {
                this.logger.debug(`[chromium] ${msg}`);
            }
        });

        return process;
    }

    /**
     * Wait for HTTP endpoint to become available
     */
    async waitForHttpOk(url, timeoutMs = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const ok = await new Promise(resolve => {
                const req = http.get(url, res => {
                    res.resume();
                    resolve(res.statusCode && res.statusCode >= 200 && res.statusCode < 400);
                });
                req.on('error', () => resolve(false));
                req.setTimeout(2000, () => { req.destroy(); resolve(false); });
            });
            if (ok) return true;
            await this._sleep(250);
        }
        return false;
    }

    /**
     * Kill process gracefully with fallback to force kill
     */
    async killProcess(process, timeoutMs = 3000) {
        return new Promise(resolve => {
            if (!process || process.killed) return resolve();
            
            try { process.kill('SIGTERM'); } catch (_) {}
            
            const timeout = setTimeout(() => {
                try { process.kill('SIGKILL'); } catch (_) {}
                resolve();
            }, timeoutMs);
            
            process.on('exit', () => { 
                clearTimeout(timeout); 
                resolve(); 
            });
        });
    }

    /**
     * Check if window is currently active/focused
     */
    isWindowActive(winId) {
        try {
            const out = execSync('xdotool getactivewindow', { env: this.env }).toString().trim();
            const active = this._normalizeWindowId(out);
            const wanted = this._normalizeWindowId(winId);
            return active && wanted && active === wanted;
        } catch {
            return false;
        }
    }

    /**
     * Normalize window id string to decimal string form.
     * Accepts formats like '0x3a00007' or '37865927' and returns decimal string.
     */
    _normalizeWindowId(raw) {
        if (!raw) return null;
        raw = String(raw).trim();
        try {
            if (raw.startsWith('0x') || raw.startsWith('0X')) {
                return String(parseInt(raw, 16));
            }
            // some xdotool outputs may include whitespace or multiple ids
            const first = raw.split('\n')[0].trim();
            // if numeric decimal
            if (/^\d+$/.test(first)) return first;
            // try parse as hex without 0x
            if (/^[0-9a-fA-F]+$/.test(first)) return String(parseInt(first, 16));
            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Check if binary exists in PATH
     */
    _binExists(cmd) {
        try {
            execSync(`command -v ${cmd} >/dev/null 2>&1`, { env: this.env });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Pick available Chromium binary using OS detection
     */
    _pickChromiumBinary() {
        // Prefer direct Chromium binary to avoid wrapper-injected global flags.
        const directChromium = '/usr/lib/chromium/chromium';
        if (fs.existsSync(directChromium)) {
            return directChromium;
        }

        // Use OS detection to get the appropriate browser command
        try {
            const { getOSDetection } = require('./os-detection');
            const osInfo = getOSDetection();
            const browserCmd = osInfo.getBrowserCommand();
            
            // Verify the detected command exists
            if (this._binExists(browserCmd)) {
                return browserCmd;
            }
        } catch (error) {
            // Fall through to manual detection if OS detection fails
        }
        
        // Fallback: try known candidates manually
        const candidates = ['chromium', 'chromium-browser', 'google-chrome'];
        for (const c of candidates) {
            if (this._binExists(c)) return c;
        }
        throw new Error('Chromium binary not found (tried chromium, chromium-browser, google-chrome). Install chromium or chromium-browser.');
    }

    /**
     * Sleep utility
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Clean up temporary files
     */
    safeUnlink(path) {
        try { 
            fs.unlinkSync(path); 
        } catch (_) {}
    }

    /**
     * Recursively remove directory
     */
    safeRemoveDir(path) {
        try { 
            fs.rmSync(path, { recursive: true, force: true }); 
        } catch (_) {}
    }
}

module.exports = WindowManager;
