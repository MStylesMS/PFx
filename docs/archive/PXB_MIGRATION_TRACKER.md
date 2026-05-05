# PxB Migration Tracker

Use this tracker as the execution contract for supervised agent work. Each release must have a named owner, a branch, explicit dependencies, and one validation command or review gate before it can be marked done.

**[STATUS CHECK — 2026-05-04]** The runtime migration goal is substantially complete: PFx and PxB have been split along the intended media vs. I/O boundary, and consumer repos were updated or verified. The migration is not fully closed administratively: PFx still has active documentation drift, [package-lock.json](../apps/PFx/package-lock.json) still lists `zigbee-herdsman` and `zwave-js`, and [PFX_CLEANUP.md](./PFX_CLEANUP.md) section 3.1 has not been reconciled with the landed runtime state.

**[PREFLIGHT LOCKED — 2026-05-01]** The adapter contract (§A), rename cutover order (§B), R6 ownership matrix (§C), doc scope (§D), and validation commands (§E) are now approved and fixed. Agents A1–A10 may proceed in sequence as specified. Any deviation from the preflight contract requires explicit approval.

## Preflight Packet

Status: **approved & locked** (Mark, 2026-05-01)

---

### A. PxB I/O Adapter Contract (for R2/R3/R4 agents)

New I/O domain adapters in `src/lights/`, `src/switches/`, `src/inputs/`, `src/outputs/` must follow this interface exactly. R2/R3/R4 agents must not invent a different shape.

```js
class MyBackendAdapter {
    /**
     * @param {object} opts
     * @param {object} opts.config     - Parsed INI section for this zone (e.g. { topic, device_id, ... })
     * @param {import('../mqtt/client').MqttClient} opts.mqttClient  - Use this; never import mqtt directly
     * @param {import('../util/logger')} opts.logger
     */
    constructor({ config, mqttClient, logger }) { ... }

    /**
     * Open hardware connections, subscribe to MQTT commands topic, publish initial state.
     * Must be idempotent (safe to call again after a failed init).
     * @returns {Promise<void>}
     */
    async init() { ... }

    /**
     * Execute an inbound MQTT command payload.
     * @param {object} payload  - Parsed JSON; shape defined in docs/json-schemas/
     * @returns {Promise<void>}
     */
    async executeCommand(payload) { ... }

    /**
     * Called when upstream state for this node changes (e.g. a radio event arrives).
     * Publish a retained state message to `{config.topic}/state`.
     * @param {object} state
     * @returns {void}
     */
    handleStateUpdate(state) { ... }

    /**
     * Unsubscribe from MQTT, close hardware connections, release timers.
     * @returns {Promise<void>}
     */
    async dispose() { ... }
}
```

Rules:
- Use `opts.mqttClient.publish(topic, payload, { retain })` — never import `mqtt` directly.
- Use `opts.mqttClient.subscribe(topic, handler)` — never set up raw subscriptions.
- Topic helpers come from `src/mqtt/contract.js` `nodeTopics(config.topic)`.
- Lifecycle: `init()` → (running) → `dispose()`. No state mutations after `dispose()`.
- On non-fatal errors: publish to `{topic}/warnings`; do not throw. On fatal errors: publish warning then `throw` so the caller can mark the adapter failed.
- Unit tests live in `test/unit/<domain>/<adapter>.test.js` and inject all dependencies. No real hardware in unit tests.

---

### B. Rename Cutover Order (R1 — must happen in this exact sequence)

1. **In-repo codemod first (this branch):** Complete all string replacements inside `apps/PZB/` on the `pzb-2-pxb` branch. Verify `npm test` is green.
2. **GitHub repo rename (manual — Mark):** Go to GitHub → `MStylesMS/PZB` Settings → rename to `MStylesMS/PxB`. The old URL auto-redirects but only for a limited time.
3. **Local folder rename (manual — Mark, after closing workspace root):**
   ```bash
   # 1. In VS Code: remove apps/PZB from workspace roots
   mv /opt/paradox/apps/PZB /opt/paradox/apps/PxB
   cd /opt/paradox/apps/PxB && git remote set-url origin <new-PxB-URL>
   # 2. In VS Code: add apps/PxB back to workspace roots
   ```
4. **Workspace file update:** Edit `paradox.code-workspace` (and any other `.code-workspace` files) to replace all `apps/PZB` paths with `apps/PxB`.
5. **Update parent scripts:** `scripts/health-api.js` references `PZB_BIN` and `PZB_CONFIG` — update those after local folder rename.
6. **Service deployment (if live):** `sudo mv /etc/systemd/system/pzb.service /etc/systemd/system/pxb.service && sudo systemctl daemon-reload`.
7. **Log directory (if live):** `sudo mv /opt/paradox/logs/pzb /opt/paradox/logs/pxb`.
8. **Validation:** Run `grep -r 'apps/PZB\|/pzb/' /opt/paradox --include='*.json' --include='*.sh' --include='*.js' --include='*.md' | grep -v node_modules | grep -v archive` — result must be zero lines.

---

### C. R6 Repo Ownership Matrix

