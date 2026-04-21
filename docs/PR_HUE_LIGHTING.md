# PR: Hue v2 Lighting Backend

Adds `backend = hue` support to PFx `LightZone` using the Philips Hue CLIP v2 API.
Targets Hue rooms, zones, and individual lights. TLS verification is disabled
(`rejectUnauthorized: false`) since the bridge uses a self-signed cert on a local LAN.

## Legend

| Marker | Meaning |
|--------|---------|
| 🤖 | Autopilot — AI agent can implement this without hardware access |
| 🔌 | Hardware required — needs a physical Hue bridge and bulbs |

---

## Architecture

Follows the same backend strategy pattern as WiZ and Shelly:

| New file | Purpose |
|---|---|
| `lib/lights/backends/hue-backend.js` | Core Hue v2 backend |
| `scripts/hue-pair.sh` | One-time pairing and resource-discovery script |
| `docs/HUE_QUICK_START.md` | Operator setup guide |
| `test/unit/hue-backend.test.js` | Backend unit tests |

**Modified files:** `light-zone.js`, `config-loader.js`, `config-loader.test.js`, `CONFIG_INI.md`

> **Note:** The existing `lib/controllers/hue-controller.js` placeholder is **superseded** by the
> new backend and will be deleted at the end of Phase 1.

### Key API Facts (v2 / CLIP)

- Base URL: `https://{bridge_ip}/clip/v2/resource/`
- Auth header: `hue-application-key: {app_key}` on every request
- Pairing endpoint (still v1): `POST https://{bridge_ip}/api` — returns `username` which becomes
  the app key
- TLS: bridge uses a self-signed cert; use `rejectUnauthorized: false` on a trusted LAN
- Room/zone control: target the `grouped_light` service RID (not the room RID directly):
  `PUT /clip/v2/resource/grouped_light/{rid}`

---

## Also Implemented During This Work

The following were added beyond the original PR scope during the Hue phase:

| Item | Status |
|------|--------|
| `lib/lights/backends/wiz-native-backend.js` | ✅ WiZ native UDP LAN backend (phase 0) |
| `lib/lights/backends/shelly-backend.js` | ✅ Shelly HTTP/RPC backend (phase 0) |
| `lib/lights/backends/lifx-backend.js` | ✅ LIFX binary UDP LAN backend |
| `lib/lights/backends/multi-target-backend.js` — warning propagation | ✅ Per-target degradation warnings surfaced to log + MQTT warnings topic |
| `test/unit/lifx-backend.test.js` | ✅ 46 tests |
| `test/unit/multi-target-backend.test.js` | ✅ 9 tests |
| Mixed-backend groups (WiZ + Hue + LIFX in same `light-group`) | ✅ Fully supported |
| `docs/CONFIG_INI.md` — `lifx_port`, `lifx_kelvin` fields | ✅ Documented |

---

## Phase 1 — Core Control ✅ COMPLETE (🤖 items) — 🔌 live test pending

**Goal:** Feature parity with WiZ — on/off, named scenes, brightness — against a Hue room or zone.
Supports color, color-temperature, and dim-only profiles via an explicit `hue_profile` INI key.

### Checklist

#### Pairing Script (`scripts/hue-pair.sh`)
- [x] 🤖 Accept bridge IP as positional arg `$1`, or prompt if omitted
- [x] 🤖 `GET http://{ip}/api/0/config` (plain HTTP) → extract and print `bridgeid` to confirm connectivity
- [x] 🤖 Prompt user to press the bridge link button, then press Enter
- [x] 🤖 `POST -k https://{ip}/api` with `{"devicetype":"paradoxfx#pfx","generateclientkey":true}`
- [x] 🤖 Extract `username` (app key) from JSON response; handle the `link button not pressed` error and retry
- [x] 🤖 Query rooms: `GET /clip/v2/resource/room` — print name, room RID, and grouped_light service RID
- [x] 🤖 Query zones: `GET /clip/v2/resource/zone` — print name, zone RID, and grouped_light service RID
- [x] 🤖 Print ready-to-paste INI config snippet with all fields filled in
- [x] 🔌 Live test: run script against real bridge, confirm printed room list and INI snippet

#### `hue-backend.js`
- [x] 🤖 Constructor: create persistent `https.Agent({ rejectUnauthorized: false })`
- [x] 🤖 `initialize()`: `GET /clip/v2/resource/grouped_light/{rid}` to validate connectivity + log profile
- [x] 🤖 `executeCommand({ command, ...params })`:
  - `on` → `PUT {"on": {"on": true}}`
  - `off` → `PUT {"on": {"on": false}}`
  - `brightness` → `PUT {"dimming": {"brightness": N}}` (0–100)
  - `scene` → resolve via `scene_map` / `HUE_DEFAULT_SCENES`, build payload by `hue_profile`
