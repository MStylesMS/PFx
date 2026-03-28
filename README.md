# ParadoxFX - Paradox Effects

A Node.js multi-modal media and effect controller for screens, lights, and relays via MQTT.

**AI Documentation**: [AI-INSTRUCTIONS.md](AI-INSTRUCTIONS.md) (quick context) | [AI-DETAILED-OVERVIEW.md](AI-DETAILED-OVERVIEW.md) (comprehensive guide)

## Overview

ParadoxFX is a comprehensive system for controlling various devices through MQTT messaging. It supports:

- **Screens**: Video/audio playback via media players (mpv, vlc, fbi, etc.)
- **Browser Integration**: Web content display with window management (Chromium)
- **Multi-Zone Audio**: Advanced audio management with background music, speech, and sound effects
- **Lights**: Individual and group lighting control (Hue, WiZ, Zigbee, Z-Wave)  
- **Relays**: Switch and outlet control
- **Effects**: Coordinated device sequences and macros

### Key Features

- **Multi-Zone Audio System**: Supports background music with automatic ducking, queued speech/narration, and fire-and-forget sound effects
- **Cross-Platform Audio**: Automatic device discovery across Pi0, Pi4, Pi5, and desktop Linux systems
- **Device Abstraction**: Simplified audio device aliases (hdmi, analog, etc.) that auto-resolve to hardware
- **Multi-Output Support**: Individual zones can output to multiple audio devices simultaneously

### Platform Variants

- **PFx (Main)**: Optimized for Raspberry Pi 4+ and modern systems
- **PFx Pi3**: Specialized version for Raspberry Pi 3 with hardware acceleration

## Quick Start

### Standard Installation (Pi4+)

```bash
# Clone the repository
## Command Outcome Events & Warnings

git clone <repository-url>
cd pfx

# Install dependencies
npm install

# Copy and edit configuration
cp pfx.ini.example pfx.ini
# Edit pfx.ini with your settings

# Run the application
npm start
```

### Raspberry Pi specific notes

For platform-specific guidance see the `docs/` folder:

- Pi5 notes and setup guidance: `docs/Pi5-Notes.md`
- Pi4 notes and setup guidance: `docs/Pi4_Notes.md`

Both documents include Pi-specific boot config recommendations and MPV profiles. For INI options and examples, see `docs/INI_Config.md`.

### Raspberry Pi 3 Installation

```bash
# Clone the repository
git clone <repository-url>
cd pfx

# Install dependencies
npm install

# Configure for Pi3
node pfx-pi3.js config

# Copy Pi3 configuration
cp pfx-pi3.ini.example pfx-pi3.ini
# Edit pfx-pi3.ini with your settings

# Test hardware acceleration
node pfx-pi3.js test-screens

# Run Pi3-optimized version
node pfx-pi3.js start
```

### Basic Configuration

Edit `pfx.ini` to configure your devices and MQTT connection:

```ini
[mqtt]
broker = localhost
port = 1883

[screen:living-room]
type = screen
topic = paradox/living-room/screen
media_dir = /opt/media
audio_device = hdmi
volume = 80
max_volume = 120

[audio:zone1]
type = audio
devices = analog
background_music_dir = /opt/media/music
volume = 80
max_volume = 120

[light:living-room-hue]
type = light
topic = paradox/living-room/lights
controller = hue
```

#### Volume Control Configuration

ParadoxFX supports configurable volume limits for all audio zones:

- **`volume`**: Default volume level (0-150, default: 80 for audio zones, 70 for screen zones)
- **`max_volume`**: Maximum allowed volume level (0-200, default: 150)

The `max_volume` setting prevents audio from exceeding the specified level, providing safety limits for different environments. This applies to:
- Video playback audio
- Background music
- Speech/narration
- Sound effects

Example with volume constraints:
```ini
[screen:zone1-hdmi0]
type = screen
volume = 80
max_volume = 120  # Audio will never exceed 120, even if volume commands request higher
```

### Advanced MQTT Connection Tuning

For unstable networks or CI test determinism you can tune connection behavior (see full reference in `README_FULL.md`):

Environment / config keys:
* `mqttMaxAttempts` – Max connection attempts (0 = unlimited)
* `mqttConnectTimeoutMs` – Per-attempt TCP connect timeout
* `mqttOverallTimeoutMs` – Total wall-clock timeout across retries
* `heartbeatInterval` / `heartbeatTopic` – Periodic status publication
* `DEBUG_MQTT=1` (env) – Enable verbose internal connection/backoff logs

