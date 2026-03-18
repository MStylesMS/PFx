````markdown
# ParadoxFX INI Configuration (Merged Reference)

This file consolidates the previous `CONFIGURATION.md` and `INI_REFERENCE.md` into a single authoritative INI configuration reference and examples document.

Contents:
- Quick overview and workflow
- Full setting reference with types, defaults, and descriptions
- Per-section examples and Pi5-specific notes
- Troubleshooting and recommended settings

---

## Quick Overview

ParadoxFX is configured using INI files. Pick a sample config from `config/` (e.g., `config/pfx-pi5-hh.ini`) and copy to `pfx.ini`. Sections are typically: `[mqtt]`, `[global]`, `[screen:<name>]`, `[audio:<name>]`, `[light:<id>]`, `[relay:<id>]`, `[controller:<type>]`.

General advice:
- Keep environment- and deployment-specific settings (like X11 DISPLAY or mpvOntop) in local `pfx.ini` and out of shared branches when necessary.
- Use `log_level = debug` for troubleshooting window/MPV/browser issues.

---

## Full Setting Reference (by section)

### [mqtt]

| Setting | Type | Req | Default | Description |
|---|---:|:--:|---|---|
| broker | string | Yes | N/A | MQTT broker host or IP |
| port | integer | No | 1883 | MQTT port |
| username | string | No | - | MQTT user |
| password | string | No | - | MQTT password |
| client_id | string | Yes | N/A | Unique client id |
| keepalive | integer | No | 60 | Keepalive seconds |
| clean_session | boolean | No | true | Clean session flag |
| base_topic | string | Yes | N/A | Root topic for messages |
| device_name | string | Yes | N/A | Device name for heartbeat/topic suffix |
| mqtt_qos | integer | No | 0 | Default QoS (0/1/2) |
| mqtt_retain | boolean | No | false | Retain published messages |

### [global]

| Setting | Type | Req | Default | Description |
|---|---:|:--:|---|---|
| log_level | string | No | info | error|warn|info|debug|trace |
| log_directory | path | No | (none) | Directory for log files. If not set, logs only to console (captured by systemd). Enables automatic log rotation (30 days / 100MB limit). |
| message_level | string | No | info | Verbosity for INFO/DEBUG messages |
| media_base_path | path | No | (deprecated) | DEPRECATED — Use per-device `media_dir` instead. When present PFx will no longer rely on a global `media_base_path` for per-zone media resolution; specify `media_dir` inside each `[screen:<name>]` or `[audio:<name>]` section (absolute or relative to `/opt/paradox/media`). |
| heartbeat_enabled | boolean | No | false | Enable heartbeat messages |
| heartbeat_interval | integer(ms) | No | 10000 | Heartbeat interval in ms |
| heartbeat_topic | string | No | paradox/heartbeat | Heartbeat MQTT topic |
| ducking_adjust | integer (negative %) | No | 0 | Background reduction percent applied while any duck trigger active (0 = no duck). Expressed as negative percentage (e.g. -40). |
| pulseaudio_wait_ms | integer (ms) | No | 6000 | Max time PFX will wait at startup for PulseAudio to become responsive before skipping combined sink setup. Increase if you see early "PulseAudio not available" warnings on boot. |
| pulseaudio_wait_interval_ms | integer (ms) | No | 500 | Poll interval while waiting for PulseAudio readiness. Lower for finer granularity; keep >=250ms to avoid excess polling. |
| max_concurrent_videos | integer | No | 1 | Max videos per zone |
| enable_hardware_acceleration | boolean | No | false | HW decode flag (mpv) |

### [screen:<zone_name>]

Defines video+audio screen zones. Common keys:

