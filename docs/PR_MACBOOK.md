# PFx on macOS (MacBook) — Windowed Zones with MPV

Status: Proposal (no code changes yet)
Owner: PFx
Last updated: 2025-11-07

## Goal
Run ParadoxFX on a MacBook with each "screen zone" rendered as a normal app window (not tied to physical HDMI outputs), using MPV as the only media player.

## Constraints
- Must use MPV (no VLC or other players).
- Do not break Raspberry Pi deployments or Linux.
- Keep risk low: favor an additive profile + small, gated tweaks.
- Minimize changes; document a clear, reversible rollout.

## Current State (what we have today)
- PFx spawns MPV directly and controls it via IPC (see `lib/media/mpv-zone-manager.js`).
- Profiles (`config/mpv-profiles.json`) define flags, fullscreen/windowed behavior, and performance tuning.
- Linux/PI hardware auto-detection uses `/proc/*` and device-tree files (Linux-only). No macOS-specific profile yet.
- Windowed mode already exists for Linux (`linux-windowed`), proving the model works.
- Spawn env includes Linux-centric vars (`DISPLAY`, `XAUTHORITY`) which are harmless on macOS but unnecessary.

## Why macOS is feasible
- MPV supports macOS (installable via Homebrew). Its IPC (`--input-ipc-server`) and window geometry work on macOS.
- PFx’s IPC control is platform-agnostic: UNIX socket paths via `os.tmpdir()` work on macOS.

## Phase 0 — Local prerequisites (MacBook)
- Install MPV and verify it's on PATH.
- Ensure Node.js 16+ is available.
- Optional: MQTT CLI (for quick manual testing).

Example setup (local, not committed):
```bash
# Install prerequisites
brew install mpv mosquitto

# Verify versions
which mpv && mpv --version
node --version
```

## Phase 1 — Add a macOS windowed MPV profile (low risk)
Add a new profile to `config/mpv-profiles.json`:
- Name: `macos-windowed`
- fullscreen: false
- windowGeometry: e.g., `960x540` (50% of 1080p)
- base args: `--hwdec=auto`, `--vo=gpu`, `--cache=yes`, `--no-terminal`, `--no-osc`, `--keep-open=always`, `--idle=yes`
- display args: none OS-specific required for macOS; keep minimal
- audio: default to `--audio-device=auto` (actual device can still be overridden per zone)

Usage (no code changes required):
```bash
# From apps/ParadoxFX
PFX_MPV_PROFILE=macos-windowed npm run dev
```
This bypasses Linux auto-detection by explicitly choosing the profile for Mac.

## Phase 2 — Gentle platform guardrails (optional, still low risk)
- In `MpvProfileManager.detectProfile()` and spawn env, gate Linux-specific behavior:
  - If `process.platform === 'darwin'`, skip `/proc/*` checks and just use fallback profile (or honor `PFX_MPV_PROFILE`).
  - Only set `DISPLAY`/`XAUTHORITY` on Linux.
- No behavior change for Pi/Linux.

## Phase 3 — Quality-of-life (optional)
- Multi-zone window positioning: accept `windowGeometry` with offsets (e.g., `960x540+0+0`, `960x540+960+0`).
- Audio device discovery helper: `mpv --audio-device=help` parser to map CoreAudio devices by alias.
- Dev script: `npm run dev:mac` to export profile and sane defaults.

## Risks & Edge Cases
- MPV path on macOS: ensure it’s resolvable as `mpv` from PFx process PATH.
- Hardware decode: `--hwdec=auto` should map to VideoToolbox; verify no black-frame symptoms.
- CPU/GPU perf: large bitrates may need different cache/demuxer settings vs Pi.
- Multiple windows clutter: consider `--ontop` removal (already removed in windowed mode) and geometry per zone.

## Acceptance Criteria
- On a MacBook, with `PFX_MPV_PROFILE=macos-windowed`, PFx starts and spawns one MPV window per screen zone.
- Media playback (video/image/audio) works; playlist append/replace behaves as on Linux.
- No regressions on Pi/Linux (unit tests pass; Linux profiles unchanged).

## Test Plan
- Install MPV; verify `mpv --version`.
- Run PFx with mac profile override:
  ```bash
  PFX_MPV_PROFILE=macos-windowed npm run dev
  ```
- Publish a few MQTT commands to the screen zone to play/pause/queue media; confirm:
  - Visible MPV window appears with requested geometry
  - Audio outputs via CoreAudio (default device OK)
  - `stop` clears playlist without errors; process stays alive (`--idle=yes`)

## Effort Estimate
- Phase 1 (profile only): ~1–2 hours
- Phase 2 (platform guards): ~1–2 hours
- Phase 3 (QoL enhancements): ~3–5 hours (as needed)

## Rollback / Safety
- Additive profile; can be removed safely.
- Platform guards are gated by `process.platform` checks; feature-flagable with env if needed.

## Notes
- Keep Pi profiles and defaults untouched to ensure zero impact on production systems.
- Document `PFX_MPV_PROFILE` override in `README_FULL.md` once implemented.