Example (fast-fail test run):
```bash
MQTT_CONNECT_TIMEOUT_MS=800 MQTT_OVERALL_TIMEOUT_MS=2500 MQTT_MAX_ATTEMPTS=2 npm test
```

On timeout the client rejects with `MQTT overall connection timeout` and force-closes the socket to avoid hanging test processes.

### Send Commands

```bash
# Display an image
mosquitto_pub -h localhost -t "paradox/living-room/screen/commands" \
  -m '{"command": "setImage", "image": "/media/background.jpg"}'

# Play a video
mosquitto_pub -h localhost -t "paradox/living-room/screen/commands" \
  -m '{"command": "playVideo", "video": "/media/intro.mp4", "volume": 80}'

# Play a looping video (⚠️ KNOWN BUG: may hang after 1-2 iterations)
mosquitto_pub -h localhost -t "paradox/living-room/screen/commands" \
  -m '{"command": "playVideo", "video": "/media/background.mp4", "loop": true}'

# Pause video
mosquitto_pub -h localhost -t "paradox/living-room/screen/commands" \
  -m '{"command": "pauseVideo"}'

# Skip to next video
mosquitto_pub -h localhost -t "paradox/living-room/screen/commands" \
  -m '{"command": "skipVideo"}'

# Browser Management (Web Content Display)
# Launch browser (⚠️ visible initially - manually hide after 10s)
mosquitto_pub -h localhost -t "paradox/living-room/screen/commands" \
  -m '{"command": "enableBrowser", "url": "http://localhost/clock/"}'

# Hide browser after page loads (typically 10 seconds)
mosquitto_pub -h localhost -t "paradox/living-room/screen/commands" \
  -m '{"command": "hideBrowser"}'

# Show browser (bring to front)
mosquitto_pub -h localhost -t "paradox/living-room/screen/commands" \
  -m '{"command": "showBrowser"}'

# Disable browser completely
mosquitto_pub -h localhost -t "paradox/living-room/screen/commands" \
  -m '{"command": "disableBrowser"}'

# Queue Inspection
```bash
# Show current video queue
mosquitto_pub -h localhost -t "paradox/living-room/screen/commands" -m '{"command": "videoQueue"}'
# Show current speech queue
mosquitto_pub -h localhost -t "paradox/zone1/commands" -m '{"command": "speechQueue"}'
```

# Screen Power Management
```bash
# Turn display off
mosquitto_pub -h localhost -t "paradox/living-room/screen/commands" -m '{"command": "sleepScreen"}'
# Turn display on
mosquitto_pub -h localhost -t "paradox/living-room/screen/commands" -m '{"command": "wakeScreen"}'
```

# System Control
```bash
# Reboot host machine
mosquitto_pub -h localhost -t "paradox/zone1/commands" -m '{"command": "reboot"}'
# Shutdown host machine
mosquitto_pub -h localhost -t "paradox/zone1/commands" -m '{"command": "shutdown"}'
# Terminate ParadoxFX process
mosquitto_pub -h localhost -t "paradox/zone1/commands" -m '{"command": "killPfx"}'
```

# Control lights
mosquitto_pub -h localhost -t "paradox/living-room/lights/commands" \
  -m '{"command": "setColor", "color": "#FF6400", "brightness": 75}'

# Play background music
mosquitto_pub -h localhost -t "paradox/zone1/commands" \
  -m '{"command": "playBackground", "file": "ambient.mp3", "volume": 60}'

# Pause background music
mosquitto_pub -h localhost -t "paradox/zone1/commands" \
  -m '{"command": "pauseBackground"}'

# Play speech with automatic background music ducking
mosquitto_pub -h localhost -t "paradox/zone1/commands" \
  -m '{"command": "playSpeech", "file": "hint1.wav"}'

# Fire sound effect immediately
mosquitto_pub -h localhost -t "paradox/zone1/commands" \
  -m '{"command": "playEffect", "file": "click.wav"}'

# Stop background music with fade-out
mosquitto_pub -h localhost -t "paradox/zone1/commands" \
  -m '{"command": "stopBackground", "fadeTime": 3.0}'

# Stop speech with fade-out
mosquitto_pub -h localhost -t "paradox/zone1/commands" \
  -m '{"command": "stopSpeech", "fadeTime": 1.5}'

# Stop all audio with fade-out (video/effects stop immediately)
mosquitto_pub -h localhost -t "paradox/zone1/commands" \
  -m '{"command": "stopAll", "fadeTime": 2.0}'
```

