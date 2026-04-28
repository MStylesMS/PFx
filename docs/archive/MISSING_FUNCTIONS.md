# Missing PFX Functions - Implementation Needed

## Overview
These commands are documented in MQTT_API.md but not yet implemented in the PFX codebase. They need to be added to the appropriate zone handlers.

## Video Control Commands (Currently Missing)

### pauseVideo
Pause current video playback.

**Format:**
```json
{
  "command": "pauseVideo"
}
```

### resumeVideo
Resume paused video playback.

**Format:**
```json
{
  "command": "resumeVideo"
}
```

### skipVideo
Skip to next video in playlist while preserving paused state if needed.

**Format:**
```json
{
  "command": "skipVideo"
}
```

### pauseAll
Pause all media playback (video and audio).

**Format:**
```json
{
  "command": "pauseAll"
}
```

### resumeAll
Resume all paused media playback (video and audio).

**Format:**
```json
{
  "command": "resumeAll"
}
```

## Audio Management Commands (Currently Missing)

### pauseAudio
Pause all audio playback (background music and speech).

**Format:**
```json
{
  "command": "pauseAudio"
}
```

### resumeAudio
Resume all paused audio playback (background music and speech).

**Format:**
```json
{
  "command": "resumeAudio"
}
```

### playMusic
Start background music with automatic volume ducking during speech.

**Format:**
```json
{
  "command": "playMusic",
  "file": "ambient.mp3",
  "volume": 60,
  "loop": true
}
```

**Parameters:**
- `File` (required): Music file relative to zone's background_music_dir
- `Volume` (optional): Volume level 0-100, default: 70
- `Loop` (optional): Whether to loop the music, default: true
- `FadeIn` (optional): Fade-in duration in seconds, default: 2

### stopMusic
Stop background music with optional fade-out.

**Format:**
```json
{
  "command": "stopMusic",
  "FadeOut": 3
}
```

**Parameters:**
- `FadeOut` (optional): Fade-out duration in seconds, default: 2

### playEffect
Play fire-and-forget sound effect with low latency.

**Format:**
```json
{
  "command": "playEffect",
  "file": "click.wav",
  "volume": 75,
  "Preload": true
}
```

**Parameters:**
- `File` (required): Effect file relative to any configured media directory
- `Volume` (optional): Volume level 0-100, default: 80
- `Preload` (optional): Whether to use preloaded effect, default: false
- `Overlap` (optional): Allow overlapping with other effects, default: true

### stopAllEffects
Stop all currently playing sound effects.

**Format:**
```json
{
  "command": "stopAllEffects"
}
```

### clearSpeechQueue
Clear all queued speech audio.

**Format:**
```json
{
  "command": "clearSpeechQueue"
}
```

## Browser Extended Control (Currently Missing)

### setBrowserKeepAlive
Enable/disable automatic browser restart on crash.

**Format:**
```json
{
  "command": "setBrowserKeepAlive",
  "enabled": true
}
```

**Parameters:**
- `enabled` (required): Boolean flag for keep-alive behavior

### browserStatus
Request current browser status. Zone publishes status to its status topic including fields like `running`, `url`, `windowClass`, and `keepAlive`.

**Format:**
```json
{ 
  "command": "browserStatus" 
}
```

## Queue/Status Inspection (Currently Missing)

### videoQueue
Return current video queue. Publishes an event with field `video_queue` (array of pending media filenames).

**Format:**
```json
{
  "command": "videoQueue"
}
```

### speechQueue
Return current speech queue. Publishes an event with field `speech_queue` (array of pending speech file paths).

**Format:**
```json
{
  "command": "speechQueue"
}
```

### getZoneStatus
Request current status of the audio zone.

**Format:**
```json
{
  "command": "getZoneStatus"
}
```

**Response includes:**
- Background music status and current file
- Speech queue length and current item
- Active sound effects count
- Zone volume and device status
- Audio device availability and aliases

## Implementation Priority
1. **High Priority**: pauseVideo, resumeVideo, pauseAll, resumeAll (basic playback control)
2. **Medium Priority**: ✅ stopAudio (implemented), pauseAudio, resumeAudio (audio management)
3. **Low Priority**: playMusic, playEffect, queue inspection commands (advanced features)

## Notes
- Some commands may be partially implemented but not wired to MQTT handlers
- Video queue functionality exists but queue inspection commands are missing
- Browser keep-alive and status commands need browser manager extensions
