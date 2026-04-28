# MPV Optimization Options for Pi4 Video Playback

## Current Configuration

**Hardware:** Raspberry Pi 4 Model B Rev 1.1  
**Profile:** `pi4` (from `/opt/paradox/apps/ParadoxFX/config/mpv-profiles.json`)  
**Display:** HDMI-1 (monitor 1)  
**Audio:** `pulse/alsa_output.platform-fef05700.hdmi.hdmi-stereo`

## Current MPV Arguments (from pi4 profile)

Based on the PFX application logs and profile configuration:

```bash
--hwdec=auto-copy \
--vo=gpu \
--cache=yes \
--demuxer-max-bytes=32M \
--no-terminal \
--no-osc \
--keep-open=always \
--audio-device=pulse/alsa_output.platform-fef05700.hdmi.hdmi-stereo \
--volume=70 \
--fs-screen=1 \
--screen=1 \
--force-window=immediate \
--fullscreen \
--no-border \
--ontop \
--no-osd-bar \
--idle=yes \
--volume-max=150
```

**Note:** `--input-ipc-server` is also added but can be omitted for manual testing.

## Issues Observed
- Video drops a few frames
- Higher CPU usage than desired
- Working but not optimal

---

## Optimization Options to Test

### Option 1: Reduce Cache Size (Lower Memory, Faster Startup)
```bash
mpv --hwdec=auto-copy --vo=gpu --cache=yes --demuxer-max-bytes=16M \
--no-terminal --no-osc --keep-open=always --fullscreen --fs-screen=1 \
--audio-device=pulse/alsa_output.platform-fef05700.hdmi.hdmi-stereo \
--volume=70 <video_file>
```
**Why:** Smaller cache uses less memory and may reduce processing overhead.

---

### Option 2: Disable Cache Entirely (Lowest Latency)
```bash
mpv --hwdec=auto-copy --vo=gpu --cache=no \
--no-terminal --no-osc --keep-open=always --fullscreen --fs-screen=1 \
--audio-device=pulse/alsa_output.platform-fef05700.hdmi.hdmi-stereo \
--volume=70 <video_file>
```
**Why:** Eliminates cache processing overhead. Good for local files.

---

### Option 3: Try Different Hardware Decode Methods
```bash
# Option 3a: Use rpi decoder (Pi-specific)
mpv --hwdec=rpi --vo=gpu --cache=yes --demuxer-max-bytes=32M \
--no-terminal --no-osc --keep-open=always --fullscreen --fs-screen=1 \
--audio-device=pulse/alsa_output.platform-fef05700.hdmi.hdmi-stereo \
--volume=70 <video_file>

# Option 3b: Try auto (direct hardware decode, may cause blue screen)
mpv --hwdec=auto --vo=gpu --cache=yes --demuxer-max-bytes=32M \
--no-terminal --no-osc --keep-open=always --fullscreen --fs-screen=1 \
--audio-device=pulse/alsa_output.platform-fef05700.hdmi.hdmi-stereo \
--volume=70 <video_file>

# Option 3c: Disable hardware decode (software only - higher CPU but more reliable)
mpv --hwdec=no --vo=gpu --cache=yes --demuxer-max-bytes=32M \
--no-terminal --no-osc --keep-open=always --fullscreen --fs-screen=1 \
--audio-device=pulse/alsa_output.platform-fef05700.hdmi.hdmi-stereo \
--volume=70 <video_file>
```
**Why:** Different decode methods have different CPU/GPU tradeoffs.

---

### Option 4: Add Frame Drop Strategy
```bash
mpv --hwdec=auto-copy --vo=gpu --cache=yes --demuxer-max-bytes=32M \
--no-terminal --no-osc --keep-open=always --fullscreen --fs-screen=1 \
--audio-device=pulse/alsa_output.platform-fef05700.hdmi.hdmi-stereo \
--volume=70 --framedrop=vo \
<video_file>
```
**Why:** `--framedrop=vo` drops frames at video output stage to maintain A/V sync. Better to drop frames intentionally than stutter.

---

