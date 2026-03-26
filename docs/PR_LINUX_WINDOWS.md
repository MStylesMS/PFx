# PR: Linux Windowed Screen Emulation for Desktop Debugging

## Purpose
Enable PFx screen zones to run as movable, resizable desktop windows on Linux so developers can emulate Raspberry Pi display behavior while debugging upstream controllers (for example, PxO) without requiring physical Pi hardware.

## Problem Statement
Current screen-zone behavior is optimized for kiosk/fullscreen Pi deployments:
- MPV launches fullscreen and on-top.
- Browser lifecycle and switching logic assumes fullscreen stacking.
- Window state forcing (above/below) can interfere with desktop workflows.

For desktop debugging, users need small side-by-side zone windows they can place near their editor and freely move or resize.

## Goals
- Preserve existing MQTT API and zone command behavior.
- Allow each screen zone to run in normal desktop windows on Linux (X11).
- Keep MPV and Chromium switching behavior (showBrowser/hideBrowser) functional in windowed mode.
- Avoid forcing windows above all other desktop apps.
- Allow manual reposition/resize during runtime without breaking playback/switching.

## Non-Goals (Phase 1)
- Full macOS native support.
- Wayland-first implementation.
- Replacing existing Pi fullscreen behavior.
- New zone type with duplicated screen-zone logic.

## Proposed Design
Use the existing screen zone type with new optional configuration flags, rather than adding a new zone type.

### New Screen Configuration Keys (Proposed)
- windowed: true|false (default false)
- window_x: integer (default 0)
- window_y: integer (default 0)
- window_width: integer (default 1280)
- window_height: integer (default 720)
- window_decorated: true|false (optional, default true for desktop debugging)

### Behavior Split
- windowed false:
  - Keep current Pi-style fullscreen behavior.
- windowed true:
  - Launch MPV with window geometry (not fullscreen, not ontop).
  - Launch Chromium in geometry-defined app window (not fullscreen).
  - Use focus activation for show/hide switching; avoid above/below forcing.
  - Do not automatically reapply geometry after user drag/resize unless explicitly requested by a future lock flag.

## Linux Platform Scope
Primary target: Linux X11 desktop environments where PFx window management dependencies are already used (xdotool, wmctrl, xrandr).

Notes:
- Wayland sessions may need compatibility handling or reduced guarantees.
- macOS requires separate WindowManager backend and is out of scope for this plan.

## Detailed Technical Plan

### 1. Configuration and Parsing
- Extend INI handling for new screen window keys.
- Validate bounds and provide safe defaults.
- Add clear logs indicating windowed vs fullscreen launch path per zone.

### 2. MPV Launch Path
- In windowed mode, remove fullscreen-oriented arguments:
  - fullscreen
  - ontop
  - no-border (unless explicitly requested)
  - fs-screen and screen targeting assumptions
- Add geometry-based launch arguments using window_x, window_y, window_width, window_height.
- Keep media and queue logic unchanged.

### 3. Chromium Launch Path
- Keep existing class/profile handling.
- In windowed mode:
  - Do not request fullscreen state.
  - Keep initial size/position from zone config.
  - Avoid forcing below/above state transitions intended for fullscreen kiosks.

### 4. Browser/MPV Switching
- In windowed mode, use focus activation only:
  - showBrowser: activate browser window
  - hideBrowser: activate MPV window
- Skip aggressive above/below state manipulation used to counter ontop/fullscreen interactions.

### 5. Runtime Move/Resize Semantics
- If user moves/resizes either window manually, PFx should continue operating normally.
- PFx should track window identity, not fixed geometry, for switching.
- Geometry is treated as initial placement only in Phase 1.

### 6. Status and Observability
- Keep existing status payload shape.
- Optionally add light metadata in status for troubleshooting:
  - windowed_mode true/false
  - known_window_ids for mpv/chromium

### 7. Backward Compatibility
- Default behavior remains unchanged for all existing screen zones.
- No MQTT command changes required for existing controllers.

## Risks and Mitigations

1. Window manager variance across Linux desktops
- Risk: focus behavior differs by WM.
- Mitigation: keep switching minimal (activate target window only), improve diagnostics.

2. Wayland sessions
- Risk: xdotool/wmctrl reliability can degrade.
- Mitigation: declare X11 as supported target for this feature; add runtime warning under unsupported session types.

3. Existing fullscreen assumptions in helper code
- Risk: hidden side effects when fullscreen flags are removed.
- Mitigation: gate behavior with explicit windowed flag and add integration tests.

4. Browser window recreation
- Risk: Chromium window id may change after relaunch.
- Mitigation: retain current refresh/rebind logic by class and pid.

## Testing Plan

### Unit/Component
- Config parsing for windowed keys and defaults.
- MPV arg generation split between fullscreen and windowed modes.
- Browser launch option generation split between fullscreen and windowed modes.

### Manual Integration (Linux X11)
- Two windowed screen zones (mirror, picture) launch in distinct positions.
- Commands:
  - setImage, playVideo, pauseVideo, stopVideo
  - enableBrowser, showBrowser, hideBrowser, disableBrowser
- While running, manually move/resize windows and confirm switching/playback still works.
- Confirm no always-on-top behavior in windowed mode.
- Confirm existing non-windowed zones remain unchanged.

## Rollout Strategy

### Phase A: Internal Feature Flag
- Implement behind windowed per-zone config.
- No default behavior change.

### Phase B: Validation with Houdini/PxO Debug Workflow
- Validate two-zone desktop workflow against realistic MQTT command traffic.
- Capture edge cases and improve diagnostics.

### Phase C: Documentation and Hardening
- Add user docs and example config snippets.
- Add troubleshooting notes for desktop WM/session differences.

## Open Questions
- Should we support a future lock_geometry flag that reapplies configured size/position after every show/hide?
- Should windowed mode expose optional decorations toggles per backend/tool?
- Should Wayland support be explicitly blocked or best-effort in initial release?

## Success Criteria
- Developers can run PFx on Linux desktop with multiple small zone windows.
- Windows can be moved/resized during runtime without breaking playback or browser switching.
- MQTT behavior remains compatible with existing PxO/Houdini integration.
- Existing Raspberry Pi fullscreen installations behave exactly as before.
