const { execSync } = require('child_process');

class ScreenZoneBrowserController {
    constructor(zone) {
        this.zone = zone;
    }

    _env() {
        return { ...process.env, DISPLAY: this.zone.display };
    }

    _normalizeWindowId(raw) {
        if (!raw) return null;
        const value = String(raw).trim();
        if (!value) return null;
        if (/^0x[0-9a-fA-F]+$/.test(value)) return String(parseInt(value, 16));
        if (/^[0-9]+$/.test(value)) return value;
        return null;
    }

    async enableBrowser(url = 'http://localhost/clock/') {
        const zone = this.zone;

        if (zone.browserManager.enabled) {
            if (!zone.browserManager.windowId) {
                zone.logger.warn('Browser already enabled but windowId is null, retrying detection');
                zone.browserManager.windowId = zone.windowManager.findChromiumWindowId(zone.browserManager.className);
                if (!zone.browserManager.windowId) {
                    zone.browserManager.windowId = await zone.windowManager.waitForWindowByClass(zone.browserManager.className, 3000);
                }
                if (zone.browserManager.windowId) {
                    zone.logger.info(`Browser window recovered: ${zone.browserManager.windowId}`);
                } else {
                    zone.logger.warn('Browser window still not found after retry');
                }
            } else {
                zone.logger.warn('Browser already enabled');
            }
            return;
        }

        zone.logger.info(`Enabling browser with URL: ${url} (background launch)`);
        zone.windowManager.safeRemoveDir(zone.browserManager.profilePath);

        let targetDisplay;
        try {
            const displays = zone.windowManager.getDisplays() || [];
            displays.sort((a, b) => (a.x || 0) - (b.x || 0));
            if (Array.isArray(displays) && displays.length > 0 && Number.isInteger(zone.targetMonitor) && zone.targetMonitor >= 0 && zone.targetMonitor < displays.length) {
                targetDisplay = displays[zone.targetMonitor];
                zone.logger.debug(`Browser target display chosen by targetMonitor ${zone.targetMonitor}: ${targetDisplay.name} at ${targetDisplay.width}x${targetDisplay.height}+${targetDisplay.x}+${targetDisplay.y}`);
            } else {
                targetDisplay = zone.windowManager.pickTargetDisplay(true);
                if (targetDisplay) zone.logger.debug(`Browser target display (fallback): ${targetDisplay.name} at ${targetDisplay.width}x${targetDisplay.height}+${targetDisplay.y}`);
            }
        } catch (error) {
            zone.logger.warn('Failed to determine target display by index, falling back to pickTargetDisplay: ' + error.message);
            targetDisplay = zone.windowManager.pickTargetDisplay(true);
        }

        const browserOptions = {
            url,
            profilePath: zone.browserManager.profilePath,
            className: zone.browserManager.className,
            width: targetDisplay.width,
            height: targetDisplay.height,
            x: targetDisplay.x,
            y: targetDisplay.y
        };

        zone.browserManager.process = zone.windowManager.launchChromium(browserOptions);
        zone.browserManager.url = url;
        zone.browserManager.enabled = true;

        const { getOSDetection } = require('../utils/os-detection');
        const osInfo = getOSDetection();
        const windowConfig = osInfo.getWindowDetectionConfig();

        zone.browserManager.windowId = await zone.windowManager.waitForWindowByClass(
            zone.browserManager.className,
            windowConfig.initialDelay + (windowConfig.maxRetries * windowConfig.retryDelay)
        );

        if (!zone.browserManager.windowId) {
            for (let attempt = 1; attempt <= windowConfig.maxRetries && !zone.browserManager.windowId; attempt++) {
                zone.logger.debug(`enableBrowser: fallback attempt ${attempt}/${windowConfig.maxRetries} to find Chromium window`);
                zone.browserManager.windowId = zone.windowManager.findChromiumWindowId(zone.browserManager.className);
                if (!zone.browserManager.windowId) await new Promise(resolve => setTimeout(resolve, windowConfig.retryDelay));
            }
            if (!zone.browserManager.windowId) zone.browserManager.windowId = zone.windowManager.findChromiumWindowId(zone.browserManager.className);
        }

        zone.logger.debug(`enableBrowser result: pid=${zone.browserManager.process?.pid || 'unknown'}, windowId=${zone.browserManager.windowId || 'not-found'}`);

        if (zone.browserManager.windowId) {
            try {
                const found = zone.windowManager.findChromiumWindowId(zone.browserManager.className);
                if (found && found !== zone.browserManager.windowId) {
                    zone.logger.debug(`enableBrowser: detected chromium windowId changed (stored=${zone.browserManager.windowId} detected=${found}), updating stored id`);
                    zone.browserManager.windowId = found;
                }
            } catch (error) {
                zone.logger.debug('enableBrowser: cross-check findChromiumWindowId failed: ' + error.message);
            }
        }

        if (zone.browserManager.windowId) {
            zone.windowManager.moveWindow(zone.browserManager.windowId, targetDisplay.x, targetDisplay.y);
            zone.windowManager.fullscreenWindow(zone.browserManager.windowId);

            const desktop = zone.windowManager.getActiveDesktop();
            zone.windowManager.moveToDesktop(zone.browserManager.windowId, desktop);
            zone.windowManager.addWindowState(zone.browserManager.windowId, 'below');

            const mpvWindow = zone.windowManager.getWindowIdByNameExact('ParadoxMPV');
            if (mpvWindow) {
                zone.windowManager.activateWindow(mpvWindow);
                zone.logger.debug('MPV window reactivated after browser launch');
            } else {
                zone.logger.debug('MPV window not found - browser may be visible');
            }
        } else {
            zone.logger.warn('Browser window not found after launch');
        }

        zone.currentState.focus = 'mpv';
        zone.currentState.content = zone.currentState.currentVideo || zone.currentState.currentImage;
        this.updateFocusAndContent();

        zone.publishStatus();
        zone.publishEvent({
            browser_enabled: true,
            url,
            window_id: zone.browserManager.windowId,
            focused: false
        });

        zone.logger.info('Browser enabled successfully (hidden in background)');
    }

