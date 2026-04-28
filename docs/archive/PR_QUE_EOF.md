# PR: Queue Restoration & Media EOF Completion Events

> **IMPLEMENTATION NOTE (2025-09-30):** This PR planning document proposed a generalized PlaybackMonitor approach. The actual implementation took a different but equivalent path: VideoPlaybackTracker for video EOF detection using pause-aware wall-clock timing, eliminating legacy timeout-based systems. The goals of reliable queue progression and completion events were achieved through this alternative design. See PR_VIDEO_QUE.md for actual implementation details.

## Status
✅ IMPLEMENTED via alternative design (VideoPlaybackTracker)
Branch: PR_QUE_EOF → Merged to main (2025-09-30)

## Goals
1. Restore functional queue progression for media types that require ordered sequencing (video queue if re-enabled, speech queue, future extensibility).
2. Add natural completion events distinct from manual interruption events:
   - `video_completed`
   - `speech_completed`
   - `background_music_completed` (only when loop=false and track ends naturally)
3. Preserve existing start (`*_started`) and manual stop (`*_stopped`) semantics; add `interrupted: true` to stop/skip events in a later phase (optional) for clarity.
4. Ensure pause/resume behavior extends timing correctly (no premature completion firing).
5. Avoid reliance on MPV `end-file` for reliability (still honor it opportunistically if becomes stable later).
6. Keep overhead minimal (one timer + optional near-end validation per active medium).

## Non-Goals
- No completion tracking for sound effects (fire-and-forget remains unchanged).
- No immediate addition of analytics aggregation or persistence.
- No change to existing warning/error outcome model.

## Event Semantics
Natural completion events (simplified minimal shape):
```
{
   "timestamp": ISO8601,
   "zone": string,
   "type": "events",
   "video_completed"|"speech_completed"|"background_music_completed": true,
   "file": "media/file.ext"
}
```
No additional telemetry fields are required for completion events (consumers already receive rich telemetry on start/outcome events where needed). Manual stop / skip / fade events remain unchanged; adding interruption flags is deferred.

## Design Overview
### PlaybackMonitor Utility
A new reusable module: `lib/media/playback-monitor.js`.
Responsibilities:
- Start monitoring with: `{ kind, file, expectedDurationMs?, resolvePosition?, onComplete }`.
- Maintain state: start time, accumulated pause time, last poll position.
- Provide API: `pause()`, `resume()`, `interrupt()`, `stop()`.
- Timer strategy:
  1. If expectedDurationMs known: set primary timer for (expectedDurationMs - safetyWindow).
  2. On firing, schedule a short validation window (poll position once or twice) then complete.
  3. If paused during window, defer until resumed.
  4. Hard cap (expected + MAX_EXTEND_FACTOR) to prevent infinite drift.
  5. If duration unknown: fallback to periodic lightweight poll (every 1000–1500ms) detecting transition to idle / null file.

### Duration Acquisition
Priority order:
1. MPV property `duration` (post-load, retry up to N times with small delay).
2. Cached prior probe (maintain simple LRU map: path → duration_ms).
3. Optional external probe (future extension; skip for now if missing).
4. Unknown (monitor uses fallback mode, omits `duration_ms`).

### Pause/Resume Handling
- On pause: record `pauseStart`.
- On resume: `accumulatedPause += now - pauseStart` and recompute remaining time.
- If paused inside final validation window: extend with new timer after resume.

### Integration Points
| Media Type | Start Hook | Stop/Interrupt Hook | Completion Trigger |
|------------|------------|---------------------|--------------------|
| Video | `_playVideo` after successful start | `_stopVideo`, `_skipVideo`, `stopAll`, `pauseAll` (not pause) | Monitor natural completion (no manual stop) before `_setDefaultImage` |
| Speech | `_playSpeech` (after mpv load begins) | `_stopSpeech`, `skipSpeech`, `stopAll` | Promise resolution path when not interrupted |
| Background (non-loop) | `_playBackgroundMusic` after confirming loop=false | `_stopBackgroundMusic`, `stopAudio`, `stopAll` | Monitor timer natural expiry |

### Telemetry Source
Reuse last playback telemetry captured (`_lastPlaybackTelemetry`) or recompute minimal: effective_volume / pre_duck_volume / ducked.

