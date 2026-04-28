# Z-Wave Quick Start (PFx Direct Backend)

> ## ⚠️ Deprecated — Radio I/O has moved to PZB
>
> All Z-Wave (and Zigbee) I/O — inclusion, inputs, and outputs — is handled by
> [PZB (Paradox Z Bridge)](/opt/paradox/apps/PZB/docs/QUICK_START.md).
>
> PFx no longer consumes radio events. **Do not add `[input:*]` sections in
> PFx INI for zwave/zigbee sensors.** Consumers (PxO, PxT, dashboards)
> subscribe to PZB's per-node topics directly, e.g.
> `paradox/houdini/zwave/spell-box/{events,state,schema}`.
>
> The PFx direct-backend for *outbound* lights / relays documented below is
> still functional for existing installations but is also slated for retirement
> once PFx gains a generic-command → PZB outbound adapter. New deployments
> should publish to `{node.base_topic}/commands` on PZB instead.

This guide describes the legacy direct-in-PFx Z-Wave output path. For new
work, see [PZB Quick Start](/opt/paradox/apps/PZB/docs/QUICK_START.md).

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

- **Inputs (sensors) are not handled by PFx at all.** Configure them in PZB.
  See [PZB Quick Start §7](/opt/paradox/apps/PZB/docs/QUICK_START.md) and
  [PZB MQTT API §8](/opt/paradox/apps/PZB/docs/MQTT_API.md). Any existing
  `[input:*]` section in a PFx INI for a zwave/zigbee sensor should be
  removed or commented out.
- **Inclusion is done via PZB, not PFx.** Pair / unpair using
  [PZB's inclusion commands](/opt/paradox/apps/PZB/docs/QUICK_START.md#8-include--exclude-a-node).
  The default PZB inclusion strategy is **Insecure (`2`)**; do not override
  to S2 unless PZB has been updated to provide S2 user callbacks.
- Use stable udev symlinks (e.g. `/dev/zwave`) to avoid `ttyUSB*` renumbering
  across reboots.
