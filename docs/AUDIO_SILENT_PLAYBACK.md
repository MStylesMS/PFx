# Silent Audio Playback (mpv OK, Room Silent)

ParadoxFX can report successful audio playback while the room hears nothing. This document describes the failure mode, how to diagnose it, and the layered fixes shipped with PFx.

## Symptoms

- Background music, hint bells, or speech cues do not play in the room
- `journalctl -u pfx` shows normal commands (`playBackground`, `playAudioFX`, `playSpeech`) with no file errors
- PFx logs `Background music started successfully` or accepts FX commands without errors
- mpv IPC shows a loaded file and advancing `playback-time`
- Video on screen may still work; **room amplifier path** is silent

## Root cause (Raspberry Pi analog output)

Two layers interact on Pi 4/5 installs using the **3.5 mm jack** (`alsa_output.platform-fe00b840.mailbox.stereo-fallback`):

1. **PulseAudio `module-suspend-on-idle`** — after idle time, the analog sink moves to `SUSPENDED`. On Pi ALSA drivers it sometimes **does not resume cleanly**.
2. **ALSA driver glitch** — journal may show:
   ```
   ALSA woke us up to write new data to the device, but there was actually nothing to write.
   ```
   mpv and PFx continue as if playback succeeded.

This is **not** a game EDN/INI volume issue. Game volumes (e.g. `start-music` at 32, zone bases at 90) are separate from the **system line-level boost** applied by `/opt/paradox/scripts/configure-audio-levels.sh` (ALSA Master 100%, PulseAudio sink 150% for the room amp).

## Layered fixes

| Layer | When it runs | Purpose |
|-------|----------------|---------|
| **1. PulseAudio config** | Install once; applies on PulseAudio start | Disable `module-suspend-on-idle` so the analog sink is not auto-suspended |
| **2. configure-audio-levels.sh** | Every `pfx.service` start | Unsuspend sink, set default, set line-level volume; unload suspend module if still loaded |
| **3. AudioManager throttled wake** | Before audio output (≥5 min apart) | If sink is `SUSPENDED`, wake it without per-FX overhead |

Layer 3 uses `pactl suspend-sink … 0` (wake only — does **not** stop streams already playing).

## Install PulseAudio config (layer 1)

From the PFx repo:

```bash
/opt/paradox/apps/PFx/scripts/install-pulseaudio-config.sh
```

This is idempotent. It:

- Installs a user PulseAudio snippet under `~/.config/pulse/` (no sudo required)
- Attempts `/etc/pulse/default.pa.d/` install when sudo is available
- Unloads `module-suspend-on-idle` immediately via `pactl` when PulseAudio is running

`pfx.service` already invokes this script via `configure-audio-levels.sh` on each start.

After manual install, restart PulseAudio if needed:

```bash
systemctl --user restart pulseaudio.service
```

## Diagnosis

```bash
# Sink state (look for SUSPENDED on the analog sink)
pactl list sinks | grep -E 'Name:|State:'

# Recent PFx audio activity
journalctl -u pfx --since today | grep -iE 'audio|music|speech|Background music'

# PulseAudio ALSA glitch
journalctl --since "2 days ago" | grep -i 'ALSA woke us up'

# Quick listen test (as paradox, analog jack)
DISPLAY=:0 XDG_RUNTIME_DIR=/run/user/1000 \
  mpv --no-video --audio-device=pulse/alsa_output.platform-fe00b840.mailbox.stereo-fallback \
  --length=2 /opt/paradox/rooms/houdinis-challenge/media/hint.mp3
```

## Recovery

```bash
/opt/paradox/scripts/paradox-control.sh restart pfx
```

Or restart PulseAudio:

```bash
systemctl --user restart pulseaudio.service
/opt/paradox/scripts/paradox-control.sh restart pfx
```

## Picture-zone / remote audio

Commands to `paradox/houdini/picture` are handled by the **picture PFx instance** (often a second Pi). Silent intro or picture speech requires checking that host separately.

## Related files

- `config/pulse/paradox-no-suspend.pa` — PulseAudio drop-in
- `scripts/install-pulseaudio-config.sh` — installer
- `lib/media/audio-manager.js` — throttled `_beforeAudioOutput()`
- `/opt/paradox/scripts/configure-audio-levels.sh` — startup levels + installer hook
