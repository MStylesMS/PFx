# Changelog

## [Unreleased]
### Added
- Optional per-screen resolution control via `resolution_mode`, `resolution_fallback`, and `output_name` keys. PFx now applies requested modes with `xrandr` before MPV launches, including fallback handling and clear logging.
- New unit suite (`test/unit/screen-resolution-helper.test.js`) validating resolution helper behavior and config trimming for the new keys.

### Fixed
- Suppressed AJV `date-time` format warnings by registering `ajv-formats` in schema validation tests.

## [1.1.3] - 2025-10-13
### Fixed
- **MQTT Reconnection**: Fixed critical bug where ParadoxFX would stop attempting to reconnect after losing connection to MQTT broker. The previous `connectWithBackoff` closure in the `close` event handler created a new client without reattaching event handlers, causing reconnection to fail silently.

### Changed
- **Simplified Reconnect Logic**: Replaced complex custom exponential backoff code (~100 lines) with mqtt.js library's built-in `reconnectPeriod` feature (default 1500ms).
- **Startup Jitter**: Added 0–500ms random delay before initial connection to prevent thundering herd when multiple devices boot simultaneously.
- **Configurable Reconnect**: Added optional `[mqtt] reconnect_period` INI parameter (milliseconds) with sensible 1500ms default.

### Added
- New unit tests for reconnect behavior (`test/unit/mqtt-client.reconnect.test.js`) with 6 test cases.
- Updated existing mqtt-client tests to match new implementation (19 total tests passing).

### Removed
- Removed `mqttMaxAttempts`, `mqttConnectTimeoutMs`, `mqttOverallTimeoutMs` config options (now using library's simpler reconnect mechanism).
- Removed `DEBUG_MQTT` environment variable (library handles reconnect transparently).

## [1.1.2-rc2] - 2025-10-XX
### Added
- Advanced MQTT client configuration options: `mqttMaxAttempts`, `mqttConnectTimeoutMs`, `mqttOverallTimeoutMs` for deterministic connection behavior in unstable networks and CI.
- Heartbeat publication now unrefs its interval, allowing clean process exit when only heartbeat remains.
- Environment flag `DEBUG_MQTT=1` to enable verbose internal connection/backoff diagnostics (suppressed by default).
 - Phase 9 (Volume Model) Part 2: Telemetry JSON Schemas for playback outcomes & background recompute events (`docs/json-schemas/command-outcome-playback.schema.json`, `background-volume-recompute.schema.json`).
 - Unified volume & ducking documentation (precedence + telemetry) finalized across README / INI / MQTT API.
 - (Planned) Media completion events for non-looping background tracks, speech items, and videos (`*_completed`), with telemetry snapshot at natural end.

### Telemetry Notes
- Playback command outcome events now optionally include `effective_volume`, `pre_duck_volume`, `ducked` (already emitted in Part 1; schemas added here for machine validation).
- Background duck lifecycle publishes `background_volume_recomputed` events with matching telemetry fields.

### Changed
- MQTT client cleanup: removed noisy ad-hoc console debug lines in favor of gated logger.debug output.
- `disconnect()` now force-closes the underlying MQTT socket (`client.end(true, ...)`) to avoid lingering event loop handles in tests.

### Fixed
- Potential Jest/test runner hang caused by heartbeat interval or open MQTT socket after tests complete.

### Migration Notes
### Audit: Playback Completion Events
Current implementation publishes start / stop / manual stop events:
- Background: `background_music_started`, `background_music_stopped` (no natural end event when a non-looping track finishes automatically)
- Speech: `speech_started`, `speech_stopped` (manual/forced) – no explicit `speech_completed` on natural end
- Video: `video_started`, `video_stopped` (manual stop); no `video_completed` on natural EOF (default image swap occurs silently)

Sound effects remain intentionally fire-and-forget (no completion tracking by design).

Planned addition (next minor):
- Emit `background_music_completed`, `speech_completed`, `video_completed` events on natural (non-interrupted) EOF.
- Include: `{ file, effective_volume, pre_duck_volume, ducked, duration_ms, playback_ms, interrupted: false }` (subset if data unavailable).
- Distinguish manual interruptions: existing `*_stopped` events remain for fade/stop/skip scenarios (will include `interrupted: true` field once implemented for clarity).

Implementation outline documented internally (see upcoming PR) and will add JSON Schema for `media-playback-completed` events.

No action required; defaults preserve current behavior. To leverage deterministic fast-fail in CI, set smaller values for the new timeout/attempt options (e.g. `mqttConnectTimeoutMs=800`, `mqttOverallTimeoutMs=2500`, `mqttMaxAttempts=2`).
For telemetry consumers: incorporate new schemas and ignore telemetry fields if not needed (event shape backward compatible).


## [1.1.0] - 2025-09-28
### Added
- Unified command outcome event model via `publishCommandOutcome` across all zones. Every received command now emits an `/events` payload:
	- `{ command, outcome: success|failed|warning, parameters?, message, error_type?, error_message?, warning_type? }`
	- Non-success outcomes also publish a human-readable message on `/warnings`.
- MPV resilience: automatic restart attempts (default up to 3 with linear backoff) when the MPV process exits unexpectedly.
	- Emits events: `internal:mpv` with outcomes (warning on exit, success on restart, failed after max attempts).
### Changed
- Screen & Audio zones now avoid emitting generic success events; standardized outcome schema replaces ad-hoc `command_completed` patterns.
### Notes
- Configure restart behavior via optional zone config keys: `mpvAutoRestart` (default true), `mpvRestartMaxAttempts`, `mpvRestartDelayMs`.
	Future enhancement: expose these in documentation configuration guide.


## [1.0.4] - 2025-08-29
### Changed
- Standardize audio effect command to canonical `playAudioFX` across zones (removed mixed `playAudioFx` variants in code/docs/tests).
- Unified inbound command payload key usage to prefer `file` while still accepting legacy `audio` / `image` for backward compatibility.
- Updated tests and docs to reflect `playAudioFX` command name.

## [0.9.0] - 2025-08-22
### Changed
- Hide mouse cursor on X displays using `unclutter` when PFX starts (if `unclutter` is available on PATH).
- Fixed browser-to-screen mapping so enableBrowser commands target the configured `target_monitor` deterministically (sorted by display X position).

### Notes
- Currently only one browser instance should be enabled across all screens to avoid command routing confusion; running multiple simultaneous browser instances can cause control messages (show/hide/enable/disable) to be misrouted.

