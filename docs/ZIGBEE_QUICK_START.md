# Zigbee Quick Start (PFx Direct Backend)

This guide covers the direct-in-PFx Zigbee setup path.

## 1. Prerequisites

- PFx host has a supported Zigbee coordinator connected.
- Stable serial symlink exists (recommended): `/dev/zigbee`.
- PFx service user has serial permissions (typically in `dialout`).

## 2. Minimal INI Example

```ini
[light:hall-color]
type = light
topic = paradox/room-a/lights/hall-color
backend = zigbee
zigbee_mode = direct
zigbee_port = /dev/zigbee
zigbee_adapter = ember
zigbee_ieee = 0x00158d0002abcdef
zigbee_type = color
```

On/off-only example:

```ini
[light:closet-light]
type = light
topic = paradox/room-a/lights/closet-light
backend = zigbee
zigbee_mode = direct
zigbee_port = /dev/zigbee
zigbee_adapter = ember
zigbee_ieee = 0x00158d0002fedcba
zigbee_type = onoff
```

## 3. Common Commands

```json
{"command":"on"}
{"command":"off"}
{"command":"setBrightness","brightness":60}
{"command":"setColor","color":"#00aaff","brightness":70}
{"command":"setColorTemp","kelvin":3500,"brightness":80}
{"command":"getStatus"}
```

## 4. Verify Operation

- PFx starts without coordinator initialization errors.
- Commands produce success outcomes on `<zone-topic>/events`.
- Status reflects expected power/brightness/color state.

## 5. Troubleshooting

- Serial access errors:
  - Check device path (`/dev/zigbee`) and permissions.
- Coordinator start failures:
  - Confirm adapter type (for HUSBZB-1, use `zigbee_adapter = ember`).
  - Verify coordinator firmware compatibility.
- Device not responding:
  - Confirm `zigbee_ieee` matches paired device.

## 6. Notes

- Use stable udev symlinks to avoid `ttyUSB*` renumbering.
- Keep Zigbee coordinator firmware current for best compatibility.
