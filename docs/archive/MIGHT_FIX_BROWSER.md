MIGHT_FIX_BROWSER - Notes on improving browser foreground detection

Purpose
-------
Short note describing low-risk options to make the PFX "browser.foreground" value more reliable, trade-offs, and a recommended incremental path.

Checklist (what I recommend)
- [ ] Implement a single, authoritative WindowManager API: `getActiveWindowId()` and `isWindowActive(windowId)` and adapt the ScreenZone to use it.
- [ ] Add an optional config flag `windowManager.foregroundCheck = "xdotool|wm-api|none"` to let operators choose the foreground detection mechanism.
- [ ] As an alternative (opt-in): provide `useXdotoolForegroundCheck` that runs `xdotool getwindowfocus` when WM APIs are missing.
- [ ] Add a small unit/integration test that simulates window IDs and verifies `browser.foreground` flips as expected.
- [ ] Document the change and the schema (already done in `docs/pfx-status.schema.json`) and add run steps to the README.

Problem statement
-----------------
Currently `screen-zone.js` determines `browser.foreground` primarily by asking `WindowManager` for the active window (if available) and otherwise falls back to a heuristic (`focus === 'chromium'`). This is defensive (won't throw) but can be stale or inaccurate if the WindowManager implementation is limited or if window IDs are returned in different formats (hex vs decimal).

Options (pros/cons)
-------------------
1) Add/standardize `WindowManager.getActiveWindowId()` (recommended)
   - Pros: Single reliable API, testable, no system calls necessary.
   - Cons: Requires editing the WindowManager implementation(s).

2) Optional `xdotool` check (opt-in)
   - Implementation: run `xdotool getwindowfocus` (or `xdotool getwindowfocus getwindowname`) and compare the returned window id to the browser `window_id`.
   - Pros: Works independent of WindowManager, reliable on X11 systems.
   - Cons: Requires `xdotool` installed, shelling out, small perf hit if used frequently, not portable to Wayland without alternatives.

3) Polling/periodic re-check
   - Implementation: run the foreground check at a configurable interval (e.g., 1s) rather than only on-demand. Update `browser.foreground` only when the result differs.
   - Pros: Handles race conditions and missed events.
   - Cons: More CPU / system calls, potential noise if too-frequent.

4) Combined heuristic (current behavior)
   - Use WM API if available, else use `focus` heuristic. No change required.
   - Pros: Safe and minimal risk.
   - Cons: May be stale/inaccurate in some deployments.

Suggested incremental approach
-----------------------------
1. Implement and expose `getActiveWindowId()` & `isWindowActive(windowId)` in the WindowManager abstraction. Make ScreenZone prefer those calls. This is low-risk and keeps logic centralized.
2. Add a config flag in `pfx.ini` (or zone config) `windowManager.foregroundCheck = "wm-api"` (default). Add `"xdotool"` as an allowed value for operators who want to opt-in.
3. (Optional) Add `windowManager.pollIntervalMs = 1000` default and only enable polling when the chosen check mechanism is `xdotool` or `wm-api-poll`.
4. Add tiny tests and a short README note with the `xdotool` commands to validate active window.

Example commands to validate manually
-----------------------------------
# Show active window (xdotool)
xdotool getwindowfocus
# Show active window in hex
xprop -root _NET_ACTIVE_WINDOW

# Compare to the browser window id printed by PFX state
mosquitto_sub -h localhost -t "paradox/houdini/mirror/state" -C 1 -v

Implementation notes
--------------------
- Normalize window ids by stripping leading `0x` before comparision to handle hex vs decimal differences.
- Keep the current fallback (`focus === 'chromium'`) to avoid regressions.
- Make `xdotool` usage opt-in behind the config flag to avoid adding a hard dependency.

Docs & tests
------------
- Add an integration test (node-based or shell script) that launches a fake window id and asserts that `publishStatus()` includes `browser.foreground` correctly.
- Add a short how-to in this repository's docs describing enabling `xdotool` checks and sample commands for manual validation.

When to apply
-------------
If you are seeing incorrect foreground reports in production (false-positives/negatives), start with the WindowManager API change (1) and optional `xdotool` fallback (2). If everything looks stable, omit `xdotool` to keep the runtime lean.

File created: `apps/pfx/docs/MIGHT_FIX_BROWSER.md`

If you'd like, I can implement the WindowManager API or add the optional `xdotool` check behind a config flag next — tell me which option to implement and I will proceed.
