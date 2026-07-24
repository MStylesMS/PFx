# Scripts Directory

This directory contains operational helpers, diagnostics, and proof scripts for PFx.

## Recommended operational scripts

- [cleanup.sh](cleanup.sh): Kills leftover mpv processes, removes stale sockets, and cleans audio leftovers during troubleshooting.
- [mqtt_test.sh](mqtt_test.sh): Interactive MQTT command smoke-test flow (currently oriented to a zone2-style setup).
- [pi-audio-discovery.sh](pi-audio-discovery.sh): Detects Pi model and reports available audio cards/sinks for configuration work.
- [test-audio-setup.sh](test-audio-setup.sh): Validates PulseAudio/PipeWire sink setup and volume ranges.
- [watch-logs.sh](watch-logs.sh): Tails the latest PFx log symlink (`pfx-latest.log`) and can list log files.
- [startup-xhost-config.sh](startup-xhost-config.sh): Grants X11 access for the paradox user in desktop sessions (for remote DISPLAY=:0 workflows).
- [install-pulseaudio-config.sh](install-pulseaudio-config.sh): Disables PulseAudio `module-suspend-on-idle` on Pi analog output (see [../docs/AUDIO_SILENT_PLAYBACK.md](../docs/AUDIO_SILENT_PLAYBACK.md)).

## Installation and desktop helpers

- [install-autostart.sh](install-autostart.sh): Installs desktop autostart entries from config into `~/.config/autostart`.
- [disable-screen-blanking.sh](disable-screen-blanking.sh): Disables X11/DPMS blanking to keep displays active for kiosk-style runs.
- [startup-xhost.sh](startup-xhost.sh): Legacy placeholder file (currently empty). Prefer [startup-xhost-config.sh](startup-xhost-config.sh).

## Browser/MPV proof and recovery scripts

- [browser-management-demo.js](browser-management-demo.js): Prints a command-by-command browser lifecycle demonstration (enable/show/hide/disable).
- [proof-mpv-chromium.js](proof-mpv-chromium.js): End-to-end proof script for mpv/chromium window switching and optional MQTT clock fade commands.
- [proof-mpv-chromium-option6-working.js](proof-mpv-chromium-option6-working.js): Variant proof focused on the option-6 window activation approach.
- [recovery.js](recovery.js): Recovery/proof script variant for mpv/chromium switching.
- [recovery1.js](recovery1.js): Recovery/proof variant snapshot.
- [recovery2.js](recovery2.js): Recovery/proof variant snapshot.
- [recovery.md](recovery.md): Notes and results from z-order/window-stacking experiments.
- [test-current-browser-impl.js](test-current-browser-impl.js): Manual test sequence for current browser command behavior.

## Screen-targeting and HDMI test scripts

- [test-direct-mqtt-video.sh](test-direct-mqtt-video.sh): Direct mpv + MQTT validation script for troubleshooting command path issues.
- [test-mpv-screen-targeting.sh](test-mpv-screen-targeting.sh): Compares multiple mpv targeting strategies for dual-screen routing.
- [test-advanced-screen-targeting.sh](test-advanced-screen-targeting.sh): Additional targeting experiments (Wayland/Pi5 oriented).
- [test-pi5-dual-hdmi.sh](test-pi5-dual-hdmi.sh): End-to-end validation for Pi5 dual HDMI video/audio behavior.

## Usage notes

- Most scripts assume a Pi/Linux environment with display access and local MQTT broker.
- Many scripts are investigative/manual tools, not production automation.
- If a script path is referenced from docs or desktop entries, update references when renaming or relocating scripts.
