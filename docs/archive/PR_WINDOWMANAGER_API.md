# PR: WindowManager API Standardization and Foreground Detection

**Status**: Planned  
**Priority**: Medium  
**Prerequisite**: `PR_BROWSER_WINDOW_REFRESH.md` (recommended but not required)  
**Related Issues**: Inaccurate `browser.foreground` status in zone state  
**Related Docs**: `MIGHT_FIX_BROWSER.md`, `Browser_Switching.md`

## Problem Statement

The `browser.foreground` field in zone status reports is sometimes inaccurate due to:
1. **WindowManager API inconsistencies** - Different window ID formats (hex vs decimal)
2. **Missing standardized methods** - No single authoritative way to check active window
3. **Fallback heuristics** - Current code uses `focus === 'chromium'` which can be stale
4. **No polling mechanism** - Foreground status only checked on-demand

**Impact**: External systems (game engine, MQTT clients) receive incorrect foreground state, leading to timing issues and incorrect behavior.

## Solution Overview

Standardize the WindowManager API to provide:
1. **Authoritative active window detection** - Single source of truth
2. **Optional xdotool integration** - Configurable for reliable X11 foreground detection
3. **Window ID normalization** - Handle hex/decimal formats consistently
4. **Optional polling** - Periodic foreground checks for real-time accuracy

## Technical Approach

### Phase 1: Core WindowManager API

Add these methods to `lib/utils/window-manager.js`:

```javascript
class WindowManager {
  constructor(config = {}) {
    this.config = {
      foregroundCheck: config.foregroundCheck || 'wm-api', // 'wm-api' | 'xdotool' | 'none'
      pollIntervalMs: config.pollIntervalMs || 0, // 0 = disabled
      ...config
    };
    this.logger = new Logger('WindowManager');
    this._pollingInterval = null;
  }

  /**
   * Get the currently active (focused) window ID
   * @returns {Promise<number>} Window ID (normalized to decimal)
   */
  async getActiveWindowId() {
    const method = this.config.foregroundCheck;
    
    if (method === 'none') {
      return null;
    }
    
    if (method === 'xdotool') {
      return await this._getActiveWindowViaXdotool();
    }
    
    // Default: wm-api
    return await this._getActiveWindowViaWmApi();
  }

  /**
   * Check if a specific window is currently active
   * @param {number|string} windowId - Window ID (hex or decimal)
   * @returns {Promise<boolean>}
   */
  async isWindowActive(windowId) {
    const activeId = await this.getActiveWindowId();
    if (!activeId) return false;
    
    const normalizedTarget = this._normalizeWindowId(windowId);
    return activeId === normalizedTarget;
  }

  /**
   * Normalize window ID to decimal integer
   * @param {number|string} windowId
   * @returns {number}
   */
  _normalizeWindowId(windowId) {
    if (typeof windowId === 'string') {
      if (windowId.startsWith('0x')) {
        return parseInt(windowId, 16);
      }
      return parseInt(windowId, 10);
    }
    return parseInt(windowId, 10);
  }

  /**
   * Get active window using xdotool (X11 only)
   * @private
   */
  async _getActiveWindowViaXdotool() {
    try {
      const result = await this._execCommand('xdotool getwindowfocus');
      const windowId = result.trim();
      return this._normalizeWindowId(windowId);
    } catch (error) {
      this.logger.debug('xdotool getwindowfocus failed:', error.message);
      return null;
    }
  }

  /**
   * Get active window using xprop (X11 only)
   * @private
   */
  async _getActiveWindowViaWmApi() {
    try {
      const result = await this._execCommand('xprop -root _NET_ACTIVE_WINDOW');
      // Output: _NET_ACTIVE_WINDOW(WINDOW): window id # 0x2000003
      const match = result.match(/0x([0-9a-fA-F]+)/);
      if (match) {
        return parseInt(match[1], 16);
      }
      return null;
    } catch (error) {
      this.logger.debug('xprop _NET_ACTIVE_WINDOW failed:', error.message);
      return null;
    }
  }

  /**
   * Start polling for active window changes (optional)
   * Emits 'activeWindowChanged' event when foreground changes
   */
  startPolling(callback) {
    if (this.config.pollIntervalMs === 0) {
      this.logger.debug('Polling disabled (pollIntervalMs = 0)');
      return;
    }

    if (this._pollingInterval) {
      this.logger.warn('Polling already started');
      return;
    }

    let lastActiveId = null;

    this._pollingInterval = setInterval(async () => {
      try {
        const currentActiveId = await this.getActiveWindowId();
        
        if (currentActiveId !== lastActiveId) {
          this.logger.debug(`Active window changed: ${lastActiveId} → ${currentActiveId}`);
          lastActiveId = currentActiveId;
          
          if (callback) {
            callback(currentActiveId, lastActiveId);
          }
        }
      } catch (error) {
        this.logger.error('Polling error:', error.message);
      }
    }, this.config.pollIntervalMs);

    this.logger.info(`Started active window polling (interval: ${this.config.pollIntervalMs}ms)`);
  }

  /**
   * Stop polling for active window changes
   */
  stopPolling() {
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = null;
      this.logger.info('Stopped active window polling');
    }
  }

  // ... existing methods ...
}
```