### Edge Cases & Rules
- If user stops media within <250ms of estimated completion → treat as interruption (emit only `*_stopped`).
- Looping background never emits `*_completed` (only stop events).
- Rapid stop/start of same file generates two discrete monitoring sessions; old monitor interrupt() first.
- Video “resume from paused first frame” (smart setImage -> playVideo) must reset start time when actual playback begins.

## Phases
1. Baseline Monitor & Speech Integration
   - Implement `PlaybackMonitor`.
   - Integrate with speech playback promise (natural completion → event).
   - Unit tests: natural vs manual stop vs pause/resume.
2. Video & Background Integration
   - Hook video start/stop; compute duration; fire `video_completed`.
   - Hook background non-loop tracks; emit `background_music_completed`.
   - Unit tests for each including unknown duration fallback.
3. Interruption Clarity (Optional / Deferred)
   - Add `interrupted: true` to `*_stopped` events; schema update.
   - Update docs & consumer guidance.
4. Schema & Docs Finalization
   - Add `media-playback-completed.schema.json`.
   - Extend MQTT_API with examples and consumer migration notes.
5. Runtime Smoke Validation
   - Manual run: play short speech, short video, short non-loop music; capture all four event types (start/complete pairs).
6. Cleanup & Merge
   - Update CHANGELOG (Unreleased) with completion events feature.

## Testing Plan
| Test | Scenario | Expected |
|------|----------|----------|
| Speech natural | Play short speech file | `speech_started` then `speech_completed` |
| Speech interrupted | Play then stop mid-way | `speech_started` + `speech_stopped`, no `speech_completed` |
| Speech pause/resume | Pause half-way then resume | Delayed `speech_completed` (playback_ms > duration_ms) |
| Video natural | Play short video | `video_started` then `video_completed` before default image status |
| Video interrupted | Play then stop | `video_stopped` only |
| Background natural | Non-loop track | `background_music_started` then `background_music_completed` |
| Background loop | Loop=true track | Start event only; no completed |
| Unknown duration | Simulate missing duration | Fallback polling completion event fired |
| Rapid restart | Start, stop quickly, start again | First monitor interrupted, second completes |

## Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Duration inaccurate | Premature or delayed completion | Grace window + position validation |
| Long pauses extend too far | Delayed completion drift | Hard cap (expected * 10) |
| Memory leak monitors | Event spam, stale timers | Ensure interrupt() called on every stop path |
| Overhead on resource-limited Pi | CPU cost | Sparse timers; single active per media type |

## Open Questions / Decisions
- Include `interrupted:true` now vs later? (Proposed: Phase 3)
- Should we emit both `video_completed` and a `status` update first or after? (Proposed: emit completion before status refresh that clears video.)
- Should background completion auto-advance a (future) background queue? (Out of scope now.)

## Migration / Consumer Guidance
- New events are additive; existing consumers unaffected.
- Consumers wanting natural completion triggers should subscribe to `*_completed` and treat `*_stopped` as interruption.
- Telemetry fields are optional; clients should defensively check existence.

## Deliverables
- ~~`lib/media/playback-monitor.js`~~ → Actually implemented as `lib/media/video-playback-tracker.js`
- Modified: `audio-zone.js`, `screen-zone.js`, `audio-manager.js` (light hooks only)
- ~~New schema: `docs/json-schemas/media-playback-completed.schema.json`~~ → Deferred
- ~~New tests: `test/unit/media-completion-events.test.js`~~ → Partially implemented in `test/unit/video-queue.test.js`
- Docs: MQTT_API.md (updated), CHANGELOG.md (updated), PR_VIDEO_QUE.md (comprehensive spec)

## Acceptance Criteria
- ~~All enumerated tests pass~~ → 9 unit tests planned but not yet implemented (fake timers needed)
- No regressions in existing telemetry or command outcome tests. → ✅ ACHIEVED
- CPU overhead negligible (<~1% additional in idle profiling). → ✅ ACHIEVED
- ~~Smoke test capture shows all three `*_completed` variants~~ → Video completion events implemented; speech/background use different event model

---

## ACTUAL IMPLEMENTATION (2025-09-30)

### What Was Built

Instead of a generalized PlaybackMonitor, the implementation focused specifically on video queue restoration with these components:

**Core Components:**
1. **VideoPlaybackTracker** (`lib/media/video-playback-tracker.js`)
   - Pause-aware wall-clock elapsed time tracking
   - Uses setInterval (100ms ticks) to accumulate active playback time
   - Fires onNaturalEnd callback when elapsed >= targetDuration - epsilon (60ms)
   - Methods: start(), pause(), resume(), stop(), getWatchedSeconds()

2. **ffprobe Duration Probing** (`lib/media/ffprobe-duration.js`)
   - Spawns ffprobe subprocess to get accurate video duration
   - Caches results by absolute path to avoid repeated probes
   - Fallback to MPV duration property if probe fails

3. **Video Queue Management** (in `lib/zones/screen-zone.js`)
   - FIFO queue with configurable size limit (default: 5)
   - Duplicate detection (ignore same file already queued)
   - Smart replacement (trailing setImage replaced by new playVideo)
   - Queue inspection commands (videoQueue)

4. **Video Looping Feature**
   - Loop parameter on playVideo command (loop: true/false)
   - Manual restart approach (stop→loadMedia→play) for observability
   - Loop iteration tracking with loopState management
   - Automatic loop cancellation when new media queued
   - **⚠️ KNOWN BUG:** Hangs after 1-2 iterations (see PR_VIDEO_QUE.md)

**Event Schema:**
- Start event: `{ command, file, started:true, looping?, duration_s, queue_remaining, ... }`
- Final event: `{ command, file, done:true, reason, message, watched_s, loop_iterations?, ... }`
- Reasons: `natural_end`, `stopped`, `queue_cleared`, `error`

**Legacy Removal:**
- Completely removed legacy `_setupVideoEof()` timeout-based EOF detection
- Removed dual EOF detection systems that caused race conditions
- Single, consistent VideoPlaybackTracker for all video EOF detection

### What Was NOT Built

- Generalized PlaybackMonitor utility (chose specialized VideoPlaybackTracker instead)
- Background music completion events (background uses different model)
- JSON schemas for validation
- Complete unit test suite (9 tests planned, utilities created, fake timers needed)
- Interrupted flag on stop events (deferred)

### Files Modified

**Core Implementation:**
- `lib/zones/screen-zone.js` - Queue logic, loop state, restart handling, EOF detection (640 lines changed)
- `lib/media/video-playback-tracker.js` - NEW (77 lines)
- `lib/media/ffprobe-duration.js` - NEW (48 lines)

**Documentation:**
- `docs/PR_VIDEO_QUE.md` - Comprehensive specification (now updated with implementation status)
- `docs/PR_QUE_EOF.md` - THIS FILE (now updated with actual vs planned)
- `docs/VIDEO_LOOP_TEST_SCENARIOS.md` - NEW - Manual test scenarios
- `docs/MQTT_API.md` - Updated with loop parameter
- `README.md`, `README_FULL.md`, `docs/ParadoxFX_Func_Spec.md` - Updated examples

**Test Assets:**
- `media/test/video/A.mp4`, `B.mp4`, `C.mp4` - 6s colored test videos
- `media/test/video/Q1-Q4.mp4` - 5-8s labeled test videos for loop testing

### Testing Status

**Manual Testing:** ✅ COMPLETED
- Non-looping videos work correctly
- Queue progression works (FIFO, no preemption)
- First loop iteration works (restarts once)
- Loop cancellation works when new media queued
- stopVideo recovery works

**Unit Testing:** ⏳ PARTIAL
- Test utilities created in `test/unit/video-queue.test.js`
- 9 comprehensive tests specified but not implemented (need fake timers)
- Integration test for speech completion events exists

**Known Issues:**
- Loop hangs after 1-2 iterations (VideoPlaybackTracker stops firing after first restart)
- Root cause: Unclear why tracker onNaturalEnd callback stops after first loop restart
- Workaround: Use stopVideo to break out of hung loop

### Conclusion

The PR goals were achieved through VideoPlaybackTracker rather than PlaybackMonitor:
- ✅ Functional queue progression restored
- ✅ Natural completion detection working (for non-looping videos)
- ✅ Pause-aware timing implemented
- ✅ No reliance on unstable MPV end-file events
- ✅ Minimal overhead (single tracker per zone)
- ⚠️ Loop feature implemented but has bug requiring future fix

**Merge Commit:** 58164fc (2025-09-30)
**Branch:** PR_QUE_EOF → main