| Repo | Owner agent | Change required | Verification-only? |
|---|---|---|---|
| `apps/PxB` | A1 | All R1–R4 work | No |
| `apps/PFx` | A7 | R5 excision | No |
| `apps/PxO` | A8 | Update docs/examples/adapter refs from PZB → PxB; no MQTT topic changes needed | No |
| `rooms/agent22` | A9 | Update `pxo.ini` service references if any; verify EDN zone topics unchanged | Mostly verify |
| `rooms/houdinis-challenge` | A9 | Same as agent22 | Mostly verify |
| `apps/Pio` | A10 | No code change; verify event topics still align with PxB contract | Verify only |
| `apps/PxT` | A10 | No code change needed; PxT talks to PxO not PxB/PZB directly | Verify only |
| `paradox` (top-level) | Supervisor | `scripts/health-api.js`, `config/*.ini` filenames, workspace files, top-level docs | No |

---

### D. Doc Codemod Scope

**Rename PZB → PxB in these file types:**
- All `AI-INSTRUCTIONS.md`, `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md` files workspace-wide.
- All `README.md` files in apps and rooms that reference PZB by product name.
- Active user guides: `docs/SPEC.md`, `docs/MQTT_API.md`, `docs/CONFIG_INI.md`, `docs/QUICK_START.md`, `docs/USER_GUIDE.md` where present.
- Setup and deployment docs: `docs/SETUP.md`, `scripts/README.md`.
- Top-level `paradox/README.md` and `paradox/AGENTS.md` family tables.

**Leave PZB as-is in these files (historical accuracy):**
- `docs/PR_PZB_INITIAL.md` — implementation plan log, references the original repo name intentionally.
- `docs/PR_ZIGBEE_FIX.md` — historical PR doc.
- Any `archive/` directories.
- The compatibility cleanup register rows in the migration plan and tracker that explain the PZB-era aliases.
- Git commit messages (obviously).

---

### E. Per-Release Validation Commands

| Release | Validation command |
|---|---|
| R1 | `cd /opt/paradox/apps/PxB && npm test` — must be green. Then `grep -r 'paradox-z-bridge\|Paradox Z Bridge' . --include='*.js' --include='*.md' --include='*.json' \| grep -v node_modules \| grep -v PR_PZB` — must be zero hits. |
| R2 | `cd /opt/paradox/apps/PxB && npm test` — scaffold tests added for new domains. |
| R3-* | `cd /opt/paradox/apps/PxB && npm test -- --testPathPattern=lights` |
| R4-Shelly | `cd /opt/paradox/apps/PxB && npm test -- --testPathPattern=switches` |
| R4-RelaysInputs | `cd /opt/paradox/apps/PxB && npm test -- --testPathPattern='inputs\|outputs'` |
| R5 | `cd /opt/paradox/apps/PFx && npm test` — must be green. Then `grep -r 'light-zone\|light-device\|relay-device\|input-zone\|zwave-js\|zigbee-herdsman' lib/ test/ \| grep -v node_modules` — must be zero hits. |
| R6-PxO | `cd /opt/paradox/apps/PxO && npm test` |
| R6-Rooms | Manual EDN validation: `node /opt/paradox/apps/PxO/src/game.js --edn <room>/config/*.edn --validate` |
| R7 | `grep -r 'PZB' /opt/paradox --include='*.md' --include='*.js' --include='*.json' \| grep -v node_modules \| grep -v PR_PZB \| grep -v archive \| grep -v TRACKER` — review any remaining hits. |

---

## Post-R7 Follow-up Register

These items do not reopen the migration itself, but they do block calling it fully closed.

| Item | Owner | Status | Notes |
|---|---|---|---|
| PFx lockfile cleanup | supervisor / PFx | open | [package.json](../apps/PFx/package.json) no longer declares `zigbee-herdsman` or `zwave-js`, but [package-lock.json](../apps/PFx/package-lock.json) still does. |
| PFx active doc cleanup | supervisor / PFx | open | Active PFx docs still describe removed light/input/relay surfaces and related contracts. |
| PFX cleanup doc reconciliation | supervisor | open | [PFX_CLEANUP.md](./PFX_CLEANUP.md) section 3.1 still reads as in-progress even though the migration superseded most of the runtime work. |

---

## Release Tracker

Historical note: the table below preserves the per-release notes that were current when each release was logged. For the current residual work, treat the Post-R7 Follow-up Register above as authoritative.

