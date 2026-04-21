# PR: Z-Wave and Zigbee Device Support (Direct-in-PFx, Hybrid-ready)

## Status

- Design decisions finalized.
- Implementation order locked: Z-Wave first, Zigbee second.
- Config format locked: INI only.
- Standalone bridge/service mode deferred to a later phase.

## Goal

Introduce native Z-Wave and Zigbee support in PFx while preserving PFx backend architecture and INI operator workflow. Deliver production-ready Z-Wave first, then Zigbee, while documenting a future extension path for standalone bridge mode.

## Out of Scope

- External daemon integration (ZWaveJS UI, Zigbee2MQTT) in this PR series.
- JSON or YAML runtime configuration support.
- MQTT topic contract changes.

## Architecture Decisions

- Hybrid direction from day one, but only direct mode is implemented initially.
- Reuse the LightZone backend strategy pattern already used by existing light backends.
- Keep INI as canonical and only supported on-disk config format.
- Use stable serial symlinks at OS layer for radio adapters.
- Use singleton-per-port lifecycle for both protocol stacks.

## Phase 0: Foundations (Docs + Interface Contract)

### Checklist

- [ ] Document direct-mode architecture in SPEC and INI docs.
- [ ] Define backend names and required keys for `backend = zwave` and `backend = zigbee`.
- [ ] Define normalized PFx command support matrix per backend.
- [ ] Define normalized sensor event vocabulary for contact and presence.
- [ ] Define failure semantics (init failure, transient command failure, degraded mode).

### Deliverables

- [ ] This phased PR design doc.
- [ ] `docs/CONFIG_INI.md` updates.
- [ ] `docs/SPEC.md` updates.

### Gate

- [ ] No implementation starts until key names and event vocabulary are approved.

## Phase 1: Z-Wave Direct Backend (First Implementation)

### Checklist

- [ ] Add `zwave-js` dependency.
- [ ] Add `lib/lights/backends/zwave-backend.js`.
- [ ] Implement lifecycle: `initialize()`, `execute()`, `shutdown()`.
- [ ] Implement singleton-per-port driver handling.
- [ ] Wire `backend = zwave` in LightZone backend selector.
- [ ] Add config loader parsing for Z-Wave keys.
- [ ] Support on/off for binary switch nodes.
- [ ] Support dimming for multilevel switch nodes.
- [ ] Support `getStatus` / `getState` with normalized output.
- [ ] Add warnings/outcome payloads for unsupported command classes.
- [ ] Add operator guide `docs/ZWAVE_QUICK_START.md`.

### Proposed INI Keys (Z-Wave)

- `backend = zwave`
- `zwave_mode = direct`
- `zwave_port = /dev/zwave`
- `zwave_node_id = <int>`
- `zwave_type = binary_switch | multilevel_switch | color_dimmer`
- `zwave_poll_ms = <int optional>`
- `zwave_security_mode = none | s0 | s2`

### Gate

- [ ] Binary switch and dimmer smoke tests pass on real hardware.

## Phase 2: Z-Wave Sensors + Input Integration

### Checklist

- [ ] Add sensor-oriented integration path using InputZone-compatible semantics.
- [ ] Normalize contact events to `open` and `closed`.
- [ ] Normalize motion/presence events to `presence` and `clear`.
- [ ] Publish sensor events to zone events/state topics with stable fields.
- [ ] Support optional `input_map` automation dispatch using normalized events.
- [ ] Add sensor examples to INI docs.

### Normalized Sensor Event Model

- `input`: channel/index string
- `event`: normalized event keyword
- `ts`: timestamp
- `source`: `zwave`
- `raw`: optional original payload object

### Gate

- [ ] Contact and presence sensors verified with real state transitions.

## Phase 3: Zigbee Direct Backend

### Checklist

- [ ] Add `zigbee-herdsman` dependency.
- [ ] Add `lib/lights/backends/zigbee-backend.js`.
- [ ] Implement Ember adapter path for HUSBZB-1 (`adapter = ember`).
- [ ] Implement singleton-per-port coordinator lifecycle.
- [ ] Wire `backend = zigbee` in LightZone backend selector.
- [ ] Add config loader parsing for Zigbee keys.
- [ ] Implement `on`, `off`, `setBrightness`, `setColor`, `setColorTemp`, `getStatus`.
- [ ] Add warning semantics for unsupported clusters/features.
- [ ] Add operator guide `docs/ZIGBEE_QUICK_START.md`.

### Proposed INI Keys (Zigbee)

- `backend = zigbee`
- `zigbee_mode = direct`
- `zigbee_port = /dev/zigbee`
- `zigbee_adapter = ember`
- `zigbee_ieee = 0x...`
- `zigbee_type = onoff | dim | ct | color`
- `zigbee_db_path = /opt/paradox/config/zigbee.db`

