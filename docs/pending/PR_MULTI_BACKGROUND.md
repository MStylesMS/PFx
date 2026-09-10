# PR: Multiple backgrounds + live audio status / kill

**Status:** implemented.  
**Test case:** TFD generator on `generator.local` — room bed (`background.mp3`) plus generator loop (`gen_loop.mp3`) at the same time.  
**Owner:** runtime on this branch.

Related: [MQTT_API.md](../MQTT_API.md) (contract updated in the same commit).

---

## Why

A zone today has **one** resident background mpv. `playBackground` does `loadfile replace`. TFD (and other rooms) need two looping beds that duck together under speech. Operators also need to see what is playing and stop one clip without `stopAll`.

Using a second bed must **succeed** and emit a **warning** (log + MQTT). Not an error.

---

## Goals

1. **Multiple background beds** on one audio or screen zone.
2. **Warning** (not failure) when a play starts while another bed is already active.
3. **Status** for every background and speech item: file name, playing/paused, time left.
4. **Kill** a specific background or speech item by `id` or by `file`.
5. Speech ducking and `stopAll` apply to **all** beds.

Non-goals: changing SFX (`playAudioFX` stays fire-and-forget spawn). Video playlist is unchanged.

---

## Current code (what to extend)

| Piece | Today |
|-------|--------|
| `lib/media/audio-manager.js` | One `backgroundMusic` process + `backgroundMusicSocket`. `playBackgroundMusic` → `loadfile replace`. |
| Speech | One speech mpv + in-memory queue. |
| Zone status | `current_state.backgroundMusic` (single file), `speechQueueLength`, `mpv_instances.background` / `.speech` (single). |
| `stopBackground` / `stopSpeech` | Stop the one bed / clear the whole speech queue. |

---

## Proposed behaviour

### Identifiers

- Optional `id` on `playBackground` (string, e.g. `"room"`, `"generator"`).
- Same `id` (or same `file` when `id` omitted) **replaces** that bed. No warning.
- A **new** `id` (or new file with no `id` while another bed is active) **adds** a bed and warns.
- If `id` is omitted on the first bed, treat it as `id: "default"` so old callers keep working.

Speech already queues. Add optional `id` on `playSpeech` for kill/status; default id is the basename.

### Warning (multiple backgrounds)

When a second (or Nth) distinct bed starts:

- Log at `warn`.
- Publish command outcome `outcome: "warning"`, `error_type` / `warning_type`: `multiple_backgrounds`.
- Include `background_count` and the list of `id`s.
- **Still start the new bed.**

### Ducking

One duck factor applies to **every** bed. Existing `ducking_adjust` / telemetry (`effective_volume`, `pre_duck_volume`, `ducked`) stay; per-bed volume may be added later.

### Stop / kill

| Command | No selector | With `id` or `file` |
|---------|-------------|---------------------|
| `stopBackground` | Stop **all** beds (today’s behaviour) | Stop that bed only |
| `stopSpeech` | Stop current + clear queue (today) | Stop / drop the matching item only |
| `skipSpeech` | Skip current (today) | Unchanged unless `id`/`file` given (skip that item if queued; skip current if it matches) |
| `stopAll` / `stopAudio` | All beds + all speech | Unchanged |

Unknown `id` / `file`: warning outcome, no other change.

### Status (retained zone `state` + on-demand)

Extend `current_state` (audio and screen zones):

```json
{
  "backgrounds": [
    {
      "id": "room",
      "file": "generator/background.mp3",
      "state": "playing",
      "time_left_s": 41.2,
      "duration_s": 180.0,
      "loop": true
    },
    {
      "id": "generator",
      "file": "generator/gen_loop.mp3",
      "state": "playing",
      "time_left_s": 12.0,
      "duration_s": 24.0,
      "loop": true
    }
  ],
  "speech": {
    "current": {
      "id": "genStart",
      "file": "generator/genStart.mp3",
      "state": "playing",
      "time_left_s": 3.4,
      "duration_s": 8.1
    },
    "queue": [
      {
        "id": "hurry",
        "file": "generator/hurry.mp3",
        "state": "queued",
        "time_left_s": null,
        "duration_s": null
      }
    ]
  }
}
```

`state` for a bed or speech item: `playing` | `paused` | `queued`.

Keep `backgroundMusic` and `speechQueueLength` as **derived** fields (first/only bed file, queue length) so old dashboards do not break.

`mpv_instances.background` becomes an **array** (or `backgrounds` alongside the legacy single object). Prefer adding `mpv_instances.backgrounds` and leaving the old single object as bed `default` / first bed.

On-demand inspect (optional, same payload shape):

```json
{ "command": "audioStatus" }
```

Publishes `{baseTopic}/events` with `audio_status: { backgrounds, speech }`.

Time left: from mpv `duration` − `time-pos`. For looping beds, time left is time to next loop boundary (remaining in this pass), not infinity.

Publish status when beds/speech change and on the existing status interval.

---

## MQTT commands (implement exactly)

See [MQTT_API.md](../MQTT_API.md) for the canonical payloads. Summary:

```json
{ "command": "playBackground", "file": "generator/background.mp3", "id": "room", "loop": true }
{ "command": "playBackground", "file": "generator/gen_loop.mp3", "id": "generator", "loop": true }
{ "command": "stopBackground", "id": "generator" }
{ "command": "stopBackground", "file": "generator/gen_loop.mp3" }
{ "command": "pauseBackground", "id": "room" }
{ "command": "resumeBackground", "id": "room" }
{ "command": "playSpeech", "file": "generator/genStart.mp3", "id": "genStart" }
{ "command": "stopSpeech", "id": "genStart" }
{ "command": "stopSpeech", "file": "generator/genStart.mp3" }
{ "command": "audioStatus" }
```

`loop` on `playBackground` already exists in code; document it if the public API section still omits it.

---

## Implementation sketch

1. **Docs** (this file + MQTT_API) — this commit.
2. **audio-manager:** replace the single `backgroundMusic` handle with a `Map<id, { process, socket, file, volume, loop }>`. Spawn another `--idle=yes` mpv per new id (same flags as today’s background instance).
3. **Zones:** pass `id` through `playBackground` / `stopBackground` / pause / resume; compute warning when `map.size` would go from 1 → 2+.
4. **Ducking:** iterate all beds when applying / clearing duck volume.
5. **Shutdown / stopAll:** quit every bed socket + speech.
6. **Status:** query each socket for pause + time-pos + duration; build `backgrounds` + `speech`.
7. **Tests:**
   - Second `playBackground` with a new id starts and warns.
   - Same id replaces, no warning.
   - `stopBackground` `{id}` leaves the other bed.
   - `stopBackground` with no id stops all.
   - Duck applies to both beds.
   - `audioStatus` / state lists both beds + current speech + queue.
   - `stopSpeech` `{file}` drops one queued item without clearing the rest.
8. **Pi check:** two beds + one speech on analog (TFD generator) — duck, kill one bed, confirm the other continues. Still pending on hardware.

---

## Acceptance

- [x] Two looping beds on one zone; speech ducks both.
- [x] Second bed → log + MQTT warning, playback still starts.
- [x] Retained `state` and `audioStatus` show file, playing/paused/queued, time left for every bed and speech item.
- [x] `stopBackground` / `stopSpeech` with `id` or `file` kills only that item.
- [x] Legacy single-bed callers (`playBackground` without `id`) still work.
- [x] Unit tests above pass; MQTT_API examples match the code.
