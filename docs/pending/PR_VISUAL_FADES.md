# PR: Visual fades to/from a color or a static image

**Status:** proposed (not implemented). Not scheduled; rooms use instant cuts for now.
**Owner:** TBD.

Related: [MQTT_API.md](../MQTT_API.md), PxC `fade_background_*` settings and `setDisplayColors`.

---

## Why

PFx `fadeTime` today only ramps **audio** volume (`stopVideo`, `stopBackground`, `stopSpeech`, `stopAudio`, `stopAll`). The picture always cuts instantly. There is no visual fade, not even to black.

PxC can already fade to/from any color (`fade_background_color`, `setDisplayColors` + `fadeTime`) or a static image (`fade_background_type = image`). PFx should be able to match that, so screen hand-offs between PFx and PxC (or between PFx media) can dissolve instead of cut.

**Current workaround (preferred for now):** bake the fade into the video so its first/last frame is a pixel-perfect match of what PxC (or the next PFx image) displays, and use instant cuts.

---

## Goals

1. Fade the screen **out to** a solid color (black, white, any hex/named color) or a static image.
2. Fade the screen **in from** a solid color or a static image.
3. Optional `fadeTime` on visual commands: `setImage`, `playVideo`, `stopVideo`, `transition`, `stopAll`.
4. Audio and visual fades on the same command run on the same clock.
5. Color names and hex formats match PxC (`#RRGGBB`, `#RRGGBBAA`, PxC's named color list).

Non-goals: arbitrary crossfades between two playing videos; per-pixel effects; changes to PFxE (Electron) beyond keeping the MQTT contract aligned.

---

## Proposed MQTT contract (draft)

New optional fields, accepted on `setImage`, `playVideo`, `stopVideo`, `transition`:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `fadeIn` | number (s) | 0 | Fade in from `fadeFrom` over N seconds |
| `fadeOut` | number (s) | 0 | (stop/transition) fade out to `fadeTo` over N seconds |
| `fadeFrom` | color or image path | `black` | What the screen fades in from |
| `fadeTo` | color or image path | `black` | What the screen fades out to |

New standalone command:

```json
{ "command": "fadeScreen", "to": "white", "fadeTime": 1.5 }
{ "command": "fadeScreen", "to": "backgrounds/end.png", "fadeTime": 2 }
{ "command": "fadeScreen", "to": "clear", "fadeTime": 1 }
```

`to: "clear"` removes the overlay (fade back in to whatever is underneath).

INI defaults per screen zone: `fade_color` (default `#000000`), `fade_image` (optional), `fade_time_default` (default 0).

Events: `screen_fade_started`, `screen_fade_complete` (with `to`, `fadeTime`). Invalid color/path → `command_rejected`.

---

## Implementation options

mpv cannot blend between two separate media items on the fly, so color/image fades need a compositing layer.

| Option | Black only | Any color / image | Notes |
|---|---|---|---|
| A. Ramp mpv `brightness` via IPC | ✅ | ❌ | Cheapest; ~0.5–1 day. Brightness +100 is not true white. |
| B. mpv lavfi filter (`fade=...:color=`, `overlay` with an image) via `vf add`/`vf remove` | ✅ | ✅ | Stays in mpv; filter swaps can glitch on Pi hardware decode (`hwdec`). Needs Pi testing. |
| C. Full-screen overlay window (Chromium/Electron) above mpv, animate opacity | ✅ | ✅ | Reuses the existing browser overlay plumbing; must solve window stacking/focus with mpv. |

Recommendation: prototype **B** first on a Pi 4 / Pi 5; fall back to **C** if filter swaps cause dropped frames or black flashes.

**Rough effort (estimate, not measured):** black-only via A ≈ 0.5–1 day. Any color or image via B or C ≈ 2–4 days including Pi timing tests.

---

## Tasks

- [ ] Spike: lavfi fade/overlay on Pi 4 + Pi 5 with current mpv profile; measure frame drops
- [ ] Color parser shared with PxC semantics (named + hex + alpha)
- [ ] `fadeScreen` command + INI defaults
- [ ] `fadeIn`/`fadeOut`/`fadeFrom`/`fadeTo` on `setImage`, `playVideo`, `stopVideo`, `transition`, `stopAll`
- [ ] Coordinate visual fade with existing audio `fadeTime`
- [ ] Events + state (`screenFade: { to, active }`)
- [ ] Unit tests (parsing, validation, timing) and a manual Pi test script
- [ ] Update MQTT_API.md and CHANGELOG

## Acceptance

- Fade to/from white, a hex color, and a PNG are smooth on a Pi 4 at 1080p (no black flash, no visible stepping).
- Final frame of a fade to a color matches PxC's `fade_background_color` for the same value.
- `fadeTime` 0 / omitted keeps today's instant-cut behavior exactly.
