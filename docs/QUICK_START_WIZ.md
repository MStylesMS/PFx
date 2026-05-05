# WiZ Quick Start (PFx)

> Deprecated: active PFx runtime no longer supports `light` zones or direct WiZ integration.
> Keep this document only for migration history on legacy installs. New hardware
> integrations should move to PxB, and active PFx configs should contain only `screen`
> and `audio` sections.

This guide covers the current PFx lighting implementation for WiZ.

## Current Capabilities

PFx now supports a `light` zone with backend selection:

- `backend = passthrough`: forwards lighting commands to another MQTT topic.
- `backend = wiz`: sends native WiZ UDP `setPilot` commands directly to a bulb IP.

Supported commands in this phase:

- `scene` / `setColorScene`
- `on`
- `off`
- `setBrightness`
- `setColor` (hex color)
- `fade` (applied as immediate level change with warning)

## 1) Configure PFx Zone (Native WiZ)

Add this to your main PFx INI (or to supplemental `pfx-lights.ini` if using `lights_config`):

```ini
[light:room-lights]
type = light
topic = paradox/agent22/lights
backend = wiz
bulb_ip = 192.168.1.120
wiz_port = 38899

; Optional: override built-in scenes
scene_map = {"normal":{"state":true,"dimming":80},"dim":{"state":true,"dimming":35},"red":{"state":true,"r":255,"g":0,"b":0,"dimming":80},"off":{"state":false}}
```

Built-in scene names include:

- `normal`
- `dim`
- `red`
- `blue`
- `green`
- `yellow`
- `orange`
- `off`

## 2) Start PFx

Example:

```bash
cd /opt/paradox/apps/ParadoxFX
node pfx.js --config /opt/paradox/config/agent22-pfx-pi5.ini
```

Optional split lights config:

```bash
cd /opt/paradox/apps/ParadoxFX
node pfx.js --config /opt/paradox/config/agent22-pfx-pi5.ini --lights-config /opt/paradox/config/pfx-lights.ini
```

Or in `[global]`:

```ini
lights_config = ./pfx-lights.ini
```

## 3) Send Commands

### Scene

```bash
mosquitto_pub -t paradox/agent22/lights/commands -m '{"command":"scene","name":"normal"}'
```

### On / Off

```bash
mosquitto_pub -t paradox/agent22/lights/commands -m '{"command":"on","brightness":80}'
mosquitto_pub -t paradox/agent22/lights/commands -m '{"command":"off"}'
```

### Brightness

```bash
mosquitto_pub -t paradox/agent22/lights/commands -m '{"command":"setBrightness","brightness":45}'
```

### Color

```bash
mosquitto_pub -t paradox/agent22/lights/commands -m '{"command":"setColor","color":"#00A0FF","brightness":75}'
```

## 4) Observe State and Warnings

```bash
mosquitto_sub -t paradox/agent22/lights/state
mosquitto_sub -t paradox/agent22/lights/warnings
mosquitto_sub -t paradox/agent22/lights/events
```

## 5) Passthrough Mode (Alternative)

If you want another service/device to apply lighting:

```ini
[light:room-lights]
type = light
topic = paradox/agent22/lights
backend = passthrough
forward_topic = paradox/agent22/lights/native/commands
```

PFx receives commands on `.../lights/commands`, normalizes them, then forwards to `forward_topic`.

## Grouping Status (Current Phase)

Config parser supports group-style keys (`lights`, `devices`, `device_list`) and `light-group` naming variants.

Current runtime behavior:

- Group zones (`type = light-group` / `light_group`) can fan out one command to multiple member lights.
- Preferred mode: define individual light zones and reference them in group `devices`.
- Fallback mode: define `bulb_ips` directly on the group to fan out without individual sections.

Example (4-light room group using member references):

```ini
[light:wiz-84]
type = light
topic = paradox/agent22/lights/wiz-84
backend = wiz
bulb_ip = 10.0.0.84

[light:wiz-109]
type = light
topic = paradox/agent22/lights/wiz-109
backend = wiz
bulb_ip = 10.0.0.109

[light:wiz-38]
type = light
topic = paradox/agent22/lights/wiz-38
backend = wiz
bulb_ip = 10.0.0.38

[light:wiz-130]
type = light
topic = paradox/agent22/lights/wiz-130
backend = wiz
bulb_ip = 10.0.0.130

[light-group:room-lights]
type = light-group
topic = paradox/agent22/lights
backend = wiz
devices = wiz-84,wiz-109,wiz-38,wiz-130
scene_map = {"normal":{"state":true,"dimming":80},"dim":{"state":true,"dimming":35},"off":{"state":false}}
```

Fallback group-only example:

```ini
[light-group:room-lights]
type = light-group
topic = paradox/agent22/lights
backend = wiz
bulb_ips = 10.0.0.84,10.0.0.109,10.0.0.38,10.0.0.130
```

## Notes

- Group fan-out reports partial success as command warnings when some targets fail.
- If all targets fail, the command is reported as failed.
