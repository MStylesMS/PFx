# INI Configuration Reference

This document explains all available settings in ParadoxFX `.ini` configuration files. Each entry lists the data type, valid values or ranges, default values (if any), and whether the setting is required or optional.

---

## 1. [mqtt]

| Setting       | Type    | Required | Default | Description                                          |
|---------------|---------|----------|---------|------------------------------------------------------|
| broker        | string  | Yes      | N/A     | Hostname or IP of the MQTT broker                    |
| port          | integer | No       | 1883    | TCP port of the MQTT broker                          |
| username      | string  | No       | —       | Username for MQTT authentication                     |
| password      | string  | No       | —       | Password for MQTT authentication                     |
| client_id     | string  | Yes      | N/A     | Unique identifier for this ParadoxFX client          |
| keepalive     | integer | No       | 60      | MQTT keep-alive interval (seconds)                   |
| clean_session | boolean | No       | true    | Whether to request a clean session                   |
| base_topic    | string  | Yes      | N/A     | Root MQTT topic for all ParadoxFX messages           |
| device_name   | string  | Yes      | N/A     | Suffix appended to MQTT topics for this device       |
| mqtt_qos      | integer | No       | 0       | Default QoS level (0, 1, or 2)                       |
| mqtt_retain   | boolean | No       | false   | Whether to retain published messages                 |

---

## 2. [global]

| Setting                | Type     | Required | Default       | Description                                                                          |
|------------------------|----------|----------|---------------|--------------------------------------------------------------------------------------|
| log_level              | string   | No       | info          | One of `error`, `warn`, `info`, `debug`, `trace`                                     |
| media_base_path        | path     | Yes      | N/A           | Directory path where media files are stored                                           |
| heartbeat_enabled      | boolean  | No       | false         | Enable periodic heartbeat messages                                                   |
| heartbeat_interval     | integer  | No       | 10000         | Interval between heartbeats (ms)                                                      |
| heartbeat_topic        | string   | No       | `paradox/heartbeat` | MQTT topic for heartbeat messages                                              |
| ducking_volume         | integer  | No       | 30            | Default volume for audio ducking (0-100)                                     |
| speech_ducking         | integer  | No       | (unset)       | Optional global default for speech ducking (negative units, e.g. -26)        |
| video_ducking          | integer  | No       | (unset)       | Optional global default for video ducking (negative units, e.g. -24)         |
| max_concurrent_videos  | integer  | No       | 1             | Maximum simultaneous video streams per zone                                           |
| max_concurrent_audio_streams | integer  | No       | 1             | Maximum simultaneous audio streams per zone                                           |
| enable_hardware_acceleration | boolean  | No    | false         | Whether to enable hardware video decoding                                             |
|
---

## 3. [screen:<zone_name>]

A screen section defines a video (and audio) zone.

| Setting           | Type      | Required | Default      | Description                                                        |
|-------------------|-----------|----------|--------------|--------------------------------------------------------------------|
| type              | string    | Yes      | screen       | Must be `screen`                                                   |
| name              | string    | No       | —            | Friendly display name                                              |
| topic             | string    | Yes      | N/A          | MQTT topic for screen commands                                     |
| enabled           | boolean   | No       | true         | Whether this zone is active                                        |
| media_path        | path      | No       | —            | Subdirectory under `media_base_path` or absolute path              |
| display           | string    | Yes      | N/A          | X11 or Wayland display (`:0`, `wayland-0`, etc.)                   |
| target_monitor    | integer   | No       | 0            | Zero-based monitor index used when multiple displays are present   |
| monitor_geometry  | string    | No       | auto         | Resolution override or `auto`                                       |
| player_type       | string    | No       | mpv          | Media player (`mpv`, `cvlc`, etc.)                                 |
| video_volume      | integer   | No       | 100          | Volume percent for video audio (0–150)                             |
| video_queue_max   | integer   | No       | 1            | Max queued video requests                                           |
| audio_device      | string    | No       | default      | PulseAudio/PipeWire device identifier (`pulse/<id>`)               |
| background_music_volume | integer | No    | 100          | Background music volume (0–150)                                     |
| ducking_volume    | integer   | No       | 100          | Volume when ducking other streams (0–150)                          |
| effects_volume    | integer   | No       | 100          | Sound effects volume (0–150)                                        |
| speech_volume     | integer   | No       | 100          | Speech/narration volume (0–150)                                     |
| audio_queue_max   | integer   | No       | 1            | Max queued audio requests                                            |
| mpv_video_options | string    | No       | —            | Extra CLI options for MPV video playback                             |
| mpv_audio_options | string    | No       | —            | Extra CLI options for MPV audio playback                             |

---

## 4. [audio:<zone_name>]

Defines an audio-only zone (e.g., headphones).

| Setting         | Type      | Required | Default  | Description                                                  |
|-----------------|-----------|----------|----------|--------------------------------------------------------------|
| type            | string    | Yes      | audio    | Must be `audio`                                              |
| name            | string    | No       | —        | Friendly name                                                |
| topic           | string    | Yes      | N/A      | MQTT topic for audio commands                                |
| enabled         | boolean   | No       | true     | Whether this audio zone is active                            |
| audio_device    | string    | Yes      | N/A      | PulseAudio/PipeWire device identifier                        |
| background_music_volume | integer | No | 100      | Volume percent for music (0–150)                             |
| ducking_volume  | integer   | No       | 100      | Volume when ducking (0–150)                                  |
| effects_volume  | integer   | No       | 100      | Sound effects volume                                         |
| speech_volume   | integer   | No       | 100      | Speech volume                                                |
| audio_queue_max | integer   | No       | 1        | Max queued audio requests                                    |
| mpv_audio_options | string  | No       | —        | Extra CLI options for MPV audio playback                     |

