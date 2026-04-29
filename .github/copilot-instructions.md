# ParadoxFX (PFx) — AI Instructions

This is the single source of AI/agent context for this repository. `CLAUDE.md` and `AGENTS.md` at the repo root are thin pointers to this file so the same instructions are picked up automatically by VS Code Copilot, Claude Code, Codex, Cursor, Aider, and Gemini-CLI.

## What PFx is

ParadoxFX is a Node.js multi-modal media and effects controller. It receives MQTT commands and coordinates screens (mpv), multi-zone audio (PulseAudio), browser overlays (Chromium), lights, relays, and input events. It is the hardware abstraction layer for the Paradox escape-room system and runs as `pfx.service` on Raspberry Pi 4/5; it also runs on desktop Linux for development.

- **Runtime**: Node.js 18+
- **Audio**: PulseAudio with multi-zone ducking (background music, speech, SFX)
- **Video**: mpv (Pi4+), vlc, fbi for framebuffer
- **Lights**: Hue, WiZ, LIFX, Shelly (direct); Zigbee + Z-Wave via **PZB** over MQTT
- **Config**: INI file with `[screen:zone]`, `[audio:zone]`, `[lights:*]`, `[input:*]` sections
- **Entry point**: `pfx.js`

## Paradox family

PFx is one of seven Paradox products. Be aware of siblings when designing contracts.

- **PFx** — media / audio / lights / relays controller (this repo)
- **PxO** — game orchestration engine (EDN, state machine)
- **PxC** — configurable clock app framework (React build)
- **PxT** — player terminal kiosk (Electron)
- **Pio** — GPIO-to-MQTT bridge (C++)
- **PZB** — Z-Wave / Zigbee / Thread to MQTT bridge (Node.js)
- Rooms: `agent22`, `houdinis-challenge` — game packages consumed by PxO + PFx

PFx does **not** own radio hardware directly. PZB does. PFx consumes PZB over MQTT (inputs from `{node.base_topic}/events`, outputs to `{node.base_topic}/commands`). Direct in-PFx Z-Wave/Zigbee code is being retired.

## How this repo is built — development methodology

The repo is built AI-accelerated but disciplined. Agents are expected to follow this methodology, not work around it.

1. **Doc-first design.** Non-trivial behaviour is specified in `docs/SPEC.md`, `docs/MQTT_API.md`, `docs/CONFIG_INI.md`, and `docs/PFX_USER_GUIDE.md` *before* it lands in code. A clear spec makes implementation faster and more predictable; it also gives the next agent something to read.
2. **Phased delivery.** Each phase ships a fully working application with incremental features. No half-wired feature flags on `main`; no dangling branches that break startup. If a phase isn't complete, it goes on a feature branch.
3. **Check-before-code gate.** Any change that alters the spec, MQTT API, INI keys, or the scaffold updates the matching doc *in the same commit as* (or before) the implementation. This applies to bug fixes that change documented behaviour. The doc is the contract; the code is the implementation.
4. **Reuse-first.** Before writing a new helper, search the codebase for an existing one. The repo already has zone base classes, an MQTT wrapper, audio/window managers, and a config loader. Adding parallel implementations is a regression.
5. **Best-practices baseline.** Conventional commits (`Docs:`, `Implement:`, `Fix:`, `Test:`, `Refactor:`, `Chore:`), tests next to features, no commented-out code, no scratch files at the repo root, no bypassing the MQTT wrapper.

If a request would violate one of these rules, propose the doc/spec update first and get explicit approval before changing the contract.

## Architecture summary

Each device type is a **zone** with its own MQTT topic namespace.

```
{baseTopic}/commands   # inbound JSON commands
{baseTopic}/state      # retained zone state and lifecycle (starting/ready/error)
{baseTopic}/warnings   # recoverable issues
{baseTopic}/events     # discrete events (EOF, button, speech-done)
```

INI sections declare zones:

```ini
[mqtt]
broker = localhost
port = 1883

[screen:mirror]
type = screen
topic = paradox/houdini/mirror
media_dir = /opt/media
audio_device = hdmi
volume = 80

[audio:zone1]
type = audio
topic = paradox/houdini/audio
device = analog
volume = 100

[lights:room]
topic = paradox/houdini/lights
backend = hue
```

Audio supports three concurrent categories: background music (looping, ducked when speech plays), speech (queued, exclusive, triggers ducking), and SFX (fire-and-forget). A zone can drive multiple outputs; device aliases `hdmi` and `analog` resolve per platform.

## Critical constraints — do not break

- **MQTT topic structure is sacred**: `{baseTopic}/{commands|state|warnings|events}`.
- **Command format**: `{"command": "actionName", "param": "value"}`. This is the contract with PxO, PxC, PxT, and operator UIs.
- **Readiness marker**: PFx creates `/run/paradox/pfx.ready` after init. The game engine startup gates on this file. Do not remove or rename it.
- **Service startup order**: `mosquitto` → `pfx.service` → game service.
- **INI section naming**: `[screen:name]`, `[audio:name]`, `[lights:name]`, `[input:name]`, `[relay:name]`. Don't rename without spec update.
- **Don't bypass the MQTT wrapper.** Use the published client; don't reach for a raw `mqtt` import.
- **Tests live next to features.** `test/unit/` mirrors `lib/`; integration tests run hardware paths.

## Common command shapes

- Screen: `playVideo`, `queueVideo`, `showImage`, `showBrowser`, `hideBrowser`, `stopAll`
- Audio: `playBackground`, `playSpeech`, `playEffect`, `setBackgroundVolume`, `stopSpeech`, `stopAll`
- Lights: `setLight`, `setScene`, `allOff`, `allOn`
- Input: emits events; not commanded

Outcome and event payloads conform to JSON schemas in `docs/json-schemas/`.

## Workflows

```bash
# Tests
npm run test:unit
npm run test:integration
npm run test:ci         # CI parity (skips hardware integration)

# Service
sudo systemctl start pfx.service
journalctl -u pfx.service -f

# Audio discovery
scripts/pi-audio-discovery.sh
```

## Key references

| Document | Purpose |
|----------|---------|
| [README.md](../README.md) | Public overview |
| [docs/PFX_USER_GUIDE.md](../docs/PFX_USER_GUIDE.md) | Feature-by-feature user guide |
| [docs/SPEC.md](../docs/SPEC.md) | Functional specification |
| [docs/MQTT_API.md](../docs/MQTT_API.md) | Command and event API |
| [docs/CONFIG_INI.md](../docs/CONFIG_INI.md) | INI configuration reference |
| [docs/json-schemas/](../docs/json-schemas/) | Machine-readable command/event schemas |
| [scripts/README.md](../scripts/README.md) | Operational tooling catalog |
| [config/pfx.service](../config/pfx.service) | Sample systemd unit |
