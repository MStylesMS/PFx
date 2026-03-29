# Shelly Quick Start (PFx)

This guide covers the current Shelly implementation in PFx.

## Supported Scope

- Output devices via `light` or `light-group` zones:
  - `profile = switch`
  - `profile = dimmer`
  - `profile = rgbw`
- Input devices via `input` zones:
  - `profile = input` (for devices like Shelly Plus i4)
- Group fan-out for output zones with partial-success warnings.

## Key Config Fields

- `backend = shelly`
- `generation = 1|2`
- `profile = switch|dimmer|rgbw|input`
- `model = ...` (optional metadata)
- `shelly_host = <ip-or-host>`
- `shelly_auth_user`, `shelly_auth_pass` (optional)
- `channel = 0` (default)

For input zones:

- `input_topic = <mqtt topic>` or `input_topics = topic1,topic2`
- `input_map = { ... }` (optional event-to-command mapping)

## Output Examples

### Gen1 RGBW

```ini
[light:shelly-room-rgbw]
type = light
topic = paradox/agent22/lights/shelly-rgbw
backend = shelly
generation = 1
profile = rgbw
model = rgbw2
shelly_host = 10.0.0.150
channel = 0
```

### Gen2 Switch

```ini
[light:shelly-switch-main]
type = light
topic = paradox/agent22/lights/shelly-switch
backend = shelly
generation = 2
profile = switch
model = plus-1
shelly_host = 10.0.0.151
channel = 0
```

### Group Fan-out

```ini
[light:shelly-1]
type = light
topic = paradox/agent22/lights/shelly-1
backend = shelly
generation = 1
profile = rgbw
shelly_host = 10.0.0.150

[light:shelly-2]
type = light
topic = paradox/agent22/lights/shelly-2
backend = shelly
generation = 1
profile = rgbw
shelly_host = 10.0.0.152

[light-group:shelly-room]
type = light-group
topic = paradox/agent22/lights/shelly-room
backend = shelly
devices = shelly-1,shelly-2
scene_map = {"normal":{"on":true,"brightness":80},"off":{"on":false}}
```

## Input Example (Plus i4)

```ini
[input:shelly-i4-main]
type = input
topic = paradox/agent22/inputs/main
backend = shelly
generation = 2
profile = input
model = plus-i4
input_topic = shellyplusi4-abc123/events/rpc
input_map = {"0.single_push":{"topic":"paradox/agent22/lights/commands","payload":{"command":"setColorScene","scene":"normal"}},"0.double_push":{"topic":"paradox/agent22/lights/commands","payload":{"command":"setColorScene","scene":"red"}}}
```

The `input_map` keys support:

- `<input>.<event>` (example: `0.single_push`)
- `<event>` fallback (example: `single_push`)

Mapped actions publish directly to the target MQTT topic with the configured payload plus `_input_event` metadata.
