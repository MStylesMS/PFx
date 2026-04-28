# PR: Unified Volume & Ducking Model

> Historical Note (Context Summary): Phases 1–5 delivered the data model, resolver, duck lifecycle, and flattened status schema. Phase 6 added configuration samples; Phase 7 broadened documentation & migration notes. Phase 8 (this change set) completes runtime integration across all playback paths, unifies `adjustVolume` (removing legacy `volumeAdjust`), and removes legacy absolute duck stacking. Future phases (9+) will focus on optional telemetry (effective volumes) and legacy doc consolidation.

## Status
Phases 1–9 complete (runtime integration + unified resolver + lifecycle ducking + telemetry on playback outcomes & background recompute events + config migration off `volumeAdjust`/`ducking_volume`). Remaining work is limited to optional schema validation tests and final smoke test artifacts prior to merge. Backward compatibility shim intentionally skipped.

Implementation Branch: `PR-VOLUME` (initial commit: adds plan steps 6 & 7). All subsequent implementation commits will reference this doc with `PR-VOLUME:` prefix in commit messages for traceability.

## Goal
Replace the current ad-hoc and inconsistent volume & ducking handling with a clear, predictable, easily testable model that:
- Uses absolute base volumes (0–200) with a zone-level max clamp.
Outcome: event shows volume 120; warning outcome lists code indicating adjust ignored (resolver warning set).
- Uses per‑play transient adjustments (percentage) without affecting persisted zone state.
- Applies a single ducking adjustment (percentage reduction) that only affects background audio while speech or video is active (video does NOT get ducked itself).

## Design Summary
| Concept | Type / Range | Scope | Notes |
|--------|--------------|-------|-------|
| Base media volume (background/speech/effects/video) | Absolute 0–200 | Per zone, per type | Defaults: 100 if omitted. Parsed from INI kebab_case (e.g., `background_volume`). |
| max_volume | Absolute 0–200 | Per zone (fallback to global) | Global default 200. Warn if <50 or >150 at startup. Immutable at runtime. |
| Ducking (ducking_adjust) | Percentage -100% .. 0% | Per zone (fallback to global) | Applies only to background audio while any ducking trigger active. |
| adjustVolume (per play) | Percentage -100% .. +100% | Command-scoped | Transient; applied before ducking; not persisted. |
| volume (per play) | Absolute 0–200 | Command-scoped | Overrides base & ignore adjustVolume if both present (warn). |
| setVolume command | Absolute 0–200 | Runtime persistent (zone) | Updates base volume for specified type (background/speech/effects/video); clamped; success+warning if clamped. |
| setDuckingAdjustment command | Percentage -100% .. 0% | Runtime persistent (zone) | Updates zone ducking_adjust (only affects future duck episodes). |
| Duck trigger sources | Events | speech, video | Starting speech or video increments active duck counter; ending decrements; duck active if counter > 0. |
| Effective volume in state | Absolute 0–200 | Published in zone status | Per type; includes transient play adjust & duck if applicable at publish time. |

## INI Configuration (kebab_case)
Global (optional):
```
[global]
max_volume = 180          ; optional (warn if >150 or <50)
ducking_adjust = -40      ; optional (default 0 -> no reduction)
```
Per Zone (example audio + screen hybrid):
```
[audio:zone1]
background_volume = 90
speech_volume = 110
 effects_volume = 120
 max_volume = 170
 ducking_adjust = -35

[screen:main]
 background_volume = 85        ; screen can host background audio too
 speech_volume = 105           ; speech overlaid on video
 effects_volume = 115          ; UI / interface effects
 video_volume = 95
 max_volume = 180
 ducking_adjust = -40          ; overrides global (if present)
```
Defaults if a zone omits a field:
- `*_volume` → 100
- `max_volume` → global `max_volume` or 200
- `ducking_adjust` → global `ducking_adjust` or 0

## Play Command Payload Examples
1. Absolute override:
```
{"command":"playBackground","file":"loop.mp3","volume":140}
```
2. Percentage transient adjust (reduce by 30%):
```
{"command":"playSpeech","file":"hint.mp3","adjustVolume":-30}
```
3. Skip ducking for this speech:
```
{"command":"playSpeech","file":"hint.mp3","skipDucking":true}
```
4. Attempting both (volume wins, warning logged/published):
```
{"command":"playSpeech","file":"hint.mp3","volume":120,"adjustVolume":-25}
```

