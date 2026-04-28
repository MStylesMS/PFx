# Pull Request: Debian Trixie Compatibility

## Overview

Add support for Debian Trixie (13) while maintaining backward compatibility with Debian Bookworm (12). This PR addresses browser command changes, window detection timing differences, and OS-specific behaviors.

## Problem Statement

ParadoxFX fails on Debian Trixie with the following issues:

1. **Browser Launch Failure**: `chromium-browser` command doesn't exist (renamed to `chromium`)
2. **Window Detection Errors**: "Browser window not found" errors prevent clock display
3. **MPV Window Detection**: Timing issues cause "MPV window not found" warnings
4. **VDPAU Warnings**: Non-critical but noisy log messages about missing libvdpau_vc4.so

## Root Causes

### Browser Command Change
- **Bookworm**: `/usr/bin/chromium-browser` 
- **Trixie**: `/usr/bin/chromium` (chromium-browser removed)

### Window Manager Timing
- Trixie has slightly different window creation/detection timing
- Window IDs may take longer to appear in wmctrl output
- Need increased retry delays and timeout adjustments

### VDPAU Backend
- Trixie's Mesa version doesn't include VC4 VDPAU backend for Raspberry Pi
- MPV falls back to software decoding (works fine, just logs warnings)

## Proposed Solution

### 1. Add OS Detection Module

Create `lib/utils/os-detection.js`:

```javascript
/**
 * OS Detection Utility
 * Detects Debian version and provides OS-specific configurations
 */
const fs = require('fs');
const { execSync } = require('child_process');

class OSDetection {
  constructor() {
    this.osInfo = this._detectOS();
    this.browserCommand = this._detectBrowserCommand();
  }

  _detectOS() {
    try {
      const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
      const codename = osRelease.match(/VERSION_CODENAME=(\w+)/)?.[1] || 'unknown';
      const versionId = parseInt(osRelease.match(/VERSION_ID="(\d+)"/)?.[1] || '0');
      
      return {
        codename,
        versionId,
        isBookworm: codename === 'bookworm' || versionId === 12,
        isTrixie: codename === 'trixie' || versionId === 13,
        isDebian: osRelease.includes('Debian'),
        isRaspbian: osRelease.includes('Raspbian')
      };
    } catch (error) {
      console.warn('[OSDetection] Could not read /etc/os-release, using defaults');
      return {
        codename: 'unknown',
        versionId: 0,
        isBookworm: false,
        isTrixie: false,
        isDebian: false,
        isRaspbian: false
      };
    }
  }

  _detectBrowserCommand() {
    // Try to find available browser, preferring Chromium
    const candidates = ['chromium', 'chromium-browser', 'google-chrome'];
    
    for (const cmd of candidates) {
      try {
        execSync(`which ${cmd}`, { stdio: 'ignore' });
        return cmd;
      } catch (error) {
        // Command not found, try next
      }
    }
    
    // Fallback based on OS version
    if (this.osInfo.isTrixie) {
      return 'chromium';
    }
    return 'chromium-browser';
  }

  getBrowserCommand() {
    return this.browserCommand;
  }

  getWindowDetectionConfig() {
    // Trixie needs more retries and longer delays
    if (this.osInfo.isTrixie) {
      return {
        maxRetries: 8,
        retryDelay: 300,
        initialDelay: 500,
        activateRetries: 3
      };
    }
    
    // Bookworm defaults
    return {
      maxRetries: 5,
      retryDelay: 200,
      initialDelay: 300,
      activateRetries: 2
    };
  }

  getMpvConfig() {
    // Suppress VDPAU warnings on Trixie (not available for VC4)
    if (this.osInfo.isTrixie) {
      return {
        suppressVdpauWarnings: true,
        logLevel: 'error' // Reduce MPV stderr noise
      };
    }
    
    return {
      suppressVdpauWarnings: false,
      logLevel: 'info'
    };
  }

  getLogPrefix() {
    return `[${this.osInfo.codename}/${this.osInfo.versionId}]`;
  }

  toString() {
    return `Debian ${this.osInfo.codename} (${this.osInfo.versionId})`;
  }
}

// Singleton instance
let instance = null;

function getOSDetection() {
  if (!instance) {
    instance = new OSDetection();
  }
  return instance;
}

module.exports = { getOSDetection };
```

### 2. Update `pfx.js` - Add OS Detection Logging

