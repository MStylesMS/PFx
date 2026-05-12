# PR_MONITOR_CONTROL: Monitor State Sensing & Control Plan

## Objectives
- Detect the power state and key attributes of monitors connected to PFx-managed displays.
- Provide software control over monitor power (on/off / DPMS) triggered via PFx commands, ideally MQTT exposed.
- Surface monitor state in existing zone status publications.
- Auto-wake monitors when media playback is requested, complementing existing resolution control work.

## Capabilities & Tooling Survey

### Sensing Options
1. **X11 DPMS Status (`xset q`)**
   - Indicates global DPMS enabled state and whether the display is in Standby/Suspend/Off.
   - Pros: Already shipped on Pi OS / Debian; no additional packages.
   - Cons: DPMS applies per display server, not per-output; coarse-grained when multiple monitors share DISPLAY.

2. **`xrandr --verbose` Output Parsing**
   - Reports per-output connection state (connected/disconnected), current mode, brightness, and DPMS (on/off) on some drivers.
   - Pros: Already required for resolution helper; per-output granularity.
   - Cons: Brightness / DPMS fields are driver dependent; parsing is more involved.

3. **`ddcutil` (DDC/CI over I2C)**
   - Reads VCP codes for power mode, brightness, input select, etc.  
   - Pros: Rich telemetry, can control vendor-agnostic features.
   - Cons: Requires enabling I2C, root privileges or i2c group membership, and not all displays expose DDC reliably (HDMI splitters often block).

4. **Systemd-logind (`loginctl show-session`)**
   - Offers idle/sleep info but not per-monitor; mostly redundant with DPMS queries.

5. **Wayland APIs**
   - Out of scope; PFx currently assumes X11.

### Control Options
1. **DPMS Commands (`xset dpms force on/off`)**
   - Simple on/off for entire display server.
   - Limitation: Not per-output; affects all monitors on the same DISPLAY.

2. **`xrandr --output <name> --off/on`**
   - Disables/enables individual outputs; forces mode renegotiation when turned back on.
   - Useful for per-zone control, but switching on requires reapplying resolution after re-enable.

3. **`ddcutil setvcp`**
   - Control VCP codes: power (0xD6), brightness (0x10), contrast, input select, etc.
   - Provides the richest control when hardware supports it.

4. **CEC / HDMI-CEC (via `cec-client`)**
   - For TVs supporting HDMI-CEC; can power on/off, change input.
   - Requires CEC wiring support (Pi HDMI-CEC driver) and additional dependencies; may conflict with existing CEC daemons.

## Candidate Features
| Feature | Description | Dependencies | Notes |
|---------|-------------|--------------|-------|
| Monitor presence | Track connected/disconnected state via `xrandr --verbose` | xrandr | Already parsed for resolution helper. |
| DPMS power state | Determine On/Off/Standby via `xset q` or xrandr DPMS lines | xrandr/xset | Need mapping per output. |
| DPMS control | Expose MQTT command to force monitors on/off | `xset` or `xrandr` | Entire DISPLAY vs per-output tradeoff. |
| Auto wake on media | On media command, ensure monitor power state is "on" before playback | same as above | Integrate with ScreenZone command flow. |
| Zone status telemetry | Include `monitorPower`, `monitorConnected`, `lastPowerChange` in zone status | PFx status topics | Schema update required. |
| DDC telemetry/control (stretch) | Brightness, input, power via DDC | `ddcutil`, I2C access | Hardware/permissions risk. |
| CEC integration (future) | Use HDMI-CEC for TVs | `cec-utils` | Complex due to collisions with Kodi/others. |

## Proposed Scope (Phase 1)
1. **Monitor State Discovery**
   - Add utility `monitor-state-helper` to parse `xrandr --verbose` for each configured screen zone.
   - Capture: `connected` (bool), `currentMode`, `dpmsState` (if available), timestamp.

2. **State Publication**
   - Extend ScreenZone status payload with `monitor` object: `{ connected, power, mode }`.
   - Publish updates on interval and whenever PFx observes a change (e.g., after command).

3. **DPMS Control**
   - Introduce MQTT commands `monitorOn`, `monitorOff` (per zone). Implementation: `xset dpms force on/off` by default (whole DISPLAY).
   - Optionally accept `output_name` to attempt `xrandr --output` toggles when resolution helper knows the target.

4. **Auto Wake Hook**
   - Before executing `setImage`, `playVideo`, etc., check monitor state and issue `monitorOn` if powered down.
   - Defer auto-sleep for future phases (requires heuristics to avoid flicker).

5. **Configuration Flags**
   - New INI keys under `[screen:*]`: `monitor_control_enabled=true`, `monitor_control_method=dpms|xrandr`, optional custom command overrides.

## Out-of-Scope (Phase 1)
- DDC/CI integration (`ddcutil`) and brightness/input control.
- HDMI-CEC control.
- Automatic sleep based on inactivity timers.
- Hardware abstraction for non-X11 environments.

These can form Phase 2+ deliverables once baseline DPMS control is stable.

## Risk Assessment
| Risk | Impact | Mitigation |
|------|--------|------------|
| DPMS commands affect multiple monitors unexpectedly | Medium | Default to per-zone `xrandr` when `output_name` known; document limitation when only DISPLAY-level control is available. |
| `xrandr --output --off` may disrupt resolution helper | Medium | Ensure we reapply resolution after re-enabling output; wrap operations in helper that sequences power + resolution. |
| Missing X11 utilities (`xset`, `xrandr`) | Low | Document deps, add startup checks (similar to resolution helper). |
| Headless/virtual displays | Low | Skip monitor control when no physical output detected. |
| Permissions for DDC/CEC future work | High (future) | Keep Phase 1 limited to X11-only dependencies. |

## Effort Estimate
- **Phase 1 (DPMS/xrandr monitoring & control)**: ~3-4 engineer days
  - Helper module + parsing: 1 day
  - ScreenZone integration & MQTT commands: 1 day
  - Status payload updates + tests: 0.5 day
  - Auto-wake logic + regression testing: 0.5-1 day
- **Phase 2 (Optional DDC/CI support)**: Additional 3-5 days depending on hardware validation.
- **Phase 2b (CEC integration)**: 5+ days; requires deep testing on Pi4/Pi5 with CEC displays.

## Next Steps
1. Validate chosen sensing method (prototype `xrandr --verbose` parser with multi-monitor setup).
2. Finalize INI schema additions and MQTT command naming.
3. Implement monitor-state helper + unit tests.
4. Integrate with ScreenZone init and status reporting.
5. Add auto-wake logic and regression tests.
6. Document configuration and operational guidance in `CONFIG_INI.md` and release notes.

---
*Draft prepared October 2025 for PFx monitor control roadmap.*
