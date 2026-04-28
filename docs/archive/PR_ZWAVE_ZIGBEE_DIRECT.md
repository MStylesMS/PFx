# PR: Z-Wave and Zigbee Device Support (Direct-in-PFx, Hybrid-ready)

> ## 🔀 Decision Reversal — Radio Ownership Moved to PZB
>
> **Supersedes the direct-in-PFx plan below.** As of 2026-04-22, radio ownership for Z-Wave, Zigbee, and future Thread is moving out of PFx into a new dedicated product, **PZB (Paradox Z Bridge)**. PFx will consume radio devices over MQTT via PZB's topic contract, not by driving `zwave-js` / `zigbee-herdsman` directly.
>
> **What this changes:**
> - Phase 1 (direct Z-Wave lights) code in PFx is **deprecated** and will be retired: `lib/lights/backends/zwave-backend.js`, `lib/controllers/zwave-controller.js`, the `.tmp_zwave_frontdoor_bridge.js` template.
> - Phase 2 (Z-Wave sensors / input zones) is **superseded by PZB**. PFx `input_topic` subscriptions stay unchanged and consume PZB's `{node.base_topic}/events` — PZB's event schema is identical to the current PFx `InputZone` contract.
> - Phase 3 (Zigbee, direct) is **cancelled**. Zigbee support is implemented in PZB (PZB phase 3, complete; hardware validation pending).
> - Phase 4 (bridge mode) is **re-scoped**: instead of being an optional alternative, it becomes the **only** mode. PFx light/relay backends gain a `bridge` mode that publishes to PZB node `commands` topics and reads state from PZB node `state`.
>
> **Coordination:**
> - PZB scaffold and plan: [`/opt/paradox/apps/PZB/docs/PR_PZB_INITIAL.md`](../../PZB/docs/PR_PZB_INITIAL.md).
> - Direct-in-PFx radio code must be removed before PZB goes live on the same host (no double-ownership of the serial port).
> - The sections below are retained as historical context; treat phase checklists as frozen/archival unless explicitly re-opened under the PZB umbrella.

## Status

- **Superseded by PZB** (see pivot block above).
- Historical status (pre-pivot):
  - Design decisions finalized.
  - Implementation order locked: Z-Wave first, Zigbee second.
  - Config format locked: INI only.
  - Standalone bridge/service mode deferred to a later phase.
  - Initial direct Z-Wave and Zigbee implementation is now in-tree.
  - Documentation rename complete: `INI_Config.md` -> `CONFIG_INI.md`.

## Implementation Snapshot (2026-04-20)

Completed in code/docs:

- Added direct backends:
	- `lib/lights/backends/zwave-backend.js`
	- `lib/lights/backends/zigbee-backend.js`
- Wired backend selection in `lib/zones/light-zone.js` for `backend = zwave` and `backend = zigbee`.
- Added config loader parsing for Z-Wave/Zigbee keys in `lib/core/config-loader.js`.
- Added dependencies in `package.json`:
	- `zwave-js`
	- `zigbee-herdsman`
- Added quick-start guides:
	- `docs/QUICK_START_ZWAVE.md`
	- `docs/QUICK_START_ZIGBEE.md`
- Renamed INI reference doc to `docs/CONFIG_INI.md` and updated references.

Still pending:

- Real hardware validation/sign-off for Z-Wave and Zigbee command paths.
- Sensor/event integration work listed in Phase 2.
- Bridge mode design work listed in Phase 4.

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

- [x] This phased PR design doc.
- [x] `docs/CONFIG_INI.md` updates.
- [ ] `docs/SPEC.md` updates.

### Gate

- [ ] No implementation starts until key names and event vocabulary are approved.

## Phase 1: Z-Wave Direct Backend (First Implementation)

### Checklist

- [x] Add `zwave-js` dependency.
- [x] Add `lib/lights/backends/zwave-backend.js`.
- [x] Implement lifecycle: `initialize()`, `execute()`, `shutdown()`.
- [x] Implement singleton-per-port driver handling.
- [x] Wire `backend = zwave` in LightZone backend selector.
- [x] Add config loader parsing for Z-Wave keys.
- [x] Support on/off for binary switch nodes.
- [x] Support dimming for multilevel switch nodes.
- [x] Support `getStatus` / `getState` with normalized output.
- [x] Add warnings/outcome payloads for unsupported command classes.
- [x] Add operator guide `docs/QUICK_START_ZWAVE.md`.

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

