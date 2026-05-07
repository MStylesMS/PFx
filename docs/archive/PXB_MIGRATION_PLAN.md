# PxB Migration Plan — Promote PZB to Paradox Bridge

**Status:** SUBSTANTIVELY COMPLETE — runtime migration landed through R7, with post-migration cleanup still open (checked 2026-05-04).
**Owner:** Mark Stevens
**Pauses:** [PFX_CLEANUP.md](../portfolio/PFX_CLEANUP.md) Phases 3 and 4 were paused during migration. Phase 3 now resumes for PFx-only cleanup that the migration did not finish.
**Scope:** Rename PZB → PxB and migrate all non-media I/O (lights, switches, sensors, relays) out of PFx and into PxB.

## Current Status Check (2026-05-04)

- The product-boundary goal is met: PFx runtime code is media-focused, PxB owns the migrated I/O domains, and the consumer repos were updated or verified.
- The release sequence in this document was executed; the detailed commit-by-commit record lives in [PXB_MIGRATION_TRACKER.md](./PXB_MIGRATION_TRACKER.md).
- The migration is not fully closed administratively. Remaining follow-up items are:
  - [PFX_CLEANUP.md](../portfolio/PFX_CLEANUP.md) section 3.1 still shows open checklist items even though the runtime decision landed.
  - Active PFx docs still describe removed light/input/relay behavior.
  - [package-lock.json](../apps/PFx/package-lock.json) still carries `zigbee-herdsman` and `zwave-js` even though [package.json](../apps/PFx/package.json) no longer does.
- Treat this file as the archived execution plan plus completion summary. Use the tracker for detailed evidence and the residual follow-up register.

---

## 1. Why

Today's split blurs the boundary between two products:

- **PFx** advertises itself as a media/effects controller, but it also owns:
  - IP-based lighting backends: Hue, LIFX, WiZ
  - Shelly (which is bidirectional — input *and* output)
  - In-process Z-Wave / Zigbee backends (already deprecated in docs)
  - Relay devices and input zones
- **PZB** is a cleanly scoped MQTT bridge for radio I/O (Z-Wave / Zigbee / Thread).

The right shape is:

- **PFx = media.** Screens, audio, video, browser overlays, ducking. Nothing else.
- **PxB = I/O.** Every non-media device — IP lights, radio devices, Shelly, GPIO-style inputs/outputs surfaced by hardware bridges — speaks MQTT through one product.

Result: one well-named, single-responsibility product per concern. Game engines (PxO) and operators get a consistent contract: media commands → PFx, device commands → PxB.

---

## 2. End-State Architecture

```
                        ┌──────────┐
                        │   PxO    │  game orchestration
                        └────┬─────┘
                             │ MQTT
              ┌──────────────┴──────────────┐
              │                             │
        ┌─────▼─────┐                 ┌─────▼─────┐
        │   PFx     │                 │   PxB     │
        │  (media)  │                 │   (I/O)   │
        └─────┬─────┘                 └─────┬─────┘
              │                             │
   screens / audio / browser /     IP lights (Hue/LIFX/WiZ),
   speech / video / overlays       Shelly, Z-Wave, Zigbee,
                                   Thread, relays, sensors,
                                   button/contact inputs
```

PFx no longer talks to lighting, switch, or sensor hardware directly. Pio (GPIO bridge) and PxT (kiosk) are unchanged.

---

## 3. What Moves vs. What Stays

### Moves PFx → PxB

