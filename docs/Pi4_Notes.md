# Pi4 Notes for ParadoxFX

This document mirrors the structure of the Pi5 notes but documents practical, tested settings and recommendations for Raspberry Pi 4 (Pi4) deployments running ParadoxFX.

---

## Quick Summary

- Raspberry Pi 4 supports dual HDMI output and analog audio; many deployments use Pi4 for stable multi-zone playback.
- ParadoxFX includes device discovery and audio mapping logic for Pi4. Use the Pi4-specific MPV profiles for reliable playback.
- Important runtime note: ParadoxFX's browser lifecycle and MPV ontop behavior are the same across Pi4/Pi5; use `mpvOntop = false` when Chromium must appear above MPV.

## Recommended `/boot/firmware/config.txt` entries for Pi4

> **Note**: On current Debian-based Raspberry Pi OS the correct path is `/boot/firmware/config.txt` (not `/boot/config.txt`). Edit with `sudo nano /boot/firmware/config.txt`. Changes take effect after a full reboot.

Add the following under the `[pi4]` section:

```ini
[pi4]
gpu_mem=128
hdmi_drive=2
hdmi_force_edid_audio=1
```

Notes:
- `hdmi_drive=2` forces HDMI mode (enables audio). Without this, adapters that don't advertise audio in their EDID (RF transmitters, some capture cards) will be silent.
- `hdmi_force_edid_audio=1` forces HDMI audio even when the display/adapter doesn't report audio capability.
- `gpu_mem=128` is sufficient for typical PFx deployments; increase to 256 for heavier video decoding.

## X11 vs Wayland

- X11 is recommended for predictable MPV screen targeting and window management.
- If your distribution defaults to Wayland, switch to X11 for multi-monitor MPV fullscreen behavior.

## MPV Profiles for Pi4

Recommended MPV args for quality:

```text
--screen=N --fullscreen --no-osc --no-input-default-bindings \
--hwdec=auto --vo=gpu --gpu-api=opengl \
--video-sync=display-resample \
--cache=yes --demuxer-max-bytes=30M --no-terminal --profile=gpu-hq
```

Lower-latency profile (for sound effects and short clips): `--profile=fast`.

## Audio routing under PipeWire (systemd services)

**This is critical for all Pi deployments running PFx as a systemd service.**

When PFx runs as a systemd unit, mpv is launched as a child process of the service. In this context `audio_device = default` causes mpv to silently fall back to raw ALSA, bypassing PipeWire entirely. If the ALSA default card is disabled (e.g. analog card suppressed in favour of HDMI), audio will be completely silent — even though PipeWire and the HDMI sink are fully functional.

**Always set an explicit PipeWire device:**

```ini
# Follow the PipeWire default sink (controlled by pactl set-default-sink)
audio_device = pipewire

# OR pin to a specific HDMI output by its full sink name:
audio_device = pipewire/alsa_output.platform-fef00700.hdmi.hdmi-stereo
```

To find the correct sink name for your hardware:
```bash
mpv --audio-device=help
```
Look for `pipewire/alsa_output.*` entries matching your HDMI port.

**Symptom of wrong `audio_device`**: `pactl list sink-inputs short` shows zero entries while PFx logs say "Background music started successfully". Audio is playing but routing to raw ALSA (not PipeWire) — nothing reaches the speaker.

**Why `pw-play` works but PFx doesn't**: Interactive login tools inherit the user's PipeWire socket. mpv processes spawned by a systemd service do not, so they fall back to ALSA unless told explicitly to use PipeWire.

## ParadoxFX INI examples for Pi4

```ini
# Pi4 with PipeWire (Debian trixie / current RPi OS — recommended)
[screen:hdmi0]
type = screen
display = :0
target_monitor = 0
# Pin to HDMI0 via PipeWire; use 'pipewire' to follow the PipeWire default sink
audio_device = pipewire/alsa_output.platform-fef00700.hdmi.hdmi-stereo
mpvOntop = true

[screen:hdmi1]
type = screen
display = :0
target_monitor = 1
audio_device = pipewire/alsa_output.platform-fef05700.hdmi.hdmi-stereo
mpvOntop = false
```

Notes:
- Use `pipewire/...` not `pulse/...` on systems running PipeWire with the pipewire-pulse compatibility layer.
- Run `mpv --audio-device=help` on the target machine to list available device strings — sink names embed the ALSA card address and vary between Pi4 units.
- `mpvOntop = false` is useful where a browser/overlay must be visible above MPV.

## Audio mapping and discovery

- Pi4 ships with three audio cards: bcm2835 Headphones (analog), vc4-hdmi-0, vc4-hdmi-1. HDMI cards may start with profile `off` and need activating:
  ```bash
  pactl set-card-profile alsa_card.platform-fef00700.hdmi output:hdmi-stereo
  ```
  Use an `ExecStartPre` script in your service unit to do this before PFx starts (see `scripts/configure-audio-levels.sh` in the paradox deployment repo for a working example).
- Use `pactl list sinks` or `aplay -l` to discover sink names. Pi4 hardware sink names can be stable but vary by kernel/firmware.
- If you need combined sinks (dual-output), see the combined sink configuration in `CONFIG_INI.md`. Note: combined sinks require PulseAudio or the pipewire-pulse compatibility layer.

## Browser and window management notes

- Browser visibility behavior and the settle-time guidance documented in `Browser_Switching.md` apply to Pi4 as well.
- If you run into stale window ids, increase `log_level` to `debug` and inspect `/opt/paradox/logs`.

## Testing & Validation

- `xrandr --query` to verify both HDMI outputs
- `aplay -l` and `pactl list sinks` for audio discovery
- `mpv --audio-device=help` to list all PipeWire/ALSA device strings available to mpv
- `pactl list sink-inputs short` to verify mpv is routing through PipeWire (should show an entry when audio is playing)
- Test MPV on each screen using `--screen` and `--audio-device`

## Troubleshooting

- **No audio (but PFx logs say playing)**: Check `pactl list sink-inputs short` — zero entries means mpv is bypassing PipeWire. Set `audio_device = pipewire` or `audio_device = pipewire/<sinkname>` in the INI.
- **HDMI card present but silent**: HDMI card may have profile `off`. Run `pactl set-card-profile alsa_card.platform-fef00700.hdmi output:hdmi-stereo`.
- **MPV remains on top**: Set `mpvOntop = false` for the affected zone.
- **Invisible Chromium**: Verify XAUTHORITY, DISPLAY and check logs for window id mismatches.

---

This note is intended to be a concise, Pi4-focused companion to `Pi5-Notes.md` and `CONFIG_INI.md`.
