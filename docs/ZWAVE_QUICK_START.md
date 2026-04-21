# Z-Wave Quick Start (PFx Direct Backend)

This guide covers the direct-in-PFx Z-Wave setup path.

## 1. Prerequisites

- PFx host has a supported Z-Wave USB stick connected.
- Stable serial symlink exists (recommended): `/dev/zwave`.
- PFx service user has serial permissions (typically in `dialout`).

## 2. Minimal INI Example

```ini
[light:entry-switch]
type = light
topic = paradox/room-a/lights/entry-switch
backend = zwave
zwave_mode = direct
zwave_port = /dev/zwave
zwave_node_id = 12
zwave_type = binary_switch
```

Dimmer example:

```ini
[light:overhead-dimmer]
type = light
topic = paradox/room-a/lights/overhead-dimmer
backend = zwave
zwave_mode = direct
zwave_port = /dev/zwave
zwave_node_id = 15
zwave_type = multilevel_switch
```

## 3. Common Commands

```json
{"command":"on"}
{"command":"off"}
{"command":"setBrightness","brightness":60}
{"command":"getStatus"}
```

## 4. Verify Operation

- PFx starts without backend initialization errors.
- Commands produce success outcomes on `<zone-topic>/events`.
- Status updates publish expected power/brightness state.

## 5. Troubleshooting

- Serial access errors:
  - Check device path (`/dev/zwave`) and permissions.
  - Confirm PFx runtime user can open the serial device.
- Node not responding:
  - Verify `zwave_node_id` matches included device.
  - Wake battery-powered nodes before issuing commands.
- Unsupported behavior warnings:
  - Confirm `zwave_type` matches device capabilities.

## 6. Notes

- Secure inclusion (S2) may require DSK from device packaging.
- Use stable udev symlinks to avoid `ttyUSB*` renumbering across reboots.