## Runtime Commands
1. Set persistent per-type volume:
```
{"command":"setVolume","type":"speech","volume":80}
```
2. Set ducking adjustment:
```
{"command":"setDuckingAdjustment","adjustValue":-45}
```
(Clamped to -100..0; success+warning outcome if clamped.)

## Validation & Clamping Rules
| Field | Allowed | Clamp Behavior | Outcome |
|-------|---------|----------------|---------|
| Absolute volume (base or per-play) | 0..200 | To nearest limit | success + warning if clamped |
| adjustVolume | -100..+100 (%) | To nearest limit | success + warning if clamped |
| ducking_adjust | -100..0 (%) | To nearest limit | success + warning if clamped |

Max volume warning on startup if zone `max_volume`:<50 or >150 (still allowed).

## Effective Volume Resolution
Per play invocation for type T:
```
base = zone.baseVolumes[T]  (default 100)   
if command.volume present:
    effectivePreDuck = clamp(command.volume, 0, maxVolume)
    if adjustVolume also present -> warn (ignore adjustVolume)
else if command.adjustVolume present:
    effectivePreDuck = clamp(base * (1 + adjustVolume/100), 0, maxVolume)
else:
    effectivePreDuck = clamp(base, 0, maxVolume)

if (T === 'background' && duckActive && !command.skipDucking):
    ducked = clamp(effectivePreDuck * (1 + duckingAdjust/100), 0, maxVolume)
else:
    ducked = effectivePreDuck

final = round(ducked)
```
`duckActive` = (activeDuckCounter > 0). Speech & video start increment; finish decrement. The duck level does not stack—any active triggers apply the single configured ducking percentage.

## State Publication Format (Revised Phase 5)

The status payload published to `<baseTopic>/state` is being flattened and simplified.

Goals:
- Provide one authoritative location for each base volume.
- Expose only whether ducking is active (`isDucked`), not internals.
- Screen and audio zones share the same shape; screen zones additionally expose `video` and `browser` objects.
- No backward compatibility block and no migration phase markers.
- Base volumes only (no effective/ducked volume numbers published).

### Flattened Schema

Top-level keys (illustrative order):
```
{
  "timestamp": ISO8601,
  "zone": string,
  "type": "status",
  "status": string,            // high-level zone status (idle, playing_video, etc.)
  "isDucked": boolean,         // true if any ducking trigger active
  "maxVolume": number,         // zone max volume (clamp ceiling)
  "background": {
     "status": "idle"|"playing"|"paused",
     "file": string|null,
     "socket_path": string,
     "volume": number          // base background volume
  },
  "speech": {
     "status": "idle"|"playing"|"paused",
     "file": string|null,
     "next": string|null,      // next queued speech file if any
     "queue_length": number,   // number of pending speech items (excluding current)
     "socket_path": string,
     "volume": number          // base speech volume
  },
  "effects": {
     "volume": number          // base effects volume
  },
  // Present only on screen zones:
  "video": {
     "status": "idle"|"playing"|"paused",
     "file": string|null,
     "next": string|null,      // next queued video (if queueing re-enabled) else null
     "queue_length": number,   // pending queued video items (excluding current)
     "socket_path": string,
     "volume": number          // base video volume
  },
  "browser": {                 // screen zones only
     "enabled": boolean,
     "url": string|null,
     "focused": boolean,
     "process_id": number|null,
     "window_id": string|null
  },
  "lastCommand": string|null,
  "errors": [ ... ]
}
```

Notes:
- `volume` fields are the configured **base** volumes (mutable via `setVolume`).
- `isDucked` derives from the duck lifecycle (speech/video active). The actual numerical ducking adjustment is *not* published.
- `queue_length` for `speech` counts remaining queued speech items (not including the one currently playing). For audio zones this reflects `speechQueue.length`; for screen zones it mirrors audio manager speech queue length.
- `next` is the next queued item if available (first in queue), else `null`.
- `video.queue_length`/`video.next` will be `0`/`null` respectively if the simplified non-playlist mode remains (still included for forward consistency).
- `effects` has only a `volume` because effects are instantaneous; no persistent MPV instance state.

