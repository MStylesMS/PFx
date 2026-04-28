# PR_VIDEO_QUE: Unified Video Queue & Event Model

Status: ✅ IMPLEMENTED (with known loop bug)
Author: Copilot Agent
Date: 2025-09-29
Branch: PR_QUE_EOF → Merged to main (2025-09-30)

## Objectives

Implement a clean, pre-release video queue and event model aligned with existing speech/background refinements:
- No legacy `video_started` / `video_completed` events.
- Deterministic start + single final event per playback instance.
- Strict no-preemption: a currently playing video finishes before the next begins (unless explicitly stopped/cleared).
- Queue clearing on `stopVideo` and `stopAll`.
- Duration determined via `ffprobe` first; fallback to mpv `duration`; final fallback heuristic (stall / timeout) only for EOF.
- Completion decided by elapsed active playback time (pause-aware) vs detected duration.
- Support `volume` and `adjustVolume` command parameters (no loop parameter for videos).
- `setImage` with a video file loads & pauses on frame 1; publishes a start-shaped event using `command:'setImage'` with `paused_first_frame:true` flag; same fundamental schema fields.
- Unified final event shape: `{ command, file, done:true, reason, message, ... }`.

## Command Parameters

Accepted for `playVideo`:
- `file` (required) – media path (relative or absolute handled upstream)
- `volume` (optional)
- `adjustVolume` (optional)
- `ducking` (optional negative dB attenuation to apply to background/audio system while video plays – retained if existing infra expects it)
- `loop` (optional, boolean) – if `true`, video restarts on natural end until queue receives new item. Only activates when queue is/will be empty. Defaults to `false`.

Accepted for `setImage` (video first-frame path):
- `file` or `image`

## Queue Semantics

1. Enqueue Rules:
   - If a video is currently playing and a new `playVideo` arrives (different file), the new item is appended to queue (no preemption, no forced stop of current).
   - Duplicate suppression: If the *same* file already queued (not currently playing), ignore the new enqueue.
   - Replacement optimization: Only last enqueued pending `setImage` item may be replaced by a newer `setImage` (image or video) – preserves user intent for “update background still”.
   - A `playVideo` never replaces an in-flight video; it waits in queue.

2. Execution Order:
   - At most one actively playing video at a time.
   - After a video final event (natural_end or interrupted), dequeue next entry (FIFO) and begin.
   - `setImage` with video: loads & pauses; counts as completion of that queue step immediately after start-shaped event (since it is not playing), then proceeds automatically to the next queued item.
   - `setImage` with static image similar (no event except status update – consistent with existing image handling). If future parity is needed, can add event but out of scope now.

3. Clearing:
   - `stopVideo` or `stopAll`:
     - If a video is playing: emit final event with `reason:'stopped'` and message reflecting position/duration, then clear queue array.
     - If no video playing: silently clear queue (no final event) unless a paused-first-frame video exists – then emit final with `reason:'queue_cleared'` for that prepared media.

## Duration & Timing

Priority order to obtain `target_duration_s`:
1. `ffprobe` (spawn, parse float). Cached per absolute path.
2. mpv `duration` property.
3. Fallback: unknown (null) – rely on heuristic stall detection OR configured safety max (optional future).

Playback Monitoring:
- On start, record `started_at_ms`.
- Maintain `accumulated_play_ms` (advance only while not paused).
- For pause/resume (if implemented later), keep consistent with speech monitor pattern.
- Natural end decision triggers when `accumulated_play_ms >= target_duration_s * 1000 - epsilon` (epsilon ~ 60ms) when we trust duration.
- If duration unknown: fallback heuristic using existing stall detection OR maximum cap (e.g., 6 hours) – final event reason:`heuristic_eof`.

## Event Schema

### Start Event (playVideo)
```
{
  command: 'playVideo',
  file: '<path>',
  started: true,
  resumed: <boolean>,
  looping: <boolean|undefined>,    // Present and true if loop active
  media_type: 'video',
  duration_s: <number|null>,   // known or null if unknown at start
  volume: <number|undefined>,
  adjust_volume: <number|undefined>,
  ducking_applied: <number|undefined>, // maintain if ducking logic active
  queue_remaining: <int>,
  ts: '<iso8601>'
}
```

### Start Event (setImage with video first frame)
```
{
  command: 'setImage',
  file: '<path>',
  started: true,
  media_type: 'video_first_frame',
  paused_first_frame: true,
  duration_s: <number|null>,
  queue_remaining: <int>,
  ts: '<iso8601>'
}
```
Immediately auto-advances queue (no final event for this item; it is a prepared static visual state). If a future resume occurs via `playVideo` same file and paused flag set, `resumed:true` will be published on that later `playVideo` start.