### Gate

- [ ] Coordinator starts cleanly and controls at least one on/off and one color-capable light.

## Phase 4: Future Bridge Mode (Design Only, No Code Yet)

### Checklist

- [ ] Define deferred bridge-mode design for `zwave_mode = bridge` and `zigbee_mode = bridge`.
- [ ] Document expected command passthrough mappings.
- [ ] Document expected service contracts and health checks.
- [ ] Keep all items explicitly marked deferred.

### Gate

- [ ] Design approved and parked for future PR.

## Phase 5: Hardening, Testing, and Operator Playbooks

### Checklist

- [ ] Unit tests for config parsing and backend command mapping.
- [ ] Unit tests for singleton lifecycle and teardown.
- [ ] Hardware smoke checklist for inclusion/pairing and control.
- [ ] Failure injection checklist (USB disconnect, restart, bad node id).
- [ ] Operator runbook snippets for recovery and diagnostics.
- [ ] README links updated to new docs sections.

### Gate

- [ ] Required tests and manual checks completed and recorded.

## Configuration Format Decision (INI vs JSON/YAML)

### Decision

- Use INI only.

### Why

- PFx runtime and docs are already INI-centered.
- Lowest migration risk and fastest path to Z-Wave-first delivery.
- Avoid parser/test churn before protocol support hardens.

### Deferred

- JSON and YAML support are not planned in this initiative.
- If reconsidered later, prefer conversion tooling to the same internal model over multi-parser runtime behavior.

## Example INI (Variety of Devices)

This example is for design and docs alignment. Key names may be finalized in Phase 0 before implementation starts.

```ini
[mqtt]
broker = localhost
port = 1883
client_id = pfx-room-a
base_topic = paradox/room-a

[global]
log_level = info
heartbeat_enabled = true
heartbeat_interval = 10000
heartbeat_topic = paradox/heartbeat

[light:entry-switch]
type = light
topic = paradox/room-a/lights/entry-switch
backend = zwave
zwave_mode = direct
zwave_port = /dev/zwave
zwave_node_id = 12
zwave_type = binary_switch

[light:overhead-dimmer]
type = light
topic = paradox/room-a/lights/overhead-dimmer
backend = zwave
zwave_mode = direct
zwave_port = /dev/zwave
zwave_node_id = 15
zwave_type = multilevel_switch

[light:hall-color]
type = light
topic = paradox/room-a/lights/hall-color
backend = zigbee
zigbee_mode = direct
zigbee_port = /dev/zigbee
zigbee_adapter = ember
zigbee_ieee = 0x00158d0002abcdef
zigbee_type = color

[input:front-door-contact]
type = input
topic = paradox/room-a/inputs/front-door
backend = zwave
profile = contact
zwave_mode = direct
zwave_port = /dev/zwave
zwave_node_id = 21
zwave_sensor_type = contact

[input:hall-presence]
type = input
topic = paradox/room-a/inputs/hall-presence
backend = zwave
profile = presence
zwave_mode = direct
zwave_port = /dev/zwave
zwave_node_id = 22
zwave_sensor_type = motion

[input:automation-door-to-light]
type = input
topic = paradox/room-a/automation/door-to-light
backend = generic
input_topic = paradox/room-a/inputs/front-door/events
input_map = {"0.open":[{"topic":"paradox/room-a/lights/entry-switch/commands","payload":{"command":"on"}}],"0.closed":[{"topic":"paradox/room-a/lights/entry-switch/commands","payload":{"command":"off"}}]}
```

## Risk Register

- Zigbee firmware compatibility risk on HUSBZB-1.
- Z-Wave secure inclusion workflow complexity (S2/DSK).
- USB naming instability without udev symlinks.
- Lifecycle coupling risk if singleton handling is not isolated per port.

## Validation Matrix (Minimum)

- Z-Wave binary switch: on/off and status readback.
- Z-Wave dimmer: `setBrightness` and status readback.
- Z-Wave contact sensor: `open` / `closed` transitions.
- Z-Wave presence sensor: `presence` / `clear` transitions.
- Zigbee on/off light: on/off and status.
- Zigbee color light: `setColor`, `setBrightness`, `setColorTemp`.
- Restart resilience after PFx restart and USB re-enumeration.

## Primary Files Affected by Implementation PRs

- `lib/lights/backends/zwave-backend.js`
- `lib/lights/backends/zigbee-backend.js`
- `lib/zones/light-zone.js`
- `lib/core/config-loader.js`
- `docs/CONFIG_INI.md`
- `docs/SPEC.md`