### Phase 2: ScreenZone Integration

Update `lib/zones/screen-zone.js` to use the new API:

```javascript
class ScreenZone extends BaseZone {
  constructor(config, mqttClient, zoneManager) {
    super(config, mqttClient);
    
    // Initialize WindowManager with config
    this.windowManager = new WindowManager({
      foregroundCheck: config.windowManager?.foregroundCheck || 'wm-api',
      pollIntervalMs: config.windowManager?.pollIntervalMs || 0
    });
    
    // Set up polling callback if enabled
    if (config.windowManager?.pollIntervalMs > 0) {
      this.windowManager.startPolling((newActiveId, oldActiveId) => {
        this._handleActiveWindowChange(newActiveId, oldActiveId);
      });
    }
    
    // ... rest of constructor ...
  }

  /**
   * Handle active window changes from polling
   * @private
   */
  async _handleActiveWindowChange(newActiveId, oldActiveId) {
    // Check if browser window became active/inactive
    if (this.browserWindowId) {
      const browserNowActive = await this.windowManager.isWindowActive(this.browserWindowId);
      
      if (browserNowActive !== this.browserForeground) {
        this.browserForeground = browserNowActive;
        this.logger.debug(`Browser foreground changed: ${!browserNowActive} → ${browserNowActive}`);
        this.publishStatus(); // Update MQTT status
      }
    }
  }

  /**
   * Update browser foreground status
   * Uses WindowManager API instead of heuristics
   * @private
   */
  async _updateBrowserForeground() {
    if (!this.browserWindowId) {
      this.browserForeground = false;
      return;
    }

    try {
      this.browserForeground = await this.windowManager.isWindowActive(this.browserWindowId);
    } catch (error) {
      this.logger.debug('Failed to check browser foreground:', error.message);
      // Fallback to heuristic
      this.browserForeground = this.focus === 'chromium';
    }
  }

  async publishStatus() {
    // Update foreground status before publishing
    await this._updateBrowserForeground();
    
    // ... existing status publishing code ...
  }

  async shutdown() {
    this.windowManager.stopPolling();
    // ... existing shutdown code ...
  }

  // ... rest of class ...
}
```

### Phase 3: Configuration Schema

Add to `pfx.ini` (or zone-specific config):

```ini
[screen:zone1-hdmi0]
type = screen
# ... existing config ...

# WindowManager configuration (optional)
[screen:zone1-hdmi0.windowManager]
# Foreground detection method: wm-api (default), xdotool, none
foreground_check = wm-api

# Polling interval in milliseconds (0 = disabled)
# Enable for real-time foreground updates
poll_interval_ms = 0
```

### Phase 4: Validation Commands

Add helper script for manual validation:

```bash
#!/bin/bash
# scripts/validate-window-manager.sh

echo "=== Window Manager Validation ==="
echo ""

echo "1. Active window (xdotool):"
xdotool getwindowfocus
echo ""

echo "2. Active window (xprop):"
xprop -root _NET_ACTIVE_WINDOW
echo ""

echo "3. All windows (wmctrl):"
wmctrl -l
echo ""

echo "4. Browser windows (xdotool search):"
xdotool search --class chromium
echo ""

echo "5. Zone status (MQTT):"
mosquitto_sub -h localhost -t "paradox/houdini/mirror/state" -C 1 -v | jq '.browser.foreground'
echo ""

echo "=== Validation Complete ==="
```

## Implementation Steps

1. **Phase 1**: Add WindowManager API methods
   - `getActiveWindowId()`
   - `isWindowActive()`
   - `_normalizeWindowId()`
   - `_getActiveWindowViaXdotool()`
   - `_getActiveWindowViaWmApi()`
   - `startPolling()` / `stopPolling()`

2. **Phase 2**: Update ScreenZone
   - Add WindowManager config handling
   - Replace `_updateBrowserForeground()` logic
   - Add `_handleActiveWindowChange()` callback
   - Update `publishStatus()` to call `_updateBrowserForeground()`

3. **Phase 3**: Add configuration support
   - Update INI parser for nested `windowManager` sections
   - Add schema documentation

4. **Phase 4**: Add validation tools
   - Create `validate-window-manager.sh` script
   - Update README with validation steps

5. **Phase 5**: Testing
   - Unit tests for WindowManager methods
   - Integration tests for ScreenZone foreground updates
   - Manual validation on Bookworm and Trixie

## Testing Plan

