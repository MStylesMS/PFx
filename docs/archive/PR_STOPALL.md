# PR: Implement `stopAll` Command with Optional Fade in PFX Backend

## Summary
Add full backend support for a unified `stopAll` media command (already emitted by Houdini game adapter and documented in cues like `:fade-out-all-media`). The adapter currently publishes `{command:"stopAll", fadeTime?}` but the PFX runtime (`apps/pfx/pfx.js` and related lib modules) has no handler, so the command is silently ignored. This PR introduces a central handler to gracefully stop all active media types (background audio, foreground audio FX, speech, video playback, browser/HTML overlays, images) with an optional coordinated fade-out duration.

## Motivation
- Game config uses cues `:fade-out-all-media` and `:stop-all-audio` expecting broad-stop semantics.
- Current workaround: multiple discrete stop commands (stopBackground, stopAudio, fadeOut, etc.) leading to race conditions and inconsistent user experience.
- A single semantic stop simplifies sequencing, reduces MQTT chatter, and ensures deterministic final media state.
- Provides foundation for future enhancements: selective category filters, per-zone overrides, telemetry (what was stopped), and fade curve customization.

## Scope (MVP)
1. Parse and route `{command: "stopAll", fadeTime?}` at zone-level PFX media controller.
2. If `fadeTime` present and > 0: start a fade-out mix for all currently playing audio streams (background + active FX/speech) and any video with audio track.
3. After fade completes (or immediately if no fade):
   - Stop background audio loop.
   - Stop/flush any one-shot audio FX or speech playback.
   - Stop/clear video playback (optionally keep last frame vs. black frame — decision below).
   - Optionally apply a final consistent volume=0 flush to avoid residual buffers.
4. Emit a structured log line: `stopAll requested fadeTime=3.0 stopped=[bg,fx,video] zone=mirror`.
5. Be idempotent (calling `stopAll` when nothing is active should be safe and quick).

## Non-Goals (This PR)
- Cross-zone aggregation (each zone still processes independently).
- Partial category targeting (future: `{command:"stopAll", categories:["audio","speech"]}`).
- Advanced fade curves (linear only for now).
- Telemetry publishing via MQTT events (can be follow-up).

## Design Details
### Input Contract
```
{
  command: "stopAll",
  fadeTime?: number  // seconds (float allowed), default 0
}
```
Ignored extra fields are logged at debug level.

### Processing Flow
1. Zone command router matches `stopAll`.
2. Gather active handles from media manager (background, activeSources[], videoPlayers?).
3. If fadeTime > 0:
   - Start parallel fades (background volume ramp -> 0, per-active source ramp -> 0).
   - Use shared promise barrier with timeout = fadeTime + safetyPadding (e.g. +250ms).
4. Stop & dispose all players.
5. Clear any repeating timers / loops tied to players.
6. Set zone display (for video/image) to a neutral state only if configured (option: keep last frame; propose: keep last frame for smoother UX).
7. Emit log / optional debug breakdown.

### Logging Examples
```
INFO  stopAll requested fadeTime=3 zone=mirror active(bg=yes fx=2 speech=0 video=1)
INFO  stopAll fade complete zone=mirror elapsed=3.04 stopped=[bg,fx,video]
```
Edge (no active media):
```
INFO  stopAll requested fadeTime=0 zone=audio active(none)
```

### Error Handling
- Invalid fadeTime (<0, NaN) → treat as 0, warn once.
- Interrupt (new play command arrives during fade) → continue fade for those sources, new sources excluded.
- Timeout (sources not reporting completion) → force stop, log warning.

### Implementation Plan
1. Add dispatcher case for `stopAll` in zone media controller.
2. Introduce helper `performStopAll({fadeTime})` returning promise.
3. Add volume ramp utility (reuse existing background fade if available, else implement linear setInterval / requestAnimationFrame-like with 50–100ms step; prefer existing abstraction if present).
4. Ensure cleanup code path reused by individual stop commands (refactor if duplication high).
5. Add unit tests (if current test framework covers media manager) OR lightweight integration test invoking fake players.
6. Update README / docs (game config already references; adapt PFX README + CHANGELOG).

### Testing Strategy
- Start background + play two FX + start video; issue `stopAll` with fadeTime=2; verify:
  * All players end within ~2.2s.
  * Volumes reached 0 before stop.
  * No subsequent tick timers left.
- Repeat with fadeTime missing.
- Repeat when nothing active (quick return, no errors).
- Issue overlapping stopAll calls (second should detect no active or fade-in-progress and short-circuit).

### Potential Follow-Ups
- Global multi-zone stop aggregator (one command to broadcast to all zones).
- Non-linear fade curves (exponential / logarithmic for perceptual smoothness).
- Telemetry event `/events media_stopped` with counts & durations.
- Configurable post-stop display image (e.g., black frame, company logo).

### Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Large number of active sources → performance spike during fade | Use shared timer; cap step frequency. |
| Player objects lack uniform stop interface | Introduce adapter shim layer with `safeStop()` wrapper. |
| Overlapping fades cause race conditions | Track fade session ID; ignore stale completions. |
| Inconsistent volume floors (residual hiss) | Clamp final volume to 0 and forcibly stop. |

### Acceptance Criteria
- Command `stopAll` is recognized and processed without runtime errors.
- Media stops deterministically with or without fadeTime.
- No regression in existing individual stop commands.
- Logging clearly shows action and result.

## Files to Modify (Anticipated)
- `apps/pfx/pfx.js` or dispatcher module (add case)
- Potentially `apps/pfx/lib/mediaManager.js` (new helper)
- `apps/pfx/docs/CHANGELOG.md` (Add entry)
- `apps/pfx/README.md` (Document command)

## CHANGELOG Draft Entry
```
### Added
- Unified `stopAll` command with optional `fadeTime` to stop all active media (background, FX, video) per zone.
```

## Open Questions
- Should videos also fade their audio track or abrupt stop? (Proposal: fade with shared ramp if API allows volume control.)
- Should we forcibly hide/black the browser or image zone on stopAll? (Proposal: No; keep visual content unless explicit hide command is sent.)

---
Prepared for implementation.
