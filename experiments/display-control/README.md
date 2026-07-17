# PFx Experiment: Display Sensing & Control Probe

Validates the sensing and control options from [`docs/pending/PR_MONITOR_CONTROL.md`](../../docs/pending/PR_MONITOR_CONTROL.md) against each HDMI-connected monitor on this host.

Control tests blank or power-cycle the display, so they need **visual confirmation** at the physical screen. Run this from a terminal you can use while watching the monitor(s).

## What it checks

| Category | Option | How verified |
|----------|--------|----------------|
| Sensing | X11 DPMS (`xset q`) | Automatic |
| Sensing | `xrandr --verbose` per-output | Automatic |
| Sensing | DRM sysfs status/dpms | Automatic |
| Sensing | EDID make / model | Automatic |
| Sensing | `ddcutil` / I2C DDC presence | Automatic (install `ddcutil` for full read) |
| Sensing | HDMI-CEC (`cec-client`) | Automatic |
| Sensing | systemd-logind | Automatic (session-level only) |
| Control | `xset dpms force off/on` | Interactive — you confirm blank/wake |
| Control | `xrandr --output … --off/--auto` | Interactive — you confirm |
| Control | `ddcutil setvcp 0xD6` power | Interactive — needs `ddcutil` |
| Control | CEC standby / on | Interactive — TV CEC must be enabled |

For each connected monitor it writes an HTML report (plus JSON twin) under `reports/`, including identity (make/model when EDID provides it) and a capability chart.

## Prerequisites

- Local X11 session on the Pi (`DISPLAY=:0` is typical for PFx)
- Tools ideally present: `xrandr`, `xset`, `cec-client` (usually already there)
- Optional: `sudo apt install ddcutil` for DDC/CI power tests
- Operator sitting where they can see each HDMI monitor
- User in `i2c` and `video` groups (this install’s `paradox` user already is)

If you are SSH’d in, make sure you are not forwarding X11 in a way that steals `:0`. Prefer a console or SSH with `DISPLAY=:0` pointing at the Pi’s real session:

```bash
export DISPLAY=:0
# if needed:
xhost +SI:localuser:$(whoami)
```

## How to run (full interactive probe)

From this directory on the Pi, with a view of the screens:

```bash
cd /opt/paradox/apps/PFx/experiments/display-control
DISPLAY=:0 node run-display-probe.js
```

Flow:

1. Discovers connected HDMI outputs and prints make/model from EDID when available.
2. Runs non-destructive sensing probes automatically.
3. For each control method, asks permission, performs off then on, and asks whether you saw the expected behaviour (`y` / `n` / `s` to skip).
4. Writes per-monitor HTML + JSON under `reports/`, plus `reports/index.html`.

Useful flags:

```bash
# Sensing only — safe, no blanking (control rows marked skipped)
DISPLAY=:0 node run-display-probe.js --sensing-only

# Skip specific control groups: dpms | xrandr | ddc | cec
DISPLAY=:0 node run-display-probe.js --skip-control=ddc,cec

DISPLAY=:0 node run-display-probe.js --display=:0
```

## Reports

After a successful run:

| File | Meaning |
|------|---------|
| `reports/HDMI-N-latest.html` | Latest report for that output |
| `reports/HDMI-N-latest.json` | Machine-readable twin |
| `reports/index.html` | Links to reports from the last run |
| `reports/*_<timestamp>.html` | Timestamped archive copies |

Open with a browser on the Pi, or copy off-box:

```bash
# example
cp reports/HDMI-1-latest.html /tmp/
```

## Safety notes

- **DPMS** (`xset`) is DISPLAY-global: with two monitors on `:0`, both may blank together.
- **xrandr --off** disables one output; the script re-enables with `--auto` / prior mode, but you may need a PFx restart or resolution re-apply if layout looks wrong.
- **CEC / DDC power** can put a TV into deep standby; the script always attempts wake afterward. Keep the TV remote handy.
- Do not run the interactive control suite unattended.

## Relation to PFx code

Existing helpers this experiment informs:

- `lib/utils/screen-power-manager.js` — DPMS + xrandr off/auto
- `lib/utils/screen-resolution-helper.js` — xrandr mode apply
- `docs/pending/PR_MONITOR_CONTROL.md` — roadmap (Phase 1 DPMS/xrandr; DDC/CEC later)

## Tomorrow’s checklist

1. Sit at the Pi (or where both HDMI screens are visible).
2. `cd /opt/paradox/apps/PFx/experiments/display-control`
3. `DISPLAY=:0 node run-display-probe.js`
4. Answer the visual prompts for each connected monitor.
5. Open `reports/index.html` / `HDMI-*-latest.html` and keep them for the PR_MONITOR_CONTROL decision.