| Setting | Type | Req | Default | Description |
|---|---:|:--:|---|---|
| type | string | Yes | screen | Must be `screen` |
| topic | string | Yes | N/A | Base MQTT topic for zone commands |
| status_topic | string | No | - | Topic for status updates |
| media_dir | path | No | - | Zone media directory |
| volume | integer | No | 80 | Base volume % |
| player_type | string | No | mpv | mpv|vlc|auto |
| audio_device | string | No | default | PipeWire/Pulse/ALSA device identifier passed to mpv via `--audio-device`. Use `pipewire` to route through PipeWire (required when running as a systemd service — `default` silently falls back to raw ALSA, bypassing PipeWire). Use `pipewire/<sinkname>` to pin to a specific output. Run `mpv --audio-device=help` to list available device strings. |
| display | string | Yes | N/A | X11 display (`:0`) or Wayland display |
| target_monitor | integer | No | 0 | Zero-based monitor index used to pick an output when multiple displays are present. |
| output_name | string | No | (auto) | Optional xrandr output name (e.g. `HDMI-1`). When omitted PFx will try to resolve the monitor by `targetMonitor` index. |
| resolution_mode | string | No | (none) | Desired display mode (e.g. `640x480@60`). Applied via `xrandr` before MPV starts. |
| resolution_fallback | string | No | (none) | Secondary mode tried when the primary fails. Same syntax as `resolution_mode`. |
| default_image | string | No | default.png | Startup image |
| mpv_video_options | string | No | - | Extra mpv CLI options |
| mpvOntop | boolean | No | true | If `false` remove `--ontop` from mpv args (useful when Chromium must be on top) |
| max_volume | integer | No | 100 | Maximum allowed volume % (0-200, enforced by MPV --volume-max) |

Notes:
- `mpvOntop = false` is recommended for zones where Chromium browser must be raised above MPV (e.g., clocks/UI overlays).
- Use `display = :0` and `target_monitor` to target specific monitors under X11. For Pi5 dual-HDMI use X11 (see Pi5 section).
- Screen resolution control requires X11 with `xrandr` installed (`sudo apt install x11-xserver-utils` on Debian/Ubuntu/Pi OS). PFx logs will warn if the binary is missing or the mode cannot be applied; the system continues using the current desktop resolution.
- `max_volume` setting prevents audio from exceeding the specified level, providing volume safety limits for installations

<!-- Combined sink configuration allows routing audio to multiple physical outputs simultaneously -->
Combined sink configuration (PulseAudio)

PFx supports creating and managing PulseAudio "combined" sinks when you need one logical audio sink that forwards audio to multiple physical sinks (for example, two HDMI outputs).

Configuration keys (per `screen:` or `audio:` device)

| Setting | Type | Req | Default | Description |
|---|---:|:--:|---|---|
| combined_sinks | array or string (JSON) | No | N/A | List of Pulse sink identifiers to combine (e.g. `["pulse/alsa_output.platform-...","pulse/alsa_output.platform-..."]`). PFx accepts a JSON string or native array in the INI parser. |
| combined_sink_name | string | No | combined_output | Name to give the created combined sink (used as `pulse/<name>` for `audio_device`). |
| combined_sink_description | string | No | Combined Audio Output | Description property assigned to the combined sink when created. |
| primary_device | string | No | N/A | Primary Pulse sink id (e.g. `pulse/alsa_output.platform-...`) used by PFx when trying to build a combined sink. |
| secondary_device | string | No | N/A | Secondary Pulse sink id used for combined/dual output scenarios. |

Behavior and operator guidance
- If `combined_sinks` (or the explicit primary/secondary device keys) is present, PFx will attempt to ensure a combined sink exists at startup. The runtime code will:
	- Detect existing sinks/modules via `pactl` and parse current sinks/modules.
	- Reuse an existing combined sink when correctly configured, or unload/recreate it when slaves differ.
	- Update the runtime `audio_device` to `pulse/<combined_sink_name>` when the combined sink is created or successfully detected. If creation fails PFx will fall back to the configured `primary_device`.