---

## 5. [light:<identifier>] and [light-group:<identifier>]

Managed lighting devices or groups.

| Setting         | Type    | Required | Default | Description                              |
|-----------------|---------|----------|---------|------------------------------------------|
| type            | string  | Yes      | light, light-group | Defines device or group type |
| name            | string  | No       | —       | Friendly name                            |
| topic           | string  | Yes      | N/A     | MQTT topic for lighting commands         |
| controller      | string  | Yes      | N/A     | One of `hue`, `wiz`, `zigbee`            |
| bridge_ip       | string  | Cond.    | N/A     | IP for Hue; required if controller=hue   |
| bridge_username | string  | Cond.    | N/A     | Required if controller=hue                |
| bulb_ip         | string  | Cond.    | N/A     | Required if controller=wiz                |
| device_id       | string  | Cond.    | N/A     | Required for Zigbee controllers           |
| devices         | list    | Cond.    | N/A     | Comma-separated IDs for light-group      |

---

## 6. [relay:<identifier>]

Defines relay or automation endpoints.

| Setting     | Type     | Required | Default | Description                                |
|-------------|----------|----------|---------|--------------------------------------------|
| controller  | string   | Yes      | N/A     | One of `zwave`, `zigbee`                    |
| topic       | string   | Yes      | N/A     | MQTT topic for relay commands              |
| node_id     | integer  | Cond.    | N/A     | Required if controller=zwave                |
| device_id   | string   | Cond.    | N/A     | Required if controller=zigbee               |
| device_type | string   | No       | switch  | Type of relay/device (e.g., switch, sensor) |

---

## 7. [controller:<type>]

Defines controller connections.

| Setting         | Type    | Required | Default | Description                              |
|-----------------|---------|----------|---------|------------------------------------------|
| type            | string  | Yes      | N/A     | Must match section name                  |
| name            | string  | No       | —       | Friendly name                            |
| serial_port     | string  | Cond.    | N/A     | Serial or IP port (for Zigbee/Z-Wave)    |
| bridge_ip       | string  | Cond.    | N/A     | For Hue controllers                      |
| bridge_username | string  | Cond.    | N/A     | For Hue controllers                      |
| polling_interval| integer | No       | 10000   | Polling interval (ms)                    |
| max_retries     | integer | No       | 3       | Number of retries on failure             |
| timeout         | integer | No       | 5000    | Command timeout (ms)                     |

---

## 8. [pi4_optimization]

Platform-specific tuning for Pi4. All settings optional.

| Setting              | Type    | Description                                          |
|----------------------|---------|------------------------------------------------------|
| gpu_mem              | integer | GPU memory allocation (MB)                          |
| enable_4kp60         | boolean | Enable 4K@60fps HDMI                                |
| hdmi_force_hotplug   | boolean | Force HDMI detection                                |
| hdmi_drive           | integer | HDMI drive strength                                 |
| audio_buffer_size    | float   | Audio buffer size (seconds)                         |
| audio_cache_enabled  | boolean | Enable audio caching for effects                    |
| audio_exclusive_mode | boolean | Request exclusive audio device mode                 |

---

## 9. [aliases]

Quick-reference device aliases:

| alias_name     | Type    | Required | Description                         |
|----------------|---------|----------|-------------------------------------|
| any alias      | list    | No       | Comma-separated list of identifiers|

---

## 10. [failsafe]

Automatic recovery and emergency settings.

| Setting               | Type    | Default | Description                                    |
|-----------------------|---------|---------|------------------------------------------------|
| auto_restart_on_failure | boolean | false   | Enable auto-restart on crash                   |
| max_restart_attempts  | integer | 3       | Max restart attempts                           |
| restart_delay_ms      | integer | 5000    | Delay between restarts (ms)                    |
| emergency_stop_topic  | string  | N/A     | MQTT topic to trigger emergency stop           |
| emergency_stop_timeout| integer | 5000    | Wait time for emergency stop (ms)              |
| enable_watchdog       | boolean | false   | Enable internal watchdog                      |
| watchdog_interval     | integer | 30000   | Watchdog heartbeat interval (ms)              |
| watchdog_timeout      | integer | 60000   | Watchdog timeout (ms)                         |

---

## 11. [logging]

Logging and debug options.

| Setting            | Type    | Required | Default | Description                             |
|--------------------|---------|----------|---------|-----------------------------------------|
| default_level      | string  | No       | info    | Global log level                        |
| audio_level        | string  | No       | info    | Audio subsystem log level               |
| video_level        | string  | No       | info    | Video subsystem log level               |
| mqtt_level         | string  | No       | warn    | MQTT subsystem log level                |
| controller_level   | string  | No       | info    | Controllers log level                   |
| log_to_file        | boolean | No       | false   | Enable file logging                     |
| log_file_path      | path    | Cond.    | N/A     | Path to logfile (required if log_to_file) |
| log_rotation       | boolean | No       | false   | Enable log rotation                     |
| log_max_size       | string  | No       | 10MB    | Max size before rotation                 |
| log_max_files      | integer | No       | 5       | Number of rotated files to keep          |

---

*This reference covers all standard settings. Platform or hardware-specific sections may introduce additional parameters.*