| Asset (PFx path) | Notes |
|---|---|
| `lib/lights/backends/hue-backend.js` | IP lights |
| `lib/lights/backends/lifx-backend.js` | IP lights |
| `lib/lights/backends/wiz-native-backend.js` | IP lights |
| `lib/lights/backends/shelly-backend.js` | Bidirectional — input + output |
| `lib/lights/backends/multi-target-backend.js` | Backend composition |
| `lib/lights/backends/passthrough-backend.js` | Test/dev backend |
| `lib/lights/backends/zigbee-backend.js` | Already deprecated; superseded by PxB-native zigbee |
| `lib/lights/backends/zwave-backend.js` | Already deprecated; superseded by PxB-native zwave |
| `lib/lights/tuner/` | Lighting calibration utilities |
| `lib/zones/light-zone.js` | Lighting zone wiring |
| `lib/zones/input-zone.js` | Sensor/button input zone (move I/O parts; keep nothing in PFx) |
| `lib/devices/light-device.js` | Per-light command surface |
| `lib/devices/light-group-device.js` | Group command surface |
| `lib/devices/relay-device.js` | Relay control |
| `docs/QUICK_START_HUE.md` | Move and adapt |
| `docs/QUICK_START_LIFX.md` *(if present)* | Move and adapt |
| `docs/QUICK_START_WIZ.md` | Move and adapt |
| `docs/QUICK_START_SHELLY.md` | Move and adapt |
| `docs/QUICK_START_ZWAVE.md` | Already redirects to PZB; finalize on PxB |
| `docs/QUICK_START_ZIGBEE.md` | Already redirects to PZB; finalize on PxB |
| Related unit/integration tests | Move with the code; rewrite import paths |

### Stays in PFx

- `lib/zones/screen-zone.js`, `lib/zones/audio-zone.js`, `lib/zones/base-zone.js`
- `lib/audio/`, `lib/media/`, `lib/effects/`
- `lib/core/` MQTT wrapper, config loader, device manager (keep generic; drop light/relay/input registrations)
- All speech/ducking infrastructure
- INI sections: `[screen:*]`, `[audio:*]` (drop `[lights:*]`, `[input:*]`, `[relay:*]`)

### New in PxB

- Top-level repo rename and product rebrand (Paradox Z Bridge → **Paradox Bridge**).
- New top-level domains under `src/`:
  - `src/lights/` — IP light backends (Hue, LIFX, WiZ) and tuner.
  - `src/switches/` — Shelly and other bidirectional devices.
  - `src/inputs/` — Input zones / sensors / buttons (where not already covered by Pio).
  - `src/outputs/` — Relays and other actuators.
  - Existing `src/radios/zigbee` and `src/radios/zwave` remain.
- Unified MQTT topic root for I/O devices (kept compatible with current PZB topic shape).
- `PxB.ini` superset replacing PZB.ini.

---

## 4. MQTT / Topic Contract

**Compatibility rule:** existing PZB topics keep working during the migration window. New PxB topics are additive; old clients are not broken until R7 (cleanup phase).

**Canonical family contract (approved):**
- Standard topics are `{baseTopic}/{commands|events|state|warnings}`.
- `/status` is deprecated across the Paradox family. Lifecycle/heartbeat data belongs in `/state`.
- Device-specific extra topics (for example `/schema`, `/config`) are allowed only with explicit justification and review.
- Every approved non-standard subtopic is recorded in the compatibility cleanup register before merge.

- Current PFx light/input/relay topics (`paradox/{room}/lights/*`, `paradox/{room}/input/*`, `paradox/{room}/relay/*`) are migrated to PxB and continue to publish/subscribe with the same shape.
- PFx will no longer publish or subscribe to those topics after R5.
- PxB inherits PZB's existing `events` / `commands` topic discipline and extends it for IP lights, Shelly, relays.
- JSON schemas under `apps/PxB/docs/json-schemas/` become the single source of truth for I/O payloads. PFx schemas are pruned to media only.

Concrete examples (final):
```
paradox/{room}/lights/{name}/commands     → PxB
paradox/{room}/lights/{name}/state        ← PxB
paradox/{room}/input/{name}/events        ← PxB
paradox/{room}/relay/{name}/commands      → PxB
paradox/{room}/screen/{name}/commands     → PFx (unchanged)
paradox/{room}/audio/{name}/commands      → PFx (unchanged)
```

### 4.1 Compatibility Alias Cleanup Register (required)

During migration, compatibility aliases are tracked and reviewed for removal at R7+1.

| Alias / non-standard topic | Reason kept during migration | Owner | Remove by |
|---|---|---|---|
| `{baseTopic}/status` | Backward compatibility for existing subscribers | PxB migration lead | R7+1 |
| `{baseTopic}/discovery` | Retained startup inventory for tooling and dashboards | PxO/PxB architecture owner | Keep (review each release) |
| `{nodeTopic}/schema` | Device capability introspection | PxB architecture owner | Keep (review each release) |
| `{nodeTopic}/config` *(if introduced)* | Runtime config exposure for operators | PxB architecture owner | Review before release |