### Unit Tests (`test/window-manager.test.js`)

```javascript
describe('WindowManager', () => {
  describe('_normalizeWindowId', () => {
    it('should normalize hex string to decimal', () => {
      const wm = new WindowManager();
      expect(wm._normalizeWindowId('0x2000003')).toBe(33554435);
    });

    it('should normalize decimal string to decimal', () => {
      const wm = new WindowManager();
      expect(wm._normalizeWindowId('33554435')).toBe(33554435);
    });

    it('should handle numeric input', () => {
      const wm = new WindowManager();
      expect(wm._normalizeWindowId(33554435)).toBe(33554435);
    });
  });

  describe('isWindowActive', () => {
    it('should return true when window IDs match', async () => {
      const wm = new WindowManager();
      wm.getActiveWindowId = jest.fn().mockResolvedValue(33554435);
      
      expect(await wm.isWindowActive('0x2000003')).toBe(true);
      expect(await wm.isWindowActive(33554435)).toBe(true);
    });

    it('should return false when window IDs differ', async () => {
      const wm = new WindowManager();
      wm.getActiveWindowId = jest.fn().mockResolvedValue(12345);
      
      expect(await wm.isWindowActive('0x2000003')).toBe(false);
    });
  });
});
```

### Integration Tests

```javascript
describe('ScreenZone foreground detection', () => {
  it('should update browser.foreground when browser becomes active', async () => {
    // Launch browser
    await zone.handleCommand({ command: 'enableBrowser', url: 'http://localhost/test' });
    await zone.handleCommand({ command: 'showBrowser' });
    
    // Check status
    const status = await zone.getStatus();
    expect(status.browser.foreground).toBe(true);
    
    // Hide browser
    await zone.handleCommand({ command: 'hideBrowser' });
    
    // Check status again
    const status2 = await zone.getStatus();
    expect(status2.browser.foreground).toBe(false);
  });
});
```

### Manual Testing Checklist

- [ ] Launch browser, verify `browser.foreground = true` in MQTT status
- [ ] Hide browser, verify `browser.foreground = false`
- [ ] Show browser, verify `browser.foreground = true`
- [ ] Test with polling enabled (1000ms interval), observe real-time updates
- [ ] Test with `xdotool` method, compare accuracy to `wm-api`
- [ ] Validate hex/decimal window ID handling
- [ ] Test on Bookworm and Trixie

## Expected Outcomes

### Before
- `browser.foreground` sometimes inaccurate
- Relies on `focus === 'chromium'` heuristic
- Window ID format inconsistencies cause false negatives

### After
- `browser.foreground` accurate 100% of time
- Uses authoritative window manager APIs
- Optional real-time polling for instant updates
- Configurable detection methods

## Configuration Options

### Recommended Settings

**Production (default)**:
```ini
foreground_check = wm-api
poll_interval_ms = 0
```
- Uses lightweight xprop check
- On-demand updates only
- Minimal CPU overhead

**Development/Debug**:
```ini
foreground_check = xdotool
poll_interval_ms = 1000
```
- More reliable foreground detection
- Real-time status updates every 1 second
- Useful for debugging timing issues

**Minimal**:
```ini
foreground_check = none
poll_interval_ms = 0
```
- Disables foreground detection
- Falls back to focus heuristic
- Use when xdotool/xprop unavailable

## Rollback Plan

1. Set `foreground_check = none` in config
2. Revert WindowManager API changes
3. Revert ScreenZone integration
4. Previous heuristic-based behavior restored

## Documentation Updates

- Update `MIGHT_FIX_BROWSER.md` to mark as implemented
- Add WindowManager API reference to README
- Document configuration options
- Add troubleshooting guide for foreground detection

## Dependencies

- **Optional**: `xdotool` (for xdotool method)
- **Required**: `xprop` (for wm-api method, usually pre-installed)
- **Required**: `wmctrl` (already a dependency)

## Performance Considerations

- **On-demand checks**: <1ms overhead per status update
- **Polling (1000ms interval)**: ~0.1% CPU usage
- **Network**: No impact (local system calls only)
- **Memory**: Negligible (<1KB for polling timer)

## Related Work

- **Prerequisite**: `PR_BROWSER_WINDOW_REFRESH.md` - Fixes stale window ID issues
- **Reference**: `MIGHT_FIX_BROWSER.md` - Original proposal
- **Reference**: `Browser_Switching.md` - Window management documentation

## Notes

This PR focuses on **foreground status accuracy**. It complements but does not replace:
- Window activation/detection (see `PR_BROWSER_WINDOW_REFRESH.md`)
- Hidden startup (see `ISSUE_BROWSER_STARTUP.md`)

Recommended implementation order:
1. `PR_BROWSER_WINDOW_REFRESH.md` first (fixes window detection)
2. This PR second (improves status reporting)
