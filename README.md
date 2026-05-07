# ParadoxFX (PFx)

[![CI](https://github.com/MStylesMS/PFx/actions/workflows/ci.yml/badge.svg)](https://github.com/MStylesMS/PFx/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**PFx is the hardware abstraction layer for escape rooms.** It takes MQTT commands from a game engine and orchestrates screens, multi-zone audio with ducking, and browser overlays — running as a single Node.js service on a Raspberry Pi.

<!-- TODO(2.3): replace with demo GIF / screenshot of PFx running a real cue -->
<!-- ![PFx demo](docs/assets/pfx-demo.gif) -->

## Quick start

```bash
sudo apt install -y nodejs npm mosquitto mpv xdotool x11-xserver-utils
git clone https://github.com/MStylesMS/PFx.git && cd PFx
npm install
# Pick a starting template that matches your hardware (Pi4 / Pi5 / Linux):
cp config/pfx-explained.ini pfx.ini
npm start
```

Then publish a command from any MQTT client:

```bash
mosquitto_pub -t paradox/demo/screen/commands \
  -m '{"command":"playVideo","file":"intro.mp4"}'
```

Full walkthrough: [docs/QUICK_START_PFX.md](docs/QUICK_START_PFX.md).

## What it does

- **Screens** — image, video, queued playback, browser overlays (mpv + Chromium)
- **Audio** — three concurrent categories per zone (background music, speech, SFX) with automatic ducking
- **Operational** — retained MQTT state, lifecycle status, structured warnings/events, systemd unit

PFx no longer supports direct lighting, relay, or input zones in active runtime configuration. Keep active PFx configs limited to `[screen:*]` and `[audio:*]` sections; migrate hardware integrations to PxB.

## Documentation

| | |
|---|---|
| [Quick start](docs/QUICK_START_PFX.md) | Get one zone running on a Pi in 5 minutes |
| [User guide](docs/PFX_USER_GUIDE.md) | Feature-by-feature walkthrough |
| [Specification](docs/SPEC.md) | Functional spec — the contract |
| [MQTT API](docs/MQTT_API.md) | Commands, events, payload schemas |
| [INI reference](docs/CONFIG_INI.md) | All config keys |
| [Scripts](scripts/README.md) | Operational tooling |

## How this repo was built

PFx is built AI-accelerated against a deliberate methodology: doc-first design, phased delivery (every phase ships a working app), and a check-before-code gate where the spec, MQTT API, and INI reference are updated in the same commit as the implementation. The full agent brief lives in [.github/copilot-instructions.md](.github/copilot-instructions.md) and is auto-loaded by VS Code Copilot, Claude Code, Codex, Cursor, Aider, and Gemini-CLI.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
