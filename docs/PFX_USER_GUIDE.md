# PFx User Guide

ParadoxFX (PFx) is a Node.js media and effects controller. It receives MQTT commands and drives screens, audio outputs, and browser overlays on a single host (typically a Raspberry Pi). This guide is a feature-by-feature tour with small examples. Every chapter links to a deeper reference.

## Table of contents

1. [Introduction](#1-introduction)
2. [Architecture and zones](#2-architecture-and-zones)
3. [Screen zones: images, video, browser overlays](#3-screen-zones-images-video-browser-overlays)
4. [Audio: background, speech, effects, ducking](#4-audio-background-speech-effects-ducking)
5. [Removed hardware integrations](#5-removed-hardware-integrations)
6. [MQTT contract](#6-mqtt-contract)
7. [Configuration (INI)](#7-configuration-ini)
8. [Operational tooling](#8-operational-tooling)
9. [Deployment](#9-deployment)
10. [Testing an install](#10-testing-an-install)
11. [Further reading](#11-further-reading)

---

## 1. Introduction

PFx is the hardware abstraction layer for an escape-room or interactive-installation host. Game logic (PxO or any MQTT publisher) sends JSON commands to zone topics; PFx executes the corresponding hardware actions and reports state, warnings, and events back over MQTT.

Key characteristics:

- One PFx process per host, configured by a single INI file.
- Zone-based: each output (a screen or an audio device) is a named zone with its own topic namespace.
- Stateless command surface, stateful telemetry: commands are fire-and-forget JSON; state is published and retained.
- Designed for Raspberry Pi 4/5 with mpv and Chromium, but runs on desktop Linux for development.

Minimal smoke test (after install and `pfx start`):

```bash
mosquitto_pub -t paradox/screen/main/commands \
  -m '{"command":"setImage","file":"default.png"}'
```

For a guided single-output Pi setup, see [QUICK_START_PFX.md](QUICK_START_PFX.md).

---

## 2. Architecture and zones

PFx is organised around a small set of zone types. Each zone is declared in the INI as a `[type:name]` section and gets its own MQTT topic root.

| Zone type | INI section | Purpose |
|-----------|-------------|---------|
| Screen    | `[screen:name]` | Image/video playback and Chromium overlay |
| Audio     | `[audio:name]`  | Multi-channel audio (background, speech, effects) |
A zone has the topic structure `{baseTopic}/{commands|state|warnings|events}`. Zones are independent — a screen-zone failure does not stop audio.

For full configuration syntax and every supported key, see [CONFIG_INI.md](CONFIG_INI.md).

---

## 3. Screen zones: images, video, browser overlays

A screen zone owns one display output and renders three things:

- **Static images** — shown via mpv, replacing whatever was on screen.
- **Videos** — single playback, with optional looping and a video queue (next-on-EOF).
- **Browser overlay** — a Chromium window that can be raised, hidden, or refreshed; useful for clock or UI overlays driven by PxC or PxT.

Common commands:

```json
{"command":"setImage","file":"intro.png"}
{"command":"playVideo","file":"reveal.mp4"}
{"command":"stopVideo"}
{"command":"showBrowser"}
{"command":"hideBrowser"}
{"command":"stopAll"}
```

The video queue lets you chain clips without gaps. The browser overlay is window-managed via `xdotool`/`wmctrl`; see [PR_MONITOR_CONTROL.md](PR_MONITOR_CONTROL.md) for the focus model.

Full command list and event payloads are in [MQTT_API.md](MQTT_API.md). Per-zone INI keys (media directory, MPV profile, default volume, Chromium URL) are documented in [CONFIG_INI.md](CONFIG_INI.md).

---

## 4. Audio: background, speech, effects, ducking

Each audio zone is mapped to a real or aliased audio output (`hdmi`, `analog`, or a PulseAudio sink). Within a zone PFx maintains three logical channels:

- **Background music** — long-running, looping, smoothly volume-controlled.
- **Speech** — queued, exclusive, automatically ducks background while playing.
- **Sound effects** — fire-and-forget, mixed on top.

Multiple audio zones can run in parallel on a host with multiple sinks (e.g., HDMI plus USB DAC). Volumes are independent per zone and per channel.

Examples:

```json
{"command":"playBackground","file":"ambient.mp3","volume":60}
{"command":"playSpeech","file":"hint1.wav"}
{"command":"playEffect","file":"chime.wav","volume":80}
{"command":"setBackgroundVolume","volume":30}
{"command":"stopSpeech"}
```

Ducking, queue ordering, and volume telemetry are described in [MQTT_API.md](MQTT_API.md). Device discovery and aliases are covered in [CONFIG_INI.md](CONFIG_INI.md) and [../scripts/README.md](../scripts/README.md) (`pi-audio-discovery.sh`).

### Multi-channel audio

PFx can tell mpv which channel layout to use when sending audio to a configured sink. Set `audio_channels` in either a `[screen:*]` or `[audio:*]` INI section:

```ini
[audio:surround]
type          = audio
topic         = paradox/houdini/surround
audio_device  = pulse/alsa_output.platform-107c701400.hdmi.hdmi-surround
audio_channels = 5.1
```

Accepted values are any layout string mpv accepts for `--audio-channels`: `stereo`, `5.1`, `7.1`, `7.1(wide)`, etc. Run `mpv --audio-channels=help` to list supported layouts on your system.

**Required sink configuration** — the PulseAudio / PipeWire sink must already be configured for the target channel count before PFx starts. Verify with:

```bash
pactl list sinks short
```

The sink's sample spec must show the correct channel count (e.g. `s16le 6ch 48000Hz` for 5.1). If the sink reports `2ch`, mpv will output stereo regardless of the `audio_channels` setting.

For PipeWire-based systems (Pi OS Bookworm and later), configure `audio.channels` and `audio.position` in a WirePlumber device rule. Consult the [WirePlumber documentation](https://pipewire.pages.freedesktop.org/wireplumber/) for per-device channel configuration.

> **Verification**: after starting PFx with `audio_channels` set, run `ps aux | grep mpv` — the `--audio-channels=` flag must appear in every audio-related mpv process listing.

---

## 5. MQTT contract

Every zone uses the same topic shape:

| Topic suffix | Direction | Retained | Purpose |
|--------------|-----------|----------|---------|
| `commands`   | inbound   | no       | JSON commands |
| `state`      | outbound  | yes      | Current zone state and lifecycle (starting/ready/error) |
| `warnings`   | outbound  | no       | Recoverable issues |
| `events`     | outbound  | no       | Discrete events (EOF, button, speech-done) |

Command shape:

```json
{"command":"playVideo","file":"clip.mp4"}
```

Outcome and event payloads conform to JSON schemas in [json-schemas/](json-schemas/). The full command catalog, payload fields, and event examples are in [MQTT_API.md](MQTT_API.md).

PFx also publishes a readiness marker file at `/run/paradox/pfx.ready` once startup is complete; downstream services (e.g., the game engine) should gate on this.

---

## 6. Configuration (INI)

PFx reads a single INI file at startup (path passed on the command line, typically `/etc/pfx.ini`). The file declares:

- Global settings (MQTT broker, log level, media root)
- One section per zone (`[screen:main]`, `[audio:main]`)

Minimal example:

```ini
[mqtt]
broker     = localhost
base_topic = paradox/demo/pfx
device_name = demo-pfx

[global]
heartbeat_topic = paradox/demo/pfx/heartbeat

[screen:main]
type    = screen
topic   = paradox/demo/screen
display = :0
media_dir = /opt/paradox/media

[audio:main]
type   = audio
topic  = paradox/demo/audio
device = hdmi
```

`[mqtt] base_topic` is the PFx process root (`…/pfx`); each zone’s `topic` is the gameplay leaf. Full key reference: [CONFIG_INI.md](CONFIG_INI.md). For Pi-specific tuning, see the platform notes in [archive/Pi5-Notes.md](archive/Pi5-Notes.md) and [archive/Pi4_Notes.md](archive/Pi4_Notes.md).

---

## 7. Operational tooling

The `scripts/` directory contains helpers for setup, debugging, and field troubleshooting:

- `mqtt_test.sh` — end-to-end command smoke test.
- `pi-audio-discovery.sh` — enumerate PulseAudio sinks and propose aliases.
- `test-audio-setup.sh` — exercise each audio channel.
- `watch-logs.sh` — tail PFx logs with highlighting.
- `cleanup.sh` — reset stuck mpv/Chromium processes between runs.
- `startup-xhost-config.sh` — DISPLAY/xhost setup for autostart.

The full catalog with usage notes is in [../scripts/README.md](../scripts/README.md).

---

## 8. Deployment

A sample systemd unit lives at [../config/pfx.service](../config/pfx.service). It is a template — adjust `User=`, `ExecStart=`, working directory, and hardening options before installing.

Typical install flow:

 1. Install Node.js 24 LTS, mpv, Chromium, mosquitto.
2. `npm install` in the PFx checkout.
3. Copy `config/pfx.service` to `/etc/systemd/system/pfx.service` and edit.
4. Place your INI at `/etc/pfx.ini`.
5. `systemctl enable --now pfx`.
6. Verify `/run/paradox/pfx.ready` appears and `paradox/.../state` topics report `ready` lifecycle status.

For desktop autostart instead of systemd, see [../config/](../config) and `scripts/startup-xhost-config.sh`.

---

## 10. Testing an install

Use the interactive install test after PFx is running and your outputs are wired. It asks which outputs to cover, publishes the current screen/audio/browser smoke commands one step at a time, prompts for pass or fail after each step, and writes a markdown report under `test/manual/reports/` for follow-up fixes.

Recommended entrypoints:

```bash
npm run test:install
```

Compatibility wrapper:

```bash
./test/manual/test-all.sh
```

The script starts by asking whether to test HDMI0, HDMI1, and analog audio where those options are valid for the detected Pi model. It then reads your PFx config path, suggests command topics from the configured zones when possible, asks for the media prefix, and uses only bundled assets from `PFx/media/*`.

Prerequisites:

- PFx is running and connected to the local MQTT broker.
- `mosquitto_pub` is installed on the host running the test.
- Your configured `media_dir` points at `PFx/media` or `PFx/media/test`.

## 11. Further reading

- [QUICK_START_PFX.md](QUICK_START_PFX.md) — single-output Pi quick start
- [CONFIG_INI.md](CONFIG_INI.md) — complete INI reference
- [MQTT_API.md](MQTT_API.md) — every command and event
- [SPEC.md](SPEC.md) — functional specification
- [json-schemas/](json-schemas/) — machine-readable command/event schemas
- [../scripts/README.md](../scripts/README.md) — operational scripts
- [../config/pfx.service](../config/pfx.service) — sample systemd unit