### Final Event (always exactly one per actively playing video)
Fields baseline:
```
{
  command: 'playVideo',
  file: '<path>',
  done: true,
  reason: 'natural_end' | 'stopped' | 'queue_cleared' | 'error' | 'heuristic_eof',
  message: '<human string>',
  duration_s: <number|null>,
  watched_s: <number>,          // accumulated active playback
  position_s: <number|undefined>,// alias for watched_s (only if not natural?) optional; may omit if equal
  loop_iterations: <number|undefined>, // Number of complete loops if video was looping
  queue_remaining: <int>,        // after dequeueing completion
  ts: '<iso8601>'
  // If error:
  // error_type: 'load_failed'|'probe_failed'|'mpv_error'|'start_failed'
  // error_detail: '<string>'
}
```

Message Formats:
- natural_end: `Video completed (MM:SS)`
- stopped: `Video stopped at MM:SS / MM:SS` (duration may be unknown -> `?`)
- queue_cleared: `Video cleared at MM:SS / MM:SS` (on stop while not actually playing? or prepared state) 
- heuristic_eof: `Video ended (heuristic) at MM:SS` (duration unknown)
- error: `Video error: <error_type>`

### No Legacy Events
- Remove all `video_started` and `video_completed` emissions.

## Internal Changes Required

1. Normalize queue items to:
```
{
  kind: 'playVideo' | 'setImage',
  file: '<path>',
  media_type: 'video'|'image',
  enqueued_at: <ms>,
  original: <original command object>
}
```
2. Remove legacy `nextItem` path inside `_handleMediaEnd`; implement explicit queue pop in a central finish routine.
3. Introduce `VideoPlaybackTracker` (or reuse PlaybackMonitor with minor specialization) to manage timing (start, stop, pause aware) using target duration.
4. Add ffprobe cache map (LRU or simple Map) keyed by absolute path.
5. Modify `_playVideo` to:
   - Acquire duration via ffprobe before load (async). If probing slow, still begin load concurrently, but final event depends on monitor timing.
   - Publish start event only after mpv playback has actually begun (post `play` call).
6. Define `completeVideo(reason, extra)` helper that:
   - Stops monitor
   - Cleans ducking
   - Publishes final event
   - Advances queue
7. Modify `stopVideo` and `stopAll` to call `completeVideo('stopped')` (if active) and then clear queue (`videoQueue=[]`). Publish no separate queue-cleared event beyond final event for active item.
8. Ensure setImage(video) start-shaped event uses duration (if probed) but produces no final event.
9. Ensure resumed detection: if last command setImage with same file and paused_first_frame true => resumed true on subsequent playVideo.

## Error Handling
- If file missing at enqueue processing: publish final event with `reason:'error', error_type:'load_failed'` (no start event) and continue queue.
- If ffprobe fails: fallback to mpv duration attempt; if still null, duration_s=null and rely on heuristic stall detection -> final reason=`heuristic_eof`.
- If mpv load rejects: final event with `error` (no start event if it never began playback).

## Telemetry & State
- `this.currentState.status` transitions:
  - idle -> playing_video
  - playing_video -> idle (on final event) or -> video_paused (future if pause supported)
  - setImage(video) leaves status at `showing_image`.

## Testing Plan (High-Level)
- Test natural end with known duration (ffprobe) => reason natural_end.
- Test stop mid-play => reason stopped; watched_s < duration_s.
- Test queue: enqueue A then B while A playing => A completes then B starts (no preemption).
- Test duplicate B while B already queued => second ignored.
- Test setImage(video) then playVideo(same video) => resumed true.
- Test missing file => error final, queue advances.
- Test heuristic path (corrupt duration retrieval) => heuristic_eof final with duration_s null.
- Test stopVideo clears queued items and emits final for active only.

## Open Decisions (Now Resolved Per User Feedback)
- Paused-first-frame event shape uses `command:'setImage'` (not `playVideo`), includes same core fields + `paused_first_frame:true`.
- No duck_id field in any published events.
- No legacy compatibility/dual emission.
- Progress tick events deferred.

## Implementation Order
1. Queue item normalization & helper utilities.
2. ffprobe duration utility + cache.
3. VideoPlaybackTracker (or extend PlaybackMonitor) with pause-awareness.
4. Replace legacy events in `_playVideo` / `_handleMediaEnd`.
5. Implement completion helper + integrate with stopVideo/stopAll.
6. Implement setImage(video) start-shaped event.
7. Purge legacy code paths and remove unreachable branches.
8. Update docs (MQTT_API, CHANGELOG) referencing new schema.
9. Add/adjust tests.
10. Smoke validate manual scenarios.

## Event Examples

Start:
```
{ "command":"playVideo", "file":"media/intro.mp4", "started":true, "resumed":false, "media_type":"video", "duration_s":12.48, "volume":80, "queue_remaining":1, "ts":"2025-09-29T19:22:05.123Z" }
```

Final (natural):
```
{ "command":"playVideo", "file":"media/intro.mp4", "done":true, "reason":"natural_end", "message":"Video completed (00:12)", "duration_s":12.48, "watched_s":12.48, "queue_remaining":0, "ts":"2025-09-29T19:22:17.655Z" }
```

Final (stopped):
```
{ "command":"playVideo", "file":"media/intro.mp4", "done":true, "reason":"stopped", "message":"Video stopped at 00:05 / 00:12", "duration_s":12.48, "watched_s":5.02, "position_s":5.02, "queue_remaining":0, "ts":"2025-09-29T19:23:01.002Z" }
```

