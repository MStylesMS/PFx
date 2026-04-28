# Configuration Guide

This document provides detailed configuration instructions for ParadoxFX (Paradox Effects).

**See Also:** For a comprehensive settings reference, see [INI Configuration Reference](INI_REFERENCE.md).

## Configuration File Structure

ParadoxFX uses INI format configuration files. Choose one of the provided configs in the `config/` folder (e.g. `config/pfx-pi4-hha.ini`), copy it to `pfx.ini`, and customize as needed.

## Global Configuration

### [mqtt] Section

```ini
[mqtt]
broker = localhost          # MQTT broker hostname/IP
port = 1883                # MQTT broker port
username =                 # MQTT username (optional)
password =                 # MQTT password (optional)
client_id = pfx-01       # Unique client identifier
keepalive = 60            # Keep-alive interval in seconds
clean_session = true      # Clean session flag
```

### [global] Section

```ini
[global]
device_name = media-controller-01   # Unique device identifier for heartbeat messages
log_level = info                    # Logging level: debug, info, warn, error
media_base_path = /opt/media       # Base path for media files (deprecated - use device-specific media_dir)
heartbeat_interval = 30000         # Heartbeat interval in milliseconds
ducking_volume = 30                # Default volume for audio ducking (0-100)
preferred_image_player = auto      # Image player preference
require_video_group = false       # Require video group membership
```

## Device Configuration

### Screen Devices

Screen devices handle image display, video playback, and audio output.

```ini
[screen:device-name]
type = screen
topic = paradox/room/screen
status_topic = paradox/room/screen/status
media_dir = /opt/media/room
volume = 80
player_type = mpv
audio_device = default
# Display target: X11 display (e.g., ":0") or Wayland (uses $WAYLAND_DISPLAY)
display = :0
target_monitor = 0       # Zero-based monitor index for multi-display setups
default_image = default.png  # Image displayed on startup and after wake (optional)
```

**Parameters:**

- `type`: Must be "screen"
- `topic`: Base MQTT topic for commands
- `status_topic`: Topic for status updates (optional)
- `media_dir`: Directory containing media files for this device (replaces media_path)
- `volume`: Base volume level (0-100) for audio and video playback
- `player_type`: Media player preference (mpv, vlc, fbi, auto)
- `audio_device`: Audio device identifier for PipeWire/PulseAudio (e.g., 'pulse/device_name') or ALSA direct (e.g., 'alsa/hdmi:CARD=...')
- `display`: Display server target; X11 (":" + display number, e.g. ":0") or Wayland (uses $WAYLAND_DISPLAY)
- `target_monitor`: Zero-based monitor index used when multiple displays are attached (only for X11/XWayland)
- `default_image`: Image file displayed on startup and after wake commands (defaults to "default.png" if not specified)

**Media File Handling:**

- All media commands use filenames relative to `media_dir`
- Subdirectories are supported (e.g., "music/background.mp3")
- Volume adjustments in commands are applied as percentages to the base `volume` setting

### Light Devices

Individual light control.

```ini
[light:device-name]
type = light
topic = paradox/room/light
controller = hue
controller_config = bridge_ip=192.168.1.100;username=api_key
```

**Parameters:**

- `type`: Must be "light"
- `topic`: Base MQTT topic for commands
- `controller`: Light controller type (hue, wiz, zigbee, zwave)
- `controller_config`: Controller-specific configuration

### Light Group Devices

Group light control.

```ini
[lightgroup:device-name]
type = lightgroup
topic = paradox/room/lights
controller = hue
lights = light1,light2,light3
```

**Parameters:**

- `lights`: Comma-separated list of light IDs in the group

### Relay Devices

Switch and relay control.

```ini
[relay:device-name]
type = relay
topic = paradox/room/switch
controller = zwave
node_id = 5
```

**Parameters:**

- `controller`: Relay controller type (zwave, zigbee, gpio)
- `node_id`: Controller-specific node/device identifier

## Controller Configuration

### Philips Hue Controller

```ini
controller = hue
controller_config = bridge_ip=192.168.1.100;username=your_api_key
```

### WiZ Controller

```ini
controller = wiz
controller_config = light_ip=192.168.1.101
```

### Zigbee Controller