    async disableBrowser() {
        const zone = this.zone;

        if (!zone.browserManager.enabled) {
            zone.logger.warn('Browser not enabled');
            return;
        }

        zone.logger.info(`Disabling browser (stored windowId=${zone.browserManager.windowId || 'none'}, pid=${zone.browserManager.process?.pid || 'unknown'})`);

        if (zone.browserManager.process) {
            await zone.windowManager.killProcess(zone.browserManager.process);
        }

        zone.windowManager.safeRemoveDir(zone.browserManager.profilePath);

        zone.logger.info(`disableBrowser: killed process, clearing stored window id (was=${zone.browserManager.windowId || 'none'})`);
        zone.browserManager.process = null;
        zone.browserManager.windowId = null;
        zone.browserManager.url = null;
        zone.browserManager.enabled = false;

        zone.currentState.focus = 'mpv';
        zone.currentState.content = zone.currentState.currentVideo || zone.currentState.currentImage;

        zone.publishStatus();
        zone.publishEvent({ browser_disabled: true });

        zone.logger.info('Browser disabled successfully');
    }

    async showBrowser() {
        const zone = this.zone;

        if (!zone.browserManager.enabled) {
            throw new Error('Browser not enabled. Call enableBrowser first.');
        }

        if (!zone.browserManager.windowId) {
            zone.logger.warn('showBrowser: windowId is null, attempting recovery detection');
            zone.browserManager.windowId = zone.windowManager.findChromiumWindowId(zone.browserManager.className);
            if (!zone.browserManager.windowId) {
                zone.browserManager.windowId = await zone.windowManager.waitForWindowByClass(zone.browserManager.className, 3000);
            }
            if (!zone.browserManager.windowId) {
                throw new Error('Browser window not found');
            }
            zone.logger.info(`showBrowser: recovered browser windowId=${zone.browserManager.windowId}`);
        }

        zone.logger.debug(`Showing browser (pure window management) - Window ID: ${zone.browserManager.windowId}`);

        const tsStart = Date.now();
        const browserWin = zone.browserManager.windowId;
        let mpvWindow = null;
        try {
            mpvWindow = zone.windowManager.getWindowIdByNameExact('ParadoxMPV');
        } catch (error) {
            zone.logger.debug('getWindowIdByNameExact threw when checking MPV window:', error.message);
        }

        zone.logger.debug(`_showBrowser start ts=${tsStart}, browserWin=${browserWin}, mpvWindow=${mpvWindow}, DISPLAY=${process.env.DISPLAY || 'unset'}`);

        try {
            const fresh = zone.windowManager.findChromiumWindowId(zone.browserManager.className);
            if (fresh && fresh !== browserWin) {
                zone.logger.warn(`_showBrowser: stored browser windowId=${browserWin} is stale, updating to fresh id=${fresh}`);
                zone.browserManager.windowId = fresh;
            }
        } catch (error) {
            zone.logger.debug(`_showBrowser: findChromiumWindowId threw: ${error.message}`);
        }

        const browserWinRefreshed = zone.browserManager.windowId || browserWin;
        if (browserWinRefreshed !== browserWin) {
            zone.logger.debug(`_showBrowser: using browser window id ${browserWinRefreshed} for activation`);
        }

        try {
            let t0 = Date.now();
            try {
                const result = zone.windowManager.addWindowState(browserWinRefreshed, 'above');
                zone.logger.debug(`addWindowState(browser,above) succeeded in ${Date.now() - t0}ms, result=${String(result)}`);
            } catch (error) {
                zone.logger.warn(`addWindowState(browser,above) failed: ${error.message}`);
            }

            if (mpvWindow) {
                try {
                    t0 = Date.now();
                    const result = zone.windowManager.removeWindowState(mpvWindow, 'above');
                    zone.logger.debug(`removeWindowState(mpv,above) succeeded in ${Date.now() - t0}ms, result=${String(result)}`);
                } catch (error) {
                    zone.logger.warn(`removeWindowState(mpv,above) failed for ${mpvWindow}: ${error.message}`);
                }
            } else {
                zone.logger.debug('No MPV window id found prior to activate()');
            }

            try {
                t0 = Date.now();
                const result = zone.windowManager.activateWindow(browserWinRefreshed);
                zone.logger.debug(`activateWindow(browser) completed in ${Date.now() - t0}ms, result=${String(result)}`);
            } catch (error) {
                zone.logger.warn(`activateWindow(browser) failed: ${error.message}`);
            }

            let becameActive = false;
            try {
                becameActive = zone.windowManager.isWindowActive(browserWinRefreshed);
            } catch (error) {
                zone.logger.debug('isWindowActive check threw: ' + error.message);
                becameActive = false;
            }

            if (!becameActive) {
                zone.logger.warn('Browser did not appear active after first activate(), attempting retries and wmctrl fallback');
                for (let attempt = 1; attempt <= 3 && !becameActive; attempt++) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, attempt * 120));
                        const t1 = Date.now();
                        try { zone.windowManager.activateWindow(browserWinRefreshed); } catch (error) { zone.logger.debug(`retry activateWindow attempt ${attempt} failed: ${error.message}`); }
                        zone.logger.debug(`retry activateWindow attempt ${attempt} took ${Date.now() - t1}ms`);

                        if (zone.windowManager.wmctrlActivate) {
                            try {
                                const t2 = Date.now();
                                zone.windowManager.wmctrlActivate(browserWinRefreshed);
                                zone.logger.debug(`wmctrlActivate fallback attempt ${attempt} took ${Date.now() - t2}ms`);
                            } catch (error) {
                                zone.logger.debug(`wmctrlActivate attempt ${attempt} failed: ${error.message}`);
                            }
                        }

                        try {
                            becameActive = zone.windowManager.isWindowActive(browserWinRefreshed);
                        } catch (_) {
                            becameActive = false;
                        }
                        if (becameActive) zone.logger.info(`Browser became active on attempt ${attempt}`);
                    } catch (error) {
                        zone.logger.debug(`retry loop error: ${error.message}`);
                    }
                }
            }

            if (!becameActive) {
                try {
                    const wmOut = execSync('wmctrl -lG', { env: this._env() }).toString().trim();
                    zone.logger.debug('wmctrl -lG output:\n' + wmOut);
                } catch (error) {
                    zone.logger.debug('Failed to run wmctrl -lG: ' + error.message);
                }
                try {
                    const wmPid = execSync('wmctrl -lp', { env: this._env() }).toString().trim();
                    zone.logger.debug('wmctrl -lp output:\n' + wmPid);
                } catch (error) {
                    zone.logger.debug('Failed to run wmctrl -lp: ' + error.message);
                }
                try {
                    const xd = execSync(`xdotool search --class ${zone.browserManager.className} || true`, { env: this._env() }).toString().trim();
                    zone.logger.debug(`xdotool search --class ${zone.browserManager.className} output: ${xd}`);
                } catch (error) {
                    zone.logger.debug('xdotool search failed: ' + error.message);
                }

                try {
                    const targetPid = zone.browserManager.process?.pid || null;
                    if (targetPid) {
                        try {
                            const wmPidOut = execSync('wmctrl -lp', { env: this._env() }).toString();
                            const lines = wmPidOut.split('\n');
                            for (const line of lines) {
                                const match = line.trim().match(/^(0x[0-9a-fA-F]+)\s+\S+\s+(\d+)/);
                                if (match && parseInt(match[2], 10) === targetPid) {
                                    const hexId = match[1];
                                    zone.logger.info(`Aggressive fallback: found window ${hexId} for browser PID ${targetPid}, trying to unhide/raise`);
                                    try { execSync(`xdotool windowmap ${hexId}`, { env: this._env() }); } catch (_) {}
                                    try { execSync(`xdotool windowraise ${hexId}`, { env: this._env() }); } catch (_) {}
                                    try { execSync(`xdotool windowfocus ${hexId}`, { env: this._env() }); } catch (_) {}
                                    try { execSync(`wmctrl -i -a ${hexId}`, { env: this._env() }); } catch (_) {}
                                    await new Promise(resolve => setTimeout(resolve, 120));
                                    try {
                                        if (zone.windowManager.isWindowActive(hexId)) {
                                            becameActive = true;
                                            zone.browserManager.windowId = hexId;
                                            zone.logger.info(`Aggressive fallback: browser active via PID matched window ${hexId}`);
                                        }
                                    } catch (_) {}
                                    if (becameActive) break;
                                }
                            }
                        } catch (error) {
                            zone.logger.debug('Aggressive fallback wmctrl -lp parse failed: ' + error.message);
                        }
                    }

                    if (!becameActive) {
                        const raw = execSync(`xdotool search --class ${zone.browserManager.className} || true`, { env: this._env() }).toString().trim();
                        const ids = raw.split('\n').map(value => value.trim()).filter(Boolean);
                        if (ids.length === 0) {
                            zone.logger.debug('Aggressive fallback: no ParadoxBrowser windows found to try');
                        }
                        for (const id of ids) {
                            zone.logger.info(`Aggressive fallback: attempting to unhide/raise/focus window ${id}`);
                            try { execSync(`xdotool windowmap ${id}`, { env: this._env() }); } catch (error) { zone.logger.debug(`windowmap ${id} failed: ${error.message}`); }
                            try { execSync(`xdotool windowraise ${id}`, { env: this._env() }); } catch (error) { zone.logger.debug(`windowraise ${id} failed: ${error.message}`); }
                            try { execSync(`xdotool windowfocus ${id}`, { env: this._env() }); } catch (error) { zone.logger.debug(`windowfocus ${id} failed: ${error.message}`); }
                            try { execSync(`wmctrl -i -a ${id}`, { env: this._env() }); } catch (error) { zone.logger.debug(`wmctrl activate ${id} failed: ${error.message}`); }
                            await new Promise(resolve => setTimeout(resolve, 120));
                            try {
                                if (zone.windowManager.isWindowActive(id)) {
                                    becameActive = true;
                                    zone.browserManager.windowId = id;
                                    zone.logger.info(`Aggressive fallback: succeeded with window ${id}`);
                                    break;
                                }
                            } catch (error) {
                                zone.logger.debug(`isWindowActive check failed for ${id}: ${error.message}`);
                            }
                        }
                    }
                } catch (error) {
                    zone.logger.debug('Aggressive fallback encountered an error: ' + error.message);
                }
            }
        } catch (error) {
            zone.logger.warn('Robust showBrowser flow failed unexpectedly:', error.message);
        }

        await new Promise(resolve => setTimeout(resolve, 150));

        try {
            const activeRaw = execSync('xdotool getactivewindow', { env: this._env() }).toString().trim();
            if (activeRaw) {
                let activeClass = '';
                try {
                    activeClass = execSync(`xdotool getwindowclassname ${activeRaw}`, { env: this._env() }).toString().trim();
                } catch (_) {
                    activeClass = '';
                }
                if (activeClass && activeClass === zone.browserManager.className) {
                    if (String(zone.browserManager.windowId) !== String(activeRaw)) {
                        zone.logger.info(`_showBrowser: rebinding browser windowId from ${zone.browserManager.windowId} to active window ${activeRaw} (${activeClass})`);
                        zone.browserManager.windowId = activeRaw;
                    }
                }
            }
        } catch (error) {
            zone.logger.debug(`_showBrowser: active-window rebinding skipped: ${error.message}`);
        }

        zone.currentState.focus = 'chromium';
        zone.currentState.content = zone.browserManager.url;

        zone.publishStatus();
        zone.publishEvent({
            browser_shown: true,
            url: zone.browserManager.url
        });

        zone.logger.info(`Browser shown (end) ts=${Date.now()}, duration=${Date.now() - tsStart}ms`);
    }

    async hideBrowser() {
        const zone = this.zone;

        if (!zone.browserManager.enabled) {
            zone.logger.warn('Browser not enabled, nothing to hide');
            return;
        }

        zone.logger.debug(`Hiding browser (pure window management) - stored windowId=${zone.browserManager.windowId || 'none'}`);

        const mpvWindow = zone.windowManager.getWindowIdByNameExact('ParadoxMPV');
        if (mpvWindow) {
            zone.logger.debug(`Found MPV window: ${mpvWindow}, activating...`);
            zone.windowManager.activateWindow(mpvWindow);
        } else {
            zone.logger.warn('MPV window not found - trying alternative detection');
            try {
                const mpvWindows = execSync('xdotool search --class mpv', { env: { ...process.env, DISPLAY: ':0' } }).toString().trim().split('\n');
                if (mpvWindows.length > 0 && mpvWindows[0]) {
                    const altMpvWindow = mpvWindows[0];
                    zone.logger.debug(`Found MPV window via class search: ${altMpvWindow}, activating...`);
                    zone.windowManager.activateWindow(altMpvWindow);
                } else {
                    zone.logger.error('No MPV window found - cannot hide browser properly');
                }
            } catch (error) {
                zone.logger.error('Failed to find MPV window:', error.message);
            }
        }

        zone.currentState.focus = 'mpv';
        zone.currentState.content = zone.currentState.currentVideo || zone.currentState.currentImage;

        zone.publishStatus();
        zone.publishEvent({
            browser_hidden: true,
            mpv_content: zone.currentState.content
        });

        zone.logger.info('Browser hidden successfully');
    }

    async setBrowserUrl(url) {
        const zone = this.zone;

        if (!url) {
            throw new Error('URL is required');
        }

        zone.logger.info(`Setting browser URL to: ${url}`);

        if (zone.browserManager.enabled) {
            const wasFocused = zone.currentState.focus === 'chromium';
            await this.disableBrowser();
            await this.enableBrowser(url);

            if (wasFocused) {
                await this.showBrowser();
            }
        } else {
            zone.browserManager.url = url;
        }

        zone.publishEvent({ browser_url_set: url });
        zone.logger.info('Browser URL updated successfully');
    }

    async setBrowserKeepAlive(enabled) {
        const zone = this.zone;

        zone.browserManager.keepAlive = !!enabled;

        zone.publishEvent({
            browser_keep_alive_set: enabled
        });

        zone.logger.info(`Browser keep-alive ${enabled ? 'enabled' : 'disabled'}`);

        if (enabled) {
            this.startBrowserMonitoring();
        } else {
            this.stopBrowserMonitoring();
        }
    }

    startBrowserMonitoring() {
        const zone = this.zone;

        if (zone._browserMonitorInterval) {
            clearInterval(zone._browserMonitorInterval);
        }

        zone.logger.debug('Starting browser keep-alive monitoring...');

        zone._browserMonitorInterval = setInterval(async () => {
            if (zone.browserManager.enabled && zone.browserManager.keepAlive && zone.browserManager.process) {
                try {
                    process.kill(zone.browserManager.process.pid, 0);
                } catch (error) {
                    if (error.code === 'ESRCH') {
                        zone.logger.warn('Browser process crashed, restarting due to keep-alive setting...');

                        const previousUrl = zone.browserManager.url || 'http://localhost/clock/';
                        const wasFocused = zone.currentState.focus === 'chromium';

                        try {
                            zone.browserManager.process = null;
                            zone.browserManager.windowId = null;
                            zone.browserManager.enabled = false;

                            await this.enableBrowser(previousUrl);

                            if (wasFocused) {
                                await this.showBrowser();
                            }

                            zone.publishEvent({
                                browser_restarted: true,
                                reason: 'keep_alive_crash_recovery',
                                url: previousUrl
                            });
                        } catch (restartError) {
                            zone.logger.error('Failed to restart browser after crash:', restartError);
                            zone.publishError('Browser restart failed', {
                                error: restartError.message,
                                url: previousUrl
                            });
                        }
                    }
                }
            }
        }, 5000);
    }

    stopBrowserMonitoring() {
        const zone = this.zone;

        if (zone._browserMonitorInterval) {
            zone.logger.debug('Stopping browser keep-alive monitoring...');
            clearInterval(zone._browserMonitorInterval);
            zone._browserMonitorInterval = null;
        }
    }

    updateFocusAndContent() {
        const zone = this.zone;
        let browserForeground = false;

        if (zone.browserManager.windowId && zone.windowManager.isWindowActive(zone.browserManager.windowId)) {
            browserForeground = true;
        }

        if (!browserForeground && zone.browserManager.process?.pid) {
            try {
                const targetPid = Number(zone.browserManager.process.pid);
                const activeRaw = execSync('xdotool getactivewindow', { env: this._env() }).toString().trim();
                const activeNorm = this._normalizeWindowId(activeRaw);
                if (activeNorm) {
                    const wmPidOut = execSync('wmctrl -lp', { env: this._env() }).toString();
                    const lines = wmPidOut.split('\n');
                    for (const line of lines) {
                        const match = line.trim().match(/^(0x[0-9a-fA-F]+)\s+\S+\s+(\d+)/);
                        if (!match) continue;
                        const winNorm = this._normalizeWindowId(match[1]);
                        const pid = Number(match[2]);
                        if (winNorm && winNorm === activeNorm && pid === targetPid) {
                            browserForeground = true;
                            if (String(zone.browserManager.windowId) !== String(match[1])) {
                                zone.logger.info(`_updateFocusAndContent: rebinding stale browser windowId ${zone.browserManager.windowId} -> ${match[1]} via active PID match`);
                                zone.browserManager.windowId = match[1];
                            }
                            break;
                        }
                    }
                }
            } catch (error) {
                zone.logger.debug(`_updateFocusAndContent PID fallback failed: ${error.message}`);
            }
        }

        if (browserForeground) {
            zone.currentState.focus = 'chromium';
            zone.currentState.content = zone.browserManager.url;
        } else {
            const mpvWindow = zone.windowManager.getWindowIdByNameExact('ParadoxMPV');
            if (mpvWindow && zone.windowManager.isWindowActive(mpvWindow)) {
                zone.currentState.focus = 'mpv';
                zone.currentState.content = zone.currentState.currentVideo || zone.currentState.currentImage;
            } else {
                zone.currentState.focus = 'none';
                zone.currentState.content = 'none';
            }
        }

        zone.currentState.browser = {
            enabled: zone.browserManager.enabled,
            url: zone.browserManager.url,
            process_id: zone.browserManager.process?.pid || null,
            window_id: zone.browserManager.windowId,
            foreground: !!browserForeground
        };
    }

    async switchToMpv() {
        const zone = this.zone;

        zone.logger.info('Switching to MPV (pure window management)');

        if (zone.browserManager.enabled && zone.currentState.focus === 'chromium') {
            await this.hideBrowser();
        } else {
            const mpvWindow = zone.windowManager.getWindowIdByNameExact('ParadoxMPV');
            if (mpvWindow) {
                zone.windowManager.activateWindow(mpvWindow);

                zone.currentState.focus = 'mpv';
                zone.currentState.content = zone.currentState.currentVideo || zone.currentState.currentImage;

                zone.publishStatus();
                zone.publishEvent({
                    switched_to_mpv: true,
                    content: zone.currentState.content
                });
            } else {
                zone.logger.warn('MPV window not found for switching');
            }
        }

        zone.logger.info('Switched to MPV successfully');
    }

    async switchToBrowser() {
        const zone = this.zone;

        if (!zone.browserManager.enabled) {
            throw new Error('Browser not enabled. Call enableBrowser first.');
        }

        zone.logger.info('Switching to browser (pure window management)');

        if (zone.currentState.focus === 'mpv') {
            zone.windowManager.activateWindow(zone.browserManager.windowId);

            zone.currentState.focus = 'chromium';
            zone.currentState.content = zone.browserManager.url;

            zone.publishStatus();
            zone.publishEvent({
                switched_to_browser: true,
                url: zone.browserManager.url
            });
        } else {
            await this.showBrowser();
        }

        zone.logger.info('Switched to browser successfully');
    }

    async toggleMpvBrowser() {
        const zone = this.zone;

        zone.logger.info('Toggling between MPV and browser (pure window management)');

        if (zone.currentState.focus === 'chromium') {
            await this.switchToMpv();
        } else if (zone.currentState.focus === 'mpv') {
            if (zone.browserManager.enabled) {
                await this.switchToBrowser();
            } else {
                zone.logger.warn('Cannot switch to browser - not enabled');
            }
        } else {
            await this.switchToMpv();
        }

        zone.logger.info('Toggle completed');
    }
}

module.exports = ScreenZoneBrowserController;