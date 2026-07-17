'use strict';

const fs = require('fs');
const { run } = require('./discover');

/**
 * Non-destructive sensing probes for one monitor.
 * Each probe returns { id, label, category, works, detail, evidence }.
 */

function result(id, label, category, works, detail, evidence = null) {
    return { id, label, category, works, detail, evidence };
}

function probeXsetDpms(display) {
    const r = run('xset', ['q'], { env: { DISPLAY: display } });
    if (!r.ok) {
        return result('sense.xset_dpms', 'X11 DPMS status (xset q)', 'sensing', false, r.stderr || r.error);
    }
    const enabled = /DPMS is Enabled/.test(r.stdout);
    const disabled = /DPMS is Disabled/.test(r.stdout);
    const monitorLine = /Monitor is (On|Off|Standby|Suspend)/.exec(r.stdout);
    const state = monitorLine ? monitorLine[1] : null;
    const works = enabled || disabled;
    return result(
        'sense.xset_dpms',
        'X11 DPMS status (xset q)',
        'sensing',
        works,
        works
            ? `DPMS ${enabled ? 'enabled' : 'disabled'}; monitor reported as ${state || 'unknown'} (DISPLAY-global, not per-output)`
            : 'DPMS section not found in xset q',
        { enabled, disabled, state, snippet: extractDpmsBlock(r.stdout) }
    );
}

function extractDpmsBlock(text) {
    const lines = text.split('\n');
    const start = lines.findIndex((l) => /DPMS/.test(l));
    if (start < 0) return null;
    return lines.slice(start, start + 6).join('\n');
}

function probeXrandrOutput(monitor) {
    const xr = monitor.xrandr;
    if (!xr) {
        return result(
            'sense.xrandr_output',
            'xrandr --verbose per-output',
            'sensing',
            false,
            `Output ${monitor.xrandrName} not found in xrandr --verbose`
        );
    }
    const works = xr.connected === true;
    return result(
        'sense.xrandr_output',
        'xrandr --verbose per-output',
        'sensing',
        works,
        works
            ? `connected=${xr.connected}, mode=${xr.currentMode || 'n/a'}, brightness=${xr.brightness ?? 'n/a'}, primary=${xr.primary}`
            : 'Output present but not connected',
        {
            name: xr.name,
            connected: xr.connected,
            currentMode: xr.currentMode || null,
            brightness: xr.brightness,
            primary: xr.primary,
            geometry: xr.geometry,
            connectorId: xr.connectorId,
        }
    );
}

function probeDrmSysfs(monitor) {
    const works = monitor.connected && Boolean(monitor.dpms || monitor.status);
    return result(
        'sense.drm_sysfs',
        'DRM sysfs (status/dpms/enabled)',
        'sensing',
        works,
        works
            ? `status=${monitor.status}, enabled=${monitor.enabled}, dpms=${monitor.dpms || 'n/a'}`
            : 'DRM connector sysfs unavailable',
        {
            status: monitor.status,
            enabled: monitor.enabled,
            dpms: monitor.dpms,
            drmName: monitor.drmName,
        }
    );
}

function probeEdidIdentity(monitor) {
    const edid = monitor.edid || {};
    const works = Boolean(edid.ok && (edid.modelName || edid.manufacturerId));
    const make = monitor.identity?.make || edid.manufacturerId || 'unknown';
    const model = monitor.identity?.model || 'unknown';
    return result(
        'sense.edid_identity',
        'EDID make / model',
        'sensing',
        works,
        works
            ? `make=${make}, model=${model}, year=${edid.manufactureYear || 'n/a'}`
            : edid.error || 'EDID not readable',
        {
            make,
            model,
            manufacturerId: edid.manufacturerId || null,
            productCode: edid.productCode ?? null,
            serialAscii: edid.serialAscii || null,
            manufactureYear: edid.manufactureYear || null,
        }
    );
}

function probeDdcutil(monitor, tools) {
    if (!tools.ddcutil) {
        // Fall back to raw I2C probe for DDC address 0x37
        return probeDdcI2cPresence(monitor, tools, true);
    }

    const busArgs = monitor.i2cNum != null ? ['--bus', String(monitor.i2cNum)] : [];
    const detect = run('ddcutil', [...busArgs, 'detect', '--verbose'], { timeout: 20000 });
    const hasDisplay = /Display\s+\d+/i.test(detect.stdout) && !/Invalid display/i.test(detect.stdout);
    const unsupported = /DDC communication failed|No monitor detected|Display not found/i.test(
        `${detect.stdout}\n${detect.stderr}`
    );

    let power = null;
    let brightness = null;
    if (hasDisplay) {
        power = run('ddcutil', [...busArgs, 'getvcp', '0xd6'], { timeout: 15000 });
        brightness = run('ddcutil', [...busArgs, 'getvcp', '0x10'], { timeout: 15000 });
    }

    const works = hasDisplay && !unsupported;
    const detailParts = [];
    if (!works) {
        detailParts.push(unsupported ? 'DDC communication failed / no monitor on this bus' : 'ddcutil detect found no display');
    } else {
        detailParts.push('ddcutil detect OK');
        if (power?.ok) detailParts.push(`power(0xD6): ${summarizeVcp(power.stdout)}`);
        if (brightness?.ok) detailParts.push(`brightness(0x10): ${summarizeVcp(brightness.stdout)}`);
    }

    return result(
        'sense.ddcutil',
        'ddcutil DDC/CI telemetry',
        'sensing',
        works,
        detailParts.join('; '),
        {
            i2cBus: monitor.i2cBus,
            detectOk: detect.ok,
            detectOut: trunc(detect.stdout || detect.stderr, 1200),
            power: power ? trunc(power.stdout || power.stderr, 400) : null,
            brightness: brightness ? trunc(brightness.stdout || brightness.stderr, 400) : null,
        }
    );
}