Example (Screen Zone playing video while ducked):
```
{
  "timestamp": "2025-09-28T19:50:12.144Z",
  "zone": "zone1",
  "type": "status",
  "status": "playing_video",
  "isDucked": true,
  "maxVolume": 150,
  "background": { "status": "playing", "file": "bgm/loop1.ogg", "socket_path": "/tmp/mpv-zone1-background.sock", "volume": 90 },
  "speech": { "status": "idle", "file": null, "next": null, "queue_length": 0, "socket_path": "/tmp/mpv-zone1-speech.sock", "volume": 110 },
  "effects": { "volume": 120 },
  "video": { "status": "playing", "file": "intro.mp4", "next": null, "queue_length": 0, "socket_path": "/tmp/mpv-zone1-media.sock", "volume": 95 },
  "browser": { "enabled": false, "url": null, "focused": false, "process_id": null, "window_id": null },
  "lastCommand": "playVideo",
  "errors": []
}
```

Example (Audio Zone with background music only):
```
{
  "timestamp": "2025-09-28T19:50:13.020Z",
  "zone": "audio1",
  "type": "status",
  "status": "idle",
  "isDucked": false,
  "maxVolume": 140,
  "background": { "status": "playing", "file": "music/ambient.ogg", "socket_path": "/tmp/mpv-audio1-background.sock", "volume": 70 },
  "speech": { "status": "idle", "file": null, "next": null, "queue_length": 0, "socket_path": "/tmp/mpv-audio1-speech.sock", "volume": 75 },
  "effects": { "volume": 80 },
  "lastCommand": "setVolume",
  "errors": []
}
```

### Implementation Notes (Phase 5)
- The previous nested `current_state.volumes` and `current_state.ducking` blocks are removed.
- The `media` MPV instance key is renamed to `video` for screen zones.
- BaseZone will construct the flattened object; ScreenZone will append `video` & `browser` objects.
- `isDucked` returns true if duckLifecycle.active() OR legacy duck map non-empty (during transition); legacy internals are not exposed.
- Effective (ducked) background volume is not emitted; only the base volume is shown.

### Future Phases
- When resolver-based runtime effective volumes are adopted (Phase 8), we may optionally add `effective_volume` fields if operationally needed.
- Queue metrics can be expanded if richer scheduling returns.

## Outcome & Warning Semantics
- Clamp events publish `outcome: success` with an added warning message (standardized outcome model) and a /warnings topic payload.
- Invalid combos (both `volume` and `adjustVolume`) produce `outcome: warning` (command still executes using `volume`).
- Out-of-range values auto-correct, included in message: e.g. `Requested speech volume 240 capped to max 170`.

## Removal of Legacy Behavior
- Remove legacy negative duck calculations & multi-layer volume inference.
- Remove per-play reliance on background volume as fallback for speech/effects (each type uses its own base volume).
- Remove unused or redundant volume fields in `AudioManager` that conflict (map to new model internally during transition).
- Reject legacy duck parameters (negative integers pretending to be dB) with a warning and ignore.

## Implementation Plan (Phase Breakdown)
1. (DONE) Data Model & Loader:
   - Config loader parses `*_volume`, `ducking_adjust`, `max_volume`; produces `baseVolumes`, `duckingAdjust`, `maxVolume`.
2. (DONE) Resolver & Utility:
   - `volume-resolver.js` pure function with unit tests (precedence, clamping, ducking, skipDucking).
3. (DONE) Duck Lifecycle:
   - `duck-lifecycle.js` + integration in `screen-zone` (video + speech triggers) and `base-zone` exposure (`getDuckActive`).
4. (DONE) Command Handlers:
   - Implement runtime mutation commands for base volumes & ducking adjustment (details below). No legacy removal yet.
5. (DONE) State Publishing (Revised Flattened Schema):
   - Flattened top-level payload with background/speech/effects/video/browser blocks, base volumes only, `isDucked` boolean.
6. (DONE) Config INI Samples Update:
   - Added `config/pfx-volume-example.ini` showcasing per-type base volumes and ducking_adjust.
7. (DONE) Documentation Updates:
   - README / MQTT API / INI docs updated with unified model, migration notes, telemetry & schemas.
8. (DONE) MPV Integration:
   - Legacy per-duck absolute adjustments removed; resolver-driven percentage duck (single application) active.
9. Tests Expansion:
   - Add command handler tests, state publication tests, duck lifecycle integration tests for overlapping triggers. (Partial – lifecycle unit test complete.)
10. (DONE) Cleanup:
   - Legacy ducking registry & negative duck stacking removed; `ducking_volume` migrated to `ducking_adjust` in active config.

### Phase 4 Detailed Design (Command Handlers)

New/clarified MQTT commands (JSON payloads shown) to mutate persistent zone volume model:

1. Update a single base volume (per type):
```
{"command":"setVolume","type":"speech","volume":80}
```
2. Bulk update multiple base volumes (optional extension):
```
{"command":"setVolume","volumes":{"background":95,"video":90}}
```
3. Update ducking adjustment:
```
{"command":"setDuckingAdjustment","adjustValue":-45}
```

