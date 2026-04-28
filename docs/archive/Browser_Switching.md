````markdown
# MPV ↔ Chromium Window Switching (Consolidated)

This document consolidates experimental notes (`MPV-Chrome-Switch.md`, `MPV_CHROME_SWITCH_SHORT.md`) and the PR plan (`PR_MPV_CHROMIUM.md`) into a single, up-to-date guide that matches current ParadoxFX code behavior (as of Aug 2025).

## Summary

- Proven reliable techniques: `xdotool windowactivate <winId>` and `wmctrl -i -a <winId>` (focus + raise)
- Avoid relying solely on `--ontop` manipulation; `--ontop` can be removed by setting `mpvOntop = false` in zone config
- ParadoxFX's browser lifecycle now refreshes Chromium window ids at show time and includes aggressive PID-matched fallbacks when stored window ids are stale

## Test Results (short)

- Successful: `wmctrl -i -a <winId>` and `xdotool windowactivate <winId>`
- Failures: pure `xdotool windowraise`, `wmctrl -b add,above`/`remove`, off-screen positioning

## Recommended Implementation (Production)

- Use a `WindowManager` utility (see implementation sketch) that provides:
  - findWindowByClass/findWindowByName
  - activateWindow (xdotool/wmctrl wrappers)
  - moveWindow/resizeWindow/fullscreenWindow
  - launchChromium and monitor its process id
- ScreenZone should manage a `browserManager` structure with process, url, windowId, enabled, keepAlive
- Implement lifecycle commands: `enableBrowser`, `disableBrowser`, `showBrowser`, `hideBrowser`, `setBrowserUrl`, `setBrowserKeepAlive` (MQTT commands exist in docs)

## Robust ShowBrowser Algorithm (best-practice)

1. Refresh candidate Chromium windows via `xdotool search --class ParadoxBrowser` (or classes `chromium`, `chromium-browser`, `Chromium`)
2. Prefer window id matching the browser process PID (map via `wmctrl -lp`) — this avoids stale stored ids
3. Try `xdotool windowactivate <candidate>`
4. If not active, retry 2-3 times with short backoff
5. If still not active, run `wmctrl -i -a <candidate>` as an alternative
6. If still failing, iterate other candidates and attempt unmap/raise/focus/activate sequence
7. Log diagnostics: `wmctrl -lG`, `wmctrl -lp`, `xdotool search --class ParadoxBrowser` for post-mortem

## Implementation Sketch (Node.js)

- Key helper functions (use execSync/child_process with proper DISPLAY/XAUTHORITY env):
  - findChromiumWindowIds()
  - mapWindowIdToPid(windowId) (use `wmctrl -lp` parsing)
  - activateWindow(winId) (xdotool/wmctrl wrappers)
  - unmapRaiseFocus(winId) (xdotool windowmap/raise/focus)

- showBrowser flow example (async):

```javascript
// refresh candidates
const candidates = findChromiumWindowIds();
let chosen = pickPidMatched(candidates, browserPid) || candidates[0];

for (let attempt=0; attempt<3; attempt++) {
  activateWindow(chosen);
  await delay(200);
  if (isWindowActive(chosen)) return true;
}

wmctrlActivateWindow(chosen);
await delay(200);
if (isWindowActive(chosen)) return true;

// aggressive fallback
for (const c of candidates) {
  unmapRaiseFocus(c);
  activateWindow(c);
  await delay(200);
  if (isWindowActive(c)) return true;
}

// failed - collect diagnostics
collectDiagnostics();
return false;
```

## Integration to ScreenZone (high-level)

- Add `browserManager` to `ScreenZone` (process, pid, url, windowId, enabled)
- On `enableBrowser(url)` launch Chromium with `--class=ParadoxBrowser --app=${url}` and capture pid
- After launch, wait for candidate windows and map pid->windowId; store `browserManager.windowId`
- On `showBrowser()` run the Robust ShowBrowser Algorithm above
- On `hideBrowser()` set focus back to MPV using stored MPV window id and `activateWindow(mpvWin)`

## Browser startup / settle time (current behavior)

- `enableBrowser()` launches Chromium via the WindowManager and attempts to detect the created window using a class search. In the code the initial wait is 5 seconds (`waitForWindowByClass(..., 5000)`) and there is a small fallback loop that performs up to 3 short retries (300ms sleep) before a final find-by-class attempt.
- When a window id is detected the implementation immediately positions the window (move, fullscreen, desktop) and forces the browser behind MPV by adding the `'below'` state; the code also explicitly re-activates the MPV window so MPV retains focus. There is no automatic additional hide delay inside `_enableBrowser()`.
- Because of web-app load timing and Chromium behavior, practical startup tests and helper scripts in the repo use an 8s HTTP/settle wait (see scripts that call `waitForHttpOk(..., 8000)` and other 8s sleeps). In practice the observed, accepted behavior is a brief visibility window for ~8–10s during `enableBrowser` while the page settles, after which callers typically issue `hideBrowser()` or rely on external orchestration.
- Recommendation (matches current code and scripts): if you want a hidden startup, call `enableBrowser()` and then schedule `hideBrowser()` ~8s after the launch (or use the project's helper scripts that wait for HTTP readiness). This avoids brittle off-screen/minimized tricks which proved unreliable across window managers.
- Logs: `_enableBrowser()` writes `enableBrowser result: pid=..., windowId=...` and `_showBrowser()` will warn and refresh stored ids when it detects stale window ids. Use these log lines when troubleshooting startup visibility issues.

## Configuration

- `mpvOntop` (boolean) added to zone configs; when `false` MPV args will not include `--ontop`. Use this when browser must be raised above MPV.

## Status Reporting & MQTT

- Publish enhanced zone status including `focus`, `content`, and `browser` fields (pid/window id)
- Use existing MQTT topics for commands; implement the commands in the ScreenZone command handler

## Tests

- Unit test `WindowManager` functions with mocked execSync
- Integration test full lifecycle using a headless/display server (Xvfb or real Pi with X11)
- Manual verification: enableBrowser → wait for settle → hideBrowser → showBrowser cycles

## Diagnostics

- When showBrowser fails, collect and include these in the bug report:
  - `wmctrl -lG`
  - `wmctrl -lp`
  - `xdotool search --class ParadoxBrowser`
  - contents of `/opt/paradox/logs/pfx-latest.log` around timestamps

## Notes & Rationale

- Activation (focus + raise) is necessary; state-only manipulations (above/below) are unreliable across window managers
- PID-matching reduces the risk of activating a stale window id
- Removing MPV `--ontop` is a low-risk configuration change that reduces surface area for conflicts but is not sufficient on its own

---

*Consolidated from: MPV-Chrome-Switch.md, PR_MPV_CHROMIUM.md, MPV_CHROME_SWITCH_SHORT.md*

````