- [x] Add `zigbee-herdsman` dependency.
- [x] Add `lib/lights/backends/zigbee-backend.js`.
- [x] Implement Ember adapter path for HUSBZB-1 (`adapter = ember`).
- [x] Implement singleton-per-port coordinator lifecycle.
- [x] Wire `backend = zigbee` in LightZone backend selector.
- [x] Add config loader parsing for Zigbee keys.
- [x] Implement `on`, `off`, `setBrightness`, `setColor`, `setColorTemp`, `getStatus`.
- [x] Add warning semantics for unsupported clusters/features.
- [x] Add operator guide `docs/QUICK_START_ZIGBEE.md`.

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

## What To Check And Test Now

Run these checks in order and record outcomes in the PR discussion.

### 1) Static/Syntax Checks

From PFx root:

```bash
node -c lib/lights/backends/zwave-backend.js
node -c lib/lights/backends/zigbee-backend.js
node -c lib/zones/light-zone.js
node -c lib/core/config-loader.js
npm run -s validate
```

Expected: all commands exit with no errors.

### 2) Dependency Install Check

```bash
npm install
```

Expected: installs `zwave-js` and `zigbee-herdsman` cleanly.

### 3) Device Node And Permissions Check

```bash
ls -l /dev/zwave /dev/zigbee
id
```

Expected: both device paths resolve and PFx runtime user has serial access (typically `dialout`).

### 4) Z-Wave Functional Smoke

Use a configured Z-Wave light topic (example topic shown):

```bash
mosquitto_pub -t paradox/room-a/lights/entry-switch/commands -m '{"command":"on"}'
mosquitto_pub -t paradox/room-a/lights/entry-switch/commands -m '{"command":"off"}'
mosquitto_pub -t paradox/room-a/lights/overhead-dimmer/commands -m '{"command":"setBrightness","brightness":55}'
mosquitto_pub -t paradox/room-a/lights/entry-switch/commands -m '{"command":"getStatus"}'
```

Verify:

- Device behavior matches command.
- Success outcomes on `.../events`.
- Status updates on `.../state`.

### 5) Zigbee Functional Smoke

```bash
mosquitto_pub -t paradox/room-a/lights/hall-color/commands -m '{"command":"on"}'
mosquitto_pub -t paradox/room-a/lights/hall-color/commands -m '{"command":"setBrightness","brightness":60}'
mosquitto_pub -t paradox/room-a/lights/hall-color/commands -m '{"command":"setColor","color":"#00aaff","brightness":70}'
mosquitto_pub -t paradox/room-a/lights/hall-color/commands -m '{"command":"setColorTemp","kelvin":3500,"brightness":80}'
mosquitto_pub -t paradox/room-a/lights/hall-color/commands -m '{"command":"off"}'
```

Verify:

- Power, brightness, color, and color-temperature actions apply correctly.
- Success outcomes on `.../events`.
- Status updates on `.../state`.

### 6) Failure/Recovery Checks

- Wrong node/device id in INI should fail with clear backend error.
- Unplug/replug USB adapter and restart PFx; confirm recovery.
- Restart PFx twice with mixed Z-Wave/Zigbee zones; ensure no duplicate-driver startup errors.

### 7) Documentation Consistency

Confirm these docs match runtime behavior:

- `docs/PR_ZWAVE_ZIGBEE_DIRECT.md`
- `docs/QUICK_START_ZWAVE.md`
- `docs/QUICK_START_ZIGBEE.md`
- `docs/CONFIG_INI.md`

## Primary Files Affected by Implementation PRs

- `lib/lights/backends/zwave-backend.js`
- `lib/lights/backends/zigbee-backend.js`
- `lib/zones/light-zone.js`
- `lib/core/config-loader.js`
- `docs/CONFIG_INI.md`
- `docs/SPEC.md`
