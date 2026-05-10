# Manual Tests

This directory contains manual tests for both media playback and MQTT communication that require human interaction or real system integration.

## Test Types

### 1. Real Media Playback Tests

Tests that actually play media files, displaying images on screen, playing videos, and outputting audio through speakers.

**Purpose**: While the main integration tests only verify that the correct media players are selected and configured, these manual tests actually execute the media players so you can:

- **Visually verify** that images display correctly
- **Hear audio** to confirm sound files work
- **Watch videos** to ensure video playback functions
- **Test media transitions** between different types

### 2. MQTT Communication Tests

Interactive tests that validate MQTT connectivity and demonstrate all device commands.

**Purpose**: Test MQTT broker communication and provide examples of all supported commands:

- **Verify MQTT connectivity** with publish/subscribe test
- **Test all device commands** for screens and audio zones
- **Interactive demonstration** of command formats and options
- **Real-time command validation** with actual MQTT broker

### 3. Raspberry Pi 3 Specialized Tests

Hardware-specific tests optimized for Raspberry Pi 3 with Bullseye (Legacy).

**Purpose**: Validate Pi3-specific hardware acceleration and performance:

- **GPU acceleration verification** with VideoCore IV hardware decode
- **Optimized media playback** using MMAL and hardware-accelerated codecs
- **Performance testing** for 1080p video and audio on Pi3 hardware
- **Fallback testing** when hardware acceleration is unavailable

## Requirements

### System Requirements

- **X11 Display**: Required for image and video display
  - Linux desktop environment or X forwarding enabled
  - `DISPLAY` environment variable set (usually `:0`)
- **Audio System**: Required for audio playback
  - ALSA, PulseAudio, or other audio system configured
  - Speakers or headphones connected

### Required Media Players

- **feh**: For image display

  ```bash
  sudo apt install feh  # Ubuntu/Debian
  sudo yum install feh  # CentOS/RHEL
  ```

- **mpv**: For video and audio playback

  ```bash
  sudo apt install mpv  # Ubuntu/Debian
  sudo yum install mpv  # CentOS/RHEL
  ```

### Media Files

The test media files must be present in `media/test/defaults/`. All required media files are included in the comprehensive media library.

## Usage

### MQTT Communication Tests

Test MQTT connectivity and demonstrate all device commands:

```bash
# Run with default config (pfx.ini)
node test/manual/test-mqtt.js

# Run with specific config file
node test/manual/test-mqtt.js pfx-test.ini
```

**Requirements for MQTT Tests:**

- MQTT broker running (mosquitto on localhost:1883 by default)
- Valid configuration file with device definitions
- Network connectivity to MQTT broker

**What the test does:**

1. Loads configuration from INI file
2. Connects to MQTT broker
3. Tests basic connectivity with publish/subscribe
4. Demonstrates all commands for each device type
5. Shows JSON message format for each command
6. Provides interactive command execution

### Raspberry Pi 3 Hardware Tests

Test hardware acceleration and performance on Pi3 with Bullseye:

```bash
# Run Pi3-optimized screen tests
node test/manual/test-screens-pi3.js
```

**Requirements for Pi3 Tests:**

- Raspberry Pi 3 with Raspberry Pi OS Bullseye (Legacy)
- GPU memory split configured (gpu_mem=128 or higher)
- Hardware acceleration packages (mpv, vlc, fbi)
- Test media files in media/test/defaults/

**What the test does:**

1. Verifies Pi3 hardware requirements (GPU memory, packages)
2. Tests image display with FBI (framebuffer)
3. Tests video playback with MPV hardware acceleration
4. Tests VLC fallback if MPV hardware decode fails
5. Tests audio playback with optimized settings
6. Reports hardware acceleration status and performance

### Real Media Playback Tests

Test actual media playback with real files:

```bash
npm run test:manual
```

### Audio Testing Suite

ParadoxFX includes comprehensive audio testing with multiple scenarios:

```bash
# Standard audio testing (single device/zone)
node test/manual/test-audio.js

# Multi-zone audio testing (independent 3-device audio)
node test/manual/test-audio-3devices.js

# Raspberry Pi audio configuration and testing
node test/manual/config-pi-audio.js
```

**Standard Audio Tests (`test-audio.js`):**
- Background music playback and volume control
- Low-latency sound effects (<50ms)
- Speech/narration with background music ducking
- Multiple simultaneous audio streams
- IPC vs spawn method comparison

**Multi-Zone Audio Tests (`test-audio-3devices.js`):**
- **Zone 'screen0'**: HDMI 1 output (alsa/plughw:0)
- **Zone 'screen1'**: HDMI 2 output (alsa/plughw:1)
- **Zone 'headphones'**: Analog output (pulse/alsa_output.platform-fe00b840.mailbox.stereo-fallback)

Each zone supports independent:
- Background music with zone-specific volume control
- Low-latency sound effects per zone
- Speech with zone-specific background ducking
- MQTT topic routing simulation (pfx/{zone}/{type}/{action})
- Simultaneous multi-zone audio streams

