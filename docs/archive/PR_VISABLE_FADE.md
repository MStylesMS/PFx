# PR: Visible Fade Support for Screen Media in PFx

## Summary

Add explicit visible fade support for screen media transitions in PFx, with two implementation phases:

1. Phase 1: fade-to-black / fade-from-black only, with no true overlap between old and new media.
2. Phase 2: true cross-fade between outgoing and incoming media.

This document is written as an implementation handoff for an agent. It is intentionally explicit about behavior, constraints, and edge cases.

## Motivation

- PFx currently supports fade behavior for several stop commands, but `setImage` is effectively immediate replace.
- Game flows such as failure/success logo reveals benefit from visible transitions rather than hard cuts.
- The first goal is low-risk visible fading to/from black for both images and video.
- True cross-fade should be treated as a separate follow-up because it requires materially different rendering architecture.
- Phase 1 delivery is the priority; Phase 2 is a later enhancement.

## Product Decisions Confirmed

These are fixed requirements for this PR series:

1. Fade in and fade out must be allowed for both images and video.
2. Until cross-fade is implemented, all fades are to/from black only.
3. Maximum fade duration must be the minimum of 10 seconds or the length of the video.
4. Default fade time is 0. No fade occurs unless explicitly set to a positive value.
5. If media changes before a fade completes, the new change should be instant. Do not continue or complete the prior fade.
6. Fade behavior is opt-in only. No zone-wide implicit default behavior for now.
7. If a video is paused during a fade, the fade may continue.

## Current State

### What exists today

- `setImage` currently loads media immediately with no visible fade semantics.
- `setImage` supports both static images and video-first-frame behavior.
- `playVideo` loads and starts video immediately.
- Several stop commands already accept `fadeTime` in seconds.
- Current screen/media playback is built around a single MPV instance per screen zone.

### Important implementation facts

- The current architecture is well-suited to Phase 1 fade-to-black transitions.
- The current architecture is not naturally suited to true cross-fade because there is only one primary render instance per screen zone.
- Existing `fadeTime` fields on stop commands provide a precedent for fade semantics that Phase 1 will extend to media-change commands.

## Non-Goals

### Not part of Phase 1

- No true overlap of old and new visuals.
- No configurable fade curves beyond simple linear fade.
- No zone-wide default fade policy.
- No automatic fade behavior on every `setImage` or `playVideo`.

### Not part of this PR series unless explicitly added later

- Browser window fading.
- Audio ducking changes.
- Fancy visual effects beyond black fade and later true cross-fade.

## Scope Overview

### Phase 1

Implement explicit fade-out to black, media swap, and fade-in from black.

This phase should support:

- `setImage` with images
- `setImage` with videos paused on first frame
- optionally `playVideo` if the team wants consistency across screen-media entry points

The visual result is:

- old media visible
- fade to black
- swap/load new media
- fade up from black

There is no overlap between outgoing and incoming content.

### Phase 2

Implement true cross-fade between outgoing and incoming content.

This phase should be treated as a separate architecture project because it will likely require:

- two visible render layers, or
- two MPV instances, or
- an explicit compositor/overlay strategy with independent opacity control

## Proposed Command Contract

Use numeric seconds for fade durations, aligned with existing `fadeTime` semantics on stop commands.

### Phase 1 Contract

Minimum contract for media commands that should visibly fade:

```json
{
  "command": "setImage",
  "file": "images/logo-failed.png",
  "fadeOut": 0.8,
  "fadeIn": 0.8
}
```

Supported fields:

- `fadeOut` optional number in seconds
- `fadeIn` optional number in seconds
- `fadeTime` optional number in seconds (legacy; not recommended with new fields)

#### Mutual Exclusivity and Conflict Resolution

If both legacy `fadeTime` and new `fadeOut`/`fadeIn` fields are present in the same command:

1. **Warn and use the new fields** (`fadeOut` and `fadeIn` take precedence).
2. **Publish the error** to the system error topic so operators are notified of misconfiguration.
3. **Do not fail or stop loading**—proceed with the command using the new field values.
4. **Example conflict:**
   ```json
   {
     "command": "setImage",
     "file": "images/logo-failed.png",
     "fadeTime": 2.0,
     "fadeOut": 0.8
   }
   ```
   Result: `fadeTime` is ignored with a warning logged; `fadeOut: 0.8` is applied.

#### Resolution Rules

- If `fadeOut` is omitted or ≤ 0, no fade-out occurs.
- If `fadeIn` is omitted or ≤ 0, no fade-in occurs.
- If both are omitted or absent, the media change is immediate (no fade).
- If `fadeTime` is present alone (no new fields), fall back to legacy behavior: apply to both fade-out and fade-in.

### Allowed command examples

Immediate behavior, unchanged from today:

```json
{
  "command": "setImage",
  "file": "images/logo-failed.png"
}
```

Fade out only:

```json
{
  "command": "setImage",
  "file": "images/logo-failed.png",
  "fadeOut": 1.5
}
```

Fade in only:

```json
{
  "command": "setImage",
  "file": "images/logo-failed.png",
  "fadeIn": 1.5
}
```

