# PR: Robust Browser Window Detection with PID-Matching

**Status**: Planned  
**Priority**: Medium  
**Prerequisite**: None  
**Related Issues**: Browser window management - stale window IDs, slow show/hide operations  
**Related Docs**: `Browser_Switching.md`, `ISSUE_BROWSER_STARTUP.md`

## Problem Statement

The current browser window management in `ScreenZone` suffers from stale window ID issues that cause:
- Warnings: "stored browser windowId=X is stale, updating to fresh id=Y"
- Slow activation requiring aggressive fallbacks
- Inconsistent show/hide operations
- MPV window detection failures

**Root Cause**: Stored window IDs become stale as Chromium window states change or windows are recreated. The current implementation stores a window ID at browser launch and reuses it for all subsequent operations.

## Solution Overview

Implement the "Robust ShowBrowser Algorithm" from `Browser_Switching.md` which:
1. **Refreshes window candidates on every show operation** (don't trust stored IDs)
2. **Uses PID-matching** to find the correct browser window
3. **Implements multi-step fallback** chain
4. **Improves MPV window detection** with retries

## Technical Approach

### Core Algorithm (7 Steps)

```javascript
async _showBrowser() {
  // Step 1: Refresh candidate Chromium windows
  const candidates = await this._findChromiumWindowsByClass();
  
  // Step 2: Prefer window matching browser PID (via wmctrl -lp)
  let chosenWindow = await this._matchWindowByPid(candidates, this.browserPid);
  if (!chosenWindow && candidates.length > 0) {
    chosenWindow = candidates[0]; // fallback to first candidate
  }
  
  if (!chosenWindow) {
    throw new Error('No browser window candidates found');
  }
  
  // Step 3: Try xdotool windowactivate
  for (let attempt = 0; attempt < 3; attempt++) {
    await this.windowManager.activateWindow(chosenWindow);
    await this._delay(200);
    
    // Step 4: Check if active
    if (await this._isWindowActive(chosenWindow)) {
      this.browserWindowId = chosenWindow; // update stored ID
      return true;
    }
  }
  
  // Step 5: Try wmctrl -i -a as alternative
  await this.windowManager.wmctrlActivate(chosenWindow);
  await this._delay(200);
  if (await this._isWindowActive(chosenWindow)) {
    this.browserWindowId = chosenWindow;
    return true;
  }
  
  // Step 6: Aggressive fallback - try all candidates
  for (const candidate of candidates) {
    await this.windowManager.unmapRaiseFocus(candidate);
    await this.windowManager.activateWindow(candidate);
    await this._delay(200);
    
    if (await this._isWindowActive(candidate)) {
      this.browserWindowId = candidate;
      this.logger.info(`Aggressive fallback succeeded with window ${candidate}`);
      return true;
    }
  }
  
  // Step 7: Failed - collect diagnostics
  await this._collectWindowDiagnostics();
  throw new Error('Browser window activation failed after all attempts');
}
```

### Helper Functions to Implement

#### 1. Find Chromium Windows by Class
```javascript
async _findChromiumWindowsByClass() {
  // Use xdotool search --class to find all Chromium windows
  // Try multiple class names: ParadoxBrowser, chromium, chromium-browser, Chromium
  const classNames = ['ParadoxBrowser', 'chromium', 'chromium-browser', 'Chromium'];
  const windows = new Set();
  
  for (const className of classNames) {
    const result = await this.windowManager.searchByClass(className);
    result.forEach(id => windows.add(id));
  }
  
  return Array.from(windows);
}
```

#### 2. Match Window by PID
```javascript
async _matchWindowByPid(windowIds, targetPid) {
  if (!targetPid) return null;
  
  // Use wmctrl -lp to get window-to-PID mapping
  const windowPidMap = await this.windowManager.getWindowPidMap();
  
  for (const windowId of windowIds) {
    const normalizedId = this._normalizeWindowId(windowId);
    if (windowPidMap[normalizedId] === targetPid) {
      return windowId;
    }
  }
  
  return null;
}
```

#### 3. Normalize Window IDs
```javascript
_normalizeWindowId(windowId) {
  // Convert between hex (0x02000003) and decimal (33554435)
  if (typeof windowId === 'string' && windowId.startsWith('0x')) {
    return parseInt(windowId, 16);
  }
  return parseInt(windowId, 10);
}
```

#### 4. Improved MPV Window Detection
```javascript
async _findMpvWindow() {
  const maxRetries = 3;
  const retryDelay = 1000; // 1 second
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const mpvWindow = await this.windowManager.findWindowByName('mpv');
    if (mpvWindow) {
      return mpvWindow;
    }
    
    this.logger.debug(`MPV window not found, retry ${attempt + 1}/${maxRetries}`);
    await this._delay(retryDelay);
  }
  
  // Try alternative detection methods
  const alternativeWindow = await this.windowManager.findWindowByClass('mpv');
  if (alternativeWindow) {
    this.logger.info('MPV window found via alternative detection (class search)');
    return alternativeWindow;
  }
  
  return null;
}
```

#### 5. Window Diagnostics Collection
```javascript
async _collectWindowDiagnostics() {
  this.logger.error('Browser activation failed - collecting diagnostics:');
  
  try {
    const wmctrlList = await this._execCommand('wmctrl -lG');
    this.logger.error('wmctrl -lG output:', wmctrlList);
    
    const wmctrlPids = await this._execCommand('wmctrl -lp');
    this.logger.error('wmctrl -lp output:', wmctrlPids);
    
    const xdotoolSearch = await this._execCommand('xdotool search --class chromium');
    this.logger.error('xdotool search output:', xdotoolSearch);
    
    const activeWindow = await this._execCommand('xdotool getwindowfocus');
    this.logger.error('Active window:', activeWindow);
  } catch (error) {
    this.logger.error('Failed to collect diagnostics:', error.message);
  }
}
```

### WindowManager API Extensions Needed

Add these methods to `window-manager.js`:

```javascript
async searchByClass(className) {
  // Execute: xdotool search --class <className>
  // Return array of window IDs
}

async getWindowPidMap() {
  // Execute: wmctrl -lp
  // Parse output and return map of {windowId: pid}
}

async wmctrlActivate(windowId) {
  // Execute: wmctrl -i -a <windowId>
}

async unmapRaiseFocus(windowId) {
  // Execute sequence:
  // xdotool windowmap <windowId>
  // xdotool windowraise <windowId>
  // xdotool windowfocus <windowId>
}
```

## Implementation Steps

1. **Phase 1**: Add helper functions to WindowManager
   - `searchByClass()`
   - `getWindowPidMap()`
   - `wmctrlActivate()`
   - `unmapRaiseFocus()`

2. **Phase 2**: Implement core algorithm in ScreenZone
   - Replace `_showBrowser()` with robust algorithm
   - Add `_findChromiumWindowsByClass()`
   - Add `_matchWindowByPid()`
   - Add `_normalizeWindowId()`

3. **Phase 3**: Improve MPV detection
   - Replace `_findMpvWindow()` with retry logic
   - Add alternative detection methods

4. **Phase 4**: Add diagnostics
   - Implement `_collectWindowDiagnostics()`
   - Enhance error logging

5. **Phase 5**: Update `_hideBrowser()`
   - Use improved MPV window detection
   - Add retry logic for MPV activation

## Testing Plan

### Unit Tests
- Test window ID normalization (hex ↔ decimal)
- Test PID-matching logic with mock data
- Test candidate selection algorithm

### Integration Tests
- Launch browser, verify window detection
- Test show/hide cycles (10 iterations)
- Test with stale window IDs (kill and restart browser)
- Test fallback chain with simulated failures

### Manual Testing
- Enable browser → wait 10s → hide → show (repeat 10 times)
- Monitor logs for "stale window" warnings (should be eliminated)
- Test on both Bookworm and Trixie
- Measure average show/hide times (should improve)

## Expected Outcomes

### Before
- Stale window ID warnings
- Show browser: 1-3 seconds with aggressive fallback
- Hide browser: occasional MPV window not found

### After
- No stale window ID warnings (or handled gracefully)
- Show browser: <500ms consistent
- Hide browser: <300ms consistent
- Reliable operation across multiple show/hide cycles

## Configuration Changes

None required - implementation is transparent to users.

## Rollback Plan

If issues arise:
1. Revert `screen-zone.js` changes
2. Revert `window-manager.js` extensions
3. Previous behavior restored

## Documentation Updates

- Update `Browser_Switching.md` with actual implementation details
- Add troubleshooting section to README
- Document new WindowManager API methods

## Related Work

- **Follow-up PR**: `PR_WINDOWMANAGER_API.md` - Standardize foreground detection
- **Reference**: `Browser_Switching.md` - Original algorithm documentation
- **Reference**: `MIGHT_FIX_BROWSER.md` - Foreground detection improvements

## Notes

This PR focuses on **window detection and activation reliability**. It does not address:
- Hidden browser startup (see `ISSUE_BROWSER_STARTUP.md` - accepted 8s visibility)
- Foreground status accuracy (see `PR_WINDOWMANAGER_API.md`)

Both of those are separate concerns with separate solutions.