---

## 5. Release Plan (R0 – R7)

Historical note: the release bodies below remain in planned/future tense because they are the approved execution record. Final outcomes and residual gaps are tracked in [PXB_MIGRATION_TRACKER.md](./PXB_MIGRATION_TRACKER.md).

Each release is a ship-able commit/tag boundary so you can pause and re-evaluate.

### R0 — Plan & guardrails (≈ ½ day)
- Approve this document.
- Pause [PFX_CLEANUP.md](../portfolio/PFX_CLEANUP.md) §3.x (no longer relevant; PFx loses Z-Wave/Zigbee anyway).
- Create migration tracker issue in PFx and PxB (or a single tracker in `/opt/paradox/portfolio/`).
- Freeze the agent preflight packet before any autonomous implementation work begins.

### R0.1 — Agent preflight gate (required before R1)
- Write the concrete PxB adapter contract in one place: constructor inputs, required methods, MQTT wrapper usage rules, expected lifecycle hooks, and disposal semantics.
- Define the rename cutover order for GitHub repo, local folder, workspace roots, package metadata, service names, and post-rename validation commands.
- Build a repo-by-repo ownership matrix for R6 so agents know which repo owns each required change and which repos are verification-only.
- Define the PZB → PxB doc codemod scope: active docs and instructions are renamed, while archive/history/compatibility notes keep `PZB` where it is historically accurate.
- Record the validation command for each release before the first agent starts so agents do not invent their own completion criteria.
- Store these decisions in the tracker or a linked preflight note and treat them as the execution contract for all agents.

### R1 — Rename PZB → PxB (mechanical)  *(parallelizable: agent A1)*
- Rename GitHub repo `MStylesMS/PZB` → `MStylesMS/PxB`.
- Rename local directory `apps/PZB/` → `apps/PxB/`.
- Update `package.json#name`, README headings, CLI banner, log tags, systemd unit name, env var prefixes.
- Replace all `PZB`/`pzb`/`paradox-z-bridge` strings repo-wide with `PxB`/`pxb`/`paradox-bridge` (case-aware codemod).
- Add a permanent `README.md` redirect on the old repo URL.
- Commit: `Rename: PZB → PxB`.

### R2 — PxB scaffolding for new domains  *(agent A1, after R1)*
- Add empty `src/lights/`, `src/switches/`, `src/inputs/`, `src/outputs/`.
- Define adapter contract (`init`, `executeCommand`, `handleStateUpdate`, `dispose`) — mirror existing radio adapter shape.
- Extend `PxB.ini` schema: `[lights:*]`, `[switch:*]`, `[input:*]`, `[output:*]` sections.
- Update `apps/PxB/docs/CONFIG_INI.md` and `MQTT_API.md` skeletons.
- Commit: `Implement: PxB I/O domain scaffolding`.