Validation rules:
| Field | Presence | Valid Range | Clamp | Warning Codes |
|-------|----------|-------------|-------|---------------|
| `type` | required if no `volumes` map | one of background|speech|effects|video | n/a | invalid_type |
| `volume` | required when single `type` provided | 0..200 | yes | clamp_base_volume_low / clamp_base_volume_high |
| `volumes` | optional object (bulk mode) | keys subset of allowed types | per value | clamp_base_volume_low / clamp_base_volume_high |
| `adjustValue` | required for setDuckingAdjustment | -100..0 | yes | clamp_ducking_adjust_low / clamp_ducking_adjust_high (positive -> coerced 0) |

Outcome semantics:
| Condition | outcome | Notes |
|-----------|---------|-------|
| Successful update w/o clamp | success | Event + status publish |
| Successful with clamp | success + warning | Warning published (code & original) |
| Invalid type / payload | failed | error_type: validation |

Event payload examples:
```
{ "command":"setVolume","outcome":"success","parameters":{"type":"speech","volume":80},"message":"speech base volume set to 80" }
{ "command":"setVolume","outcome":"success","parameters":{"type":"background","volume":260},"message":"background base volume clamped to 200 (requested 260)","warning_type":"clamp_base_volume_high" }
{ "command":"setDuckingAdjustment","outcome":"success","parameters":{"adjustValue":-45},"message":"ducking_adjust set to -45" }
```

Internal model updates:
```
zone.baseVolumes[type] = clampedVolume
zone.duckingAdjust = clampedAdjust
```
The legacy `currentState.volume` (single field) remains untouched for now (will eventually mirror background base or be deprecated).

Publishing:
After each successful mutation, immediately publish status so downstream controllers can reconcile.

Failure cases (examples):
```
{"command":"setVolume","type":"ambient","volume":90} -> outcome: failed, error_type: validation, message: "Invalid volume type 'ambient'"
{"command":"setDuckingAdjustment","adjustValue":10} -> coerce to 0 with warning (positive not allowed)
```

Concurrency / sequencing:
- Mutations are synchronous (single-threaded JS). No special locking required.
- Bulk updates apply all valid keys; invalid keys are reported individually in a combined warning array (aggregate outcome still success if at least one valid update occurred; failed if none valid).

Telemetry additions (optional future):
- Track last mutation timestamp per type for diagnostics.

Forward compatibility:
- If future per-zone presets or profiles are added, these commands can feed a higher-level preset manager; schema leaves space for `profile` field.


## Edge Cases Covered
| Scenario | Expected Result |
|----------|-----------------|
| playSpeech with volume 220, zone max 170 | Clamped to 170, success + warning |
| playEffect with adjustVolume -120 | Clamped to -100% (silence), success + warning |
| playSpeech with volume 120 & adjustVolume -30 | Use 120, outcome warning (adjust ignored) |
| Two overlapping speeches while video also playing | active_triggers increments/decrements; background ducked once |
| Ducking adjust -100 | Background becomes 0 while ducked |
| adjustVolume +100 | Double the base (capped by max volume) |

## Open Questions (Closed by User Responses)
All prior ambiguities resolved; no further open questions.

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Regression in existing tests | Introduce new tests first; refactor tests to use new model; update fixtures. |
| Misinterpretation of adjustVolume sign | Explicit range validation + clear error messages. |
| Over-complication of state payload | Keep schema stable; only add nested volumes object. |

## Phase 9 Snapshot (Final)
Delivered:
- Telemetry fields on playback command outcomes & `background_volume_recomputed` events (effective_volume, pre_duck_volume, ducked).
- JSON Schemas published for playback outcomes & background recompute events.
- Docs (README, MQTT_API, INI_Config, Functional Spec) reference unified resolver & telemetry.
- Active configs migrated off `volumeAdjust` and legacy `ducking_volume` (now `ducking_adjust`).

Deferred / Optional (post-merge enhancements):
- Automated runtime schema validation (AJV test harness) – in progress separately.
- Additional integration smoke captures for PR notes (optional artifact).

---
**Reviewer Checklist**
- [ ] Structure & formulas match expectations
- [ ] Command semantics clear
- [ ] State schema acceptable
- [ ] Clamp & warning behavior appropriate
- [ ] Migration / removal plan acceptable

Please provide feedback or approval to proceed with implementation.
