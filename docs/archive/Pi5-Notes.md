````markdown
# Pi5 Notes for ParadoxFX (Consolidated)

This document consolidates Pi5 setup, migration, MPV optimizations, and troubleshooting notes for ParadoxFX. It combines content from the PI5_* documents and updates guidance to reflect recent code changes (mpvOntop configurable per zone and improved browser window management).

---

## Quick Summary

- Raspberry Pi 5 is HDMI-only for analog audio; it supports two independent HDMI outputs.
- ParadoxFX now supports Pi5 device naming, dual-HDMI routing, and Pi5-optimized MPV profiles.
- Important runtime note: ParadoxFX's browser lifecycle now refreshes Chromium window ids at show time and includes aggressive fallbacks when a previously stored window id becomes stale. If you run into invisible-browser issues, set `log_level = debug` and check the pfx logs for window id mismatches.

## Setup & Boot Configuration

Recommended additions to `/boot/firmware/config.txt`:

```ini
# Pi5 ParadoxFX Optimized Configuration
gpu_mem=256
hdmi_enable_4kp60=1
hdmi_drive=2
hdmi_force_hotplug=1
config_hdmi_boost=7
dtoverlay=vc4-kms-v3d
max_framebuffers=2
```

Notes:
- X11 is recommended for reliable dual-HDMI video routing with MPV. Wayland's Xwayland translation can prevent `--screen` targeting from working properly; if you need two independent fullscreen outputs, switch to X11.

## Switching to X11 (if on Wayland)

```bash
sudo raspi-config
# Advanced Options -> Wayland -> X11
sudo reboot
```

Confirm X11 with `echo $XDG_SESSION_TYPE` (should be `x11`).

## MPV Optimization Recommendations

Primary (high-quality) profile recommended for Pi5:

```text
--screen=N --fullscreen --no-osc --no-input-default-bindings \
--hwdec=auto --vo=gpu --gpu-api=opengl \
--opengl-swapinterval=1 --video-sync=display-resample \
--audio-device=alsa/hdmi:CARD=vc4hdmiN,DEV=0 \
--cache=yes --demuxer-max-bytes=50M --no-terminal --profile=gpu-hq
```

Performance mode (lower latency): `--profile=fast` instead of `--profile=gpu-hq`.

Important: ParadoxFX's MPV launcher now respects a zone-level setting `mpvOntop`. By default, MPV will include `--ontop` unless `mpvOntop = false` is set for that zone in `pfx.ini`. Use this to avoid MPV staying above Chromium windows, which can interfere with browser activation/visibility.

## ParadoxFX-specific Configuration

Examples (in `pfx.ini`):

```ini
[screen:display1]
type = screen
display = :0
audio_device = hdmi0
mpvOntop = false  # set false if MPV must not sit above Chromium windows

[audio:pi5-main]
type = audio
devices = hdmi0
```

Notes:
- `mpvOntop = false` removes `--ontop` from the MPV args generation path. This is useful when Chromium needs to be raised above MPV for clocks or UI overlays.
- `pfx.ini` is often local and may be ignored by git; keep deployment-specific settings out of commits unless intended.

## Browser & Window Management (Houdini Clock)

Background:
- Chromium windows may change window ids across restarts or renderer process reloads. ParadoxFX previously stored the browser window id at enable time and re-used it; this could become stale and `activateWindow` would target a non-visible id.

Current behavior (as of recent updates):

- At show time, the system refreshes the list of Chromium/ParadoxBrowser windows and prefers currently-live ids. If the stored id is stale, ParadoxFX will try:
  - activateWindow on the refreshed id
  - retry activation with small backoff
  - wmctrl fallback attempt
  - aggressive fallback: prefer PID-matched windows (wmctrl -lp mapping), iterate candidate ParadoxBrowser windows and run unmap/raise/focus/activate until successful

Operational advice:
- If you see invisible-browser behavior, check logs under `/opt/paradox/logs`. Look for lines mentioning enableBrowser pid/windowId and showBrowser discovered ids. If identifiers differ, consider increasing `log_level` to `debug` and check for MPV ontop conflicts.
- Ensure the service process has the correct XAUTHORITY and DISPLAY when running in systemd; missing X authority often causes window-management commands to silently fail.

## Pi5 Audio & Device Mapping

Pi5 is HDMI-only for analog; recommended aliases and mappings:

- `hdmi0` → `alsa/hdmi:CARD=vc4hdmi0,DEV=0` (primary)
- `hdmi1` → `alsa/hdmi:CARD=vc4hdmi1,DEV=0` (secondary)

ParadoxFX contains logic to detect Pi5 and map alias requests (for example `analog`) to HDMI0 with a warning.

## Testing & Validation

Quick validation checks:

- `echo $XDG_SESSION_TYPE` → should be `x11` for dual-screen MPV targeting
- `xrandr --query` → both HDMI outputs should be listed
- `aplay -l | grep vc4hdmi` → shows vc4hdmi0 and vc4hdmi1
- Check ParadoxFX logs: `/opt/paradox/logs/pfx-latest.log`

MPV test commands:

```bash
# Test HDMI0
mpv --screen=0 --fullscreen --audio-device=alsa/hdmi:CARD=vc4hdmi0,DEV=0 test.mp4

# Test HDMI1
mpv --screen=1 --fullscreen --audio-device=alsa/hdmi:CARD=vc4hdmi1,DEV=0 test.mp4
```

## Troubleshooting

Common issues and checks:

- No video on second screen under Wayland: switch to X11 (see above)
- MPV stays above Chromium: set `mpvOntop = false` in the zone config
- Invisible Chromium on showBrowser: check logs for stale window id; confirm that Chromium PID maps to a current window id using `wmctrl -lp` and `xdotool search --class ParadoxBrowser`
- XAUTHORITY/Display problems: systemd services must set DISPLAY and XAUTHORITY correctly to operate window-manager commands

Useful commands (run on Pi with proper X authority):

```bash
wmctrl -lG
wmctrl -lp
xdotool search --class ParadoxBrowser
xdotool windowmap <id>
xdotool windowraise <id>
xdotool windowfocus <id>
```

## Migration Checklist (Pi4 → Pi5)

- Update `/boot/firmware/config.txt` with Pi5 recommended settings
- Test audio device discovery and update any device maps
- Verify `gpu_mem` and optionally set to 256 for robust dual-screen playback
- Ensure power supply is adequate (5V/5A recommended)
- Switch to X11 for ParadoxFX deployment

## References

- MPV Manual: https://mpv.io/manual/stable/
- Raspberry Pi Documentation: https://www.raspberrypi.org/documentation/

---

*Consolidated from: PI5_MPV_OPTIMIZATION_2025.md, PI5_SETUP_GUIDE.md, PI5_Wayland_MPV_Issue.md, PI5_Configuration_UPDATE_SUMMARY.md, PI5_MIGRATION.md* 

````