### R3 — Migrate IP lights into PxB  *(parallelizable: agents A2 Hue, A3 LIFX, A4 WiZ)*
For each backend (Hue / LIFX / WiZ):
- Copy `lib/lights/backends/<x>-backend.js` from PFx into `apps/PxB/src/lights/`.
- Adapt to PxB adapter contract (constructor signature, MQTT publish via PxB's wrapper).
- Move and adapt unit tests; mark integration tests gated on real hardware.
- Update / move quick-start docs.
- Commit per-backend: `Implement: migrate <backend> to PxB`.

### R4 — Migrate Shelly + relays + inputs  *(parallelizable: agents A5 Shelly, A6 relays/inputs)*
- Shelly is the most subtle (bidirectional). Move backend, ensure both command path and event path are wired through PxB.
- Move `relay-device.js` and `input-zone.js` semantics into PxB outputs/inputs domains. Confirm Pio interactions are unchanged.
- Migrate tests and docs.
- Commits: `Implement: migrate Shelly to PxB`, `Implement: migrate relays/inputs to PxB`.

### R5 — Excise from PFx  *(agent A7, after R3+R4 land and PxB tag cut)*
- Delete migrated files from PFx (`lib/lights/`, `lib/devices/light*.js`, `lib/devices/relay-device.js`, `lib/zones/light-zone.js`, `lib/zones/input-zone.js`, related tests, related docs).
- Drop `[lights:*]`, `[input:*]`, `[relay:*]` from PFx INI loader; emit a hard error if seen, instructing user to migrate to PxB.
- Remove `zwave-js` and `zigbee-herdsman` dependencies from `package.json` (this completes [PFX_CLEANUP.md](../portfolio/PFX_CLEANUP.md) §3.1 in one go).
- Update PFx README, SPEC, MQTT_API, CONFIG_INI to media-only scope.
- Commit: `Refactor: remove I/O domains from PFx (now in PxB)`.

### R6 — Update consumers  *(parallelizable: agents A8 PxO, A9 rooms, A10 Pio/PxT)*
- PxO config examples + adapters point at PxB topics for lights/inputs/relays.
- `rooms/agent22` and `rooms/houdinis-challenge` EDN configs and INI files reference PxB.
- Pio + PxT unchanged in code; verify event topics still align.
- Service files / `paradox-control.sh` updated to start `pxb.service` instead of `pzb.service` (but keep alias for one release).
- Commits per consumer.

### R7 — Cleanup & cut releases
- Tag `PxB v1.0.0`, `PFx v2.0.0` (major bump — breaking config change in PFx).
- Remove the old `pzb.service` alias.
- Refresh top-level `/opt/paradox/README.md` and `paradox/AGENTS.md` family table to call PxB by name.
- Update `PFX_CLEANUP.md`: mark §3.1 done, mark Phase 3 redirected to post-migration items.
- Present the compatibility cleanup register to Mark for keep/remove decisions, then remove all unapproved aliases.

---

## 6. Cross-cutting Updates (touched in nearly every release)

- **Docs:** rename PZB references in active product docs, setup docs, user guides, and agent instructions. Do not blindly rewrite archive/history/migration documents that need to preserve historical names; track any intentional exceptions in the compatibility cleanup register or tracker.
- **Copilot-instructions / AGENTS.md / CLAUDE.md:** PFx, PxO, PxT, PxC, room repos all reference PZB by name today. Update.
- **systemd / scripts:** unit names, paths, control scripts.
- **Tests:** every test that imports from `lib/lights/...` or `lib/devices/light*` must be moved or deleted.
- **CI:** PxB CI runs the new domain tests; PFx CI no longer runs light/input tests.

---

## 7. Risk Register

| Risk | Mitigation |
|---|---|
| Topic regressions break a live room | Keep both PZB and PxB topics live during R3–R6; only cut over in R7. |
| Shelly bidirectional code is subtle | R4 lands behind a feature flag in PxB; PFx Shelly stays available until flag is verified in a room. |
| PxO config drift | Touch PxO adapter configs in the same PR as the PxB change (cross-repo PR pair). |
| Hidden imports of moved files | After each release, run a `grep -R` codemod to detect dangling imports; CI breaks if any remain. |
| Long-lived parallel branches | Each agent works on its own `feature/pxb-migration-<area>` branch with daily rebase from `main`; merge order is enforced (R1 → R2 → R3+R4 in parallel → R5 → R6 → R7). |

---

## 8. Automation Strategy — How to actually run this

The migration is highly parallelizable because each backend is an independent module. Recommended setup:

There is no single local command in this workspace that will read this document, choose models, sequence releases, and supervise cross-repo PRs automatically. Treat this plan as a supervised multi-agent workflow: one chat or cloud agent per scoped work item, with the tracker as the coordinator.

### 8.1 Local agents (this VS Code workspace)

- Use VS Code Copilot Chat with **separate sessions per release/agent**. Each session gets:
  - The exact subset of files in scope (e.g., agent A2 Hue: `lib/lights/backends/hue-backend.js`, related test, related docs).
  - A model tier appropriate to the work (see table below).
  - A clear "stop after this commit" boundary.
- Run **2–3 sessions concurrently** on the same machine — they don't conflict if scoped to non-overlapping files.

### 8.2 Cloud agents (recommended for scale)

You have two practical options:

**Option A — GitHub Copilot Coding Agent (cloud).** Each PxB backend migration is opened as a GitHub issue with a clear scope; assign Copilot to the issue. It will branch, implement, run tests in Actions, and open a PR. Best for R3 and R4 (independent backends).

**Option B — Anthropic Claude Code on cloud runners.** Use `claude-code` non-interactively in a cloud VM or self-hosted runner; one agent per release in parallel. This is most useful for R5 (the PFx excision pass) and R6 (consumer updates) where multi-repo coordination matters.

### 8.3 Model routing for this migration

| Release | Work | Model | Why |
|---|---|---|---|
| R0 | Approve plan | Manual (you) | High-judgment; cheap |
| R1 | Mechanical rename | GPT-5.3-Codex (or Sonnet 4.6 Low) | Pure codemod |
| R2 | Scaffolding | Sonnet 4.6 Medium | New code, clear contract |
| R3 (×3 in parallel) | Backend migration (Hue/LIFX/WiZ) | Sonnet 4.6 Medium | Multi-file, scoped |
| R4 (×2) | Shelly + relays/inputs | Sonnet 4.6 High | Bidirectional logic; subtler |
| R5 | PFx excision | GPT-5.3-Codex | Big mechanical delete pass |
| R6 (×3 in parallel) | Consumer updates | Sonnet 4.6 Medium | Per-repo |
| R7 | Tag, polish, top-level docs | Sonnet 4.6 High | Public-facing wording |
| Design checkpoints | Adapter contract review | Opus 4.7 (one short session) | High judgment, low volume |

### 8.4 Minimum supervisor loop (you, the human)

Even fully automated, you do four things:
1. Approve this plan (R0).
2. Approve each agent's PR before merge.
3. Run a real-room smoke test after R3 and after R6.
4. Cut tags at R7.

Estimated active human time: **~4 hours total** spread across the migration window.

### 8.5 Concrete kickoff sequence

Historical record of the approved kickoff sequence:
1. I create the migration tracker (`/opt/paradox/portfolio/PXB_MIGRATION_TRACKER.md`) and record owner, branch, validation command, and dependency chain for each release.
2. I complete the R0.1 preflight packet so every agent works from the same adapter contract, rename order, and repo ownership matrix.
3. I run R1 in the bridge repo first, then refresh workspace roots and any local automation that still points at `apps/PZB/`.
4. I land R2 only after the rename settles and the adapter contract is frozen.
5. We open three GitHub issues for R3 (Hue, LIFX, WiZ) and assign Copilot Coding Agent to each — they run in parallel in the cloud.
6. While those run, I handle R4 Shelly in a separate high-judgment session, since it needs tighter supervision for bidirectional behavior.
7. After R3+R4 PRs merge into PxB and tests are green, I open R5 (PFx excision) as a single PR.
8. R6 consumer updates open as parallel PRs against PxO and each room repo using the ownership matrix from R0.1.
9. You review, smoke-test, and I tag.

---

## 9. Acceptance Criteria

| Criterion | Status (2026-05-04) | Notes |
|---|---|---|
| `apps/PFx` contains zero runtime references to migrated I/O surfaces and radio deps. | Partially met | Runtime code is excised, but active docs still reference removed surfaces and [package-lock.json](../apps/PFx/package-lock.json) still carries `zigbee-herdsman` / `zwave-js`. |
| `apps/PxB/src/` contains all migrated backends and passes its own CI matrix. | Met | See tracker releases R2–R4. |
| A working room (agent22 or houdinis-challenge) brings up PFx + PxB and runs end-to-end without regression. | Met | See tracker releases R6 and R7. |
| All active product and operator docs in scope refer to **PxB** (Paradox Bridge), with historical/archive exceptions explicitly tracked. | Partially met | Cross-repo rename largely landed, but PFx still has active doc drift to clean up. |
| [PFX_CLEANUP.md](../portfolio/PFX_CLEANUP.md) §3.1 is closed and Phase 3 is restructured around remaining PFx-only work. | Not yet met | The migration changed the runtime reality, but the cleanup document itself still needs to be updated. |

---

## 10. Approved Decisions (Recorded)

1. **Repo rename strategy:** rename in place (`MStylesMS/PZB` → `MStylesMS/PxB`).
2. **PFx major version:** approved (`PFx v2.0.0` at R7).
3. **Cloud agent budget:** approved for parallel cloud-agent execution.
4. **Topic compatibility window:** safe migration approved; keep compatibility aliases through one minor release, then review and remove.
5. **In-flight PFx I/O work:** none blocking.
