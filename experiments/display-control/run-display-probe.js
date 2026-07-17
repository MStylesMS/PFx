#!/usr/bin/env node
'use strict';

/**
 * Interactive (or sensing-only) probe of HDMI monitor sensing & control options.
 *
 * Validates the matrix in docs/pending/PR_MONITOR_CONTROL.md against real hardware.
 *
 * Usage:
 *   DISPLAY=:0 node run-display-probe.js
 *   DISPLAY=:0 node run-display-probe.js --sensing-only
 *   DISPLAY=:0 node run-display-probe.js --skip-control=ddc,cec
 */

const path = require('path');
const { discover } = require('./lib/discover');
const { runSensingProbes } = require('./lib/sensing');
const { runControlTests } = require('./lib/control');
const { writeMonitorReport, writeIndex } = require('./lib/report');
const {
    createInterface,
    askChoice,
    heading,
    subheading,
    say,
    pause,
} = require('./lib/prompt');

const REPORTS_DIR = path.join(__dirname, 'reports');

function parseArgs(argv) {
    const args = {
        sensingOnly: false,
        skipControl: [],
        display: process.env.DISPLAY || ':0',
        help: false,
    };
    for (const a of argv.slice(2)) {
        if (a === '--sensing-only') args.sensingOnly = true;
        else if (a === '--help' || a === '-h') args.help = true;
        else if (a.startsWith('--skip-control=')) {
            args.skipControl = a
                .slice('--skip-control='.length)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
        } else if (a.startsWith('--display=')) {
            args.display = a.slice('--display='.length);
        }
    }
    return args;
}

function printHelp() {
    say(`Usage: node run-display-probe.js [options]

Options:
  --sensing-only          Run non-destructive sensing probes only (no visual confirmation)
  --skip-control=a,b      Skip control groups: dpms, xrandr, ddc, cec
  --display=:0            X11 DISPLAY (default: $DISPLAY or :0)
  -h, --help              Show this help

Reports are written to: ${REPORTS_DIR}
`);
}

function printIdentity(monitor) {
    const id = monitor.identity || {};
    say(`  Output:     ${monitor.xrandrName} (${monitor.drmName})`);
    say(`  Make/Model: ${id.make || 'unknown'} / ${id.model || 'unknown'}`);
    say(`  Mode:       ${id.currentMode || 'n/a'}  geometry=${id.geometry || 'n/a'}`);
    say(`  I2C/DDC:    ${monitor.i2cBus || 'n/a'}  CEC=${monitor.cecDevice || 'n/a'}`);
}

async function probeOneMonitor(rl, monitor, tools, args) {
    heading(`Monitor ${monitor.xrandrName}`);
    printIdentity(monitor);

    subheading('Sensing probes (automatic)');
    const sensing = runSensingProbes(monitor, tools);
    for (const p of sensing) {
        const mark = p.works === true ? 'OK ' : p.works === false ? 'NO ' : '?? ';
        say(`  [${mark}] ${p.label}`);
        say(`         ${p.detail}`);
    }

    let control = [];
    if (args.sensingOnly) {
        say('\nSensing-only mode: skipping control tests that need visual confirmation.');
        control = [
            stubControl('control.dpms_force', 'DPMS xset force off/on'),
            stubControl('control.xrandr_toggle', 'xrandr output --off/--auto'),
            stubControl('control.ddcutil_power', 'ddcutil setvcp power (0xD6)'),
            stubControl('control.cec_power', 'HDMI-CEC standby/on'),
        ];
    } else {
        subheading('Control tests (visual confirmation required)');
        say('You will be asked before each test. Answer y/n/s (yes / no / skip).');
        say('Have a clear view of this physical monitor before continuing.');
        await pause(rl, 'Press Enter when ready to start control tests for this monitor…');
        control = await runControlTests(rl, monitor, tools, { skip: args.skipControl });
    }

    const probes = [...sensing, ...control];
    const report = {
        monitor: {
            xrandrName: monitor.xrandrName,
            drmName: monitor.drmName,
            display: monitor.display,
            i2cBus: monitor.i2cBus,
            cecDevice: monitor.cecDevice,
            status: monitor.status,
            enabled: monitor.enabled,
            dpms: monitor.dpms,
            identity: monitor.identity,
            edid: monitor.edid,
        },
        probes,
        meta: {
            timestamp: new Date().toISOString(),
            host: require('os').hostname(),
            tools,
            mode: args.sensingOnly ? 'sensing-only' : 'interactive-full',
            skipControl: args.skipControl,
        },
    };

    const paths = writeMonitorReport(REPORTS_DIR, report);
    say(`\nReport written:\n  ${paths.htmlPath}\n  ${paths.latestHtml}`);
    return { report, paths, title: `${monitor.xrandrName} (${monitor.identity?.make || '?'} ${monitor.identity?.model || ''})`.trim() };
}

function stubControl(id, label) {
    return {
        id,
        label,
        category: 'control',
        works: null,
        detail: 'Not run (--sensing-only). Re-run without that flag for visual confirmation tests.',
        requiresVisualConfirmation: true,
    };
}

async function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
        printHelp();
        process.exit(0);
    }

    process.env.DISPLAY = args.display;

    heading('PFx display-control probe');
    say(`DISPLAY=${args.display}`);
    say(`Mode: ${args.sensingOnly ? 'sensing-only (non-interactive)' : 'interactive (visual confirmation)'}`);
    say('Based on docs/pending/PR_MONITOR_CONTROL.md sensing & control matrix.\n');

    const discovery = discover({ display: args.display });
    say('Tools:');
    for (const [name, p] of Object.entries(discovery.tools)) {
        say(`  ${name}: ${p || '(missing)'}`);
    }

    if (discovery.disconnected.length) {
        say('\nDisconnected HDMI ports (not probed):');
        for (const d of discovery.disconnected) {
            say(`  ${d.xrandrName} (${d.drmName})`);
        }
    }

    if (!discovery.monitors.length) {
        say('\nNo connected HDMI monitors found. Connect a display and re-run.');
        process.exit(2);
    }

    say(`\nConnected monitors: ${discovery.monitors.length}`);
    for (const m of discovery.monitors) {
        printIdentity(m);
        say('');
    }

    const rl = args.sensingOnly ? null : createInterface();
    const summaries = [];

    try {
        if (!args.sensingOnly) {
            const go = await askChoice(rl, 'Start probing connected monitors?', {
                defaultAnswer: 'y',
                allowSkip: false,
            });
            if (go !== 'y') {
                say('Aborted.');
                process.exit(0);
            }
        }

        for (const monitor of discovery.monitors) {
            if (!args.sensingOnly && discovery.monitors.length > 1) {
                const doThis = await askChoice(rl, `Probe ${monitor.xrandrName} now?`, {
                    defaultAnswer: 'y',
                    allowSkip: true,
                });
                if (doThis === 's' || doThis === 'n') {
                    say(`Skipping ${monitor.xrandrName}`);
                    continue;
                }
            }
            const summary = await probeOneMonitor(rl, monitor, discovery.tools, args);
            summaries.push({
                title: summary.title,
                htmlPath: summary.paths.htmlPath,
                probes: summary.report.probes,
            });
        }
    } finally {
        if (rl) rl.close();
    }

    if (summaries.length) {
        const indexPath = writeIndex(REPORTS_DIR, summaries);
        heading('Done');
        say(`Index: ${indexPath}`);
        say('Open the HTML files in a browser (or scp them off the Pi).');
    } else {
        say('No reports generated.');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