| Release | Scope | Repo(s) | Owner | Branch | Depends on | Validation | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| R0 | Plan and guardrails | paradox | Mark / supervisor | n/a | none | Plan approved | complete | Plan approved in [PXB_MIGRATION_PLAN.md](./PXB_MIGRATION_PLAN.md) |
| R0.1 | Agent preflight packet | paradox | supervisor | n/a | R0 | Packet complete and approved | **approved & locked** | Adapter contract (§A), rename cutover (§B), ownership matrix (§C), doc scope (§D), validation commands (§E) finalized and approved by Mark. Agents A1–A10 cleared to begin. |
| R1 | Rename PZB → PxB | PxB | A1 | `pzb-2-pxb` | R0.1 | Repo rename checklist completed; targeted tests green | **in-repo complete** (148/148 tests pass, commit f971fb8) — 5 manual steps remain (see preflight §B) | Refresh workspace paths after local folder rename. Ready for R2 initiation after manual cutover steps 3–8 complete. |
| R2 | PxB I/O scaffolding | PxB | A1 | `pzb-2-pxb` | R1 | Scaffolding tests/docs validation green | **complete** (commit 5424033) | AdapterBase contract, config schema extended, adapter loading hooks, test scaffold. Total tests: 157 (was 148). Ready for R3-R4 agent work. |
| R3-Hue | Migrate Hue backend | PxB | A2 | `feature/pxb-migration-hue` (or local on `pzb-2-pxb`) | R2 | Hue unit tests green; integration test gated | **complete** (commit 6bd383c — full implementation + 20 tests) | HueAdapter: full REST API implementation, polling, setLight/setScene/allOn/allOff. Reference pattern for A3, A4. |
| R3-LIFX | Migrate LIFX backend | PxB | A3 | `pzb-2-pxb` | R2 | LIFX unit tests green; integration test gated | **complete** (commit e2f0a3e — 8 tests) | LifxAdapter: LIFX Cloud HTTP REST; api_key required; selector-based targeting; 5s polling; setLight/allOn/allOff |
| R3-WiZ | Migrate WiZ backend | PxB | A4 | `pzb-2-pxb` | R2 | WiZ unit tests green; integration test gated | **complete** (commit e2f0a3e — 10 tests) | WizAdapter: UDP LAN port 38899; brightness 0–100→0–255 scaling; 5s polling; setLight/setScene/allOn/allOff |
| R4-Shelly | Migrate Shelly backend | PxB | A5 | `pzb-2-pxb` | R2 | Shelly command/event tests green; room validation planned | **complete** (commit e2f0a3e — 12 tests) | ShellyAdapter: local HTTP; Gen1/Gen2 auto-detect; setRelay/pulse/allOn/allOff; 5s polling |
| R4-RelaysInputs | Migrate relays and inputs | PxB | A6 | `pzb-2-pxb` | R2 | Input/relay tests green; Pio compatibility reviewed | **complete** (commit e2f0a3e — 18+17 tests) | InputsAdapter: aggregates sensor events, duplicate suppression; OutputsAdapter: handler-registry, pulse support |
| R5 | Excise I/O from PFx | PFx | A7 | `pzb-2-pxb` | R3-Hue, R3-LIFX, R3-WiZ, R4-Shelly, R4-RelaysInputs | PFx targeted tests green; no dangling imports | **complete for runtime scope** (commits 542d711, fd9689f — 211/211 tests pass; 22 files deleted) | lib/lights/, lib/controllers/, LightZone, InputZone, relay-device excised; config-loader and zone-manager trimmed; pfx.js --lights-config CLI option removed. `package.json` no longer declares `zigbee-herdsman` or `zwave-js`, but lockfile/doc cleanup remains open. |
| R6-PxO | Update PxO consumers | PxO | A8 | `pzb-2-pxb` | R5 | PxO config/examples validation green | **complete** (verify-only — zero PZB references found in PxO repo) | No code changes needed |
| R6-Rooms | Update room configs | agent22, houdinis-challenge | A9 | repo-local feature branches | R5 | Room config validation and smoke checklist prepared | **complete** (houdinis-challenge: pzbWarn → pxbWarn in operator UI, commit 9a7d913; agent22: PR_PUI.md updated; no EDN changes needed) | EDN zone topics were already PxB-compatible |
| R6-PioPxT | Verify unchanged consumers | Pio, PxT | A10 | repo-local feature branches if needed | R5 | Topic compatibility reviewed | **complete** (PxT: AI-INSTRUCTIONS PZB→PxB commit 3b2c88d; Pio: README commit eaf73ae; no code changes required) | Both verified topic-compatible; only doc renames applied |
| R7 | Cleanup and release | paradox, PxB, PFx | supervisor | release branches/tags | R6-PxO, R6-Rooms, R6-PioPxT | Smoke test complete; tags cut | **substantively complete** | Runtime cutover and cross-repo updates landed. Residual cleanup is tracked above: PFx lockfile drift, PFx active doc drift, and [PFX_CLEANUP.md](./PFX_CLEANUP.md) reconciliation remain open. |

## Decisions / Notes

- Local branch `pzb-2-pxb` already created in PxO and PZB/PxB staging repo.
- The tracker coordinates work; it is not an instruction to run all releases concurrently.
- **R3-R4 Reference Pattern:** HueAdapter (commit 6bd383c) is the complete reference implementation. Agents A2–A6 use it as the pattern:
  - All adapters extend AdapterBase and implement init/executeCommand/handleStateUpdate/dispose
  - All tests mock HTTP/MQTT clients; no real hardware required
  - All use async/await and error handling (warnings vs. throws)
  - See `src/lights/hue.js` and `test/unit/lights/hue.test.js` for examples