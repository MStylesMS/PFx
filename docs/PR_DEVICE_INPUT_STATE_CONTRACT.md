# PR: Device Input State/Event Contract (PFx)

Status: Draft plan aligned with PxO external input routing work.

## Goal
Define and implement a clean producer-side contract for PFx device-facing zones so downstream consumers (PxO, dashboards, tooling) receive high-signal data.

This PR focuses on contract shape and behavior for sensors and output devices.

## Contract Summary
PFx device topics should follow:
- `{baseTopic}/events`
- `{baseTopic}/state`
- `{baseTopic}/commands`
- `{baseTopic}/warnings`
- `{baseTopic}/schema`

## Events vs State Rules
### `/events`
- Publish only facts received from the device/backend at receipt time.
- Piecemeal reports are expected.
- Examples:
  - Contact open/closed transition
  - Motion active/clear
  - Battery level update
  - Power/energy report
  - Link quality update
  - Device diagnostics event

### `/state`
- Retained compact summary of last-known values.
- Publish on PFx startup and whenever tracked values change.
- Include only fields each device can report.
- Include per-field timestamps to show staleness.
- Do not emit generic media/audio/status internals for sensor-only zones.

### `/warnings`
- Publish derived/operator-facing warnings and failures:
  - Low battery threshold crossed
  - Tamper active
  - Device offline/silent timeout
  - Command execution failures

### `/schema`
- Retained metadata for integration/tooling.
- Include capability and field descriptions:
  - Device/backend/profile
  - Supported commands
  - Event field names/types
  - State field names/types

## Why This Change
Current input-zone status payloads can contain inherited fields that are irrelevant for sensor semantics. This creates noise and hides the meaningful signal.

The new contract makes:
- events sparse and truthful,
- retained state compact and useful,
- warnings intentional,
- schema explicit for tooling.

## Example Target State Shapes
### Contact Sensor
```json
{
  "contact": { "value": "open", "ts": "2026-04-21T15:42:13Z" },
  "battery": { "level": 87, "ts": "2026-04-21T12:00:00Z" },
  "tamper": { "active": false, "ts": "2026-04-21T09:00:00Z" },
  "reachable": { "value": true, "ts": "2026-04-21T15:42:13Z" },
  "last_seen": "2026-04-21T15:42:13Z"
}
```

### Smart Plug
```json
{
  "power": { "watts": 9.4, "ts": "2026-04-21T15:42:13Z" },
  "energy": { "kwh": 12.81, "ts": "2026-04-21T15:40:00Z" },
  "switch": { "value": "on", "ts": "2026-04-21T15:39:58Z" },
  "reachable": { "value": true, "ts": "2026-04-21T15:42:13Z" }
}
```

## Implementation Phases
### Phase 1: Contract and Metadata
- [ ] Define capability-scoped state field model for sensor and output profiles
- [ ] Define warnings policy and thresholds (battery, offline, tamper)
- [ ] Extend schema payloads with state/events field metadata

### Phase 2: Input Zone Payload Cleanup
- [ ] Reduce inherited status noise for input/sensor profiles
- [ ] Keep retained state publish behavior: startup and on-change
- [ ] Preserve backward compatibility where practical

### Phase 3: Backend Alignment
- [ ] Align Z-Wave and Zigbee sensor event normalization to the contract
- [ ] Ensure output backends (lights/plugs) emit consistent state/event semantics
- [ ] Keep raw device-origin detail available in event payload `raw` fields when useful

### Phase 4: Warnings and Threshold Config
- [ ] Add/validate INI settings for warning thresholds (for example low battery)
- [ ] Emit warnings on threshold crossing and recovery
- [ ] Document warning fields and codes

### Phase 5: Documentation and Examples
- [ ] Update `docs/CONFIG_INI.md` with contract-oriented examples
- [ ] Add profile examples for contact, motion, plug, and light devices
- [ ] Clarify event-only vs retained-state behavior for operators

## Cross-Repo Order (Recommended)
1. PxO first
   - Source registry and trigger routing in place so gameplay logic can consume inputs cleanly.
2. PFx second (this PR)
   - Align PFx producer contract for high-signal data and capability-scoped retained state.
3. Pio last (optional)
   - Minimal or no change required initially.
   - Optional contract metadata alignment if needed.

## Backward Compatibility Notes
- Existing topic families remain intact.
- State payload shape may become intentionally slimmer for sensor-like profiles.
- Where behavior changes, document migration notes and provide examples.

## Definition of Done (PFx Portion)
- Sensor and output profiles publish high-signal `/events`.
- Retained `/state` is compact, capability-scoped, and timestamped per field.
- `/warnings` policy is explicit and configurable.
- `/schema` clearly advertises capabilities, events, and state fields.
- Docs include concrete INI and payload examples.