**What Multi-Zone Tests Validate:**
1. **Independent audio content** across 3 physical outputs
2. **Zone-specific volume control** and background music ducking
3. **MQTT topic routing** patterns for production integration
4. **Parallel audio streams** without cross-zone interference
5. **Fire-and-forget sound effects** per zone
6. **Simultaneous multi-zone coordination**

### Run Specific Test Categories

```bash
# Image tests only
ENABLE_REAL_PLAYBACK=true npx jest test/manual/real-playback.test.js -t "Image Playback"

# Audio tests only
ENABLE_REAL_PLAYBACK=true npx jest test/manual/real-playback.test.js -t "Audio Playback"

# Video tests only
ENABLE_REAL_PLAYBACK=true npx jest test/manual/real-playback.test.js -t "Video Playback"

# Media transition demo
ENABLE_REAL_PLAYBACK=true npx jest test/manual/real-playback.test.js -t "Media Transition Demo"

# Seamless full-screen transition test
ENABLE_REAL_PLAYBACK=true npx jest test/manual/real-playback.test.js -t "Seamless Full-Screen"
```

### Skip Real Playback (Default Behavior)

```bash
# These will skip the real playback tests
npm test
npx jest test/manual/
```

## What to Expect

### Image Tests (9 tests)

Each image will be displayed for 3 seconds in a borderless window:

- **JPEG**: Standard, high quality, and low quality variants
- **PNG**: Standard and 24-bit variants  
- **GIF**: Animated image support
- **BMP**: Windows bitmap format
- **TIFF**: High quality format
- **WebP**: Modern web format

### Video Tests (2-4 tests)

Each video will play for 3 seconds with audio at 50% volume:

- **MP4**: Standard H.264 video
- **AVI**: Legacy video format (if available)
- **MKV**: Matroska container (if available)

### Audio Tests (10 tests)

Each audio file will play for 3 seconds at 50% volume:

- **MP3**: Standard, high quality (320kbps), low quality (128kbps)
- **WAV**: Lossless uncompressed
- **FLAC**: Lossless compressed
- **OGG**: Open source Vorbis codec
- **AAC**: Apple/modern standard
- **Opus**: Modern low-latency codec

### Media Transition Demo (1 test)

Demonstrates switching between media types:

1. Displays an image
2. Plays audio
3. Plays a video

### Seamless Full-Screen Transition Test (1 test)

**Professional-grade seamless transition testing** for production environments using **overlapping processes**:

**Sequence:**

1. **Background image** (houdini_picture_24bit.png) - starts and stays persistent
2. **Video overlay** (default.mp4) - plays on top for full 8 seconds
3. **Background switch** - image changes while video plays (invisible to user)
4. **Video ends** - reveals the new background image seamlessly

**Key Features:**

- **Overlapping processes**: Video plays "on top" of persistent background images
- **No transition gaps**: Background switches during video playback (invisible)
- **Full-screen mode**: No borders, menus, or window decorations
- **Hidden cursor**: Cursor completely hidden throughout sequence
- **Tunable timing**: Configurable delays for optimal seamlessness
- **Production-ready**: Tests real-world deployment scenarios

**Timing Configuration:**

- `VIDEO_START_DELAY`: 2000ms (wait after image1 before video)
- `IMAGE_SWITCH_AFTER_START`: 2500ms (switch background after video starts)
- `IMAGE_SWITCH_BEFORE_END`: 2000ms (ensure new image ready before video ends)
- `FINAL_DISPLAY_TIME`: 3000ms (show final result)

This test validates that the system can deliver **truly seamless transitions** with no visible gaps, suitable for professional live events, installations, and presentations where visual continuity is critical.

## Configuration

### Adjust Playback Duration

Edit `DISPLAY_TIME` in `real-playback.test.js`:

```javascript
const DISPLAY_TIME = 5000; // 5 seconds instead of 3
```

### Adjust Audio Volume

Edit the `--volume` parameter in the test file:

```javascript
'--volume=75', // 75% instead of 50%
```

### Change Window Positioning

Edit the `--geometry` parameters:

```javascript
'--geometry=1024x768+200+200', // size and position
```

## Troubleshooting

### No Display

```bash
# Check if X11 is running
echo $DISPLAY
xdpyinfo

# For SSH connections, enable X forwarding
ssh -X username@hostname
```

### No Audio

```bash
# Check audio devices
aplay -l
pactl list sinks

# Test audio system
speaker-test -t sine -f 1000 -l 1
```

### Media Player Not Found

```bash
# Check if players are installed
which feh
which mpv

# Install missing players
sudo apt install feh mpv
```

### Permission Issues

```bash
# Ensure user is in audio group
groups $USER
sudo usermod -a -G audio $USER
```

## Integration with CI/CD

These tests are designed for manual verification and should **not** be run in automated CI/CD pipelines. They require:

- Interactive display
- Audio hardware
- User interaction

For automated testing, use the regular integration tests:

```bash
npm run test:ci
```