```ini
controller = zigbee
controller_config = coordinator_port=/dev/ttyUSB0
```

### Z-Wave Controller

```ini
controller = zwave
controller_config = controller_port=/dev/ttyACM0
```

## Audio Configuration

### Volume Settings

Each screen device has a base `volume` setting (0-100) that serves as the reference level for all audio and video playback. Volume adjustments in MQTT commands are applied as percentage changes to this base level.

**Volume Calculation:**

```
Effective Volume = Base Volume × (1 + VolumeAdjust/100)
```

**Examples:**

- Base volume: 80, VolumeAdjust: -10 → Effective volume: 72 (80 × 0.90)
- Base volume: 60, VolumeAdjust: +20 → Effective volume: 72 (60 × 1.20)
- Base volume: 50, VolumeAdjust: -50 → Effective volume: 25 (50 × 0.50)

### ALSA Device Names

Common ALSA device configurations:

```ini
audio_device = default              # System default
audio_device = hw:0,0              # Hardware device 0, subdevice 0
audio_device = plughw:1,0          # Hardware device 1 with format conversion
audio_device = pulse               # PulseAudio
```

**Raspberry Pi 5 PipeWire Devices:**
```ini
audio_device = pulse/alsa_output.platform-107c701400.hdmi.hdmi-stereo    # HDMI0 output
audio_device = pulse/alsa_output.platform-107c706400.hdmi.hdmi-stereo    # HDMI1 output
```

### Multi-Channel Audio

For systems with multiple audio outputs:

```ini
[screen:hdmi1]
audio_device = hw:0,3              # HDMI output 1

[screen:hdmi2]
audio_device = hw:0,7              # HDMI output 2
```

**Pi5 Dual HDMI Example:**
```ini
[screen:zone1]
audio_device = pulse/alsa_output.platform-107c701400.hdmi.hdmi-stereo    # Left monitor audio

[screen:zone2]
audio_device = pulse/alsa_output.platform-107c706400.hdmi.hdmi-stereo    # Right monitor audio
```

## Display Configuration

### Single Monitor

```ini
display = :0                       # Default X11 display
target_monitor = 0               # Primary screen
```

### Multi-Monitor Setup

```ini
[screen:monitor1]
display = :0
target_monitor = 0               # Left monitor

[screen:monitor2]
display = :0
target_monitor = 1               # Right monitor
```

**Important for Pi5**: Multi-monitor video routing requires X11. Wayland (the Pi5 default) has limitations that prevent reliable dual-screen video targeting. Use `sudo raspi-config` to switch to X11.

### Custom Geometry

For precise positioning:

```ini
monitor_geometry = 1920x1080+1920+0    # width x height + x_offset + y_offset
```

## Media Players

### Player Selection

PFx automatically selects appropriate players for media types:

- **Images**: fbi, feh, imagemagick
- **Video**: mpv, vlc
- **Audio**: mpv, vlc, aplay

### Player Preferences

```ini
preferred_image_player = fbi       # For framebuffer systems
preferred_image_player = feh       # For X11 systems
preferred_image_player = auto      # Automatic selection
```

## Platform-Specific Configuration

### Raspberry Pi 5 Setup

The Raspberry Pi 5 requires specific configuration for optimal dual-HDMI performance with video and audio routing.

#### System Requirements

**Display System**: Pi5 requires **X11** for reliable dual-screen video routing. The default Wayland compositor has limitations that prevent proper `--screen` parameter functionality in MPV.

**Audio System**: Use **PipeWire** for maximum compatibility and robust multi-format support. PipeWire provides better format handling and more reliable audio routing than ALSA direct access.

#### Required Boot Configuration

Add these settings to `/boot/firmware/config.txt`:

```bash
# Pi5 optimized dual-HDMI configuration
hdmi_enable_4kp60=1
gpu_mem=256

# Force HDMI0 to 1920x1080@60Hz (optional - prevents 4K auto-detection)
hdmi_group:0=1
hdmi_mode:0=16

# HDMI audio settings for better compatibility
hdmi_drive=2
hdmi_force_hotplug=1
config_hdmi_boost=7

# Enable DRM VC4 V3D driver
dtoverlay=vc4-kms-v3d
max_framebuffers=2
```

#### Switch to X11 (Required for Dual-Screen)