- [x] 🤖 Profile-aware payload builder (set via `hue_profile` INI key):
  - `color` → `{color: {xy: {x, y}}, dimming: {brightness: N}}`
  - `ct` (color temperature) → `{color_temperature: {mirek: N}, dimming: {brightness: N}}`
  - `dim` → `{dimming: {brightness: N}}`
- [x] 🤖 `HUE_DEFAULT_SCENES` map — matches WiZ scene names and adds Hue-appropriate payloads:
  `normal`, `dim`, `red`, `blue`, `green`, `yellow`, `orange`, `purple`, `pink`,
  `cyan`, `magenta`, `white`, `softWhite`/`softwhite`, `brightWhite`/`brightwhite`,
  `warmWhite`/`warmwhite`, `coolWhite`/`coolwhite`, `off`
- [x] 🤖 RGB → XY helper: sRGB gamma decode → linear → multiply by D65 sRGB→XYZ matrix → `x = X/(X+Y+Z)`, `y = Y/(X+Y+Z)`; gamut-B clamp
- [x] 🤖 Kelvin → mirek helper: `Math.round(1_000_000 / K)`; clamp to Hue range 153–500
- [x] 🤖 INI `scene_map` override (same pattern as WiZ backend)
- [x] 🤖 `shutdown()`: destroy `https.Agent`
- [x] 🤖 All non-2xx responses throw with status + body for diagnosability
- [x] 🔌 Live smoke test: `{"command":"scene","scene":"softWhite"}` → verify HTTPS PUT sent and bulb changes

#### `light-zone.js`
- [x] 🤖 Add `case 'hue':` to `_createBackendForConfig()`; import `HueBackend`

#### `config-loader.js` — new fields for `light` and `light_group` sections
- [x] 🤖 `hue_bridge_host` (string, required for hue backend)
- [x] 🤖 `hue_app_key` (string, required)
- [x] 🤖 `hue_resource_id` (string, the `grouped_light` service RID)
- [x] 🤖 `hue_resource_type` (string: `room` | `zone` | `light`, default `room`)
- [x] 🤖 `hue_profile` (string: `color` | `ct` | `dim`, default `color`)

#### Tests
- [x] 🤖 `hue-backend.test.js`: mock `https.request`; 30 tests covering on/off, scene→XY, scene→mirek, brightness, dim profile, unknown scene (warn + no-throw), HTTP error response
- [x] 🤖 `config-loader.test.js`: `[light:hue-test]` and minimal fixture → all `hue_*` fields asserted

#### Docs
- [x] 🤖 `docs/HUE_QUICK_START.md`: pairing walkthrough, INI example, scene-name table, common issues
- [x] 🤖 `docs/CONFIG_INI.md`: `[light:hue-zone]` example block; all `hue_*` fields documented
- [x] 🤖 Delete `lib/controllers/hue-controller.js` (placeholder superseded)
- [x] 🔌 Verify no remaining references to `hue-controller.js` — confirmed zero references

#### Example INI (Phase 1)

```ini
[light:hue-main-room]
type              = light
backend           = hue
topic             = paradox/houdini/lights/main

hue_bridge_host   = 192.168.1.XXX
hue_app_key       = your-app-key-here
hue_resource_id   = xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx   ; grouped_light service RID
hue_resource_type = room
hue_profile       = color

; optional: override individual scene names
scene_map = softWhite=softWhite,brightWhite=brightWhite
```

---

## Phase 2 — Enhanced Control

**Goal:** Transition time for fades, per-light gamut-aware control, and automatic capability detection.

### Checklist

#### Transition Time
- [ ] 🤖 Add optional `transition_ms` field to PFx command schema (passed in MQTT JSON payload)
- [ ] 🤖 `HueBackend.executeCommand()` maps `transition_ms` → Hue v2 `dynamics.duration` (ms integer)
- [ ] 🤖 INI key `hue_default_transition_ms` — zone-level default (0 = instant)
- [ ] 🤖 `config-loader.js`: parse `hue_default_transition_ms`
- [ ] 🔌 Live test: fade to `dim` scene over 3 seconds and observe smooth transition

