# ParadoxFX Multi-Platform Media Control System

## Overview

ParadoxFX (formerly ImageSwitcher) is a comprehensive Node.js application designed to control multi-zone media playback, lighting, and automation devices via MQTT commands. Originally designed for Raspberry Pi single-screen installations, it has evolved to support multiple hardware platforms with advanced multi-zone audio/video capabilities for interactive installations, escape rooms, theaters, and immersive experiences.

## Terminology

- **Physical Device**: The actual hardware running the application (e.g., Raspberry Pi 4, Linux PC)
- **Soft Device/Zone**: Individual controllable endpoints within a physical device (e.g., HDMI-0 port, HDMI-1 port, headphone jack)
- **Multi-Zone**: Multiple independent soft devices operating simultaneously on one physical device
- **Enhanced Audio System**: Three-subsystem architecture (Background Music, Sound Effects, Speech/Narration)

## Supported Hardware Platforms

ParadoxFX supports multiple hardware platforms with optimized configurations for each:

- **Raspberry Pi 3 Model B/B+**: Single HDMI plus headphone jack
- **Raspberry Pi Zero W**: Mini HDMI only
- **Raspberry Pi 4 Model B**: Dual HDMI plus headphone jack
- **Raspberry Pi 5**: Dual HDMI (no analog audio)
- **Generic Linux Machines**: Scalable multi-display configurations