```bash
sudo raspi-config
# Advanced Options -> Wayland -> X11
sudo reboot
```

#### Pi5 Single HDMI Configuration

```ini
[mqtt]
broker = localhost
port = 1883
client_id = pfx-pi5-h

[global]
device_name = pi5-single
log_level = info
heartbeat_interval = 10000

[screen:zone1]
type = screen
topic = paradox/zone1/screen
media_dir = /opt/paradox/media/zone1
volume = 80
player_type = mpv
audio_device = pulse/alsa_output.platform-107c701400.hdmi.hdmi-stereo
display = :0
target_monitor = 0
```

**Pi5 Audio Device Names:**
- HDMI0: `pulse/alsa_output.platform-107c701400.hdmi.hdmi-stereo`
- HDMI1: `pulse/alsa_output.platform-107c706400.hdmi.hdmi-stereo`

#### Pi5 Dual HDMI Configuration

```ini
[mqtt]
broker = localhost
port = 1883
client_id = pfx-pi5-hh

[global]
device_name = pi5-dual
log_level = info
heartbeat_interval = 10000

[screen:zone1-hdmi0]
type = screen
topic = paradox/zone1/screen
media_dir = /opt/paradox/media/zone1
volume = 80
player_type = mpv
audio_device = pulse/alsa_output.platform-107c701400.hdmi.hdmi-stereo
display = :0
target_monitor = 0

[screen:zone2-hdmi1]
type = screen
topic = paradox/zone2/screen
media_dir = /opt/paradox/media/zone2
volume = 80
player_type = mpv
audio_device = pulse/alsa_output.platform-107c706400.hdmi.hdmi-stereo
display = :0
target_monitor = 1
```

**Pi5 Audio Device Names:**
- HDMI0: `alsa/hdmi:CARD=vc4hdmi0,DEV=0`
- HDMI1: `alsa/hdmi:CARD=vc4hdmi1,DEV=0`

#### Pi5 Performance Notes

- **Resolution**: Both HDMI outputs support up to 4K@60Hz, but 1920x1080 provides better performance for multimedia applications
- **MPV Optimization**: The system automatically uses optimized MPV parameters (`--vo=xv --framedrop=vo --cache=yes`) for smooth playback
- **Memory**: 256MB GPU memory allocation provides optimal balance for dual-screen video

## Example Configurations

### Basic Single Screen Setup

```ini
[mqtt]
broker = localhost
port = 1883

[global]
device_name = main-controller
log_level = info
heartbeat_interval = 30000

[screen:main]
type = screen
topic = paradox/main/screen
media_dir = /opt/media
volume = 75
player_type = auto
audio_device = default
display = :0
```

### Multi-Room Entertainment System

```ini
[mqtt]
broker = 192.168.1.10
port = 1883

[global]
device_name = entertainment-system
log_level = info
heartbeat_interval = 30000

[screen:living-room]
type = screen
topic = paradox/living-room/screen
media_dir = /opt/media/living-room
volume = 85
audio_device = hw:0,3
display = :0

[screen:bedroom]
type = screen
topic = paradox/bedroom/screen
media_dir = /opt/media/bedroom
volume = 70
audio_device = hw:1,0
display = :0.1

[light:living-room-hue]
type = light
topic = paradox/living-room/lights
controller = hue
controller_config = bridge_ip=192.168.1.100;username=api_key

[relay:living-room-outlet]
type = relay
topic = paradox/living-room/outlet
controller = zwave
node_id = 5
```

### Raspberry Pi Framebuffer Setup

```ini
[mqtt]
broker = localhost
port = 1883

[global]
device_name = raspberry-pi-display
log_level = info
preferred_image_player = fbi
require_video_group = true

[screen:pi-display]
type = screen
topic = paradox/pi/screen
media_dir = /opt/media
volume = 60
player_type = mpv
audio_device = hw:0,1
display = /dev/fb0
```

## Troubleshooting

### Common Issues

#### MQTT Connection Failed

- Verify broker hostname and port
- Check network connectivity
- Verify credentials if authentication is enabled

#### Media Files Not Playing

- Check file paths are absolute
- Verify file permissions
- Ensure media players are installed
- Check audio device configuration

#### Permission Denied

- Add user to `video` group for framebuffer access
- Add user to `audio` group for audio device access
- Verify file ownership and permissions

