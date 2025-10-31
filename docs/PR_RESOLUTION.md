# PR_RESOLUTION: Screen Resolution Control for PFx

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
1. **Schema Update**
   - Extend config loader to accept new keys and validate basic format.
   - Default behavior remains unchanged when keys are absent.

2. **Resolution Helper Module**
   - Accepts `{ outputName, mode, fallbackMode }`.
   - Parses mode into width/height/refresh, or accepts raw `xrandr --mode` tokens.
   - Executes `xrandr --output <output> --mode <WxH> --rate <Hz>`.
   - If the target mode is already active, skip to avoid log noise.
   - On failure, attempt fallback (if provided), then warn.

3. **Screen Zone Integration**
   - `ScreenZone.initialize()` calls resolution helper before mpv processes spawn.
   - Ensure asynchronous calls resolve before continuing to media load.

4. **Testing**
   - Verify on Pi3 (Trixie) and Pi4/5 with dual-head setups.
   - Test fallback behavior by specifying an invalid mode first.
   - Confirm mpv launches with expected window size and no race conditions.

5. **Documentation Refresh (Final Step)**
   - Add "Resolution Control" section to `INI_Config.md` and reference this PR plan.
   - Document manual firmware edits (hdmi_group/mode) only as supplementary guidance.

## Risks & Mitigations
- **Missing xrandr**: Ensure package dependency documented (`x11-xserver-utils`). Log a clear error if the binary is missing.
- **Unsupported mode**: Provide fallback logic and avoid crashing PFx.
- **Wayland users**: Document that X11 is required for `xrandr` (recommended for PFx deployments already). Warn if `DISPLAY` not set.

## Acceptance Criteria
- New INI keys documented and optional.
- PFx applies requested resolution before mpv window creation.
- Logs indicate resolution state changes or failures clearly.
- System continues operating when modes cannot be set.
- Example configuration demonstrates Pi3 640x480 use case.

## Next Steps
- Implement resolution helper module.
- Update config loader and screen zone initialization.
- Refresh documentation and provide sample configs.
- Test on physical Pi hardware with HDMI→RF converter scenario.