SetImage(video) paused-first-frame:
```
{ "command":"setImage", "file":"media/loop.mp4", "started":true, "media_type":"video_first_frame", "paused_first_frame":true, "duration_s":94.31, "queue_remaining":0, "ts":"2025-09-29T19:25:44.019Z" }
```

## Risks / Mitigations
- ffprobe latency: Run probe asynchronously but gate final start event until at least mpv load begins; if probe slower than threshold (e.g., 300ms), publish with duration_s null then patch? (Decision: wait up to short timeout 300ms, else proceed with null to avoid user-visible delay; optional later improvement.)
- Heuristic misfire: Provide logging tag `heuristic_eof` and potentially configurable epsilon.
- Queue starvation if monitor fails: watchdog fallback (optional future) not included now.

## Logging
- Add structured logs: `VIDEO_START`, `VIDEO_FINAL`, `VIDEO_QUEUE_ENQUEUE`, `VIDEO_QUEUE_ADVANCE` with concise JSON for internal troubleshooting.

---

## Implementation Status

### ✅ COMPLETED (2025-09-30)

**Implemented Features:**
- Video queue FIFO with configurable size limit (default: 5)
- Intelligent duplicate detection and replacement logic
- ffprobe-based duration probing with caching (`lib/media/ffprobe-duration.js`)
- VideoPlaybackTracker for pause-aware EOF detection (`lib/media/video-playback-tracker.js`)
- Start/final event schema with `started`, `done`, `reason`, `message` fields
- Loop parameter support with manual restart approach
- Loop iteration tracking and telemetry events
- Automatic loop cancellation when new media queued
- Queue inspection commands (`videoQueue`, `speechQueue`)
- Complete removal of legacy timeout-based EOF detection
- Guard mechanisms to prevent concurrent loop restarts
- Timeout protection on MPV operations during restart

**Test Assets Created:**
- `media/test/video/A.mp4`, `B.mp4`, `C.mp4` (6s colored test videos)
- `media/test/video/Q1-Q4.mp4` (5-8s labeled test videos for loop testing)

**Documentation:**
- `docs/VIDEO_LOOP_TEST_SCENARIOS.md` - Manual test scenarios
- Updated MQTT_API.md, README.md, README_FULL.md, ParadoxFX_Func_Spec.md

### ⚠️ KNOWN ISSUES

**Video Loop Bug:**
The video looping feature (loop: true) has a known bug where loop restarts work for the first iteration but fail to restart after the second iteration, causing the video to hang.

**Symptoms:**
- First loop iteration: ✅ Works (restarts once)
- Subsequent iterations: ❌ Hangs after second iteration
- VideoPlaybackTracker fires once, logs "Loop iteration 1", but subsequent iterations don't trigger

**Root Cause (Hypothesis):**
The tracker is not firing its onNaturalEnd callback after the first restart, despite being recreated and started in `_handleLoopRestart()`. Possible causes:
- probeDurationSeconds might be returning null after restart
- Tracker might not be starting properly after MPV loadMedia
- Tracker reference might be lost or overwritten

**Workaround:**
Use `stopVideo` command to break out of hung loop state. The system remains responsive to stopVideo even when looping hangs.

**Testing Status:**
- ✅ Non-looping videos work correctly
- ✅ First loop iteration works (restarts once)
- ❌ Subsequent iterations hang after second iteration
- ✅ Loop cancellation works when items queued
- ✅ stopVideo recovery works

**Files Modified:**
- `lib/zones/screen-zone.js` - Loop state, restart logic, EOF detection
- `lib/media/video-playback-tracker.js` - Wall-clock timing-based EOF
- `lib/media/ffprobe-duration.js` - Duration probing with caching

### 📋 TODO FOR BUG FIX

- [ ] Debug why VideoPlaybackTracker onNaturalEnd stops firing after first restart
- [ ] Add explicit logging around tracker creation/start in _handleLoopRestart
- [ ] Verify probeDurationSeconds returns valid duration after restart
- [ ] Check if tracker.start() is being called properly
- [ ] Investigate if tracker needs different initialization after MPV restart
- [ ] Consider if MPV state after loadMedia affects tracker behavior

### 🧪 PENDING TESTS

Nine unit tests specified but not yet implemented:
- [ ] Test 1: Single video natural end with paused last frame
- [ ] Test 2: Sequential video queue (A then B)
- [ ] Test 3: Duplicate playVideo ignored when same file playing
- [ ] Test 4: setImage(video) after playVideo shows first frame
- [ ] Test 5: Replay same video after completion
- [ ] Test 6: setImage(video) mid-play immediate display
- [ ] Test 7: playVideo removes trailing setImage from queue
- [ ] Test 8: Three sequential videos (A, B, C)
- [ ] Test 9: Duplicate at tail (B, C, B) all play in order

Test utilities exist in `test/unit/video-queue.test.js` but tests need fake timers integration.

---

**Implementation complete as of merge commit 58164fc (2025-09-30).**
**Loop bug documented in all user-facing documentation with workaround.**