#### Display Issues

- Verify X11 display is accessible
- Confirm `target_monitor` / `output_name` mappings by running `xrandr --listmonitors`
- Ensure proper graphics drivers are installed

**Pi5 Specific Issues:**

- **Dual-screen video routing fails**: Switch from Wayland to X11 using `sudo raspi-config`
- **Audio plays but video goes to wrong screen**: Ensure using ALSA device names (`alsa/hdmi:CARD=vc4hdmi0,DEV=0`)
- **Poor video performance**: Check `/boot/firmware/config.txt` has `gpu_mem=256` and consider forcing 1080p resolution
- **Video appears on screen but no audio**: Verify ALSA device names match your Pi5 configuration

### Pi5 Validation Commands

Test Pi5-specific configuration:

```bash
# Verify X11 is active (not Wayland)
echo $XDG_SESSION_TYPE  # Should show: x11

# Check display configuration
xrandr --query

# Test ALSA audio devices
aplay -l | grep vc4hdmi

# Test MPV video routing
timeout 3s mpv --screen=0 --audio-device=alsa/hdmi:CARD=vc4hdmi0,DEV=0 test.mp4
timeout 3s mpv --screen=1 --audio-device=alsa/hdmi:CARD=vc4hdmi1,DEV=0 test.mp4
```

### Validation

Test your configuration:

```bash
# Test MQTT connectivity
mosquitto_pub -h your_broker -t test -m "hello"

# Test media players
mpv --version
vlc --version
fbi --help

# Test audio devices
aplay -l
pactl list sinks

# Test display access
echo $DISPLAY
xrandr
```

### Logging

Enable debug logging for troubleshooting:

```ini
[global]
log_level = debug
```

Check logs for detailed error information and device status updates.

## Desktop Autostart and Remote SSH Setup

To ensure ParadoxFX (PFX) and X11 permissions are set up automatically on every desktop login, use the provided example files in `config/`:

- `config/startup-xhost.desktop` – Grants X11 access to the 'paradox' user for remote/SSH sessions
- `config/pfx.desktop` – Launches ParadoxFX automatically on desktop login

### Step-by-Step Instructions

1. **Copy the example autostart files to your autostart directory:**

   ```bash
   mkdir -p ~/.config/autostart
   cp /opt/paradox/apps/pfx/config/startup-xhost.desktop ~/.config/autostart/
   cp /opt/paradox/apps/pfx/config/pfx.desktop ~/.config/autostart/
   chmod +x /opt/paradox/apps/pfx/scripts/startup-xhost-config.sh
   ```

2. **Verify the contents (optional):**

   - `~/.config/autostart/startup-xhost.desktop` should contain:
     ```ini
     [Desktop Entry]
     Type=Application
   Exec=/opt/paradox/apps/pfx/scripts/startup-xhost-config.sh
     Hidden=false
     NoDisplay=false
     X-GNOME-Autostart-enabled=true
     Name=Startup XHost
     Comment=Allow paradox user X11 access for remote PFX
     ```
   - `~/.config/autostart/pfx.desktop` should contain:
     ```ini
     [Desktop Entry]
     Type=Application
     Exec=/usr/bin/env DISPLAY=:0 node /opt/paradox/apps/pfx/pfx.js
     Hidden=false
     NoDisplay=false
     X-GNOME-Autostart-enabled=true
     Name=ParadoxFX
     Comment=Start ParadoxFX media controller
     ```

3. **How it works:**
   - On every desktop login, X11 access is granted to the 'paradox' user (for both local and SSH sessions).
   - ParadoxFX will start automatically and take over the configured screens.

4. **Remote SSH Workflow:**
   - SSH into the Pi as 'paradox'.
   - Stop PFX if needed (e.g., `pkill -f pfx.js`).
   - Make code changes.
   - Restart PFX with:
     ```bash
     export DISPLAY=:0
     node /opt/paradox/apps/pfx/pfx.js
     ```

5. **Security Note:**
   - The `startup-xhost.desktop` file uses `xhost +SI:localuser:paradox` for secure X11 access. Do not use `xhost +` unless you understand the security implications.

For more details, see the example files in `config/` and the comments in `scripts/startup-xhost-config.sh`.
