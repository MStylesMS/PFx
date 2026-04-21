# ParadoxFX (PFx) — AI Instructions

ParadoxFX is a **Node.js multi-modal media and effect controller** that manages screens, multi-zone audio, lights, and relays via MQTT. It is the hardware abstraction layer for the Paradox escape room system.

## Tech Stack

- **Runtime**: Node.js 18+
- **Audio**: PulseAudio with multi-zone ducking (background music, speech, SFX)
- **Video**: mpv (Pi4+), vlc, fbi for framebuffer
- **Lights**: Hue, WiZ, Zigbee, Z-Wave
- **Config**: INI format with `[screen:zone]` and `[audio:zone]` sections
- **Platforms**: Raspberry Pi 3/4/5, desktop Linux

## Architecture Summary

PFx receives commands over MQTT zone topics and translates them to hardware operations. Each zone (screen, audio, lights, relays) has its own topic namespace following `{baseTopic}/{commands|state|status|warnings}`. Audio uses automatic device discovery with aliases (`hdmi`, `analog`). Multi-zone audio supports ducking (speech mutes background) and queued playback.

## Critical Constraints

- **MQTT topic structure is sacred**: `{baseTopic}/{commands|state|status|warnings}`
- **Command format**: `{"command": "actionName", "param": "value"}`
- **PFx readiness marker**: Creates `/run/paradox/pfx.ready` — game engine depends on this
- **Service startup order**: mosquitto → pfx.service → game service
- **INI config sections**: `[screen:zonename]`, `[audio:zonename]`, `[lights]`, `[relay:name]`
- **Don't bypass the MQTT wrapper** — always use the published client patterns

## Documentation-First Development

Before significant changes, review relevant docs. If a change conflicts with documented design, propose doc updates first. Update docs alongside code. API/protocol changes require explicit approval. Use commit prefixes: `Docs:`, `Implement:`, `Fix:`, `Test:`, `Refactor:`, `Chore:`.

## Key References

| Document | Purpose |
|----------|---------|
| [AI-DETAILED-OVERVIEW.md](AI-DETAILED-OVERVIEW.md) | Full architecture, code patterns, development workflows |
| [docs/SPEC.md](docs/SPEC.md) | Comprehensive specification (audio, video, lights, config) |
| [docs/CONFIG_INI.md](docs/CONFIG_INI.md) | INI configuration reference |
| [docs/Pi5-Notes.md](docs/Pi5-Notes.md) | Pi5-specific setup and MPV profiles |
| [docs/Pi4_Notes.md](docs/Pi4_Notes.md) | Pi4-specific setup guidance |
| [README.md](README.md) | User-facing overview, quick start, platform variants |
| Parent system: [/opt/paradox/AI-INSTRUCTIONS.md](/opt/paradox/AI-INSTRUCTIONS.md) | System-wide context (when in Paradox workspace) |