For detailed hardware specifications, performance characteristics, and use cases, see [Appendix A: Hardware Platform Details](#appendix-a-hardware-platform-details).

## Features

### 1. Enhanced Multi-Zone Audio System

ParadoxFX features a comprehensive three-subsystem audio architecture designed for professional installations:

#### **Background Music Subsystem**
- **Purpose**: Continuous ambient audio with seamless looping
- **Management**: Persistent MPV instance with IPC control
- **Features**: Real-time volume control, automatic ducking during speech
- **Latency**: Optimized for smooth transitions and volume changes
- **Use Cases**: Ambient soundscapes, atmospheric music, environmental audio

#### **Sound Effects Subsystem**  
- **Purpose**: Short-duration responsive effects
- **Management**: Fire-and-forget MPV instances for parallel playback
- **Features**: <50ms latency, overlapping effects, instant triggering
- **Performance**: Optimized with --audio-buffer=0.02 --cache=no
- **Use Cases**: Button clicks, alerts, feedback sounds, impact effects

#### **Speech/Narration Subsystem**
- **Purpose**: Voice instructions, hints, and narration
- **Management**: Queue-based system with automatic background music coordination
- **Features**: Automatic ducking, queue management, priority handling
- **Integration**: Coordinates with background music for seamless audio experience
- **Use Cases**: Guided instructions, hints, character voices, announcements

##### Unified Volume & Ducking (Phases 8–9)
Volume resolution precedence (highest → lowest):
1. Command `volume` (absolute 0–200)
2. Command `adjustVolume` (delta -100..+100 % applied to base)
3. Zone base `volume` (INI)

If both are supplied a warning is emitted and `adjustVolume` is ignored.

Ducking applies a single negative percentage `ducking_adjust` to BACKGROUND MUSIC ONLY while any duck trigger is active (speech, video if configured, or manual future hooks). Ducks do not stack. When the last trigger ends background returns to its pre-duck level.

Telemetry (events only): `effective_volume`, `pre_duck_volume`, `ducked` are published on playback outcomes and background recompute events (not in steady state status stream).

<!-- Volume Safety and Control:
- max_volume setting provides safety limits for all audio subsystems
- MPV --volume-max argument enforces hard limits at the player level
- Volume validation ensures values are within 0-200% range
- Configuration supports both max_volume and maxVolume formats for compatibility
-->

### 2. Multi-Platform Media Playback

- **Image Display:**
  - Full-screen image display using MPV exclusively
  - Hardware-accelerated rendering with platform-specific optimizations
  - Seamless integration with video playback through single MPV instance per zone
- **Video Playback:**
  - Hardware-accelerated video using MPV with platform-specific optimizations
  - Multi-zone support on Pi4/Pi5 with independent video streams per soft device
  - Single MPV instance per zone for seamless media transitions
- **Audio Routing:**
  - Independent audio device targeting per zone. The implementation currently uses PulseAudio-compatible tooling (pactl) and `pulse/<name>` device identifiers; full PipeWire-only handling is not guaranteed and is under review (see `docs/Issues.md`).
  - Simultaneous multi-zone audio with different content per soft device is supported via configured audio devices and runtime combined-sink handling.
  - Platform-specific device identifiers are used primarily in PulseAudio-compatible form; mapping to native PipeWire identifiers may require additional glue.

### 3. Platform Configuration Templates

Pre-configured .ini templates for each supported platform:

- **pfx-pi3.ini**: Single-zone Pi3 optimized configuration
- **pfx-pi0w.ini**: Low-power Pi Zero W configuration  
- **pfx-pi4.ini**: Dual-zone Pi4 with all audio options
- **pfx-pi5.ini**: Enhanced Pi5 dual-zone configuration
- **pfx-linux.ini**: Generic Linux multi-zone setup

#### **Seamless Media Transitions**

ParadoxFX provides professional-grade seamless transitions using per-zone MPV processes (images/video) with IPC control; audio playback (background music, speech, effects) is managed via separate MPV instances created by the AudioManager.

**Image-to-Video Transitions:**
  - Zone MPV instance loads image and can pause on first frame when the media is a video
  - IPC commands seamlessly switch to video playback without application restart
  - Hardware-accelerated transitions minimize visible interruption
  - Zone-specific control allows independent transitions per soft device

**Video-to-Image Transitions:**
  - Video playback can be configured to keep the last frame using MPV options (e.g., `--keep-open=yes`) but the implementation adds duration-based EOF handling and playback-time polling to robustly detect media end
  - IPC commands load next image while maintaining MPV session
  - Smart queue management determines whether to pause or continue to next media
  - Multi-zone support allows independent media flows per soft device

- **Audio Coordination:**
  - Background music subsystem continues seamlessly during visual transitions
  - Sound effects can trigger precisely with visual changes via IPC timing
  - Speech subsystem coordinates with media transitions for narrative flow

### 4. Advanced Media Queuing and Control

-- **Queueing:**
  - Video queuing is implemented as an application-level FIFO with explicit replacement rules for static visuals (setImage). When the configured queue length is exceeded the oldest video command is dropped.
  - Audio queuing differs from video: speech uses a dedicated queue with de-duplication and completion promises; sound effects are fire-and-forget MPV spawns. These differing semantics are intentional but should be revisited (see `docs/Issues.md`).
- **Video/Image Queue Logic:**
  - The screen queue handles `playVideo` and `setImage` commands to ensure smooth transitions and logical playback order.
  - **Queuing a New Command:** When a new `playVideo` or `setImage` command is received, it is handled as follows:
    - **Duplicate Check:** If the new command is identical to the last command already in the queue, it is ignored.
    - **Replacement Logic:** The system checks the last item currently in the queue:
      - If the last item is an `setImage` command (for any file type) OR a `playVideo` command for an *image* file, it is considered a "static visual" and is **replaced** by the new command.
      - If the last item is a `playVideo` command for a *video* file, it is considered an "active visual" and is **not replaced**. The new command is added to the end of the queue.
  - **Playback Behavior:**
  - `playVideo` (with video file): Plays the video. When configured, ducking is applied by the zone layer (ScreenZone) which coordinates with the AudioManager for background audio reduction.
    - `playVideo` (with image file): Displays the image. Does not duck audio.
    - `setImage` (with video file): Loads the video and pauses on the first frame. Does not duck audio.
    - `setImage` (with image file): Displays the image. Does not duck audio.
  - **Resuming Playback:**
    - A `resumeVideo` command will resume the currently paused video.
    - If a `playVideo` command is issued for the *same file* that is currently loaded and paused (from a previous `setImage` command), it will be treated as a `resumeVideo` command to avoid reloading the file.
- **Video Looping:**
  - Videos can be played in continuous loop mode using the `loop: true` parameter
  - Loop implementation uses manual restart approach (stop→loadMedia→play) for observability
  - Loop iteration tracking with telemetry events published each iteration
  - Loops automatically cancelled when new media is queued
  - **⚠️ KNOWN BUG:** Loop currently hangs after 1-2 iterations. Use stopVideo command to break out of hung loop.
- **Stop Commands:**
  - `stopVideo`, `stopAudio`, `stopAllAudioFx`, and `stopAll` commands immediately stop playback and clear queues as appropriate.
  - `sleepScreen` and `wakeScreen` commands control display power management

### 4.1. Intelligent Screen Power Management

ParadoxFX implements intelligent screen power management that balances energy efficiency with responsive user experience:

#### **Default State**
- **Power On**: All connected displays remain powered on by default when ParadoxFX starts
- **Default Image**: Optional configurable default image displayed on startup (default: `default.png`)
- **Stay Active**: Displays remain active indefinitely without automatic blanking or sleep

#### **Sleep Commands**
- **Manual Sleep**: `sleepScreen` command puts displays into low-power sleep mode
- **DPMS Control**: Uses X11 DPMS (Display Power Management Signaling) to communicate with displays
- **State Persistence**: System remembers sleep state and maintains it until explicitly woken

#### **Automatic Wake Behavior**
- **Media Triggers**: Any media command (`setImage`, `playVideo`) automatically wakes sleeping displays
- **Audio Triggers**: Audio commands that route to HDMI (not analog) also wake displays
- **Instant Response**: Wake occurs before media playback begins for seamless user experience
- **Smart Detection**: System distinguishes between HDMI audio (triggers wake) and analog audio (no wake)

#### **Wake Commands**
- **Manual Wake**: `wakeScreen` command explicitly wakes sleeping displays
- **Default Image Restore**: After wake, displays return to configured default image if no other media is playing
- **State Synchronization**: Wake command synchronizes all connected displays
- **Transition Behavior:**
  - Videos automatically pause on the last frame using MPV's `--keep-open=yes` option
  - If no additional media is queued, video remains paused on final frame
  - If media is queued, seamless transition occurs via IPC commands
  - Queue management determines whether to hold final frame or continue playback flow

### 5. Enhanced MQTT Integration

- **Multi-Zone Command Routing:**
  - Zone-specific topic structures for independent control
  - Broadcast commands for synchronized multi-zone operations
  - Device-specific command validation and routing

- **Advanced Audio Commands:**
  - `playBackgroundMusic`: Start background music with volume control
  - `playSoundEffect`: Trigger low-latency sound effects  
  - `playSpeech`: Queue speech with automatic background music ducking
  - `setBackgroundMusicVolume`: Real-time volume adjustment
  - `clearSpeechQueue`: Immediate speech queue management

-- **Enhanced Status Reporting:**
  - Real-time audio subsystem status (background music, effects, speech queue)
  - Multi-zone device health and basic performance monitoring (heartbeat)
  - Detailed audio latency and low-level platform performance metrics are not currently published by the code; consider opening an issue to specify required telemetry (see `docs/Issues.md`).
  - Platform-specific hardware status reporting is available at a heartbeat level; deeper metrics require additional instrumentation.

-- **Configuration Management:**
  - Device discovery and capability reporting
  - Remote logging and debugging capabilities

  NOTE: Runtime hot-reload of the full `pfx.ini` via MQTT is not implemented; configuration is parsed at startup. If runtime configuration updates are required, add a tracked item in `docs/Issues.md`.

### 6. Comprehensive Device Configuration

Platform-optimized configurations are provided as templates for each supported hardware platform. All device configurations are stored in a single `pfx.ini` file using section-based format:

- Single INI file contains all device types (screens, lights, relays, audio zones)
- Each device gets its own section with platform-specific optimizations
- All devices share a single MQTT broker connection with intelligent routing
- Enhanced audio system configuration with three-subsystem architecture

#### **Example: Raspberry Pi 4 Dual-Zone Configuration**

```ini
[mqtt]
broker = localhost
port = 1883
client_id = pfx-pi4-01

[global]
log_level = info
message_level = info
media_base_path = /opt/media
max_concurrent_videos = 2
enable_hardware_acceleration = true

# Zone 1 - HDMI-0 with enhanced audio
[screen:zone1-hdmi0]
type = screen
topic = paradox/zone1/screen
display = :0
target_monitor = 0
audio_device = pulse/alsa_output.platform-fef00700.hdmi.hdmi-stereo
background_music_volume = 70
effects_volume = 100
speech_volume = 90
mpv_video_options = --hwdec=auto --vo=gpu --profile=gpu-hq

# Zone 2 - HDMI-1 with independent audio
[screen:zone2-hdmi1] 
type = screen
topic = paradox/zone2/screen
display = :0
target_monitor = 1
audio_device = pulse/alsa_output.platform-fef05700.hdmi.hdmi-stereo
background_music_volume = 70
effects_volume = 100
speech_volume = 90

# Lighting integration
[light:zone1-main]
type = light
topic = paradox/zone1/lights/main
controller = hue
bridge_ip = 192.168.1.100

[controller:hue]
type = hue
bridge_ip = 192.168.1.100
bridge_username = your-hue-username
```

### 7. Enhanced Architecture

<!-- Core architectural principles:
- Modular design with clear separation of concerns
- Zone-based abstraction for multi-device management
- IPC-based communication between components
- Platform-specific optimizations while maintaining API compatibility
-->
- **Multi-Platform Application**: Adapts to hardware capabilities across Pi3, Pi4, Pi5, and Linux
- **Shared MQTT Broker**: All devices and zones use intelligent connection multiplexing  
- **Enhanced Audio Manager**: Three-subsystem audio architecture with MPV-based playback
- **Hardware Optimization**: Platform-specific performance tuning and hardware acceleration
- **Modular Device System**: Extensible framework for screens, lights, relays, and custom devices
- **Real-time Coordination**: Subsystem coordination for seamless multi-zone experiences
- **Device Routing**: Commands are automatically routed to correct device handlers based on MQTT topic
- **Audio Integration**: Audio effects are tied to specific screen devices
- **External API Placeholders**: Framework includes placeholders for Hue, WiZ, Zigbee, and Z-Wave controllers

### 6. Status and Error Reporting

**Soft Device (Zone) Reporting**: Each soft device listens for commands on its configured MQTT command topic and publishes two types of messages to its status topic:

1. **State Updates**: Published whenever soft device state changes

   ```json
   {
     "timestamp": "2025-07-03T10:30:00Z",
     "device": "zone1-hdmi0",
     "type": "state",
     "status": "playing_video",
     "current_media": "video1.mp4",
     "queue_length": 2
   }
   ```

2. **Problem Reports**: Published when warnings or errors occur specific to that soft device

   ```json
   {
     "timestamp": "2025-07-03T10:30:00Z",
     "device": "zone1-hdmi0", 
     "type": "warning",
     "error_code": "MEDIA_NOT_FOUND",
     "message": "File video1.mp4 not found in media directory",
     "source_topic": "paradox/zone1/screen/commands"
   }
   ```

**Physical Device Heartbeat**: The physical device publishes comprehensive status to a heartbeat topic:

```json
{
  "timestamp": "2025-07-03T10:30:00Z",
  "device_name": "pi4-controller-01", 
  "hostname": "paradox-pi4",
  "ip_address": "192.168.1.100",
  "uptime": 86400000,
  "cpu_usage": 15.2,
  "gpu_usage": 8.5,
  "memory_usage": 45.8,
  "gpu_temp": 42.1,
  "cpu_temp": 38.7,
  "state": "running",
  "zones_active": 2,
  "zones_idle": 0
}
```

### 7. Framework Provisions

- **Effect Macros**: Framework structure for lighting effects (FADE, BLINK, etc.) to be implemented later
- **Process Managers**: Framework for managing external media player instances (up to 8 concurrent) to be implemented later
- **External Controllers**: Placeholder classes for Hue, WiZ, Zigbee, and Z-Wave integrations

### 8. Media Player Support

ParadoxFX uses MPV extensively for media playback:

<!-- MPV Integration Details:
- Single MPV instance per zone for video/images with IPC control
- Separate MPV instances for each audio subsystem (background, effects, speech)
- JSON IPC protocol for real-time command/response communication
- Hardware acceleration via VAAPI/V4L2 on supported platforms
- Audio routing through PulseAudio/PipeWire with device-specific sink selection
-->
- **MPV Integration**: MPV-based playback with JSON IPC for control. Images and video are managed by a zone-specific MPV process; background music and speech use separate MPV instances managed by the AudioManager.
- **IPC Control**: JSON-based socket communication for real-time control
- **Hardware Acceleration**: Platform-specific optimization (GPU decode, etc.)
- **Audio System Integration**: The implementation uses PulseAudio-compatible tooling (pactl, combined sinks). Pure PipeWire-only workflows are not guaranteed and may require additional mapping.
- **Multi-Instance**: Independent MPV processes are used per soft device/zone for media; additional MPV instances exist for background audio and speech.
- **Volume Management**: MPV's --volume-max argument enforces volume safety limits configured via max_volume settings

### 9. MQTT Discovery and Schema Topics

On startup, after all zones are initialized, PFx publishes two retained messages for external integrations (Node-RED, dashboards, monitoring tools):

**Discovery topic**: `{global.baseTopic}/discovery`

Lists all initialized zones with their topics:

```json
{
  "application": "pfx",
  "timestamp": "2025-10-24T10:30:00.000Z",
  "zones": [
    {
      "name": "screen",
      "type": "screen",
      "baseTopic": "paradox/pi4/screen",
      "commandsTopic": "paradox/pi4/screen/commands",
      "stateTopic": "paradox/pi4/screen/state",
      "schemaTopic": "paradox/pi4/screen/schema"
    }
  ]
}
```

**Per-zone schema topic**: `{zone.baseTopic}/schema`

Lists all commands accepted by a zone:

```json
{
  "application": "pfx",
  "zone": "screen",
  "type": "screen",
  "commandsTopic": "paradox/pi4/screen/commands",
  "commands": [
    { "name": "playVideo", "description": "Play a video file" },
    { "name": "setImage",  "description": "Display a still image" }
  ]
}
```

Both messages use `retain: true` so newly connected clients immediately receive the current inventory.

### 10. Testing

- **Unit Tests**: Included with actual MQTT message testing against localhost broker
- **Integration Tests**: Test external media player wrappers with mock implementations
- **Configuration Tests**: Validate INI file parsing and device initialization

For detailed project structure and file organization, see [Appendix B: Project Structure](#appendix-b-project-structure).

---

## Appendix A: Hardware Platform Details

### **Raspberry Pi 3 Model B/B+**
- **Video Output**: Single HDMI (1920x1080@60fps)
- **Audio Output**: HDMI audio, 3.5mm headphone jack
- **Performance**: Single zone, hardware-accelerated H.264 playback
- **Memory**: 1GB RAM (GPU: 64MB recommended)
- **Use Case**: Single-screen installations with basic audio

### **Raspberry Pi Zero W**
- **Video Output**: Mini HDMI (1920x1080@30fps)  
- **Audio Output**: HDMI audio only
- **Performance**: Lightweight single zone, optimized for low power
- **Memory**: 512MB RAM (GPU: 64MB maximum)
- **Use Case**: Compact installations, digital signage

### **Raspberry Pi 4 Model B (2GB/4GB/8GB)**
- **Video Output**: Dual HDMI (HDMI-0, HDMI-1) up to 4K@60fps each
- **Audio Output**: Independent HDMI audio per port, 3.5mm headphone jack
- **Performance**: Dual-zone with hardware acceleration
- **Memory**: 2-8GB RAM (GPU: 128-256MB recommended)
- **Use Case**: Multi-zone installations, escape rooms with multiple screens

### **Raspberry Pi 5 (4GB/8GB)**
- **Video Output**: Dual HDMI (HDMI-0, HDMI-1) up to 4K@60fps each
- **Audio Output**: Independent HDMI audio per port (no analog audio)
- **Performance**: Enhanced dual-zone with improved GPU
- **Memory**: 4-8GB RAM (GPU: 256-512MB recommended) 
- **Use Case**: High-performance multi-zone installations

### **Generic Linux Machines**
- **Video Output**: Multiple displays via GPU configuration
- **Audio Output**: System audio devices (PulseAudio/PipeWire)
- **Performance**: Scalable based on hardware specifications
- **Memory**: 4GB+ RAM recommended
- **Use Case**: Large installations, server-based deployments

## Appendix B: Project Structure

```
/opt/paradox/apps/pfx/
├── pfx.js                          # Main application entry point
├── pfx.ini                         # Active configuration file
├── pfx-pi3.ini                     # Pi3 single-zone configuration
├── pfx-pi0w.ini                    # Pi Zero W configuration  
├── pfx-pi4.ini                     # Pi4 dual-zone configuration
├── pfx-pi5.ini                     # Pi5 enhanced dual-zone configuration
├── pfx-linux.ini                   # Generic Linux configuration
├── package.json
├── lib/
│   ├── core/
│   │   ├── device-manager.js       # Multi-zone device registry and router
│   │   ├── config-loader.js        # Enhanced INI parser with platform detection
│   │   ├── mqtt-client.js          # Intelligent MQTT connection management
│   │   └── message-router.js       # Multi-zone command routing
│   ├── devices/
│   │   ├── screen-device.js        # Enhanced screen device with AudioManager
│   │   ├── light-device.js         # Hue/WiZ/Zigbee light control
│   │   ├── light-group-device.js   # Synchronized light group management
│   │   └── relay-device.js         # Z-Wave/Zigbee relay control
│   ├── media/
│   │   ├── audio-manager.js        # Three-subsystem audio architecture
│   │   ├── media-player-factory.js # Platform-optimized player selection
│   │   ├── mpv-zone-manager.js     # Multi-zone MPV process coordination
│   │   ├── video-player.js         # Hardware-accelerated video playback
│   │   └── players/
│   │       ├── base-player.js      # Base class for all media players
│   │       └── mpv-player.js       # Primary MPV media player (images, video, audio)
│   ├── controllers/
│   │   ├── hue-controller.js       # Philips Hue bridge integration
│   │   ├── wiz-controller.js       # WiZ smart lighting
│   │   ├── zigbee-controller.js    # Zigbee coordinator management
│   │   └── zwave-controller.js     # Z-Wave network management
│   ├── effects/
│   │   └── effect-engine.js        # Multi-zone effect coordination
│   └── utils/
│       ├── logger.js               # Enhanced multi-zone logging
│       └── utils.js                # Platform detection and optimization
└── test/
    ├── unit/                       # Unit tests for individual components
    ├── integration/                # Multi-zone integration testing
    │   ├── audio-manager-auto.test.js     # Automated audio system tests
    │   ├── audio-manager.test.js          # Interactive audio system tests  
    │   ├── media-playback.test.js         # Media player integration tests
    │   └── mqtt-integration.test.js       # MQTT system integration tests
    ├── manual/                     # Platform-specific manual testing
    │   ├── config-pi-audio.js             # Pi audio configuration utility
    │   ├── test-audio.js                  # Comprehensive audio validation
    │   ├── test-dual-hdmi.js              # Pi4/Pi5 dual-HDMI validation
    │   ├── test-screens.js                # Multi-zone screen testing
    │   └── real-playback.test.js          # Real media playback validation
    └── utils/
        └── loadTestConfig.js       # Test configuration management
├── media/
│   └── test/                       # Test audio/video/image files organized by type
│       ├── defaults/               # Default test media (png, mp4, mp3, wav, etc.)
│       ├── fx/                     # Sound effects library  
│       ├── music/                  # Background music tracks
│       ├── general/                # Speech and voice prompts
│       ├── devices/                # Device identification audio
│       └── surround/               # Multi-channel audio test files
```
