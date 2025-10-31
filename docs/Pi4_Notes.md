# Pi4 Notes for ParadoxFX

This document mirrors the structure of the Pi5 notes but documents practical, tested settings and recommendations for Raspberry Pi 4 (Pi4) deployments running ParadoxFX.

---

## Quick Summary

- Raspberry Pi 4 supports dual HDMI output (depending on firmware) and analog audio on some models; many deployments use Pi4 for stable multi-zone playback.
- ParadoxFX includes device discovery and audio mapping logic for Pi4. Use the Pi4-specific MPV profiles for reliable playback.
- Important runtime note: ParadoxFX's browser lifecycle and MPV ontop behavior are the same across Pi4/Pi5; use `mpvOntop = false` when Chromium must appear above MPV.

## Recommended `/boot/config.txt` entries for Pi4

These settings balance video quality and stability for dual-monitor playback:

```ini
# Pi4 recommended config
gpu_mem=256
hdmi_drive=2
hdmi_force_hotplug=1
config_hdmi_boost=4
dtoverlay=vc4-kms-v3d
max_framebuffers=2
```

Notes:
- Keep `gpu_mem` at 256 for heavier decoding workloads.
- `config_hdmi_boost` may be adjusted if HDMI signal issues occur.

## X11 vs Wayland

- X11 is recommended for predictable MPV screen targeting and window management.
- If your distribution defaults to Wayland, switch to X11 for multi-monitor MPV fullscreen behavior.

## MPV Profiles for Pi4

Recommended MPV args for quality:

```text
--screen=N --fullscreen --no-osc --no-input-default-bindings \
--hwdec=auto --vo=gpu --gpu-api=opengl \
--video-sync=display-resample --audio-device=alsa/hdmi:CARD=vc4hdmiN,DEV=0 \
--cache=yes --demuxer-max-bytes=30M --no-terminal --profile=gpu-hq
```

Lower-latency profile (for sound effects and short clips): `--profile=fast`.

## ParadoxFX INI examples for Pi4

```ini
[screen:zone1]
type = screen
display = :0
target_monitor = 0
audio_device = pulse/alsa_output.platform-107c701400.hdmi.hdmi-stereo
mpvOntop = true

[screen:zone2]
type = screen
display = :0
target_monitor = 1
audio_device = pulse/alsa_output.platform-107c706400.hdmi.hdmi-stereo
mpvOntop = false
```

Notes:
- On Pi4 you may use either ALSA sink specifiers (hw/plughw) or PulseAudio sink identifiers depending on your audio stack.
- `mpvOntop = false` is useful where a browser/overlay must be visible above MPV.

## Audio mapping and discovery

- Use `pactl list sinks` or `aplay -l` to discover sink names. Pi4 hardware sink names can be stable but vary by kernel/firmware.
- If you need combined sinks (dual-output), see `COMBINED_AUDIO.md` and consider using PFx's combined-sink settings (combined_sinks, combined_sink_name) or a boot-time discovery script.

## Browser and window management notes

- Browser visibility behavior and the settle-time guidance documented in `Browser_Switching.md` apply to Pi4 as well.
- If you run into stale window ids, increase `log_level` to `debug` and inspect `/opt/paradox/logs`.

## Testing & Validation

- `xrandr --query` to verify both HDMI outputs
- `aplay -l` and `pactl list sinks` for audio discovery
- Test MPV on each screen using `--screen` and `--audio-device`

## Troubleshooting

- No audio on HDMI: ensure correct sink id and verify PulseAudio/ALSA is running
- MPV remains on top: set `mpvOntop = false` for the affected zone
- Invisible Chromium: verify XAUTHORITY, DISPLAY and check logs for window id mismatches

---

This note is intended to be a concise, Pi4-focused companion to `Pi5-Notes.md` and `INI_Config.md`.