Fade out then fade in with separate durations:

```json
{
  "command": "setImage",
  "file": "images/logo-failed.png",
  "fadeOut": 0.8,
  "fadeIn": 1.2
}
```

Legacy behavior (still supported but not recommended with new fields):

```json
{
  "command": "setImage",
  "file": "images/logo-failed.png",
  "fadeTime": 1.5
}
```
This applies `fadeTime` to both fade-out and fade-in symmetrically.

### Validation Rules

- `fadeOut` and `fadeIn` must be numeric and finite if provided.
- Negative values must be normalized to 0 with a warning.
- Values greater than 10 seconds must be capped to 10 seconds with a warning.
- For video media, effective fade duration must be further capped to the video length (whichever is shorter: 10s or video length).
- For images, effective fade duration is capped to 10 seconds maximum.
- If both `fadeTime` and new fields are present, publish a warning and use the new fields.

### Time unit rule

- MQTT payload continues to use seconds as a float.
- Internally, PFx may convert to milliseconds.
- Example: `1.5` seconds equals `1500ms` internally.

## Phase 1 Technical Design

## Goal

Deliver visible fade-to-black and fade-from-black with minimal architecture change.

## Recommended mechanism

Use a single MPV render path and drive a black fade layer or black fade effect around the current content.

There are two acceptable implementation approaches for stage 1:

### Preferred Approach: Explicit Black Overlay Opacity Control

Mechanism:

- keep current media loaded and visible
- place a black visual layer above the content
- animate overlay opacity from 0 to 1 for fade-out
- after fully black, swap media
- animate overlay opacity from 1 to 0 for fade-in

Why preferred:

- avoids mutating media volume or brightness in ways that may have side effects
- maps directly to the visual requirement: fade to black
- works for images, paused video, and playing video
- keeps semantics separate from audio control

### Acceptable Fallback: Brightness/Opacity-Style Fade of the Single Render Output

Mechanism:

- animate the visible output down toward black
- swap media at black
- animate back up

Why this is less preferred:

- may be more implementation-sensitive depending on available MPV primitives
- can be harder to reason about than an explicit black overlay

## Behavior Model

### Phase 1 Fade-Out Only

Sequence:

1. Current media is visible.
2. Begin fade-out to black using duration from `fadeOut` field.
3. Once fully black, load/swap new media.
4. End state remains black unless a separate fade-in is requested.

### Phase 1 Fade-In Only

Sequence:

1. Load/swap new media immediately while black is present or forced.
2. Fade from black to visible using duration from `fadeIn` field.

### Phase 1 Fade-Out Plus Fade-In

Sequence:

1. Fade current media to black using duration from `fadeOut` field.
2. Swap/load new media while black.
3. Fade from black to the new media using duration from `fadeIn` field.

## Command interruption rules

These rules are required:

1. If a new media-changing command arrives before the active fade completes, cancel the in-flight fade and perform the new media change instantly.
2. Do not continue the old fade to completion once it has been superseded.
3. Non-media commands should not interrupt a fade unless they explicitly change visible screen media.
4. A pause action on a video does not need to stop the fade.

### Definition of media-changing command

At minimum:

- `setImage`
- `playVideo`
- `stopVideo` if it changes visible media state
- `stopAll` if it changes visible media state

## Queue and cancellation requirements

The screen-zone queue logic must preserve original fade parameters when commands are queued.

Required behavior:

- If a `setImage` command with fade options is queued, its full command payload must survive queue storage.
- If a trailing queued `setImage` is replaced by a newer `setImage`, the newer command's fade options win.
- If a new command supersedes an in-progress fade, mark the old fade session stale and ignore its completion callbacks.

Recommended implementation pattern:

- create a fade session token or transition ID
- attach it to each transition
- all async callbacks verify they still own the active transition before mutating state

## Phase 1 Logging

Add structured logs such as:

```text
INFO  setImage fade started zone=tv file=images/logo-failed.png fadeOut=0.8 fadeIn=1.2
INFO  setImage fade-to-black complete zone=tv file=images/logo-failed.png
INFO  setImage media swap complete zone=tv file=images/logo-failed.png mediaType=image
INFO  setImage fade-in complete zone=tv file=images/logo-failed.png
WARN  setImage duration capped zone=tv requestedFadeOut=15.0 cappedTo=10.0
WARN  setImage frame capped zone=tv requestedFadeOut=12.0 videoLength=8.5 cappedTo=8.5
WARN  setImage conflict zone=tv fadeTime=2.0 fadeOut=0.8 using=fadeOut ignoring=fadeTime
WARN  setImage fade canceled zone=tv reason=superseded newCommand=playVideo
```

## Phase 1 Acceptance Criteria

1. `setImage` with no fade fields behaves exactly as it does today.
2. `setImage` can visibly fade to black and from black for image media.
3. `setImage` can visibly fade to black and from black for video-first-frame media.
4. If a command is superseded before fade completion, the new change is instant.
5. Effective fade duration never exceeds the shorter of 10 seconds or video length.
6. If fade setup fails, PFx falls back to immediate media swap and logs a warning.

