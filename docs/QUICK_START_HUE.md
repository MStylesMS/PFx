# Hue v2 Quick Start (PFx)

This guide walks through pairing PFx with a Philips Hue bridge using the Clip v2 API and configuring a lighting zone in your INI file.

**Requirements:** `curl`, `jq` (both standard on Raspberry Pi OS)

---

## Step 1 — Run the Pairing Script

```bash
cd /opt/paradox/apps/ParadoxFX
./scripts/hue-pair.sh                  # auto-discover bridge
# or
./scripts/hue-pair.sh 192.168.1.100    # supply IP directly
```

The script will:

1. Locate your bridge (via `discovery.meethue.com` or mDNS fallback)
2. Ask you to press the round link button on the bridge
3. Request an app key from the bridge
4. Query and print all available **rooms** and **zones** with their `grouped_light` RIDs
5. Print a ready-to-paste INI config snippet

**Sample output:**

```
=== ROOMS (2) ===

  Room: Escape Room
    room RID     : 11111111-aaaa-bbbb-cccc-000000000001
    grouped_light: 22222222-aaaa-bbbb-cccc-000000000002

  Room: Hallway
    room RID     : 33333333-aaaa-bbbb-cccc-000000000003
    grouped_light: 44444444-aaaa-bbbb-cccc-000000000004

=== READY-TO-PASTE INI CONFIG ===

[light:escape-room]
type              = light
backend           = hue
topic             = paradox/ROOM_NAME/lights/ZONE_NAME
hue_bridge_host   = 192.168.1.100
hue_app_key       = abc123xyz...
hue_resource_id   = 22222222-aaaa-bbbb-cccc-000000000002
hue_resource_type = room
hue_profile       = color
```

> **Security note:** The `hue_app_key` grants full control of the bridge. Treat it like a password.

---

## Step 2 — Add the Zone to Your INI File

Copy the snippet into your room's PFx INI (for example `houdini-pfx-pi5.ini`):

```ini
[light:hue-main-room]
type              = light
backend           = hue
topic             = paradox/houdini/lights/main

hue_bridge_host   = 192.168.1.100
hue_app_key       = your-app-key-here
hue_resource_id   = 22222222-aaaa-bbbb-cccc-000000000002    ; grouped_light RID
hue_resource_type = room
hue_profile       = color
```

### Profile options

| `hue_profile` | Behaviour |
|---|---|
| `color` | Full colour via CIE XY (default). Best for colour-capable bulbs. |
| `ct` | Colour temperature via mirek (2000–6500 K). Use for white-ambiance bulbs. |
| `dim` | Brightness only. Use for dimmable non-colour bulbs. |

### Resource type options

| `hue_resource_type` | Target |
|---|---|
| `room` | Hue room (controls all lights via `grouped_light` service RID) |
| `zone` | Hue zone (same API, different organisational grouping) |
| `light` | Individual light (Phase 2; requires single-light RID) |

---

## Step 3 — Test with MQTT

Start PFx and publish a scene command:

```bash
mosquitto_pub -h localhost \
  -t 'paradox/houdini/lights/main/commands' \
  -m '{"command":"scene","scene":"softWhite"}'
```

Monitor status:

```bash
mosquitto_sub -h localhost -t 'paradox/houdini/lights/main/#' -v
```

---

## Built-in Scene Names

These scene names work out-of-the-box on any Hue zone configured in PFx:

| Scene | Color profile | CT profile | Dim profile |
|---|---|---|---|
| `normal` | warm white XY | — | 80% |
| `dim` | — | — | 35% |
| `off` | power off | power off | power off |
| `red` | red XY | — | 80% |
| `blue` | blue XY | — | 75% |
| `green` | green XY | — | 75% |
| `yellow` | yellow XY | — | 80% |
| `orange` | orange XY | — | 80% |
| `purple` | purple XY | — | 75% |
| `pink` | pink XY | — | 75% |
| `cyan` | cyan XY | — | 75% |
| `magenta` | magenta XY | — | 75% |
| `white` | 4000 K → XY | 4000 K (250 mr) | 75% |
| `softWhite` / `softwhite` | 2700 K → XY | 2700 K (370 mr) | 70% |
| `brightWhite` / `brightwhite` | 6500 K → XY | 6500 K (154 mr) | 100% |
| `warmWhite` / `warmwhite` | 2200 K → XY | 2200 K (455 mr) | 80% |
| `coolWhite` / `coolwhite` | 6000 K → XY | 6000 K (167 mr) | 85% |

Override or extend any scene with `scene_map` in the INI section (same syntax as WiZ).

---

## Custom Scene Map

```ini
[light:hue-accent]
type              = light
backend           = hue
topic             = paradox/houdini/lights/accent
hue_bridge_host   = 192.168.1.100
hue_app_key       = your-app-key-here
hue_resource_id   = xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
hue_resource_type = room
hue_profile       = color

; Define a custom scene by overriding the built-in 'normal'
; scene_map values follow the same format as WiZ (r/g/b + brightness)
scene_map = normal={"on":true,"r":255,"g":200,"b":100,"brightness":70}
```

---

## Direct Commands

Beyond scenes, PFx supports these commands directly:

```bash
# Turn on at a specific brightness
mosquitto_pub -h localhost \
  -t 'paradox/houdini/lights/main/commands' \
  -m '{"command":"setBrightness","brightness":50}'

# Turn off
mosquitto_pub -h localhost \
  -t 'paradox/houdini/lights/main/commands' \
  -m '{"command":"off"}'

# Turn on (at previous brightness)
mosquitto_pub -h localhost \
  -t 'paradox/houdini/lights/main/commands' \
  -m '{"command":"on"}'

# Set a specific colour
mosquitto_pub -h localhost \
  -t 'paradox/houdini/lights/main/commands' \
  -m '{"command":"setColor","color":"#ff4400","brightness":70}'
```

---

## Common Issues

**"Hue backend initialization failed"**
- Verify the bridge IP: `curl -k https://192.168.1.100/api/0/config | jq .name`
- Verify the app key: `curl -k -H "hue-application-key: YOUR_KEY" https://192.168.1.100/clip/v2/resource`
- Verify `hue_resource_id` is the `grouped_light` RID, not the room RID

**"Link button not pressed"**
- Re-run `hue-pair.sh` and press the physical link button on the bridge within the prompt window

**Scenes apply brightness but not colour**
- Check `hue_profile` matches the bulb capability (`color`, `ct`, or `dim`)
- White-ambiance bulbs need `hue_profile = ct`; dimmable-only bulbs need `hue_profile = dim`

**Bridge not found by discovery script**
- Supply IP directly: `./scripts/hue-pair.sh 192.168.1.100`
- Check that the Pi and bridge are on the same VLAN/subnet