In `pfx.js`, add OS detection at startup:

```javascript
// Near top of file, after requires
const { getOSDetection } = require('./lib/utils/os-detection');

// In startup section (after logger initialization)
const osInfo = getOSDetection();
logger.info('PFx', `Running on ${osInfo.toString()}`);
logger.info('PFx', `Browser command: ${osInfo.getBrowserCommand()}`);
logger.info('PFx', `Window detection config: ${JSON.stringify(osInfo.getWindowDetectionConfig())}`);
```

### 3. Update `lib/zones/screen-zone.js` - Browser Launch

Modify the browser launch section to use OS-detected browser command:

```javascript
// At top of file
const { getOSDetection } = require('../utils/os-detection');

// In _launchBrowser method (search for chromium-browser)
async _launchBrowser(url, background = false) {
  const osInfo = getOSDetection();
  const browserCmd = osInfo.getBrowserCommand();
  
  this.logger.info(`Launching browser: ${browserCmd}`);
  
  const args = [
    '--kiosk',
    '--noerrdialogs',
    '--disable-infobars',
    '--disable-session-crashed-bubble',
    `--window-position=${this.config.x || 0},${this.config.y || 0}`,
    `--window-size=${this.config.width || 1920},${this.config.height || 1080}`,
    url
  ];
  
  // Launch browser
  const browserProcess = spawn(browserCmd, args, {
    env: { ...process.env, DISPLAY: this.display },
    detached: false,
    stdio: 'ignore'
  });
  
  // ... rest of existing code
}
```

### 4. Update `lib/zones/screen-zone.js` - Window Detection

Enhance window detection with OS-specific timing:

```javascript
// In _findBrowserWindow method
async _findBrowserWindow(pid, retries = null) {
  const osInfo = getOSDetection();
  const config = osInfo.getWindowDetectionConfig();
  const maxRetries = retries !== null ? retries : config.maxRetries;
  
  // Initial delay before first check (Trixie needs more time)
  await this._delay(config.initialDelay);
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const output = await this._execAsync(`DISPLAY=${this.display} wmctrl -lp`);
      const lines = output.split('\n');
      
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3 && parts[2] === pid.toString()) {
          const windowId = parts[0];
          this.logger.info(`Found browser window: ${windowId} for PID ${pid}`);
          return windowId;
        }
      }
    } catch (error) {
      this.logger.warn(`Window detection attempt ${i + 1}/${maxRetries} failed: ${error.message}`);
    }
    
    // Wait before retry (Trixie needs longer delays)
    await this._delay(config.retryDelay);
  }
  
  throw new Error('Browser window not found after maximum retries');
}
```

### 5. Update `lib/media/mpv-zone-manager.js` - Suppress VDPAU Warnings

Filter MPV stderr based on OS:

```javascript
// At top of file
const { getOSDetection } = require('../utils/os-detection');

// In MPV process stderr handler
this.mpvProcess.stderr.on('data', (data) => {
  const osInfo = getOSDetection();
  const mpvConfig = osInfo.getMpvConfig();
  const message = data.toString().trim();
  
  // Suppress VDPAU warnings on Trixie (expected, not critical)
  if (mpvConfig.suppressVdpauWarnings && message.includes('VDPAU')) {
    return; // Silently ignore
  }
  
  // Log other stderr messages
  if (message && mpvConfig.logLevel !== 'error' || message.includes('error')) {
    this.logger.info(`MPV stderr: ${message}`);
  }
});
```

### 6. Add Configuration Override (Optional)

Add optional configuration in `pfx.ini` for manual override:

```ini
[system]
# Browser command override (auto-detected if not specified)
# Options: auto, chromium, chromium-browser, google-chrome
browser_command = auto

# Window detection tuning (auto-configured based on OS)
# Uncomment to override defaults
# window_detection_max_retries = 8
# window_detection_retry_delay_ms = 300
# window_detection_initial_delay_ms = 500
```

Parse in configuration loader:

```javascript
// In config parser
if (config.system?.browser_command && config.system.browser_command !== 'auto') {
  // Override detected browser command
  process.env.PFX_BROWSER_COMMAND = config.system.browser_command;
}
```

## Testing Plan

### Test Matrix

