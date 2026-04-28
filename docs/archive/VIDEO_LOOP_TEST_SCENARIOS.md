# Video Looping Test Scenarios

## Test Commands via MQTT

### Basic Loop Test
```bash
# Terminal 1: Subscribe to events
mosquitto_sub -t paradox/houdini/picture/events -v

# Terminal 2: Start looping video
mosquitto_pub -t paradox/houdini/picture/commands -m '{"command":"playVideo","file":"A.mp4","loop":true}'

# Expected: Video A plays and restarts indefinitely
# Events: 
# - Start event with looping:true
# - Loop iteration events every 6s
```

### Loop Cancel on Enqueue
```bash
# Start looping video
mosquitto_pub -t paradox/houdini/picture/commands -m '{"command":"playVideo","file":"A.mp4","loop":true}'

# Wait 10s (should see ~1-2 loop iterations)

# Enqueue new video
mosquitto_pub -t paradox/houdini/picture/commands -m '{"command":"playVideo","file":"B.mp4"}'

# Expected: A completes current iteration, then B starts
# Final event for A should show loop_iterations: N
```

### Queue Prevents Loop Activation
```bash
# Queue two videos where second has loop
mosquitto_pub -t paradox/houdini/picture/commands -m '{"command":"playVideo","file":"A.mp4"}'
mosquitto_pub -t paradox/houdini/picture/commands -m '{"command":"playVideo","file":"B.mp4","loop":true}'

# Expected: 
# - A plays once (no loop, queue not empty)
# - B starts and loops (queue empty when B starts)
```

### setImage Cancel Loop
```bash
# Start looping video
mosquitto_pub -t paradox/houdini/picture/commands -m '{"command":"playVideo","file":"A.mp4","loop":true}'

# Wait 10s

# Queue setImage
mosquitto_pub -t paradox/houdini/picture/commands -m '{"command":"setImage","file":"B.mp4"}'

# Expected: A finishes current iteration, B shown paused on first frame
```

### Resume with Loop
```bash
# Show first frame
mosquitto_pub -t paradox/houdini/picture/commands -m '{"command":"setImage","file":"A.mp4"}'

# Resume with loop
mosquitto_pub -t paradox/houdini/picture/commands -m '{"command":"playVideo","file":"A.mp4","loop":true}'

# Expected: Video resumes from start and loops indefinitely
# Start event should show resumed:true AND looping:true
```

### stopVideo Breaks Loop
```bash
# Start looping video
mosquitto_pub -t paradox/houdini/picture/commands -m '{"command":"playVideo","file":"A.mp4","loop":true}'

# Wait 10s

# Stop video
mosquitto_pub -t paradox/houdini/picture/commands -m '{"command":"stopVideo"}'

# Expected: Video stops, final event shows reason:'stopped' and loop_iterations
```

## Expected Event Schemas

### Start Event (Looping)
```json
{
  "command": "playVideo",
  "file": "A.mp4",
  "started": true,
  "looping": true,
  "resumed": false,
  "media_type": "video",
  "duration_s": 6,
  "queue_remaining": 0,
  "ts": "2025-09-30T..."
}
```

### Loop Iteration Event
```json
{
  "command": "playVideo",
  "file": "A.mp4",
  "loop_iteration": 3,
  "ts": "2025-09-30T..."
}
```

### Final Event (Loop Completed)
```json
{
  "command": "playVideo",
  "file": "A.mp4",
  "done": true,
  "reason": "natural_end",
  "message": "Video completed (00:06)",
  "watched_s": 18.0,
  "duration_s": 6,
  "loop_iterations": 2,
  "queue_remaining": 1,
  "ts": "2025-09-30T..."
}
```

### Final Event (Loop Stopped)
```json
{
  "command": "playVideo",
  "file": "A.mp4",
  "done": true,
  "reason": "stopped",
  "message": "Video stopped",
  "watched_s": 15.2,
  "duration_s": 6,
  "loop_iterations": 2,
  "queue_remaining": 0,
  "ts": "2025-09-30T..."
}
```

## Edge Cases to Verify

1. **Empty Queue Check**: Loop only activates if `videoQueue.length === 0` at playback start
2. **Loop Cancel Timing**: New enqueue sets `isLooping = false`, current iteration completes naturally
3. **Error During Loop**: Loop breaks, error final event emitted, queue advances
4. **Multiple Rapid Enqueues**: First enqueue cancels loop, subsequent enqueues just queue normally
5. **Loop Parameter Defaults**: Omitting `loop` or `loop:false` should not activate looping
6. **Non-Video Files**: Loop parameter ignored for image files in playVideo (edge case handling)

## Manual Test Checklist

- [ ] Basic loop (single video loops indefinitely)
- [ ] Loop iteration events emitted every ~6s
- [ ] Enqueue playVideo cancels loop
- [ ] Enqueue setImage cancels loop
- [ ] Queue prevents loop activation
- [ ] stopVideo breaks loop cleanly
- [ ] Resume from setImage with loop=true works
- [ ] Final event includes correct loop_iterations count
- [ ] watched_s accumulates across all iterations
- [ ] Loop state cleared on all completion paths

## Performance Notes

- Each loop iteration requires ~100-300ms overhead (stop + reload + play)
- For seamless loops, consider MPV native `--loop-file` in future iteration
- Loop iteration events add ~1 event per 6s (manageable for monitoring)
- No memory leaks expected (tracker properly stopped/restarted each iteration)
