# PFx — PFx/PFxE Sync Plan (2.1.0)

**Branch:** `pfx-pfxe-sync`
**Version target:** `2.0.0 → 2.1.0`
**Parent plan:** [/opt/paradox/portfolio/PFX_PFXE_SYNC.md](../../../portfolio/PFX_PFXE_SYNC.md)

PFx retains all current functionality. This plan **adds** PFxE-vocabulary compatibility, **removes** any remaining lights/relays/inputs artifacts, and **documents** multi-channel audio. PFx remains the multi-zone / audio-only fallback runtime.

## Scope summary

| Area | Action |
|---|---|
| Browser lifecycle | Auto-enable on zone startup. `enableBrowser` / `disableBrowser` / `verifyBrowser` **fully removed** — unknown-command warning on MQTT + log + stderr when invoked. No aliases. |
| `moveBrowser` | **Not implemented on PFx** (PFx browser is full-screen, no meaningful geometry). Warning emitted on MQTT + log + stderr when invoked. Documented as known PFx/PFxE difference. |
| Lights / relays / inputs | Final purge — code, tests, docs, scripts, example INIs, MQTT API doc entries, JSON schemas. All legacy references removed now (no "deprecated" placeholders). |
| Multi-channel audio | Add `audio_channels` INI key (passes to mpv `--audio-channels`); document in `CONFIG_INI.md` and `PFX_USER_GUIDE.md` |
| Audio-only auto-mode | Optional: if INI has only `[audio:*]` zones, skip mpv/browser/window init. Ship only if trivial; otherwise defer to audio PR. |
| Version bump | Last step after all tests pass |

## Phase 1 — Final purge of lights/relays/inputs

**Model: Sonnet 4.6 - Medium**

Mechanical cleanup. Search-and-destroy.

- [x] Remove the `config-loader.js` deprecation message and the code that emits it (the deprecation surface itself)
- [x] Grep PFx for `lights|relay|inputZone|\[input:|\[lights:|\[relay:|hue|wiz|lifx|shelly|zigbee|zwave` — remove all non-archive references
- [x] Remove from `docs/MQTT_API.md` any command families for lights/relays/inputs
- [x] Remove from `docs/CONFIG_INI.md` any `[lights:*]`, `[input:*]`, `[relay:*]` sections
- [x] Remove from `docs/SPEC.md` and `docs/PFX_USER_GUIDE.md` any mention of these device types
- [x] Remove JSON schemas under `docs/json-schemas/` for lights/relays/inputs
- [x] Remove example config sections under `config/`
- [x] Remove tests under `test/unit/` and `test/integration/` for these device types
- [x] Remove related scripts under `scripts/`
- [x] Update `README.md` — PFx is now "multi-zone media + audio controller" (no lights/relays/inputs language)
- [x] Update `.github/copilot-instructions.md` to drop the lights/relays/inputs references
- [x] `npm test` clean

## Phase 2 — PFxE-vocabulary compatibility

**Model: Sonnet 4.6 - High**

This is the substantive code change.

- [x] Audit and **remove all internal call sites** of `enableBrowser` / `disableBrowser` / `verifyBrowser` (controllers, helpers, state tracking, tests, schemas)
- [x] Change `ScreenZone` to auto-enable the browser during zone init when a browser URL is configured (no operator action needed)
- [x] Add `enableBrowser` / `disableBrowser` / `verifyBrowser` / `moveBrowser` to the command router's **unknown-command warning path** — each emits a warning to MQTT (`{baseTopic}/warnings`), the log, and stderr explaining the command is no longer supported (or, for `moveBrowser`, not meaningful on PFx since the overlay is full-screen)
- [x] Update `docs/MQTT_API.md` to drop the removed commands entirely; add a brief "PFx ↔ PFxE differences" note covering `moveBrowser` warning behavior
- [x] Remove from `docs/SPEC.md`, `docs/PFX_USER_GUIDE.md`, and `docs/CONFIG_INI.md` every reference to the removed commands (no "deprecated" mentions — fully purge)
- [x] Remove related JSON schemas under `docs/json-schemas/`
- [x] Remove unit tests for the removed commands; add a test asserting the warning is emitted when they are invoked
- [x] Integration test against a PFxE-style EDN sequence (uses `showBrowser` / `hideBrowser` only; auto-enable verified at zone init)

## Phase 3 — Multi-channel audio support

**Model: Sonnet 4.6 - High**

- [ ] Add `audio_channels` INI key to `[audio:*]` and `[screen:*]` (values: `stereo`, `5.1`, `7.1`, or explicit `--audio-channels` string)
- [ ] Plumb to mpv args in `mpv-zone-manager.js`
- [ ] Document expected PulseAudio/PipeWire sink configuration (link to a short ops note)
- [ ] Update `docs/CONFIG_INI.md` and `docs/PFX_USER_GUIDE.md` with a "Multi-channel audio" section explaining: required sink config, codec considerations, how to verify with `pactl list sinks short`
- [ ] Unit test: mpv args contain expected `--audio-channels` flag for each config value
- [ ] Manual hardware test note in the test plan (cannot fully unit-test multi-channel)

## Phase 4 — Optional: audio-only auto-mode

**Model: Sonnet 4.6 - High (only if attempting)**

Ship only if trivial. Otherwise defer to the audio PR.

- [ ] Spike: in `core/zone-manager.js`, detect "INI contains only `[audio:*]` zones"
- [ ] If detected, skip browser-controller wiring and any mpv-video init
- [ ] If the spike takes more than ~2 hours, **stop and document the gap in the audio PR instead**
- [ ] If shipped: docs note in `CONFIG_INI.md`

## Phase 5 — Final polish + version bump

**Model: Sonnet 4.6 - Medium**

- [ ] `CHANGELOG.md` entry for 2.1.0
- [ ] `package.json` version → `2.1.0`
- [ ] `npm test` clean
- [ ] PR title: `Release: PFx 2.1.0 — PFxE vocabulary compatibility + final hardware purge`

## Acceptance criteria

- All tests pass
- Houdini's existing EDN (post-PxO normalization) runs end-to-end on PFx
- Agent22's existing EDN (post-PxO normalization) runs end-to-end on PFx
- No grep hits for `light|relay|input` outside `archive/` and `node_modules`
- No grep hits for `verifyBrowser|enableBrowser|disableBrowser` outside `archive/`, `node_modules`, and the warning-emission code path
- Multi-channel mpv args appear in process listing when configured

## Risks

- Auto-enabling browser may slow zone startup. Mitigate with lazy first-show.
- Operator scripts that still call `enableBrowser` / `disableBrowser` / `verifyBrowser` / `moveBrowser` will receive a warning and the command will not execute. This is the desired clean break.