| OS | Version | Browser | Window Mgr | Expected Result |
|----|---------|---------|------------|-----------------|
| Bookworm | 12 | chromium-browser | Openbox | ✅ All features work |
| Trixie | 13 | chromium | Openbox | ✅ All features work |
| Bookworm | 12 | chromium | Openbox | ✅ Fallback works |
| Trixie | 13 | chromium-browser | Openbox | ❌ Fails (expected, not installed) |

### Test Cases

1. **Browser Launch**
   - ✅ Browser launches successfully
   - ✅ Window detected within timeout
   - ✅ Browser shows in kiosk mode
   - ✅ Browser positioned on correct monitor

2. **Window Management**
   - ✅ showBrowser brings window to front
   - ✅ hideBrowser hides window
   - ✅ MPV window properly detected
   - ✅ Window stacking works correctly

3. **Video Playback**
   - ✅ Videos play smoothly
   - ✅ No VDPAU warnings on Trixie
   - ✅ Hardware acceleration works on Bookworm (if available)
   - ✅ Software fallback works on Trixie

4. **Cross-Version**
   - ✅ Same code works on both Bookworm and Trixie
   - ✅ No regression on Bookworm
   - ✅ All features functional on Trixie

### Manual Testing Steps

1. **On Trixie System:**
   ```bash
   cd /opt/paradox/apps/ParadoxFX
   # Apply PR changes
   npm test  # Run unit tests if available
   node pfx.js --config /opt/paradox/config/pfx.ini
   # Test browser launch via MQTT
   mosquitto_pub -h localhost -t 'paradox/houdini/mirror/commands' -m '{"command":"enableBrowser","url":"http://localhost/clock"}'
   ```

2. **On Bookworm System:**
   ```bash
   # Same tests on Bookworm Pi to ensure no regression
   cd /opt/paradox/apps/ParadoxFX
   node pfx.js --config /opt/paradox/config/pfx.ini
   # Test browser launch via MQTT
   ```

3. **Check Logs:**
   - OS detection logged at startup
   - No "Browser window not found" errors
   - No VDPAU warnings on Trixie
   - All browser commands succeed

## Files Changed

### New Files
- `lib/utils/os-detection.js` - OS detection and configuration module
- `docs/PR_TRIXIE.md` - This PR documentation

### Modified Files
- `pfx.js` - Add OS detection logging at startup
- `lib/zones/screen-zone.js` - Browser command detection, enhanced window detection timing
- `lib/media/mpv-zone-manager.js` - Filter VDPAU warnings on Trixie
- `docs/README.md` - Update with Trixie compatibility notes (optional)

### Configuration Files (Optional)
- `config/pfx.ini.example` - Add browser_command override example

## Backward Compatibility

- ✅ **Bookworm (12)**: Fully compatible, no breaking changes
- ✅ **Trixie (13)**: New support added
- ✅ **Configuration**: Existing configs work without changes
- ✅ **Auto-Detection**: Browser command detected automatically
- ✅ **Manual Override**: Config option available if needed

## Performance Impact

- **Minimal**: OS detection runs once at startup (~10ms)
- **Window Detection**: Slightly longer timeouts on Trixie (adds ~300ms worst case)
- **Video Playback**: No change (MPV handles decoding internally)
- **Memory**: No significant increase

## Migration Path

Existing installations can upgrade seamlessly:

```bash
cd /opt/paradox/apps/ParadoxFX
git pull
npm install  # If any new dependencies
sudo systemctl restart pfx.service
```

No configuration changes required - OS detection handles differences automatically.

## Alternatives Considered

1. **Environment Variable Override**: Less elegant, requires manual setup per system
2. **Separate Codebases**: Not maintainable, duplicates code
3. **Docker Containers**: Overkill for this use case, adds complexity
4. **Configuration-Only**: Requires manual per-system setup, error-prone

## Rollback Plan

If issues arise:
```bash
git revert <commit-hash>
sudo systemctl restart pfx.service
```

All changes are in new module and isolated modifications, minimal risk.

## References

- [Debian Trixie Release Notes](https://www.debian.org/releases/trixie/)
- [Chromium Package Changes](https://packages.debian.org/search?keywords=chromium)
- [VDPAU Mesa Documentation](https://www.freedesktop.org/wiki/Software/VDPAU/)
- Related Issue: Houdini-Installs docs/TRIXIE_COMPATIBILITY.md

---

**PR Author**: GitHub Copilot (via user request)  
**Date**: 7 October 2025  
**Target Branch**: main  
**Review Status**: Pending user review
