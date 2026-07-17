'use strict';

const { run } = require('./discover');
const { askChoice, pause, say, subheading } = require('./prompt');

/**
 * Interactive control tests that require visual confirmation.
 * Each test: explain → optional execute → ask whether the monitor behaved as expected → restore.
 */

function controlResult(id, label, works, detail, evidence = null) {
    return {
        id,
        label,
        category: 'control',
        works,
        detail,
        evidence,
        requiresVisualConfirmation: true,
    };
}

async function confirmVisual(rl, expected) {
    const answer = await askChoice(rl, `Did you observe: ${expected}?`, {
        defaultAnswer: 'n',
        allowSkip: true,
    });
    if (answer === 's') return { skipped: true, works: null };
    return { skipped: false, works: answer === 'y' };
}

async function maybeProceed(rl, actionDescription) {
    say(`About to: ${actionDescription}`);
    const answer = await askChoice(rl, 'Proceed with this control test?', {
        defaultAnswer: 'y',
        allowSkip: true,
    });
    return answer; // y | n | s
}

async function testDpmsForce(rl, monitor) {
    subheading(`Control: X11 DPMS force off/on (${monitor.xrandrName})`);
    say('Note: xset DPMS is DISPLAY-global — it affects every monitor on this X display,');
    say(`not only ${monitor.xrandrName}.`);

    const proceed = await maybeProceed(rl, `xset dpms force off, wait, then xset dpms force on (DISPLAY=${monitor.display})`);
    if (proceed === 's') {
        return controlResult('control.dpms_force', 'DPMS xset force off/on', null, 'Skipped by operator');
    }
    if (proceed === 'n') {
        return controlResult('control.dpms_force', 'DPMS xset force off/on', false, 'Operator declined to run');
    }

    say('Forcing DPMS off in 2 seconds… watch the monitor.');
    await sleep(2000);
    let off = run('xset', ['dpms', 'force', 'off'], { env: { DISPLAY: monitor.display } });
    await sleep(2500);
    const offConfirm = await confirmVisual(rl, 'monitor went blank / powered down (or to standby)');

    say('Forcing DPMS on…');
    let on = run('xset', ['dpms', 'force', 'on'], { env: { DISPLAY: monitor.display } });
    // Re-enable DPMS timeouts at 0 for PFx-style always-on after test
    run('xset', ['dpms', '0', '0', '0'], { env: { DISPLAY: monitor.display } });
    await sleep(2000);
    const onConfirm = await confirmVisual(rl, 'monitor woke / image returned');

    if (offConfirm.skipped || onConfirm.skipped) {
        return controlResult('control.dpms_force', 'DPMS xset force off/on', null, 'Skipped during confirmation', {
            offCmd: off,
            onCmd: on,
        });
    }

    const works = offConfirm.works && onConfirm.works;
    return controlResult(
        'control.dpms_force',
        'DPMS xset force off/on',
        works,
        works
            ? 'Operator confirmed blank + wake via xset dpms force'
            : `Off observed=${offConfirm.works}, On observed=${onConfirm.works}; cmd off ok=${off.ok}, on ok=${on.ok}`,
        { offOk: off.ok, onOk: on.ok, offConfirm, onConfirm }
    );
}