function probeDdcI2cPresence(monitor, tools, ddcutilMissing) {
    if (monitor.i2cNum == null) {
        return result(
            'sense.ddcutil',
            'ddcutil DDC/CI telemetry',
            'sensing',
            false,
            ddcutilMissing
                ? 'ddcutil not installed; no I2C bus mapped for this connector'
                : 'No I2C bus mapped for this connector'
        );
    }

    if (!tools.i2cdetect) {
        return result(
            'sense.ddcutil',
            'ddcutil DDC/CI telemetry',
            'sensing',
            false,
            ddcutilMissing
                ? `ddcutil not installed; i2cdetect also missing (bus ${monitor.i2cBus})`
                : `i2cdetect missing (bus ${monitor.i2cBus})`,
            { i2cBus: monitor.i2cBus, ddcutilMissing: true }
        );
    }

    const scan = run('i2cdetect', ['-y', String(monitor.i2cNum)], { timeout: 10000 });
    // DDC/CI slave address is 0x37
    const has37 = scan.ok && /(?:^|\s)37(?:\s|$)/m.test(formatI2cGrid(scan.stdout));
    // Also accept 'UU' occupied markers near 37
    const line30 = scan.stdout.split('\n').find((l) => /^30:/.test(l)) || '';
    const cell37 = line30.trim().split(/\s+/).slice(1)[7]; // columns 0..f
    const present = has37 || cell37 === '37' || cell37 === 'UU';

    return result(
        'sense.ddcutil',
        'ddcutil DDC/CI telemetry',
        'sensing',
        false,
        ddcutilMissing
            ? `ddcutil not installed; I2C 0x37 (DDC) ${present ? 'appears present' : 'not detected'} on ${monitor.i2cBus} — install ddcutil to test fully`
            : `I2C 0x37 ${present ? 'present' : 'absent'} on ${monitor.i2cBus}`,
        {
            i2cBus: monitor.i2cBus,
            ddcutilMissing: Boolean(ddcutilMissing),
            ddcAddressPresent: present,
            i2cdetect: trunc(scan.stdout || scan.stderr, 800),
            worksIfInstalled: present,
        }
    );
}

function formatI2cGrid(stdout) {
    return stdout;
}

function summarizeVcp(text) {
    const m = /VCP code 0x[0-9a-fA-F]+[^\n]*/.exec(text);
    return m ? m[0].trim() : trunc(text, 160);
}

function probeCec(monitor, tools) {
    if (!tools.cecClient) {
        return result('sense.cec', 'HDMI-CEC sensing (cec-client)', 'sensing', false, 'cec-client not installed');
    }
    if (!monitor.cecDevice) {
        return result('sense.cec', 'HDMI-CEC sensing (cec-client)', 'sensing', false, 'No /dev/cec* mapped for this port');
    }

    // Poll TV at logical address 0 for power status
    const pow = run(
        'bash',
        ['-lc', `printf 'pow 0\\n' | timeout 6 cec-client -s -d 1 '${monitor.cecDevice}'`],
        { timeout: 10000 }
    );
    const scan = run(
        'bash',
        ['-lc', `printf 'scan\\n' | timeout 8 cec-client -s -d 1 '${monitor.cecDevice}'`],
        { timeout: 12000 }
    );

    const powerMatch = /power status:\s*(\S+)/i.exec(pow.stdout || '');
    const powerStatus = powerMatch ? powerMatch[1] : null;
    const busHasTv = /device #0:|TV/i.test(scan.stdout || '');
    const works = Boolean(powerStatus && powerStatus !== 'unknown') || busHasTv;

    return result(
        'sense.cec',
        'HDMI-CEC sensing (cec-client)',
        'sensing',
        works,
        works
            ? `device=${monitor.cecDevice}; TV power=${powerStatus || 'seen on bus'}; scan found TV=${busHasTv}`
            : `device=${monitor.cecDevice}; TV power=${powerStatus || 'unknown'}; no responsive TV on CEC bus (common if CEC disabled on TV)`,
        {
            cecDevice: monitor.cecDevice,
            powerStatus,
            busHasTv,
            powOut: trunc(pow.stdout || pow.stderr, 600),
            scanOut: trunc(scan.stdout || scan.stderr, 1000),
        }
    );
}

function probeLogind() {
    const r = run('bash', ['-lc', 'loginctl show-session "$XDG_SESSION_ID" 2>/dev/null || loginctl 2>/dev/null | head -20']);
    const works = r.ok && /Id=|SESSION/.test(r.stdout);
    return result(
        'sense.logind',
        'systemd-logind session idle',
        'sensing',
        works,
        works
            ? 'loginctl available (session-level only; not per-monitor — noted for completeness)'
            : 'loginctl unavailable or no session',
        { snippet: trunc(r.stdout || r.stderr, 400) }
    );
}

function runSensingProbes(monitor, tools) {
    return [
        probeXsetDpms(monitor.display),
        probeXrandrOutput(monitor),
        probeDrmSysfs(monitor),
        probeEdidIdentity(monitor),
        probeDdcutil(monitor, tools),
        probeCec(monitor, tools),
        probeLogind(),
    ];
}

function trunc(text, max) {
    if (!text) return '';
    const t = String(text).trim();
    return t.length <= max ? t : `${t.slice(0, max)}…`;
}

module.exports = {
    runSensingProbes,
    probeXsetDpms,
    probeXrandrOutput,
    probeDrmSysfs,
    probeEdidIdentity,
    probeDdcutil,
    probeCec,
    probeLogind,
};
