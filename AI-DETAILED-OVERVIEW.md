# ParadoxFX (PFx) — AI Detailed Overview

This document provides comprehensive guidance for AI coding agents working on ParadoxFX. For a quick-start summary, see [AI-INSTRUCTIONS.md](AI-INSTRUCTIONS.md).

## System Overview

ParadoxFX is the hardware abstraction layer for the Paradox escape room system. It receives MQTT commands and translates them into hardware operations across multiple device types: screens (video/images), multi-zone audio, lights, and relays.

**Repository**: `apps/ParadoxFX/` within the Paradox workspace
**Service**: Runs as `pfx.service` via systemd
**Entry point**: `pfx.js`

## Architecture

### Zone-Based Design

Each device type is organized into zones with independent MQTT topic namespaces:

```
{baseTopic}/commands    # Inbound commands
{baseTopic}/state       # Zone state updates
{baseTopic}/status      # Health/heartbeat
{baseTopic}/warnings    # Error reporting
```

### INI Configuration Structure

Zones are defined in INI config with typed sections:
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

[lights]
topic = paradox/houdini/lights
```

### Multi-Zone Audio System

The audio system supports three concurrent categories with priority handling:

1. **Background music** — Continuous, loops automatically, ducked when speech plays
2. **Speech/narration** — Queued playback, triggers ducking of background
3. **Sound effects (SFX)** — Fire-and-forget, overlaps with everything

Key behaviors:
- Automatic ducking: background volume reduces when speech starts, restores when speech ends
- Queue management: speech items queue in order; SFX play immediately
- Multi-output: a single zone can output to multiple audio devices simultaneously
- Device aliases: `hdmi`, `analog` auto-resolve to hardware paths per platform

### Platform Support

| Platform | Video Player | Audio | Notes |
|----------|-------------|-------|-------|
| Pi5 | mpv (hardware accel) | PulseAudio | Primary target |
| Pi4 | mpv (hardware accel) | PulseAudio | Well supported |
| Pi3 | mpv (legacy), fbi | PulseAudio | `pfx-pi3.js` variant |
| Desktop Linux | mpv, vlc | PulseAudio | Development |

### Audio Device Discovery

`scripts/pi-audio-discovery.sh` auto-detects available audio outputs per platform:
- HDMI outputs (may be multiple on Pi4/Pi5)
- 3.5mm analog jack
- USB audio devices
- Volume levels: ALSA at 100%, PulseAudio at 150% boost for line-out

## Development Workflows

### Running Tests
```bash
npm run test:unit        # Unit tests only
npm run test:integration # Hardware integration tests
npm run test:manual      # Real device testing
```

### Configuration
- Config templates: `pfx.ini.example` (Pi4+), `pfx-pi3.ini.example` (Pi3)
- Active config: `pfx.ini` (typically a symlink to environment-specific file)
- Multi-environment pattern: `houdini-pfx-pi5.ini`, `houdini-pfx-pi4.ini`

### Service Management
```bash
sudo systemctl start pfx.service
sudo systemctl stop pfx.service
journalctl -u pfx.service -f    # Live logs
```

### Adding a New Device Type

1. Create handler module following existing zone patterns
2. Add INI section type (e.g., `[newdevice:name]`)
3. Register MQTT subscriptions for the zone topic
4. Implement command handler following `{"command": "action", ...params}` format
5. Publish state updates to `{baseTopic}/state`
6. Add tests for command handling

## Command Outcome Events & Warnings

PFx publishes outcome events after command execution:
- Success: state update on `{baseTopic}/state`
- Failure: warning on `{baseTopic}/warnings` with error details

## Critical Patterns to Preserve

### MQTT Command Format
```json
{"command": "actionName", "param": "value"}
```
This format is the contract with PxO, PxC, control UIs, and all other integrations.

### Readiness Marker
PFx creates `/run/paradox/pfx.ready` after successful initialization. The game engine startup depends on this file existing. Do not remove or change this behavior.

### Screen Zone Commands
Key commands: `playVideo`, `playAudio`, `showImage`, `showBrowser`, `hideBrowser`, `stopAll`

### Audio Zone Commands
Key commands: `playBackground`, `playSpeech`, `playSFX`, `stopAll`, `setVolume`, `duck`, `unduck`

### Lights Commands
Key commands: `scene`, `setColorScene`, `allOff`, `allOn`

## Regression Prevention

- Search existing codebase before creating new functions
- Follow established MQTT publish/subscribe patterns
- Don't change command names or parameter structures without approval
- Preserve INI section naming conventions
- Test on actual hardware when possible (audio routing, video playback)
- Don't modify PulseAudio/ALSA configuration patterns without Pi testing

## Documentation-First Development

This repo follows the Paradox documentation-first standard:
1. Review relevant docs before coding (SPEC.md, CONFIG_INI.md)
2. Propose doc updates before conflicting changes
3. Update docs alongside code changes
4. API/protocol changes require explicit approval
5. Use commit prefixes: `Docs:`, `Implement:`, `Fix:`, `Test:`, `Refactor:`, `Chore:`

## File Map

| Path | Purpose |
|------|---------|
| `pfx.js` | Main entry point |
| `pfx-pi3.js` | Pi3 variant entry point |
| `pfx.ini.example` | Configuration template |
| `docs/SPEC.md` | Comprehensive specification |
| `docs/CONFIG_INI.md` | INI configuration reference |
| `docs/Pi5-Notes.md` | Pi5 platform notes |
| `docs/Pi4_Notes.md` | Pi4 platform notes |
| `scripts/` | Audio discovery, setup scripts |
| `test/` | Unit and integration tests |