async function testXrandrOutputToggle(rl, monitor) {
    subheading(`Control: xrandr --output ${monitor.xrandrName} --off / --auto`);
    say('This disables the individual output, then re-enables it with --auto.');
    say('Resolution / positioning may need repair afterward (PFx screen-power-manager does this).');

    const proceed = await maybeProceed(
        rl,
        `xrandr --output ${monitor.xrandrName} --off, then --auto`
    );
    if (proceed === 's') {
        return controlResult('control.xrandr_toggle', 'xrandr output --off/--auto', null, 'Skipped by operator');
    }
    if (proceed === 'n') {
        return controlResult('control.xrandr_toggle', 'xrandr output --off/--auto', false, 'Operator declined to run');
    }

    const modeBefore = monitor.xrandr?.currentMode || null;
    say(`Turning ${monitor.xrandrName} off in 2 seconds…`);
    await sleep(2000);
    const off = run('xrandr', ['--output', monitor.xrandrName, '--off'], {
        env: { DISPLAY: monitor.display },
    });
    await sleep(2500);
    const offConfirm = await confirmVisual(rl, `${monitor.xrandrName} went dark / disconnected from desktop`);

    say(`Re-enabling ${monitor.xrandrName} with --auto…`);
    const onArgs = ['--output', monitor.xrandrName, '--auto'];
    if (modeBefore) {
        // Prefer previous mode when known
        onArgs.push('--mode', modeBefore);
    }
    const on = run('xrandr', onArgs, { env: { DISPLAY: monitor.display } });
    await sleep(2500);
    const onConfirm = await confirmVisual(rl, 'image returned on this monitor');

    if (offConfirm.skipped || onConfirm.skipped) {
        // Best-effort restore
        run('xrandr', ['--output', monitor.xrandrName, '--auto'], { env: { DISPLAY: monitor.display } });
        return controlResult('control.xrandr_toggle', 'xrandr output --off/--auto', null, 'Skipped during confirmation', {
            off,
            on,
        });
    }

    const works = offConfirm.works && onConfirm.works;
    return controlResult(
        'control.xrandr_toggle',
        'xrandr output --off/--auto',
        works,
        works
            ? 'Operator confirmed per-output off + restore via xrandr'
            : `Off observed=${offConfirm.works}, On observed=${onConfirm.works}; cmd off ok=${off.ok}, on ok=${on.ok}`,
        { offOk: off.ok, onOk: on.ok, modeBefore, offConfirm, onConfirm }
    );
}

async function testDdcutilPower(rl, monitor, tools) {
    subheading(`Control: ddcutil setvcp 0xD6 (power mode) on ${monitor.xrandrName}`);

    if (!tools.ddcutil) {
        return controlResult(
            'control.ddcutil_power',
            'ddcutil setvcp power (0xD6)',
            false,
            'ddcutil not installed — skip or apt install ddcutil, then re-run'
        );
    }
    if (monitor.i2cNum == null) {
        return controlResult('control.ddcutil_power', 'ddcutil setvcp power (0xD6)', false, 'No I2C bus for this connector');
    }

    const busArgs = ['--bus', String(monitor.i2cNum)];
    const detect = run('ddcutil', [...busArgs, 'detect'], { timeout: 20000 });
    if (!/Display\s+\d+/i.test(detect.stdout)) {
        return controlResult(
            'control.ddcutil_power',
            'ddcutil setvcp power (0xD6)',
            false,
            `ddcutil detect found no display on ${monitor.i2cBus}`,
            { detectOut: detect.stdout || detect.stderr }
        );
    }

    say('VCP 0xD6 values vary by vendor; common: 1=on, 4=standby/off, 5=off.');
    say('This test sets standby/off (0x04), asks for confirmation, then sets on (0x01).');

    const proceed = await maybeProceed(rl, `ddcutil --bus ${monitor.i2cNum} setvcp 0xD6 0x04 then 0x01`);
    if (proceed === 's') {
        return controlResult('control.ddcutil_power', 'ddcutil setvcp power (0xD6)', null, 'Skipped by operator');
    }
    if (proceed === 'n') {
        return controlResult('control.ddcutil_power', 'ddcutil setvcp power (0xD6)', false, 'Operator declined to run');
    }

    say('Setting power to standby/off (0x04) in 2 seconds…');
    await sleep(2000);
    const off = run('ddcutil', [...busArgs, 'setvcp', '0xD6', '0x04'], { timeout: 15000 });
    await sleep(3000);
    const offConfirm = await confirmVisual(rl, 'TV/monitor entered standby or turned off');

    say('Setting power to on (0x01)…');
    const on = run('ddcutil', [...busArgs, 'setvcp', '0xD6', '0x01'], { timeout: 15000 });
    await sleep(4000);
    const onConfirm = await confirmVisual(rl, 'TV/monitor turned back on');

    if (offConfirm.skipped || onConfirm.skipped) {
        run('ddcutil', [...busArgs, 'setvcp', '0xD6', '0x01'], { timeout: 15000 });
        return controlResult('control.ddcutil_power', 'ddcutil setvcp power (0xD6)', null, 'Skipped during confirmation');
    }

    const works = offConfirm.works && onConfirm.works;
    return controlResult(
        'control.ddcutil_power',
        'ddcutil setvcp power (0xD6)',
        works,
        works
            ? 'Operator confirmed DDC power off + on'
            : `Off observed=${offConfirm.works}, On observed=${onConfirm.works}; cmd off ok=${off.ok}, on ok=${on.ok}`,
        {
            offOk: off.ok,
            onOk: on.ok,
            offOut: off.stderr || off.stdout,
            onOut: on.stderr || on.stdout,
            offConfirm,
            onConfirm,
        }
    );
}

