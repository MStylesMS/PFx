# Changelog

All notable changes to PFx are documented here.

---

## [2.1.0] — 2026-05-10

### Summary

PFxE vocabulary compatibility, final lights/relays/inputs purge, multi-channel audio support, and audio-only auto-mode.

### Added

- **PFxE vocabulary compatibility** (`showBrowser`, `hideBrowser`, `setBrowserUrl`, `setBrowserKeepAlive`) — full parity with PFxE browser command set.
- **Browser auto-enable** — when `browser_url` is set in a `[screen:*]` INI section, PFx launches the browser overlay automatically during zone startup (no `enableBrowser` MQTT command required).
- **`audio_channels` INI key** — pass an mpv `--audio-channels` layout string (`stereo`, `5.1`, `7.1`, etc.) to `[screen:*]` and `[audio:*]` zones. Applied to every mpv process spawned by that zone (background music, speech, and SFX).
- **Audio-only auto-mode** — configs containing only `[audio:*]` zones now skip X11/display init (MPV video player, Chromium browser, unclutter cursor-hider) automatically. No config change required.
- **`moveBrowser` warning** — emits an MQTT warning on `{baseTopic}/warnings` explaining that `moveBrowser` is not meaningful on PFx (browser is full-screen). No crash.
- **MQTT warnings for removed commands** — `enableBrowser`, `disableBrowser`, and `verifyBrowser` emit a structured warning instead of silently failing.

### Removed

- **Lights / relays / inputs subsystem** — all code, tests, scripts, example configs, JSON schemas, and documentation. PFx is now a screen + audio controller only. Hardware device control (Z-Wave, Zigbee, GPIO) routes through PxB and Pio.
- **`enableBrowser` / `disableBrowser` / `verifyBrowser` commands** — replaced by auto-enable at zone startup. Operators that still publish these commands receive an MQTT warning.
- **Hardcoded `http://localhost/clock/` default URL** — removed from `window-manager.js`, `screen-zone-browser-controller.js`, and `screen-zone.js`. A `browser_url` must now be explicitly set in the INI to enable the browser overlay.

### Changed

- `docs/MQTT_API.md` — "Browser/Clock Commands" section replaced with "Browser Commands" (`showBrowser`, `hideBrowser`, `setBrowserUrl`, `setBrowserKeepAlive` only). Lights/relays/inputs command families removed. PFx ↔ PFxE differences note added.
- `docs/CONFIG_INI.md` — `browser_url` and `audio_channels` keys documented; lights/relays/inputs sections removed; new "Audio-only mode" section added.
- `docs/PFX_USER_GUIDE.md` — "Multi-channel audio" section added (sink config requirements, verification steps). Lights/relays/inputs content removed.
- `docs/SPEC.md` — updated to reflect removed device types and new browser lifecycle.

### Fixed

- `_startUnclutter()` previously enumerated every zone's display, defaulting to `:0` for audio-only zones. It now skips non-screen zones, preventing spurious display connections on headless audio servers.

### Tests

- **178 unit tests pass** (was 160 pre-branch).
- Phase 2 integration test: PFxE-style EDN sequence (`showBrowser` / `hideBrowser` / auto-enable).
- Phase 3: `--audio-channels` flag coverage for `stereo`, `5.1`, `7.1`, and absent cases.
- Phase 4: audio-only mode detection logic.
- Removed tests for lights/relays/inputs device types (net reduction in dead code).

---

## [2.0.0] — prior release

See git history.