## Documentation

- **[MQTT API Reference](docs/MQTT_API.md)** - Complete command reference and message formats
- **[Configuration & INI Reference](docs/INI_Config.md)** - Consolidated INI reference and examples
- **[Project Architecture](docs/Scaffold_Summary.md)** - Technical implementation details
- **[Browser Switching & Startup Timing](docs/Browser_Switching.md)** - Browser lifecycle and show/hide guidance matching runtime behavior
- **[Production Deployment](README_FULL.md#process-management-with-systemd)** - systemd service setup and process management
- **Platform notes**: `docs/Pi4_Notes.md`, `docs/Pi5-Notes.md`

## Volume & Ducking Model (Unified)

Effective playback volume is resolved per command with this precedence (highest → lowest):
1. Absolute `volume` (0–200) provided in the command payload
2. Relative `adjustVolume` (-100..+100 % delta) provided in the command payload
3. Zone base `volume` from configuration

If both `volume` and `adjustVolume` are present, the absolute value is used and a warning event is published (command still succeeds).

Background ducking applies ONLY to background music. The configured `ducking_adjust` (negative percent, e.g. `-40`) reduces background while a duck trigger (speech, video, manual duck) is active; ducks do not stack.

### Quick Examples

Temporary 30% reduction relative to base (base 80 → effective 56 before any ducking):
```bash
mosquitto_pub -t "paradox/zone1/commands" -m '{"command":"playSpeech","file":"hint1.wav","adjustVolume":-30}'
```

Force absolute 120 (ignores any adjustVolume, emits warning):
```bash
mosquitto_pub -t "paradox/zone1/commands" -m '{"command":"playSpeech","file":"hint1.wav","volume":120,"adjustVolume":-25}'
```

Set global background ducking (INI) for a zone:
```ini
[screen:zone1-hdmi0]
type = screen
volume = 80
ducking_adjust = -40   ; Background plays at 60% during speech
```

### Telemetry
Playback outcome and background-volume recompute events now include:
`effective_volume`, `pre_duck_volume`, `ducked`.
They are NOT part of steady state `status` messages; subscribe to `{baseTopic}/events`.

Full details: `docs/INI_Config.md` (Unified Volume & Ducking section).

## Requirements

- Node.js 16+ and npm
- MQTT broker accessible on network
- Media players: mpv, vlc, fbi (for respective media types)
- Audio system: PulseAudio/PipeWire or ALSA
- For Raspberry Pi: Pi0 (analog), Pi4 (analog + dual HDMI), Pi5 (HDMI-only)

## Development

### Running Tests

```bash
npm test                # Run all tests (unit + integration)
npm run test:ci         # Unit tests only (faster, no external dependencies)
npm run test:manual     # Real media playback tests
```

### Audio Testing

ParadoxFX includes comprehensive audio testing capabilities:

```bash
# Standard audio testing (single device)
node test/manual/test-audio.js

# Multi-zone audio testing (3 independent physical outputs)
node test/manual/test-audio-3devices.js

# Raspberry Pi audio configuration
node test/manual/config-pi-audio.js
```

**Multi-Zone Audio Architecture:**
- **Zone 'screen0'**: HDMI 1 output (alsa/plughw:0)
- **Zone 'screen1'**: HDMI 2 output (alsa/plughw:1)
- **Zone 'headphones'**: Analog output (pulse/alsa_output.platform-fe00b840.mailbox.stereo-fallback)

Each zone supports independent:
- Background music with looping and volume control
- Low-latency sound effects (<50ms)
- Speech/narration with background music ducking
- MQTT topic routing (pfx/{zone}/{type}/{action})

### Project Structure

- **lib/core/**: System initialization, configuration, MQTT, and device management
- **lib/devices/**: Device-specific implementations for screens, lights, and relays
- **lib/media/**: Media player framework with multi-zone audio management and device discovery
- **lib/controllers/**: Integration with external systems (Hue, WiZ, Zigbee, Z-Wave)
- **lib/effects/**: Macro system for complex device sequences
- **test/**: Comprehensive test suite with unit, integration, and manual tests

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

For issues, questions, or contributions, please refer to the documentation in the `docs/` directory or create an issue in the project repository.
