# MQTT API Reference

This document provides the complete MQTT API specification for ParadoxFX (Paradox Effects), including command formats, message structures, topic patterns, and response formats.

**Note**: This documentation reflects only the currently implemented commands. For a comprehensive list of documented but unimplemented commands, see [MISSING_FUNCTIONS.md](MISSING_FUNCTIONS.md).

## Table of Contents

- [Overview](#overview)
- [Topic Structure](#topic-structure)
- [Message Formats](#message-formats)
- [Event Publishing](#event-publishing)
- [Multi-Zone Audio](#multi-zone-audio)
- [Screen/Media Commands](#screenmedia-commands)
- [Multi-Zone Audio Commands](#multi-zone-audio-commands)
- [Light Commands](#light-commands)
- [Relay Commands](#relay-commands)
- [System Messages](#system-messages)
- [Error Handling](#error-handling)
- [Examples](#examples)

## Overview

PFx uses MQTT for all device communication. Each device subscribes to a command topic and publishes status updates and responses. The system also provides heartbeat messages and error reporting.

### Unified Volume & Ducking Model

Playback volume for audio/video related commands is resolved using this precedence (highest → lowest):
1. `volume` (absolute 0–200) supplied in the command payload
2. `adjustVolume` (transient -100..+100 %) supplied in the command payload
3. Zone base `volume` from configuration (INI)

If both `volume` and `adjustVolume` are present the absolute `volume` is used and a warning event is published (command still succeeds, `adjustVolume` ignored).

Background ducking applies ONLY to background music and ONLY while a duck trigger is active (speech, video or manual—depending on feature set). The configured `ducking_adjust` (negative percent, e.g. -40) is applied once; ducks do not stack.

### Volume Telemetry (Phase 9)

Command outcome events for playback plus background-volume recompute events now include:
- `effective_volume`: Final volume applied after resolution and ducking
- `pre_duck_volume`: Effective volume before ducking reduction (equal to `effective_volume` if no duck active)
- `ducked`: Boolean (true if background was reduced by a duck)

These telemetry fields are event-only (not included in steady periodic status snapshots) to keep status lean. Subscribe to `{baseTopic}/events` to observe them.

#### JSON Schema References
See `docs/json-schemas/command-outcome-playback.schema.json` and `docs/json-schemas/background-volume-recompute.schema.json` for machine-readable validation of telemetry-enriched events.

#### Example Telemetry Event Sequence
When a playback command is issued the system may emit several related events. Below is a real capture (trimmed) from a `playBackground` command that specified both `volume` and `adjustVolume` (triggering a resolution warning) followed by a manual duck / unduck cycle.

```jsonc
[
  {
    "timestamp": "2025-09-29T18:20:03.633Z",
    "zone": "mirror",
    "type": "events",
    "command_received": "playBackground",
    "parameters": { "file": "music.mp3", "volume": 120, "adjustVolume": -25 }
  },
  {
    "timestamp": "2025-09-29T18:20:03.688Z",
    "zone": "mirror",
    "type": "events",
    "background_music_started": true,
    "file": "music.mp3",
    "volume": 120,
    "pre_duck": 120,
    "ducked": false,
    "adjust_volume": -25
  },
  {
    "timestamp": "2025-09-29T18:20:03.688Z",
    "zone": "mirror",
    "type": "events",
    "command": "playBackground",
    "outcome": "warning",
    "parameters": { "file": "music.mp3", "volume": 120, "warnings": ["both_volume_and_adjust"] },
    "message": "Background playback started with volume resolution warnings",
    "warning_type": "volume_resolution_warning"
  },
  {
    "timestamp": "2025-09-29T18:20:03.688Z",
    "zone": "mirror",
    "type": "events",
    "command": "playBackground",
    "outcome": "success",
    "parameters": { "file": "music.mp3", "volume": 120, "adjustVolume": -25 },
    "message": "Command 'playBackground' executed successfully"
  },
  {
    "timestamp": "2025-09-29T18:20:08.638Z",
    "zone": "mirror",
    "type": "events",
    "background_volume_recomputed": true,
    "volume": 120,
    "pre_duck": 120,
    "ducked": true,
    "effective_volume": 120,
    "pre_duck_volume": 120
  }
]
```

Notes:
- A warning outcome is emitted (with `warning_type`) when both `volume` and `adjustVolume` are supplied; a subsequent success outcome is also emitted for the same command (legacy pattern maintained for backward compatibility with clients expecting a terminal success). Consumers may treat the warning outcome as authoritative and ignore the later success.
- `background_music_started` and `background_volume_recomputed` events carry real-time telemetry; periodic state snapshots intentionally omit `effective_volume`, `pre_duck_volume`, and `ducked` to stay lightweight.

Client Guidance:
- If you only care about final status, deduplicate by the tuple `(timestamp truncated to ms, command)` keeping the first non-success outcome (warning/failed) if present.
- For analytics, prefer the telemetry-bearing events (`*_recomputed`, `*_started`) plus the command outcome with any `warning_type` / `error_type`.


### Base Architecture

- **Commands**: Sent to `{baseTopic}/commands`
- **State**: Published to `{baseTopic}/state`
- **Heartbeat**: Published to global heartbeat topic
- **Errors**: Published to both device state topic and global heartbeat topic

## Topic Structure

### Device Topics

Each device has a base topic configured in `pfx.ini`:

```
{baseTopic}/commands   # Incoming commands
{baseTopic}/state      # Outgoing state updates
{baseTopic}/events     # Real-time events
{baseTopic}/warnings   # Warnings and errors
```

### Global Topics

```
{heartbeatTopic}       # System heartbeat and global messages
```

### Example Topic Structure

```
paradox/living-room/screen/commands   # Commands to living room screen
paradox/living-room/screen/state      # State from living room screen
paradox/living-room/screen/events     # Event notifications
paradox/living-room/screen/warnings   # Warnings and errors
paradox/living-room/lights/commands   # Commands to living room lights
paradox/devices                       # Global heartbeat topic
```

## Message Formats

### Command Message Format

All commands must be valid JSON with a required `command` field:

```json
{
  "command": "commandName",
  "parameter1": "value1",
  "parameter2": "value2"
}
```

### Status Message Format

Status messages include device state and operational information:

```json
{
  "timestamp": "2025-07-12T10:30:00.000Z",
  "device": "living-room-screen",
  "status": "playing_video",
  "currentImage": null,
  "currentVideo": "/media/intro.mp4",
  "currentAudio": null,
  "videoQueueLength": 2,
  "audioQueueLength": 0
}
```

### Heartbeat Message Format

System heartbeat messages:

```json
{
  "timestamp": "2025-07-12T10:30:00.000Z",
  "application": "pfx",
  "device_name": "media-controller-01",
  "ip_address": "192.168.1.150",
  "status": "online",
  "uptime": 3600.5
}
```

**Fields:**

- `timestamp`: ISO 8601 timestamp when heartbeat was generated
- `application`: Always "pfx"
- `device_name`: Device name from global DEVICE_NAME configuration
- `ip_address`: Current IP address of the system
- `status`: System status ("online", "offline", "error")
- `uptime`: System uptime in seconds

## Event Publishing

PFX publishes real-time events for all media completion and command validation activities. Events are published to dedicated event and warning topics for external system integration.

### Event Topics

Each device publishes events to these topics:

```
{baseTopic}/events     # Real-time events and notifications
{baseTopic}/warnings   # Warning and error messages
```

### Command Validation Events

All MQTT commands are validated and publish events indicating their processing status:

**Valid Command Event:**
```json
{
  "timestamp": "2025-09-07T12:00:00.000Z",
  "type": "command",
  "command": "playVideo",
  "status": "valid",
  "zone": "screen:mirror-hdmi0"
}
```

**Invalid Command Event:**
```json
{
  "timestamp": "2025-09-07T12:00:00.000Z",
  "type": "command",
  "command": "invalidCommand",
  "status": "invalid",
  "error": "Unknown command: invalidCommand",
  "zone": "screen:mirror-hdmi0"
}
```

**Command Execution Events:**
```json
{
  "timestamp": "2025-09-07T12:00:00.000Z",
  "type": "command",
  "command": "playVideo",
  "status": "executed",
  "file": "intro.mp4",
  "zone": "screen:mirror-hdmi0"
}
```

### Media Completion Events

Media completion events are published when playback naturally ends (not when stopped manually):

**Speech Completion Event:**
```json
{
  "timestamp": "2025-09-07T12:00:00.000Z",
  "type": "speech",
  "state": "ended",
  "file": "hint1.wav",
  "zone": "screen:mirror-hdmi0"
}
```

**Background Music Completion Event:**
```json
{
  "timestamp": "2025-09-07T12:00:00.000Z",
  "type": "background",
  "state": "ended",
  "file": "ambient.mp3",
  "zone": "screen:mirror-hdmi0"
}
```

**Note:** Video completion events are not published as videos are typically managed by external systems. Audio effects (playAudioFX) do not publish completion events per design requirements.

### Warning and Error Events

Warnings and errors are published to both `/events` and `/warnings` topics:

**Warning Event:**
```json
{
  "timestamp": "2025-09-07T12:00:00.000Z",
  "type": "warning",
  "level": "INFO",
  "message": "File not found: missing.mp3",
  "zone": "screen:mirror-hdmi0"
}
```

**Error Event:**
```json
{
  "timestamp": "2025-09-07T12:00:00.000Z",
  "type": "error",
  "level": "ERROR",
  "message": "MPV process crashed",
  "zone": "screen:mirror-hdmi0"
}
```

### Event Message Level Control

The `message_level` configuration setting controls which events are published:

```ini
[global]
message_level = INFO  # Publish INFO level events only (default)
# message_level = DEBUG  # Publish both INFO and DEBUG level events
```

- **INFO level**: Command validation, media completion, and important warnings
- **DEBUG level**: All INFO events plus detailed operational messages

### Event Publishing Examples

**Subscribe to all events for a zone:**
```bash
mosquitto_sub -t "paradox/houdini/mirror/events"
```

**Subscribe to warnings for all zones:**
```bash
mosquitto_sub -t "paradox/+/+/warnings"
```

**Monitor command validation:**
```bash
mosquitto_sub -t "paradox/houdini/mirror/events" | grep '"type": "command"'
```

**Monitor media completion:**
```bash
mosquitto_sub -t "paradox/houdini/mirror/events" | grep '"state": "ended"'
```

## Multi-Zone Audio

ParadoxFX supports independent audio content across multiple physical outputs, enabling true multi-zone audio experiences. Each zone can play different background music, sound effects, and speech simultaneously.

### Audio Zone Architecture

**Supported Zones:**
- **screen0**: HDMI 1 output (alsa/plughw:0)
- **screen1**: HDMI 2 output (alsa/plughw:1) 
- **headphones**: Analog output (pulse/alsa_output.platform-fe00b840.mailbox.stereo-fallback)

**Audio Types per Zone:**
- **background**: Continuous music with looping and volume control
- **effects**: Low-latency sound effects (<50ms response time)
- **speech**: Voice/narration with automatic background music ducking

### Multi-Zone Topic Structure

Multi-zone audio uses a hierarchical topic structure:

```
pfx/{zone}/{audioType}/{action}
```

**Examples:**
```
pfx/screen0/background/play     # Play background music on Screen 0
pfx/screen1/effects/trigger     # Trigger sound effect on Screen 1
pfx/headphones/speech/say       # Play speech on headphones
pfx/screen0/background/volume   # Adjust Screen 0 background volume
```

### Multi-Zone Commands

#### Background Music Control

**Play Background Music:**
```json
Topic: pfx/{zone}/background/play
Payload: {
  "file": "/path/to/background_music.mp3"
}
```

**Adjust Background Volume:**
```json
Topic: pfx/{zone}/background/volume
Payload: {
  "level": 70
}
```

**Stop Background Music:**
```json
Topic: pfx/{zone}/background/stop
Payload: {}
```

#### Sound Effects

**Trigger Sound Effect:**
```json
Topic: pfx/{zone}/effects/trigger
Payload: {
  "file": "/path/to/sound_effect.wav"
}
```

#### Speech/Narration

**Play Speech:**
```json
Topic: pfx/{zone}/speech/say
Payload: {
  "file": "/path/to/speech.mp3",
  "duckBackground": true,
  "duckLevel": 40
}
```

### Multi-Zone Examples

**Independent Background Music:**
```bash
# Different music on each zone
mosquitto_pub -t "pfx/screen0/background/play" -m '{"file": "/media/classical.mp3"}'
mosquitto_pub -t "pfx/screen1/background/play" -m '{"file": "/media/jazz.mp3"}'
mosquitto_pub -t "pfx/headphones/background/play" -m '{"file": "/media/ambient.mp3"}'

# Different volumes per zone
mosquitto_pub -t "pfx/screen0/background/volume" -m '{"level": 100}'
mosquitto_pub -t "pfx/screen1/background/volume" -m '{"level": 60}'
mosquitto_pub -t "pfx/headphones/background/volume" -m '{"level": 30}'
```

**Zone-Specific Sound Effects:**
```bash
# Button click on Screen 0
mosquitto_pub -t "pfx/screen0/effects/trigger" -m '{"file": "/media/button_click.wav"}'

# Alert sound on Screen 1
mosquitto_pub -t "pfx/screen1/effects/trigger" -m '{"file": "/media/alert.wav"}'

# Notification on headphones
mosquitto_pub -t "pfx/headphones/effects/trigger" -m '{"file": "/media/notification.wav"}'
```

**Speech with Background Ducking:**
```bash
# Speech on Screen 0 with background music ducking
mosquitto_pub -t "pfx/screen0/speech/say" -m '{"file": "/media/instructions.mp3", "duckBackground": true, "duckLevel": 20}'
```

## Screen/Media Commands

Screen devices handle image display, video playback, and audio playback.

### Queue Inspection

* `videoQueue`
  Return current video queue. Publishes an event with field `video_queue` (array of pending media filenames).

* `speechQueue`
  Return current speech queue. Publishes an event with field `speech_queue` (array of pending speech file paths).

### Screen Power Management

* `sleepScreen`
  Turn off the display (monitor goes to sleep). Publishes event `screen_sleep`.

* `wakeScreen`
  Wake the display (monitor on). Publishes event `screen_wake`.

### System Control

* `reboot`
  Reboot the host machine running PFX (requires sudo privileges). Publishes `command_completed` event.

* `shutdown`
  Shutdown the host machine running PFX immediately (requires sudo privileges). Publishes `command_completed` event.

* `killPfx`
  Gracefully terminate the PFX process via SIGTERM. Publishes `command_completed` event.

### Media Playback & Stop Commands (Fade Support)

The following stop-related commands accept an optional `fadeTime` (seconds) parameter. When provided and greater than 0, audio (and now video audio) will fade smoothly to silence before stopping. For composite commands the same `fadeTime` is applied to all supported media types.

Supported fade-capable commands:

| Command        | Zone Type        | Media Affected                          | Notes |
|----------------|------------------|------------------------------------------|-------|
| `stopBackground` | audio, screen   | Background music                         | Fades background music volume to 0 then stops |
| `stopSpeech`     | audio, screen   | Active speech playback / queue           | Fades active speech channel before clearing queue |
| `stopAudio`      | screen, audio   | Background + speech                      | Applies fade to both where active |
| `stopVideo`      | screen          | Video playback audio track               | Fades video audio then stops video (image resets) |
| `stopAll`        | screen          | Video (audio), background, speech        | Applies unified fade to each active medium |

Example (fade out all media over 3 seconds):
```json
{ "command": "stopAll", "fadeTime": 3 }
```

Example (fade only background music over 2 seconds):
```json
{ "command": "stopBackground", "fadeTime": 2 }
```

If `fadeTime` is omitted or 0, the stop is immediate (legacy behavior). Video fading falls back to immediate stop if the underlying player does not support runtime volume adjustments.

### Image Commands

#### setImage

Display an image on the screen.

**Format:**

```json
{
  "command": "setImage",
  "image": "image.jpg"
}
```

**Parameters:**

- `Image` (required): Filename or subdirectory path relative to device MEDIA_DIR
- Supported formats: JPEG, PNG, GIF, BMP, TIFF, WebP

**Examples:**

```json
{
  "command": "setImage",
  "image": "lobby.jpg"
}
```

```json
{
  "command": "setImage",
  "image": "backgrounds/lobby.jpg"
}
```

**Note:** Image paths are relative to the device's configured MEDIA_DIR. For example, if MEDIA_DIR is `/opt/media/room1/`, then "lobby.jpg" resolves to `/opt/media/room1/lobby.jpg` and "backgrounds/lobby.jpg" resolves to `/opt/media/room1/backgrounds/lobby.jpg`.

### Video Commands

#### playVideo

Play a video file with optional volume control and background ducking.

**Format:**

```json
{
  "command": "playVideo",
  "video": "intro.mp4",
  "volumeAdjust": -10,
  "ducking": -24,
  "loop": false
}
```

**Parameters:**

- `Video` (required): Filename or subdirectory path relative to device MEDIA_DIR
- `VolumeAdjust` (optional): Volume adjustment percentage (-100 to +100), applied to device base VOLUME setting
- `Channel` (optional): Audio channel routing
- `Ducking` (optional): Background music volume reduction in units. Use negative values only (e.g., -24 to reduce by 24 units). Default: -24 for videos, 0 for images. Positive values are ignored with warning.
- `loop` (optional): Boolean flag to enable continuous looping. Default: false. When true, video will restart automatically after natural end until stopped with stopVideo or new media is queued. **⚠️ KNOWN BUG:** Loop currently hangs after 1-2 iterations. Use stopVideo to break out of hung loop.

Ducking resolution precedence (highest → lowest):
1. Explicit `ducking` parameter in the command payload
2. Per-zone INI setting (`speech_ducking` / `video_ducking`)
3. Global INI defaults (`speech_ducking` / `video_ducking`) loaded by the config loader
4. Code default (-26 for speech, -24 for video)

**Supported formats:** MP4, AVI, MKV, MOV, WebM

**Examples:**

```json
{
  "command": "playVideo",
  "video": "intro.mp4"
}
```

```json
{
  "command": "playVideo",
  "video": "room1/intro.mp4",
  "volumeAdjust": 20,
  "ducking": -30
}
```

```json
{
  "command": "playVideo",
  "video": "background.mp4",
  "loop": true
}
```

**Note:** Video paths are relative to the device's MEDIA_DIR. VolumeAdjust modifies the base VOLUME setting from the device configuration. For example, if device VOLUME is 80 and VolumeAdjust is -10, the effective volume will be 72 (80 * 0.90).

**Loop Behavior:** When `loop: true` is specified, the video will restart automatically after natural end. Loop is cancelled automatically if new media is queued. Use stopVideo command to manually stop a looping video. **⚠️ KNOWN BUG:** Loop currently hangs after 1-2 iterations and requires stopVideo to break out.

#### stopVideo

Stop current video playback.

**Format:**

```json
{
  "command": "stopVideo"
}
```

### Browser/Clock Commands

Generic browser control to show/hide a Chromium-based UI (e.g., the clock at http://localhost/clock/). These commands are zone-aware and will target the screen zone’s display.

#### enableBrowser

Launch the browser on the target screen and optionally focus it.

Format:

```json
{
  "command": "enableBrowser",
  "url": "http://localhost/clock/",
  "screen": 1,
  "focus": true
}
```

Parameters:
- url (optional): Page to open. Default: http://localhost/clock/
- screen (optional): Screen index or identifier; if omitted, use zone’s configured screen.
- focus (optional): Bring window to front. Default: true.

#### disableBrowser

Terminate the browser instance managed by this zone.

Format:

```json
{ "command": "disableBrowser" }
```

#### showBrowser

Bring the browser to the front.

Format:

```json
{
  "command": "showBrowser"
}
```

Parameters:
- None. This is pure window management and does not publish clock fade commands.

#### hideBrowser

Hide the browser and return focus to MPV.

Format:

```json
{
  "command": "hideBrowser"
}
```

Parameters:
- None. This is pure window management and does not publish clock fade commands.



### Screen Power Management Commands

ParadoxFX provides intelligent screen power management that balances energy efficiency with responsive operation.

#### sleepScreen

Put all connected displays into low-power sleep mode using DPMS (Display Power Management Signaling).

**Format:**

```json
{
  "command": "sleepScreen"
}
```

**Behavior:**
- **Screen zones only**: Sends DPMS sleep signal to the target monitor for this zone
- **Audio zones**: Command is ignored (no screen to control)
- **Video playback restriction**: Sleep commands are ignored while video is actively playing
- Sleep is only applied when video is paused or an image is displayed
- Maintains system state and media queues
- Display will show "No Signal" or enter standby mode

**Examples:**

```json
{
  "command": "sleepScreen"
}
```

#### wakeScreen

Wake the zone's display from sleep mode and restore default display state.

**Format:**

```json
{
  "command": "wakeScreen"
}
```

**Behavior:**
- **Screen zones only**: Sends DPMS wake signal to the target monitor for this zone
- **Audio zones**: Command is ignored (no screen to control)
- Display returns to active state immediately
- If no media is currently playing, display shows the configured default image

**Examples:**

```json
{
  "command": "wakeScreen"
}
```

**Note:** Most media commands (`setImage`, `playVideo`) automatically wake sleeping displays, making explicit `wakeScreen` commands typically unnecessary during normal operation. Sleep commands are ignored during active video playbook to prevent interruption.

### Browser Management Commands

ParadoxFX supports browser integration for displaying web content alongside multimedia. Browser management provides **pure window focus control** with **process lifecycle management**.

#### enableBrowser

⚠️ **Launch browser process in foreground**. Browser will be visible until manually hidden.

```json
{
  "command": "enableBrowser",
  "url": "http://localhost/clock/"
}
```

**Parameters:**
- `url` (optional): Initial URL to load (default: `http://localhost/clock/`)

**Behavior:** 
- Launches Chromium process with specified URL
- ⚠️ **Browser window appears in foreground initially**
- Must manually send `hideBrowser` after page loads (typically 10 seconds)
- Uses isolated profile: `/tmp/pfx-browser-{zoneName}/`

> **💡 Scheduling Tip**: To launch hidden, send `enableBrowser` followed by `hideBrowser` with a 10-second delay to allow page loading.

#### disableBrowser

Terminate browser process and clean up all resources.

```json
{
  "command": "disableBrowser"
}
```

**Behavior:**
- Terminates browser process completely
- Cleans up temporary profile directory
- Returns focus to MPV content

#### showBrowser

**Pure window management**: Bring browser window to front using window focus switching.

```json
{
  "command": "showBrowser"
}
```

**Behavior:**
- Uses `xdotool windowactivate` to bring browser to front
- MPV window is pushed behind browser
- **No fade effects or clock commands** - pure window layering
- Browser must be enabled first with `enableBrowser`

#### hideBrowser

**Pure window management**: Return focus to MPV by bringing MPV window to front.

```json
{
  "command": "hideBrowser"
}
```

**Behavior:**
- Uses `xdotool windowactivate` to bring MPV to front
- Browser window is pushed behind MPV (still running, just hidden)
- **No fade effects or clock commands** - pure window layering
- Browser process continues running in background

### Browser Window Management Architecture

Browser management provides **pure window focus control** with clear separation of concerns:

**Process Lifecycle:**
- `enableBrowser`: Launch browser process (⚠️ **visible in foreground initially**)
- `disableBrowser`: Terminate browser process completely

**Window Focus Control:**
- `showBrowser`: Bring browser window to front (pure window management)
- `hideBrowser`: Bring MPV window to front (pure window management)

**Key Design Principles:**
- **No automatic fade effects**: show/hide commands perform only window switching
- **⚠️ Foreground launch**: enableBrowser starts browser visible in foreground - manually hide after page loads
- **External fade control**: Clock fade effects managed separately via clock MQTT commands
- **Proven technique**: Uses Option 6 (`xdotool windowactivate`) for reliable window switching

> **📝 Note**: `enableBrowser` will launch the browser in front. If you want it hidden, you must send a `hideBrowser` command manually after the page has finished loading. Generally, 10 seconds should be more than enough for most pages if you want to schedule a `hideBrowser` command to be sent after the `enableBrowser` command.

**Clock Integration (Separate):**
If you want clock fade effects with browser switching, send separate commands:

```bash
# Manual fade sequence example
mosquitto_pub -t "paradox/houdini/clock/commands" -m '{"command": "fadeOut"}'
mosquitto_pub -t "paradox/zone1/commands" -m '{"command": "showBrowser"}'
mosquitto_pub -t "paradox/houdini/clock/commands" -m '{"command": "fadeIn"}'
```
4. Update zone status with focus and content tracking

**Clock MQTT Topic**: `paradox/houdini/clock/commands`

#### verifyBrowser

Check browser health and restart if needed (automated health monitoring).

**Format:**

```json
{
  "command": "verifyBrowser"
}
```

**Behavior:**
- Requests current browser state from the PFX zone
- Waits briefly (500ms) for state update to arrive
- If browser is not running or responding, automatically restarts it
- Uses the previously configured URL or zone default
- Useful for sequence-based reliability checks and automated recovery

**Use Cases:**
- Sequence steps that need to ensure browser is healthy before proceeding
- Automated recovery from browser crashes during game sequences
- System initialization and startup verification
- Periodic health checks in long-running games

**Status Reporting**: Browser status is included in zone status updates:

```json
{
  "focus": "chromium",
  "content": "http://localhost/clock/",
  "browser": {
    "enabled": true,
    "url": "http://localhost/clock/",
    "process_id": 12345,
    "window_id": "0x123456"
    "foreground": true
  }
}
```

### System / State Message Schema (Full)

All PFX devices publish a `status` message to their `{baseTopic}/state` topic. The message is JSON and always includes a timestamp, zone/device identifier and a `current_state` object. For screen zones the `current_state` contains additional fields for media and browser tracking. Below is the canonical schema and description of each field.

Top-level fields
- `timestamp` (string, ISO 8601): When the state snapshot was generated
- `zone` (string): Zone identifier (e.g., `screen:mirror-hdmi0`)
- `type` (string): Message type, typically `status`
- `current_state` (object): Detailed runtime state for the zone
- `mpv_instances` (object): Status for MPV player instances (media/background/speech)
- `volume` (number): Current effective volume for the zone (0-100)
- `status` (string): High-level human readable state (e.g., `idle`, `playing_video`, `showing_image`)

`current_state` fields (common)
- `status` (string): One of `idle`, `showing_image`, `playing_video`, `playing_audio`, `paused`, `error`, `starting`
- `volume` (number): Configured base volume for the zone (0-100)
- `lastCommand` (string|null): Last command processed by the zone (if any)
- `errors` (array): List of error objects or messages
- `currentImage` (string|null): Image filename currently displayed
- `currentVideo` (string|null): Video filename currently playing
- `backgroundMusic` (string|null): Background music file currently playing
- `videoQueueLength` (number): Number of items waiting in the video queue
- `audioQueueLength` (number): Number of items waiting in the audio/effects queue
- `speechQueueLength` (number): Number of items waiting in the speech queue
- `screenAwake` (boolean): Whether the screen/display is awake (DPMS state)
- `focus` (string): `mpv`, `chromium`, or `none` — indicates which window currently has focus
- `content` (string|null): Short description or URL of the content currently in focus

`current_state.browser` (object - screens only)
- `enabled` (boolean): Whether the managed browser process is running
- `url` (string|null): URL currently loaded in the browser
- `process_id` (number|null): PID of the chromium process if running
- `window_id` (string|null): Window identifier used by the WindowManager (may be hex like `0x200001` or decimal)
- `foreground` (boolean): NEW — true if the browser window is currently the foreground (active) window on the display. Computed by comparing the browser `window_id` to the active window reported by the WindowManager; falls back to `focus === 'chromium'` if WM APIs are unavailable

`mpv_instances` (object)
- `media` (object): `{ status: 'idle'|'active'|'playing', file: string|null, socket_path: string }`
- `background` (object): `{ status: 'idle'|'active', file: string|null, socket_path: string }`
- `speech` (object): `{ status: 'idle'|'active', file: string|null, socket_path: string }`

Examples
```
paradox/houdini/mirror/state {
  "timestamp": "2025-08-22T19:27:08.951Z",
  "zone": "screen:mirror-hdmi0",
  "type": "status",
  "current_state": {
    "status": "showing_image",
    "volume": 100,
    "lastCommand": "enableBrowser",
    "errors": [],
    "currentImage": "black_screen.png",
    "currentVideo": null,
    "backgroundMusic": null,
    "videoQueueLength": 0,
    "audioQueueLength": 0,
    "speechQueueLength": 0,
    "screenAwake": true,
    "focus": "none",
    "content": "none",
    "browser": {
      "enabled": true,
      "url": "http://localhost/clock/index.html",
      "process_id": 60891,
      "window_id": "33554433",
      "foreground": true
    }
  },
  "mpv_instances": {
    "media": { "status": "idle", "file": "black_screen.png", "socket_path": "/tmp/mpv-mirror-media.sock" },
    "background": { "status": "idle", "file": null, "socket_path": "/tmp/mpv-mirror-background.sock" },
    "speech": { "status": "idle", "file": null, "socket_path": "/tmp/mpv-mirror-speech.sock" }
  },
  "volume": 100,
  "status": "showing_image"
}
```

This schema is authoritative for all screen zones. Non-screen devices (lights, relays, audio-only zones) publish simplified `current_state` objects containing the applicable fields (e.g., `status`, `volume`, `errors`, and device-specific keys).

If you want me to also add machine-readable JSON Schema for these messages (for validation or UI generation), I can add that to the docs as a follow-up.

#### skip

Skip to next video in queue.

**Format:**

```json
{
  "command": "skip"
}
```

### Audio Commands

#### playAudio

Play an audio file with optional volume control.

**Format:**

```json
{
  "command": "playAudio",
  "audio": "background.mp3",
  "volumeAdjust": -20
}
```

**Parameters:**

- `Audio` (required): Filename or subdirectory path relative to device MEDIA_DIR
- `VolumeAdjust` (optional): Volume adjustment percentage (-100 to +100), applied to device base VOLUME setting
- `Channel` (optional): Audio channel routing

**Supported formats:** MP3, WAV, FLAC, OGG, AAC, OPUS

**Examples:**

```json
{
  "command": "playAudio",
  "audio": "ambient.mp3"
}
```

```json
{
  "command": "playAudio",
  "audio": "music/background.mp3",
  "volumeAdjust": 15
}
```

**Note:** Audio paths are relative to the device's MEDIA_DIR. VolumeAdjust modifies the base VOLUME setting from the device configuration.

#### playAudioFX

Play audio effects (supports polyphonic playback).

**Format:**

```json
{
  "command": "playAudioFX",
  "audio": "effects/explosion.wav",
  "type": "one-shot",
  "volumeAdjust": 10
}
```

**Parameters:**

- `Audio` (required): Filename or subdirectory path relative to device MEDIA_DIR
- `Type` (optional): Playback type ("one-shot", "loop"), default: "one-shot"
- `VolumeAdjust` (optional): Volume adjustment percentage (-100 to +100), applied to device base VOLUME setting

**Examples:**

```json
{
  "command": "playAudioFX",
  "audio": "doorbell.wav"
}
```

```json
{
  "command": "playAudioFX",
  "audio": "fx/ambient_loop.wav",
  "type": "loop",
  "volumeAdjust": -30
}
```

#### stopAudio

Stop all audio playback (background music and speech) with optional fade-out.

**Format:**

```json
{
  "command": "stopAudio",
  "fadeTime": 2.5
}
```

**Parameters:**

- `fadeTime` (optional): Fade-out duration in seconds (0.1-30.0). If not specified or 0, stops immediately.

**Behavior:**
- Stops background music playback (with fade if specified)
- Clears all queued speech items immediately
- Publishes `{ all_audio_stopped: true, fade_time: fadeTime }` event
- Logs the action with fade time information

**Examples:**

```json
{
  "command": "stopAudio"
}
```

```json
{
  "command": "stopAudio",
  "fadeTime": 3.0
}
```

**Note:** Unlike `stopAll`, this command only affects audio components (background music and speech) and does not stop video playback.

## Multi-Zone Audio Commands

Multi-zone audio devices support background music, speech, and sound effects with volume control and ducking capabilities.

### Topic Structure for Audio Zones

```
paradox/zone1/audio/commands    # Commands to audio zone 1
paradox/zone1/audio/status     # Status from audio zone 1
```

### Background Music Commands

#### playBackground

Play background music with seamless looping and volume control.

**Format:**

```json
{
  "command": "playBackground",
  "audio": "ambient/forest.mp3",
  "volume": 70
}
```

**Parameters:**

- `Audio` (required): Filename or subdirectory path relative to device MEDIA_DIR
- `Volume` (optional): Volume level (0-100), defaults to device configuration

**Features:**
- Seamless looping for continuous playback
- Real-time volume control for ducking during speech
- Persistent playback instance for smooth audio experience

**Examples:**

```json
{
  "command": "playBackground",
  "audio": "ambient.mp3"
}
```

```json
{
  "command": "playBackground",
  "audio": "music/mystical.mp3",
  "volume": 60
}
```

#### pauseBackground

Pause background music playback.

**Format:**

```json
{
  "command": "pauseBackground"
}
```

#### resumeBackground

Resume background music playback.

**Format:**

```json
{
  "command": "resumeBackground"
}
```

#### stopBackground

Stop background music playback with optional fade-out.

**Format:**

```json
{
  "command": "stopBackground",
  "fadeTime": 2.5
}
```

**Parameters:**

- `fadeTime` (optional): Fade-out duration in seconds (0.1-30.0). If not specified or 0, stops immediately.

**Examples:**

```json
{
  "command": "stopBackground"
}
```

```json
{
  "command": "stopBackground",
  "fadeTime": 3.0
}
```

### Speech Commands

#### playSpeech

Play speech audio with automatic background music ducking.

**Format:**

```json
{
  "command": "playSpeech",
  "audio": "hint1.wav",
  "volume": 85
}
```

**Parameters:**

- `Audio` (required): Speech file relative to device MEDIA_DIR
- `Volume` (optional): Volume level 0-100, default: 80

#### stopSpeech

Stop current speech playback.

**Format:**

```json
{
  "command": "stopSpeech"
}
```

### Sound Effects Commands

#### playAudioFX / playSoundEffect

Play sound effect.

**Format:**

```json
{
  "command": "playAudioFX",
  "audio": "click.wav",
  "volume": 75
}
```

**Parameters:**

- `Audio` (required): Effect file relative to device MEDIA_DIR
- `Volume` (optional): Volume level 0-100, default: 80

### Queue Inspection

#### videoQueue

Return current video queue. Publishes an event with field `video_queue` (array of pending media filenames).

**Format:**

```json
{
  "command": "videoQueue"
}
```

#### speechQueue

Return current speech queue. Publishes an event with field `speech_queue` (array of pending speech file paths).

**Format:**

```json
{
  "command": "speechQueue"
}
```

#### audioQueue

Return current audio queue.

**Format:**

```json
{
  "command": "audioQueue"
}
```

#### clearQueue

Clear video or audio queue (context-dependent).

**Format:**

```json
{
  "command": "clearQueue"
}
```

### Configuration

#### getConfig

Get current device configuration.

**Format:**

```json
{
  "command": "getConfig"
}
```

### Sound Effects Commands

#### playEffect

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

#### stopAllEffects

Stop all currently playing sound effects.

**Format:**

```json
{
  "command": "playAudioFX",
  "audio": "click.wav",
  "volume": 75
}
```

**Parameters:**

- `Audio` (required): Effect file relative to device MEDIA_DIR
- `Volume` (optional): Volume level 0-100, default: 80

### Queue Inspection

```json
{
  "command": "playBackground",
  "audio": "ambient/forest.mp3",
  "volume": 70
}
```

**Parameters:**

- `Audio` (required): Filename or subdirectory path relative to device MEDIA_DIR
- `Volume` (optional): Volume level (0-100), defaults to device configuration

**Features:**
- Seamless looping for continuous playback
- Real-time volume control for ducking during speech
- Persistent playback instance for smooth audio experience

**Examples:**

```json
{
  "command": "playBackground",
  "audio": "ambient.mp3"
}
```

```json
{
  "command": "playBackground",
  "audio": "music/mystical.mp3",
  "volume": 60
}
```

#### pauseBackground

Pause background music playback.

**Format:**

```json
{
  "command": "pauseBackground"
}
```

#### resumeBackground

Resume background music playback.

**Format:**

```json
{
  "command": "resumeBackground"
}
```

#### stopBackground

Stop background music playback with optional fade-out.

**Format:**

```json
{
  "command": "stopBackground",
  "fadeTime": 2.5
}
```

**Parameters:**

- `fadeTime` (optional): Fade-out duration in seconds (0.1-30.0). If not specified or 0, stops immediately.

**Examples:**

```json
{
  "command": "stopBackground"
}
```

```json
{
  "command": "stopBackground",
  "fadeTime": 3.0
}
```

#### setBackgroundMusicVolume

Set background music volume in real-time.

**Format:**

```json
{
  "command": "setBackgroundMusicVolume",
  "volume": 40
}
```

**Parameters:**

- `Volume` (required): Volume level (0-100)

**Use case:** Perfect for ducking background music during speech without stopping playback.

#### playSpeech

Play speech audio with automatic background music ducking.

**Format:**

```json
{
  "command": "playSpeech",
  "audio": "voice/instructions.mp3",
  "volume": 90,
  "ducking": -26
}
```

**Parameters:**

- `Audio` (required): Filename or subdirectory path relative to device MEDIA_DIR
- `Volume` (optional): Volume level (0-100), defaults to device configuration
- `Ducking` (optional): Background music volume reduction in units. Use negative values only (e.g., -26 to reduce by 26 units). Default: -26. Positive values are ignored with warning.

**Features:**
- Automatic background music ducking during speech using the precedence chain described above
- Queue-based system for multiple speech items
- Deterministic unduck: speech removes only its own duck when the speech item completes (no timeout-based unduck)

**Manual duck/unduck commands**

You can apply or remove manual ducks at runtime using the `duck` and `unduck` commands. Manual ducks are tracked by a generated `duck_id` and are resolved by the same per-zone duck registry (most-negative wins).

Manual duck example (apply -50 immediately):

```json
{
  "command": "duck",
  "ducking": -50
}
```

Manual unduck examples:

Remove a specific manual duck by id:

```json
{
  "command": "unduck",
  "duck_id": "manual-175562..."
}
```

Remove all manual ducks:

```json
{
  "command": "unduck"
}
```

Manual unduck removes the specified duck(s) immediately and the zone recalculates the active duck level (no timeout-based restoration).

**Examples:**

```json
{
  "command": "playSpeech",
  "audio": "hints/clue1.mp3"
}
```

```json
{
  "command": "playSpeech",
  "audio": "narration/intro.mp3",
  "volume": 95,
  "ducking": -10
}
```

#### clearSpeechQueue

Clear all queued speech audio and stop current speech.

**Format:**

```json
{
  "command": "clearSpeechQueue"
}
```

#### pauseSpeech

Pause current speech playback.

**Format:**

```json
{
  "command": "pauseSpeech"
}
```

#### resumeSpeech

Resume current speech playback.

**Format:**

```json
{
  "command": "resumeSpeech"
}
```

#### stopSpeech

Stop current speech playback with optional fade-out.

**Format:**

```json
{
  "command": "stopSpeech",
  "fadeTime": 1.5
}
```

**Parameters:**

- `fadeTime` (optional): Fade-out duration in seconds (0.1-30.0). If not specified or 0, stops immediately.

**Examples:**

```json
{
  "command": "stopSpeech"
}
```

```json
{
  "command": "stopSpeech",
  "fadeTime": 2.0
}
```

#### skipSpeech

Skip current speech and move to next in queue.

**Format:**

```json
{
  "command": "skipSpeech"
}
```

#### stopAudio

Stop all audio playback (background music, speech, and sound effects) with optional fade-out.

**Format:**

```json
{
  "command": "stopAudio",
  "fadeTime": 2.0
}
```

**Parameters:**

- `fadeTime` (optional): Fade-out duration in seconds (0.1-30.0) for background music and speech. Sound effects stop immediately. If not specified or 0, stops all audio immediately.

**Features:**
- Comprehensive audio control stopping all audio channels
- Configurable fade-out for background music and speech
- Immediate stop for sound effects (no fade)
- Useful for sequence management and emergency stops

**Examples:**

```json
{
  "command": "stopAudio"
}
```

```json
{
  "command": "stopAudio",
  "fadeTime": 3.0
}
```

#### playSoundEffect

Play sound effects with ultra-low latency and parallel playback.

**Format:**

```json
{
  "command": "playSoundEffect",
  "audio": "effects/button_click.wav",
  "volume": 100
}
```

**Parameters:**

- `Audio` (required): Filename or subdirectory path relative to device MEDIA_DIR
- `Volume` (optional): Volume level (0-100), defaults to device configuration

**Features:**
- Sub-50ms latency for instant feedback
- Multiple effects can play simultaneously
- Fire-and-forget operation for maximum performance
- Optimized for button clicks, alerts, and UI feedback

**Examples:**

```json
{
  "command": "playSoundEffect",
  "audio": "fx/click.wav"
}
```

```json
{
  "command": "playSoundEffect",
  "audio": "feedback/success.wav",
  "volume": 80
}
```

### Advanced Commands

#### transition

Play a video followed by an image.

**Format:**

```json
{
  "command": "transition",
  "video": "transitions/intro.mp4",
  "image": "backgrounds/final.jpg",
  "channel": "default"
}
```

**Parameters:**

- `Video` (required): Video filename or subdirectory path relative to device MEDIA_DIR
- `Image` (required): Image filename or subdirectory path relative to device MEDIA_DIR
- `Channel` (optional): Audio channel routing

**Example:**

```json
{
  "command": "transition",
  "video": "intro.mp4",
  "image": "lobby.jpg"
}
```

#### stopAll

Stop all media playback (video, audio, effects) with optional fade-out for audio components.

**Format:**

```json
{
  "command": "stopAll",
  "fadeTime": 2.0
}
```

**Parameters:**

- `fadeTime` (optional): Fade-out duration in seconds (0.1-30.0) for background music and speech. Video and effects stop immediately. If not specified or 0, stops all immediately.

**Examples:**

```json
{
  "command": "stopAll"
}
```

```json
{
  "command": "stopAll",
  "fadeTime": 3.0
}
```

### Queue Management

#### videoQueue

Get current video queue status.

**Format:**

```json
{
  "command": "videoQueue"
}
```

#### audioQueue

Get current audio queue status.

**Format:**

```json
{
  "command": "audioQueue"
}
```

#### clearQueue

Clear video or audio queue (context-dependent).

**Format:**

```json
{
  "command": "clearQueue"
}
```

### Configuration

#### getConfig

Get current device configuration.

**Format:**

```json
{
  "command": "getConfig"
}
```

## Light Commands

Light devices control individual lights and light groups.

### Basic Light Control

#### setColor

Set light color and brightness.

**Format:**

```json
{
  "command": "setColor",
  "color": "#FF6400",
  "brightness": 75
}
```

**Parameters:**

- `Color` (required): Hex color code or RGB object
- `Brightness` (optional): Brightness level 0-100

#### on

Turn light on.

**Format:**

```json
{
  "command": "on",
  "brightness": 100
}
```

#### off

Turn light off.

**Format:**

```json
{
  "command": "off"
}
```

### Light Group Control

#### setGroupColor

Set color for all lights in group.

**Format:**

```json
{
  "command": "setGroupColor",
  "color": {"r": 255, "g": 100, "b": 0},
  "brightness": 80,
  "lights": ["light1", "light2"]
}
```

#### fade

Fade lights to target brightness over time.

**Format:**

```json
{
  "command": "fade",
  "brightness": 50,
  "duration": 30000
}
```

**Parameters:**

- `Brightness` (required): Target brightness 0-100
- `Duration` (required): Fade duration in milliseconds

## Relay Commands

Relay devices control switches, outlets, and other on/off devices.

#### on

Turn relay on.

**Format:**

```json
{
  "command": "on"
}
```

#### off

Turn relay off.

**Format:**

```json
{
  "command": "off"
}
```

#### toggle

Toggle relay state.

**Format:**

```json
{
  "command": "toggle"
}
```

#### pulse

Pulse relay (on, then off after delay).

**Format:**

```json
{
  "command": "pulse",
  "duration": 5000
}
```

**Parameters:**

- `Duration` (optional): Pulse duration in milliseconds, default: 1000

## System Messages

### Heartbeat Messages

Published periodically to the global heartbeat topic:

```json
{
  "timestamp": "2025-07-12T10:30:00.000Z",
  "application": "pfx",
  "device_name": "media-controller-01",
  "ip_address": "192.168.1.150",
  "status": "online",
  "uptime": 3600.5
}
```

### Event Messages

Published for significant system events:

```json
{
  "timestamp": "2025-07-12T10:30:00.000Z",
  "device": "living-room-screen",
  "type": "event",
  "event_code": "MEDIA_STARTED",
  "message": "Video playback started: intro.mp4",
  "source_topic": "paradox/living-room/screen"
}
```

### Status Updates

Published when device state changes:

```json
{
  "timestamp": "2025-07-12T10:30:00.000Z",
  "device": "living-room-screen",
  "status": "playing_video",
  "currentImage": null,
  "currentVideo": "/media/intro.mp4",
  "currentAudio": null,
  "videoQueueLength": 1,
  "audioQueueLength": 0
}
```

## Error Handling

### Error Message Format

Errors are published to both device status topics and the global heartbeat topic:

```json
{
  "timestamp": "2025-07-12T10:30:00.000Z",
  "device": "living-room-screen",
  "type": "error",
  "error_code": "COMMAND_FAILED",
  "message": "playVideo: File not found: /missing/video.mp4",
  "source_topic": "paradox/living-room/screen"
}
```

### Common Error Codes

- `INVALID_MESSAGE_FORMAT`: Message is not valid JSON or missing Command field
- `COMMAND_FAILED`: Command execution failed
- `FILE_NOT_FOUND`: Media file does not exist
- `UNSUPPORTED_FORMAT`: Media format not supported
- `DEVICE_BUSY`: Device is busy and cannot process command
- `CONFIGURATION_ERROR`: Device configuration is invalid
- `PLAYER_ERROR`: Media player error
- `NETWORK_ERROR`: Network communication error

### Warning Messages

Non-fatal issues are reported as warnings:

```json
{
  "timestamp": "2025-07-12T10:30:00.000Z",
  "device": "living-room-screen",
  "type": "warning",
  "warning_code": "QUEUE_FULL",
  "message": "Video queue is full, removing oldest entry",
  "source_topic": "paradox/living-room/screen"
}
```

## Examples

### Complete Media Playback Sequence

1. **Set background image:**

```bash
mosquitto_pub -h localhost -t "paradox/living-room/screen/commands" \
  -m '{"command": "setImage", "image": "background.jpg"}'
```

2. **Play intro video:**

```bash
mosquitto_pub -h localhost -t "paradox/living-room/screen/commands" \
  -m '{"command": "playVideo", "video": "intro.mp4", "volumeAdjust": -20}'
```

3. **Play background music:**

```bash
mosquitto_pub -h localhost -t "paradox/living-room/screen/commands" \
  -m '{"command": "playAudio", "audio": "ambient.mp3", "volumeAdjust": -40}'
```

4. **Stop all playback:**

```bash
mosquitto_pub -h localhost -t "paradox/living-room/screen/commands" \
  -m '{"command": "stopAll"}'
```

### Light Control Sequence

1. **Turn on lights:**

```bash
mosquitto_pub -h localhost -t "paradox/living-room/lights/commands" \
  -m '{"command": "on", "brightness": 100}'
```

2. **Set warm color:**

```bash
mosquitto_pub -h localhost -t "paradox/living-room/lights/commands" \
  -m '{"command": "setColor", "color": "#FF8C00", "brightness": 75}'
```

3. **Fade to dim:**

```bash
mosquitto_pub -h localhost -t "paradox/living-room/lights/commands" \
  -m '{"command": "fade", "brightness": 25, "duration": 10000}'
```

### Monitoring Status Updates

Subscribe to device status:

```bash
mosquitto_sub -h localhost -t "paradox/+/+/status"
```

Subscribe to all system messages:

```bash
mosquitto_sub -h localhost -t "paradox/devices"
```

## Configuration Reference

Device topics are configured in `pfx.ini`:

```ini
[global]
device_name = media-controller-01
heartbeat_topic = paradox/devices
heartbeat_interval = 30000

[screen:living-room]
type = screen
topic = paradox/living-room/screen
status_topic = paradox/living-room/screen/status
media_dir = /opt/media/living-room
volume = 80

[light:living-room-hue]
type = light
topic = paradox/living-room/lights
controller = hue
```

**Key Configuration Parameters:**

- `device_name`: Unique device identifier included in heartbeat messages
- `media_dir`: Base directory for media files (images, videos, audio)
- `volume`: Base volume level for the device (0-100)

For complete configuration options, see the [Configuration Guide](CONFIGURATION.md).
