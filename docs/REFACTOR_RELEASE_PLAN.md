# PFx Refactor And Release Plan

This plan is the working roadmap for finishing the PFx refactor in a way that is both release-ready and presentable in a code review. The goal is to keep the remaining runtime cleanup automated and incremental, defer manual smoke work until the code shape is stable, then separate the final stabilized milestone from the later 2.0.0 archive-removal milestone.

## Principles

- Prefer small, test-first cleanup slices over broad rewrites.
- Avoid repeated manual smoke tests during refactor work.
- Keep the archive in place through the final stabilization commit.
- Reserve the major version bump for the later archive-removal and dead-surface purge milestone.

## Phases

### Phase 1: Finish Shared Runtime Cleanup

Continue extracting duplicated zone/runtime behavior behind narrow automated coverage.

Current priority order:

1. Shared background playback parity between `AudioZone` and `ScreenZone`
2. Remaining zone lifecycle dedupe (`playSoundEffect`, `stopAudio`, `stopAll`, repeated status/event helpers)
3. MPV resilience and IPC cleanup behind stronger tests

Rules for this phase:

- Add or extend the narrowest relevant unit tests first.
- Run only targeted Jest files while iterating on a slice.
- Use full `npm run test:unit` only after a cleanup phase or substantial runtime change.

### Phase 2: Cleanup Freeze Before Smoke Test

Once the remaining runtime cleanup slices are complete:

- Run the full PFx automated suite.
- Verify active PFx docs still match runtime truth.
- Review scripts/manual harnesses and classify them before any deletions.
- Confirm Houdini and Agent22 assumptions remain aligned with PFx behavior.

No broad new refactors should start after this freeze point.

### Phase 3: Single Integrated Manual Smoke Test

Run one final integrated manual smoke test only after the cleanup freeze.

The smoke should cover:

- PFx startup and readiness marker
- Image and video playback
- Background music, speech, effects, ducking, and recovery
- Browser overlay if configured
- Houdini compatibility
- Agent22 compatibility
- A few recovery/error paths such as missing media and MQTT reconnect

If issues are found, fix only those issues and rerun targeted automation before returning to the broader automated gate.

### Phase 4: Final Stabilization Milestone

After the smoke test is green:

- Do one final pass on active docs
- Record smoke evidence and release notes
- Create one final stabilization commit with the archive still present

At this point PFx should be clean, runnable, and ready to present as the next major release candidate.

### Phase 5: Major Release Cleanup Milestone

After the stabilized milestone:

- Remove archive docs and obsolete tests/scripts/code that no longer make sense
- Regenerate final release artifacts as needed
- Bump version from `1.1.3` to `2.0.0`
- Treat that cleanup as the next major milestone

## Validation Strategy

### During Refactor Work

- Start with slice-specific unit tests
- Expand to `npm run test:unit` after meaningful runtime changes
- Run `npm run test:ci` before the final smoke freeze

### Before Manual Smoke

- Validate Houdini and Agent22 configs with PxO tools
- Confirm PFx startup against the intended runtime config
- Confirm automated PFx gates are green

### After Manual Smoke

- Rerun targeted automated tests for any fixes found
- Rerun the full PFx unit suite and CI-safe integration suite before the stabilization commit

## Key Files

- `lib/zones/base-zone.js`
- `lib/zones/audio-zone.js`
- `lib/zones/screen-zone.js`
- `lib/media/mpv-zone-manager.js`
- `test/unit/background-duck-recompute.test.js`
- `test/unit/playback-warning-background.test.js`
- `test/unit/playback-telemetry.test.js`
- `test/unit/background-stop-shared.test.js`
- `test/unit/mpv-zone-manager-startup.test.js`
- `test/integration/media-playback.test.js`
- `test/manual/real-playback.test.js`
- `docs/CONFIG_INI.md`
- `docs/MQTT_API.md`
- `docs/PFX_USER_GUIDE.md`
- `README.md`
- `/opt/paradox/rooms/houdinis-challenge/config/houdini.edn`
- `/opt/paradox/rooms/agent22/config/agent22.edn`
- `/opt/paradox/apps/PxO/tools/validate-edn.js`
- `/opt/paradox/apps/PxO/src/game.js`

## Release Decisions

- Manual smoke policy: one integrated manual smoke test after the cleanup freeze unless a hardware-specific blocker forces an exception.
- Archive policy: keep archive content through the final stabilization commit.
- Versioning policy: do not bump to `2.0.0` until the archive-removal milestone.
