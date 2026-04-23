# Z-Wave Quick Start (PFx Direct Backend)

This guide covers the direct-in-PFx Z-Wave setup path.

> **Note:** Direct Z-Wave support inside PFx is being retired in favour of the
> [PZB](/opt/paradox/apps/PZB/docs/QUICK_START.md) bridge. New deployments should
> pair devices with PZB and consume events over MQTT via a PFx input zone. This
> document is retained for existing installations only.

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

- **Inclusion is done via PZB, not PFx.** PFx's direct backend only controls
  already-included nodes. Pair / unpair using
  [PZB's inclusion commands](/opt/paradox/apps/PZB/docs/QUICK_START.md#8-include--exclude-a-node)
  (or a dedicated Z-Wave tool such as Silicon Labs PC Controller). The default
  PZB inclusion strategy is **Insecure (`2`)**; do not override to S2 unless
  PZB has been updated to provide S2 user callbacks.
- Secure inclusion (S2) may require the DSK printed on the device packaging.
  S2 is not currently supported end-to-end; stick with Insecure inclusion.
- Use stable udev symlinks (e.g. `/dev/zwave`) to avoid `ttyUSB*` renumbering
  across reboots.