- Because module-created sinks are transient (lost when PulseAudio restarts), choose one of the persistence methods described in `COMBINED_AUDIO.md`: persist the module in PulseAudio startup config, run a discovery script at boot (recommended on Pi hardware), or allow PFx to recreate the sink at app startup.
- Avoid hardcoding fragile sink names when possible. Use discovery logic that matches sinks by properties (device description) or run a small discovery script to produce stable names before PFx starts.

Example (dual HDMI combined sink created by PFx):

```ini
[screen:dual-hdmi]
type = screen
media_dir = /opt/paradox/media/zone-dual
# Primary/secondary physical sinks (Pulse sink ids)
primary_device = pulse/alsa_output.platform-107c701400.hdmi.hdmi-stereo
secondary_device = pulse/alsa_output.platform-107c706400.hdmi.hdmi-stereo
# Or provide an explicit array of sinks:
# combined_sinks = ["pulse/alsa_output.platform-107c701400.hdmi.hdmi-stereo", "pulse/alsa_output.platform-107c706400.hdmi.hdmi-stereo"]
combined_sink_name = paradox_dual_output
combined_sink_description = Paradox Dual HDMI Output
```

See `COMBINED_AUDIO.md` for operational guidance on persistence, discovery scripts, and `pactl` commands to create the sink manually or at boot.

### [audio:<zone_name>]

Audio-only zones. Common keys:

| Setting | Type | Req | Default | Description |
|---|---:|:--:|---|---|
| type | string | Yes | audio | Must be `audio` |
| topic | string | Yes | N/A | MQTT topic |
| audio_device | string | Yes | N/A | Pulse/PipeWire/ALSA device id |
| background_music_volume | integer | No | 100 | Music volume |
| ducking_adjust | integer (negative %) | No | 0 | Background reduction percent while duck active (speech / manual / video trigger). |
| mpv_audio_options | string | No | - | Extra mpv audio options |
| max_volume | integer | No | 100 | Maximum allowed volume % for all audio subsystems (0-200) |

<!-- Volume Management Notes:
- max_volume applies to all audio subsystems (background music, sound effects, speech)
- MPV enforces volume limits using --volume-max argument
- Values above 100% are supported for systems requiring boosted audio
- Default fallback is 100% if max_volume is not specified
-->

### [light:<id>] and [lightgroup:<id>]

Lighting sections for supported controllers (hue, wiz, zigbee). Keys include `controller`, `controller_config`, `lights` for groups, and controller-specific connection settings.

### [relay:<id>]

Relay/controller sections define switching endpoints and include `controller`, `node_id`/`device_id`, and `topic`.

### [controller:<type>]

Controller-global settings (serial_port, bridge_ip, polling_interval, timeout, max_retries).

---

## Platform Notes (Pi5)

- Pi5 is HDMI-only for analog audio. Use `hdmi0` / `hdmi1` mappings or PipeWire sink names.
- For reliable dual-HDMI video targeting, switch Pi5 to X11 (Wayland has multi-monitor limitations for mpv). Use `sudo raspi-config` → Advanced → Wayland → X11.
- **Audio Volume Settings**: Pi5 HDMI sinks may default to low volumes (0.35-0.40). Set to 1.0 using `wpctl set-volume <sink_id> 1.0` for proper audio levels.
- Recommended boot config additions in `/boot/firmware/config.txt`:

```ini
gpu_mem=256
hdmi_enable_4kp60=1
hdmi_drive=2
hdmi_force_hotplug=1
config_hdmi_boost=7
dtoverlay=vc4-kms-v3d
max_framebuffers=2
```

## Examples

Single-screen minimal:

```ini
[mqtt]
broker = localhost
port = 1883

[global]
device_name = main-controller
log_level = info
message_level = info

[screen:main]
type = screen
topic = paradox/main/screen
media_dir = /opt/media
volume = 75
player_type = auto
audio_device = default
ducking_adjust = -35  ; Reduce background to 65% during active duck (speech / manual duck)
```

Pi5 dual-HDMI example:

```ini
[mqtt]
broker = localhost
client_id = pfx-pi5-hh

[global]
device_name = pi5-dual
log_level = info
message_level = info

[screen:zone1-hdmi0]
type = screen
media_dir = /opt/paradox/media/zone1
audio_device = pulse/alsa_output.platform-107c701400.hdmi.hdmi-stereo
display = :0
target_monitor = 0
max_volume = 120  # Limit HDMI-0 audio to 120% for safety
ducking_adjust = -40  # Background reduced to 60% during speech/video/manual duck

[screen:zone2-hdmi1]
type = screen
media_dir = /opt/paradox/media/zone2
audio_device = pulse/alsa_output.platform-107c706400.hdmi.hdmi-stereo
display = :0
target_monitor = 1
max_volume = 100  # Standard limit for HDMI-1
ducking_adjust = -30
```

<!-- Volume Configuration Examples:
- max_volume = 100: Standard safety limit (default)
- max_volume = 120: Moderate boost allowed for quiet environments
- max_volume = 80: Conservative limit for loud installations
- Values above 100% require careful testing to avoid distortion
-->

## Troubleshooting & Diagnostics

- Enable `log_level = debug` in `[global]` to capture window manager and mpv diagnostics.
- For browser show/hide issues check `/opt/paradox/logs/pfx-latest.log` for stored pid/window id mismatches.
- Useful commands (run with proper XAUTHORITY/DISPLAY):

```bash
wmctrl -lG
wmctrl -lp
xdotool search --class ParadoxBrowser
```

## Removal of old docs

`CONFIGURATION.md` and `INI_REFERENCE.md` are replaced by this consolidated `INI_CONFIG.md` file. Keep per-deployment `pfx.ini` files local and out of commits unless intentional.

---

*Last updated: August 2025 — consolidated reference*

---

## Unified Volume & Ducking Model (Phase 8–9)

This deployment uses a unified resolver that determines an effective playback volume for each command.

Precedence (highest → lowest):
1. `volume` (absolute 0–200) per command
2. `adjustVolume` (transient -100% .. +100%) per command — applied as a percentage delta to the zone base
3. Zone base `volume` (from INI)

If both `volume` and `adjustVolume` are provided the system applies only `volume` and emits a warning event (command still succeeds).

### Ducking
`ducking_adjust` (configured per zone or globally) is a negative percentage (0 or negative) applied ONLY to background music while any duck trigger is active:
- Speech playback
- Active video (if implemented to trigger ducking for your profile)
- Manual duck command (future / optional)

Only a single duck percentage is applied at a time; no stacking. When the last trigger ends background volume returns to its pre-duck effective level.

### Telemetry (Phase 9)
Playback command outcome events and background-volume recompute events now include:
- `effective_volume` – Final volume actually applied after resolution & ducking
- `pre_duck_volume` – Effective volume before ducking applied (same as effective when no duck active)
- `ducked` – Boolean indicating whether a duck reduction was applied

These fields are NOT currently added to steady-state status messages (to keep status lean). Subscribe to zone `{baseTopic}/events` to capture recompute and playback telemetry.

### Configuration Summary
| Concept | Key / Field | Notes |
|---------|-------------|-------|
| Base volume | `volume` (INI) | Persistent per zone |
| Per-play absolute | `volume` (command) | Overrides everything else |
| Per-play delta | `adjustVolume` (command) | Applied to base when absolute not present |
| Ducking | `ducking_adjust` (INI) | Negative percentage applied to background only |
| Telemetry | `effective_volume`, `pre_duck_volume`, `ducked` | Events only |

Legacy `volumeAdjust` has been removed; use `adjustVolume` instead.

### JSON Schemas
Machine-readable JSON Schemas for volume telemetry events (playback outcome & background recompute) are available in `docs/json-schemas/`:
- `command-outcome-playback.schema.json`
- `background-volume-recompute.schema.json`
These can be consumed by external validators / dashboards to ensure event shape compliance.

````
