# PR_RESOLUTION: Screen Resolution Control for PFx

## Status Snapshot (March 2026)

This feature is mostly implemented in code and tests.

- Implemented in PFx code path:
   - `lib/utils/screen-resolution-helper.js`
   - `lib/core/config-loader.js`
   - `lib/zones/screen-zone.js`
   - `test/unit/screen-resolution-helper.test.js`
   - `test/unit/config-loader.test.js`
- Remaining work is primarily hardware validation and final doc/acceptance closure.
- Monitor control is intentionally postponed and tracked separately in `docs/PR_MONITOR_CONTROL.md`.

## Implementation Checklist

### 1) INI Schema Extension
- [x] Added optional `[screen:*]` keys: `output_name`, `resolution_mode`, `resolution_fallback`.
- [x] Wired keys through config loader normalization (`outputName`, `resolutionMode`, `resolutionFallback`).
- [x] Added/updated unit coverage in config loader tests.
- [x] Documented keys and behavior in `docs/INI_Config.md`.

### 2) Runtime Resolution Manager
- [x] Added dedicated helper module for resolution apply flow.
- [x] Parses `WxH@Hz` style mode strings and supports raw mode tokens.
- [x] Resolves output by explicit `output_name` or fallback `target_monitor` index.
- [x] Applies mode using `xrandr --output <name> --mode <WxH> [--rate <Hz>]`.
- [x] Skips idempotently when target mode already active.
- [x] Attempts fallback mode when primary mode apply fails.

### 3) Screen Zone Integration
- [x] `ScreenZone.initialize()` calls resolution helper before MPV zone manager creation.
- [x] Resolution failure path is non-fatal and initialization continues.
- [x] Logging records success/warn/skip outcomes.

### 4) Error Handling & Logging
- [x] Handles missing `DISPLAY` safely and skips with warning.
- [x] Handles invalid `resolution_mode`/`resolution_fallback` safely.
- [x] Handles missing `xrandr` binary with explicit actionable warning.
- [x] Continues operation when resolution change cannot be applied.

### 5) Tests
- [x] Unit tests for helper: no-mode skip, already-set skip, fallback behavior, unresolved output, missing binary.
- [x] Unit tests for config parsing of resolution keys.
- [ ] Hardware validation runbook execution on real devices (Pi3/Pi4/Pi5) is still pending final sign-off.
- [ ] End-to-end verification logs/screenshots for invalid-primary/valid-fallback scenario on target hardware are still pending.

### 6) Documentation
- [x] `docs/INI_Config.md` updated with resolution settings and dependency note (`x11-xserver-utils`).
- [x] Plan doc exists and now includes implementation status.
- [x] Supplementary platform guidance includes firmware-level notes.
- [ ] Add a short "verified on" matrix (device, output, mode, result) after hardware pass.

### 7) Scope Control
- [x] Monitor control is deferred; not part of this PR delivery.
- [x] Adaptive/per-media resolution switching remains excluded.

## Objective
Add a software-managed screen resolution feature to PFx that allows each `screen:` zone to specify the desired output mode (resolution + refresh rate) and optional HDMI output name. PFx will set the mode dynamically during startup using `xrandr` (or equivalent) before launching mpv.

## Motivation
- Simplify deployments where televisions or HDMI→RF modulators prefer a fixed resolution (e.g., 640x480 for Pi3 analog conversion).
- Reduce GPU/CPU load on lower-powered Pis by matching display mode to transcoded media (e.g., downscaled 480p videos).
- Provide per-zone flexibility for multi-monitor setups (different resolutions per output).
- Avoid manual ssh workflows or global desktop settings for each install.

## Scope
### Included
1. **INI Schema Extension**
   - Add optional keys under `[screen:<name>]`:
     - `output_name` (string): e.g., `HDMI-1`, `HDMI-A-1`.
     - `resolution_mode` (string): `640x480@60`, `1280x720@60`, etc.
     - `resolution_fallback` (string, optional): attempted if primary mode fails.
   - Document acceptable formats and defaults in `docs/INI_Config.md`.

2. **Runtime Resolution Manager**
   - Small utility to parse the mode string, construct `xrandr` commands, and apply them idempotently.
   - Run during screen zone initialization *before* mpv starts to avoid window tearing.
   - Log results (success, failure, already set) with actionable messages.

3. **Error Handling & Logging**
   - Gracefully continue if mode cannot be set (fall back to current resolution).
   - Provide clear warnings in PFx logs to guide operators.
   - Optionally suggest running `xrandr` manually for troubleshooting.

4. **Documentation & Examples**
   - Update `docs/INI_Config.md` with new keys, example configs (Pi3 480p, Pi4 dual 1080p).
   - Add a troubleshooting note referencing firmware-level overrides (`/boot/firmware/config.txt`) for stubborn displays.

## Media Preparation (Optional Transcode Workflow)
- Provide operators with an ffmpeg one-liner for generating Pi-friendly assets:
  ```bash
  ffmpeg -i input.mp4 -vf scale=640:480:flags=lanczos -c:v libx264 -preset medium -crf 20 -c:a aac -b:a 160k output_480p.mp4
  ```
- Note that scaling to 640×480 (or another target mode) keeps playback smooth on Pi3 software decode paths.
- Encourage keeping source master copies elsewhere; PFx deployments should reference the downscaled versions in zone `media_dir`.

### Excluded (future consideration)
- Automatic EDID probing or adaptive resolution changes mid-game.
- Integration with Pi firmware settings (we will reference them in docs only).
- Per-media resolution switching.

## Implementation Plan
Most implementation-plan items are complete. Remaining items are tracked in the checklist above under "Tests" and "Documentation".

## Risks & Mitigations
- **Missing xrandr**: Ensure package dependency documented (`x11-xserver-utils`). Log a clear error if the binary is missing.
- **Unsupported mode**: Provide fallback logic and avoid crashing PFx.
- **Wayland users**: Document that X11 is required for `xrandr` (recommended for PFx deployments already). Warn if `DISPLAY` not set.

## Acceptance Criteria
- [x] New INI keys documented and optional.
- [x] PFx applies requested resolution before mpv window creation.
- [x] Logs indicate resolution state changes or failures clearly.
- [x] System continues operating when modes cannot be set.
- [x] Example configuration demonstrates Pi3 640x480 use case.
- [ ] Hardware validation evidence captured on target devices (Pi3/Pi4/Pi5 where applicable).

## Next Steps
- Execute hardware validation pass on physical targets:
   - Pi3 + HDMI->RF workflow at `640x480@60`
   - Pi4/Pi5 single and dual output scenarios as configured
   - Invalid primary mode + valid fallback mode behavior
- Capture a concise verification matrix in this document (device/output/mode/result/log reference).
- If hardware validation passes, mark this PR as complete and close remaining checklist items.