### Option 5: Use Fast Profile with Performance Tweaks
```bash
mpv --hwdec=auto-copy --vo=gpu --cache=yes --demuxer-max-bytes=32M \
--no-terminal --no-osc --keep-open=always --fullscreen --fs-screen=1 \
--audio-device=pulse/alsa_output.platform-fef05700.hdmi.hdmi-stereo \
--volume=70 --profile=fast --video-sync=audio --opengl-swapinterval=0 \
<video_file>
```
**Why:** `--profile=fast` enables performance-oriented settings. `--video-sync=audio` prioritizes audio sync. `--opengl-swapinterval=0` disables vsync waiting.

---

### Option 6: Try GPU Video Output with DRM (Pi-specific)
```bash
mpv --hwdec=auto-copy --vo=gpu --gpu-context=drm --cache=yes \
--demuxer-max-bytes=32M --no-terminal --no-osc --keep-open=always \
--fullscreen --fs-screen=1 \
--audio-device=pulse/alsa_output.platform-fef05700.hdmi.hdmi-stereo \
--volume=70 <video_file>
```
**Why:** DRM context bypasses X11 overhead, but may conflict with X11 windows.
**Caution:** May not work well with X11 setup.

---

### Option 7: Reduce Demuxer Thread Count
```bash
mpv --hwdec=auto-copy --vo=gpu --cache=yes --demuxer-max-bytes=32M \
--no-terminal --no-osc --keep-open=always --fullscreen --fs-screen=1 \
--audio-device=pulse/alsa_output.platform-fef05700.hdmi.hdmi-stereo \
--volume=70 --demuxer-thread=no \
<video_file>
```
**Why:** Reduces CPU overhead from demuxer threading on Pi4's limited cores.

---

### Option 8: Combination - Aggressive Performance
```bash
mpv --hwdec=auto-copy --vo=gpu --cache=no --no-terminal --no-osc \
--keep-open=always --fullscreen --fs-screen=1 \
--audio-device=pulse/alsa_output.platform-fef05700.hdmi.hdmi-stereo \
--volume=70 --framedrop=vo --video-sync=audio \
--opengl-swapinterval=0 --demuxer-thread=no \
<video_file>
```
**Why:** Combines multiple optimizations: no cache, frame dropping, audio sync priority, no vsync, no demuxer threads.

---

## Testing Procedure

1. Stop PFX if running: `Ctrl+C` or `sudo systemctl stop pfx.service`

2. Get a test video file path:
   ```bash
   TEST_VIDEO="/opt/paradox/media/game/intro_short.mp4"
   ```

3. Test each option (run from terminal):
   ```bash
   DISPLAY=:0 mpv <options_from_above> "$TEST_VIDEO"
   ```

4. While video plays, monitor CPU usage:
   ```bash
   # In another terminal:
   top
   ```
   Look for the `mpv` process CPU percentage.

5. Watch for:
   - Frame drops (look for stuttering)
   - CPU usage percentage
   - Smoothness of playback
   - Any errors in terminal output

6. Press `q` to quit mpv after testing.

---

## Recommended Testing Order

1. **Option 2** (no cache) - Quick test to see if cache is the problem
2. **Option 4** (framedrop) - Handle drops gracefully
3. **Option 8** (aggressive combo) - Maximum performance
4. **Option 5** (fast profile) - Balanced optimization
5. **Option 3a** (rpi hwdec) - Pi-specific hardware decoder

---

## Updating PFX Configuration

Once you find the best settings, update `/opt/paradox/apps/ParadoxFX/config/mpv-profiles.json`:

Edit the `"pi4"` profile section:
```json
"pi4": {
  "name": "Raspberry Pi 4",
  "description": "Pi4 with optimized settings",
  "tested": true,
  "baseArgs": [
    "--hwdec=auto-copy",
    "--vo=gpu",
    "--cache=no",               // Example: Changed from yes to no
    "--no-terminal",
    "--no-osc",
    "--keep-open=always"
  ],
  "performance": {
    "profile": "fast",           // Example: Added fast profile
    "extraArgs": [
      "--framedrop=vo",           // Example: Added frame dropping
      "--video-sync=audio"
    ]
  }
}
```

Then restart PFX to apply changes.

---

## Notes

- The current `--hwdec=auto-copy` is already optimized to avoid blue screen issues
- Pi4 has limited GPU memory (256MB as configured in your config.txt)
- Local file playback shouldn't need large caches
- Frame dropping is often better than stuttering
- Monitor temperature: `vcgencmd measure_temp`