async function testCecPower(rl, monitor, tools) {
    subheading(`Control: HDMI-CEC standby / on (${monitor.cecDevice || 'n/a'})`);

    if (!tools.cecClient) {
        return controlResult('control.cec_power', 'HDMI-CEC standby/on', false, 'cec-client not installed');
    }
    if (!monitor.cecDevice) {
        return controlResult('control.cec_power', 'HDMI-CEC standby/on', false, 'No CEC device for this port');
    }

    say('Sends CEC standby to address 0 (TV), then `on 0` to wake.');
    say('Requires CEC enabled on the TV; may conflict with other CEC clients.');

    const proceed = await maybeProceed(rl, `cec-client standby / on via ${monitor.cecDevice}`);
    if (proceed === 's') {
        return controlResult('control.cec_power', 'HDMI-CEC standby/on', null, 'Skipped by operator');
    }
    if (proceed === 'n') {
        return controlResult('control.cec_power', 'HDMI-CEC standby/on', false, 'Operator declined to run');
    }

    say('Sending CEC standby in 2 seconds…');
    await sleep(2000);
    const off = run(
        'bash',
        ['-lc', `printf 'standby 0\\n' | timeout 6 cec-client -s -d 1 '${monitor.cecDevice}'`],
        { timeout: 10000 }
    );
    await sleep(4000);
    const offConfirm = await confirmVisual(rl, 'TV entered standby / turned off via CEC');

    say('Sending CEC on…');
    const on = run(
        'bash',
        ['-lc', `printf 'on 0\\n' | timeout 6 cec-client -s -d 1 '${monitor.cecDevice}'`],
        { timeout: 10000 }
    );
    // Also try as active source to help some TVs wake to this input
    run(
        'bash',
        ['-lc', `printf 'as\\n' | timeout 4 cec-client -s -d 1 '${monitor.cecDevice}'`],
        { timeout: 8000 }
    );
    await sleep(5000);
    const onConfirm = await confirmVisual(rl, 'TV turned back on / woke via CEC');

    if (offConfirm.skipped || onConfirm.skipped) {
        run('bash', ['-lc', `printf 'on 0\\n' | timeout 6 cec-client -s -d 1 '${monitor.cecDevice}'`], {
            timeout: 10000,
        });
        return controlResult('control.cec_power', 'HDMI-CEC standby/on', null, 'Skipped during confirmation');
    }

    const works = offConfirm.works && onConfirm.works;
    return controlResult(
        'control.cec_power',
        'HDMI-CEC standby/on',
        works,
        works
            ? 'Operator confirmed CEC standby + on'
            : `Off observed=${offConfirm.works}, On observed=${onConfirm.works}`,
        {
            cecDevice: monitor.cecDevice,
            offOut: trunc(off.stdout || off.stderr, 500),
            onOut: trunc(on.stdout || on.stderr, 500),
            offConfirm,
            onConfirm,
        }
    );
}

async function runControlTests(rl, monitor, tools, { skip = [] } = {}) {
    const results = [];
    const all = [
        ['dpms', () => testDpmsForce(rl, monitor)],
        ['xrandr', () => testXrandrOutputToggle(rl, monitor)],
        ['ddc', () => testDdcutilPower(rl, monitor, tools)],
        ['cec', () => testCecPower(rl, monitor, tools)],
    ];

    for (const [key, fn] of all) {
        if (skip.includes(key)) {
            results.push(
                controlResult(`control.${key}`, `Skipped group ${key}`, null, 'Disabled via CLI flag')
            );
            continue;
        }
        try {
            results.push(await fn());
        } catch (err) {
            results.push(
                controlResult(`control.${key}`, `Control test ${key}`, false, `Exception: ${err.message}`)
            );
            say(`Restoring display best-effort after error…`);
            run('xset', ['dpms', 'force', 'on'], { env: { DISPLAY: monitor.display } });
            run('xrandr', ['--output', monitor.xrandrName, '--auto'], { env: { DISPLAY: monitor.display } });
        }
        await pause(rl, 'Press Enter for the next control test (or finish)…');
    }
    return results;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function trunc(text, max) {
    if (!text) return '';
    const t = String(text).trim();
    return t.length <= max ? t : `${t.slice(0, max)}…`;
}

module.exports = {
    runControlTests,
    testDpmsForce,
    testXrandrOutputToggle,
    testDdcutilPower,
    testCecPower,
};