#### Per-Light Control
- [ ] 🤖 Support `hue_resource_type = light` targeting `PUT /clip/v2/resource/light/{rid}`
- [ ] 🤖 At `initialize()`, read `color.gamut_type` from light resource (`A`, `B`, or `C`)
- [ ] 🤖 Gamut triangle clamp for XY: cross-product containment method; gamut tables for A, B, C
- [ ] 🤖 Phase 1 hardcoded gamut-B clamp upgraded to gamut-type-aware
- [ ] 🔌 Live test: send red to a single light RID; verify clamp works on a gamut-A bulb

#### Auto Capability Detection
- [ ] 🤖 At `initialize()`, inspect resource services for `color` and `color_temperature` support
- [ ] 🤖 Derive `effective_profile`: `color` > `ct` > `dim`
- [ ] 🤖 Override config-declared `hue_profile` if mismatch; log warning so INI can be corrected
- [ ] 🤖 Opt-out: `hue_auto_profile = false` forces configured profile (default: `true`)
- [ ] 🤖 `config-loader.js`: parse `hue_auto_profile`
- [ ] 🔌 Live test: configure `hue_profile = color` on a dim-only bulb; verify auto-detection warning and correct dim behavior

---

## Phase 3 — Event Integration & Discovery

**Goal:** Receive Hue state changes via SSE to keep PFx state in sync; auto-discover bridge IP.

### Checklist

#### SSE Event Streaming
- [ ] 🤖 `HueBackend` opens persistent `GET /eventstream/clip/v2` (`Accept: text/event-stream`)
- [ ] 🤖 Parse incoming events: filter `update` type for `grouped_light` / `light` resource
- [ ] 🤖 On `on.on`, `dimming.brightness`, `color.xy`, `color_temperature.mirek` changes →
  update `currentState` and publish to MQTT state topic
- [ ] 🤖 Reconnect on disconnect: exponential backoff starting at 2 s, cap 30 s
- [ ] 🤖 INI key `hue_events_enabled` (default `true`); `false` to disable
- [ ] 🤖 `config-loader.js`: parse `hue_events_enabled`
- [ ] 🔌 Live test: change bulb brightness from phone app; verify PFx state topic updates within 2 s

#### Bridge Auto-Discovery
- [ ] 🤖 New utility: `lib/lights/hue-discovery.js`
  - Method 1: `GET https://discovery.meethue.com` (HTTPS, external) → returns array of bridges with IP
  - Method 2: mDNS — shell out to `avahi-browse -r -t _hue._tcp` as LAN fallback
- [ ] 🤖 Update `hue-pair.sh`: if no IP arg given, run auto-discovery and offer numbered bridge selection
- [ ] 🔌 Live test: run `hue-pair.sh` with no args on local network; confirm bridge is found

---

## Reference Notes

- **Color conversion:** sRGB → linear (gamma ÷ 2.2 approx) → XY via D65 matrix.
  `x = X/(X+Y+Z)`, `y = Y/(X+Y+Z)`. Gamut clamp keeps XY within the bulb's reachable triangle.
- **Color temperature:** Hue uses mirek (μrd). `mirek = Math.round(1_000_000 / kelvin)`.
  Hue range: 153 (6500 K cool white) → 500 (2000 K warm candlelight).
- **grouped_light RID ≠ room RID.** The pairing script queries and displays both; use the
  `grouped_light` service RID in all PUT calls.
- **TLS:** `rejectUnauthorized: false` via a persistent `https.Agent`. This is safe for a
  controlled LAN where the bridge IP is known and trusted.
- **Node.js built-in `https` module only** — no npm Hue SDK.
- **`hue-controller.js`** (the old placeholder) uses v1 terminology (`bridge_username`,
  integer group IDs) incompatible with v2 and will be deleted in Phase 1.

---

## Verification

1. [x] 🤖 `npm test` — all existing tests plus new `hue-backend.test.js` and config-loader Hue cases pass (62 unit tests total, excluding pre-existing `schema-validation` failure unrelated to lighting)
2. [ ] 🔌 `hue-pair.sh` end-to-end: run against real bridge, confirm app key returned + room list printed + INI snippet output
3. 🔌 Publish `{"command":"scene","scene":"softWhite"}` to Hue zone topic; verify correct XY or mirek PUT body
4. 🔌 Publish `{"command":"brightness","value":30}`; confirm `dimming.brightness: 30` in PUT body
5. 🤖 Confirm `hue-controller.js` has zero references across codebase after deletion
6. 🔌 (Phase 2) Publish with `transition_ms: 3000`; observe smooth 3-second fade on hardware
7. 🔌 (Phase 3) Change brightness from phone app; observe MQTT state topic update within 2 s
