# ParadoxFX (PFx)

PFx is a Node.js media and effects controller for escape-room style environments. It consumes MQTT commands and coordinates screens, audio, browser overlays, lights, relays, and input events.

This README is intentionally short for GitHub browsing. Use the docs links below for configuration, API details, and platform setup.

## Quick links

- Quick start (single Pi output): [docs/QUICK_START_PFX.md](docs/QUICK_START_PFX.md)
- Full user guide: [docs/PFX_USER_GUIDE.md](docs/PFX_USER_GUIDE.md)
- Configuration reference (INI): [docs/CONFIG_INI.md](docs/CONFIG_INI.md)
- MQTT API: [docs/MQTT_API.md](docs/MQTT_API.md)
- Specification: [docs/SPEC.md](docs/SPEC.md)
- Script index: [scripts/README.md](scripts/README.md)

## What PFx does

- Runs zone-based screen/media playback (image, video, background audio, speech, effects)
- Controls browser window focus for clock/UI overlays
- Publishes zone state, warnings, and events over MQTT
- Supports modern lighting integrations (Hue, WiZ, Shelly, and bridge-driven radio workflows)
- Provides operational tooling for Raspberry Pi deployments

## Service deployment note

A sample systemd unit is included at [config/pfx.service](config/pfx.service). It is a template, not a one-size-fits-all production unit. Adjust user, paths, and hardening options before install.

## Repository layout

- Application entrypoint: [pfx.js](pfx.js)
- Core runtime code: [lib](lib)
- Tests: [test](test)
- Documentation: [docs](docs)
- Operational scripts: [scripts](scripts)
- Configuration templates and desktop entries: [config](config)

## How this repo was built

PFx is built with AI-accelerated development against a deliberate methodology:

1. **Doc-first design.** The functional spec, MQTT API, and INI reference are written before non-trivial code lands. See [docs/SPEC.md](docs/SPEC.md), [docs/MQTT_API.md](docs/MQTT_API.md), [docs/CONFIG_INI.md](docs/CONFIG_INI.md).
2. **Phased delivery.** Each phase ships a fully working application with incremental features — no half-wired flags on `main`.
3. **Check-before-code gate.** Any change that alters spec, API, INI keys, or scaffold updates the matching doc in the same commit as the implementation. The doc is the contract; the code is the implementation.
4. **Reuse-first.** Existing helpers, zone base classes, and the MQTT wrapper are searched before new code is written.
5. **Best-practices baseline.** Conventional commits, tests next to features, no scratch files at the repo root.

The full agent brief lives in [.github/copilot-instructions.md](.github/copilot-instructions.md) and is auto-loaded by VS Code Copilot, Claude Code, Codex, Cursor, Aider, and Gemini-CLI.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