## Phase 1 Implementation Plan

1. Add a supported screen transition helper in the MPV layer or screen-zone abstraction.
2. Add explicit transition session tracking and cancellation.
3. Extend `setImage` path to preserve and apply fade parameters.
4. Ensure queued commands retain original fade parameters and support legacy `fadeTime` fallback.
5. Add conflict detection: if both `fadeTime` and new fields are present, warn and use new fields.
6. Add validation: cap durations to 10s max and video length if applicable.
7. Add tests for image, paused-video, cancellation, legacy fadeTime, conflict detection, and no-fade regressions.
8. Update `docs/MQTT_API.md` and `README.md` after implementation.

## Phase 1 Test Matrix

### Unit Tests

- validate fadeOut and fadeIn numeric parsing and normalization
- validate negative values capped to 0 with warning
- validate values > 10s capped to 10s with warning
- validate video fadeOut/fadeIn capping to video length
- validate no-fade default behavior (both fields absent)
- validate legacy `fadeTime` fallback when new fields absent
- validate conflict detection: warn and use new fields when both present
- validate supersession cancellation behavior

### Integration Tests

- image to image with fadeOut+fadeIn (different durations)
- image to paused-video-first-frame with fadeOut+fadeIn
- paused-video-first-frame to image with fadeOut+fadeIn
- in-flight fade canceled by new `setImage`
- in-flight fade canceled by `playVideo`
- legacy `fadeTime` on setImage (symmetric apply to in and out)
- conflict case: both `fadeTime` and `fadeOut` present (verify new field wins with warning)

### Manual tests

- short image logo swap
- failure logo reveal
- paused video fade while paused
- multiple rapid `setImage` commands in sequence

## Phase 2: True Cross-Fade

## Goal

Replace black midpoint transitions with true overlap between outgoing and incoming content.

## Definition

True cross-fade means:

- old media opacity decreases from 1 to 0
- new media opacity increases from 0 to 1
- both are simultaneously visible during the transition window

This is not the same as fade-to-black plus fade-from-black.

## Architecture Expectation

Phase 2 likely requires one of these:

### Option A: Dual MPV Instances per Screen Zone

- one instance for outgoing media
- one instance for incoming media
- independent z-order and opacity control

### Option B: Compositor-Backed Layered Rendering

- keep one or more MPV renderers
- add a dedicated compositor or overlay layer that can blend independently

### Option C: Advanced MPV Filter/Overlay Composition

- only acceptable if it can provide deterministic independent opacity control for both sources
- agent must verify this is robust before choosing it

## Phase 2 Design Constraints

1. Must work for image-to-image.
2. Must work for image-to-video.
3. Must work for video-to-image.
4. Must work for video-to-video.
5. Must preserve current queue and interruption semantics.
6. If a new media-changing command arrives during cross-fade, new command should be instant and active cross-fade should be canceled.

## Phase 2 Risks

- materially more complex lifecycle management
- more state and process coordination
- higher chance of z-order race conditions
- more GPU or display overhead
- more difficult recovery when one render layer fails

## Phase 2 Acceptance Criteria

1. Outgoing and incoming media are simultaneously visible during transition.
2. Cross-fade works across image and video combinations.
3. Superseding commands still resolve instantly.
4. Failure in one render path falls back cleanly to immediate swap.

## Suggested File Areas to Touch

These are likely implementation areas. Agent should verify before editing.

- `lib/zones/screen-zone.js`
- `lib/media/mpv-zone-manager.js`
- `lib/media/media-player-factory.js`
- `docs/MQTT_API.md`
- `README.md`

## Suggested Delivery Sequence

### Deliver First

- Phase 1 visible black fade
- tests
- docs

### Deliver Later

- Phase 2 true cross-fade as separate PR or separate phase within the same epic

## Agent Instructions

If an implementation agent takes this on, it should:

1. **Implement Phase 1 only** unless explicitly instructed to proceed into Phase 2.
2. Preserve current no-fade behavior by default.
3. Use numeric seconds for `fadeOut` and `fadeIn` fields at command boundary.
4. Support legacy `fadeTime` as a fallback, but prioritize new fields if both are present.
5. Detect and warn if both `fadeTime` and new fields are present; use new fields and publish error.
6. Cap effective fade duration to the shorter of 10 seconds or the video length.
7. Cancel any in-flight fade immediately if a new media-changing command arrives.
8. Prefer explicit black overlay semantics over ad hoc media-specific hacks.
9. Update docs only after runtime behavior is verified by tests.

## Open Questions for Implementation Agent

These are technical questions, not product questions:

1. What is the cleanest MPV primitive available for a black overlay fade in the current runtime?
2. Should Phase 1 support `playVideo` command fades in the same PR, or should it be limited to `setImage` first?
3. What is the most reliable source of video duration for cap enforcement in the current code path?
4. Is a dedicated transition helper in `mpv-zone-manager.js` sufficient, or should transition orchestration remain entirely in `screen-zone.js`?
5. Where is the best place to publish conflict warnings when both `fadeTime` and new fields are present? (Error topic? Structured logs?)

---

Prepared as a PR handoff document for implementation.