'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseEdidPath } = require('./edid');

/**
 * Discover HDMI outputs and map them to DRM, I2C (DDC), and CEC devices.
 *
 * On Raspberry Pi (vc4):
 *   HDMI-1 / card*-HDMI-A-1  ->  i2c-20  /  /dev/cec0  /  fef00700.hdmi
 *   HDMI-2 / card*-HDMI-A-2  ->  i2c-21  /  /dev/cec1  /  fef05700.hdmi
 */

function run(cmd, args, opts = {}) {
    try {
        const stdout = execFileSync(cmd, args, {
            encoding: 'utf8',
            timeout: opts.timeout || 10000,
            env: { ...process.env, ...(opts.env || {}) },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { ok: true, stdout: stdout.toString() };
    } catch (err) {
        return {
            ok: false,
            stdout: (err.stdout || '').toString(),
            stderr: (err.stderr || '').toString(),
            error: err.message,
            code: err.status,
        };
    }
}

function which(bin) {
    const result = run('bash', ['-lc', `command -v ${bin}`]);
    return result.ok ? result.stdout.trim() : null;
}

function listDrmHdmiConnectors() {
    const drmRoot = '/sys/class/drm';
    if (!fs.existsSync(drmRoot)) return [];

    return fs
        .readdirSync(drmRoot)
        .filter((name) => /HDMI-A-\d+$/.test(name))
        .map((name) => {
            const dir = path.join(drmRoot, name);
            const status = safeRead(path.join(dir, 'status')) || 'unknown';
            const enabled = safeRead(path.join(dir, 'enabled')) || 'unknown';
            const dpms = safeRead(path.join(dir, 'dpms')) || null;
            const connectorId = safeRead(path.join(dir, 'connector_id'));
            const ddcTarget = resolveSymlink(path.join(dir, 'ddc'));
            const i2cBus = ddcTarget ? path.basename(ddcTarget) : null; // e.g. i2c-20
            const i2cMatch = i2cBus ? /^i2c-(\d+)$/.exec(i2cBus) : null;
            const i2cNum = i2cMatch ? Number(i2cMatch[1]) : null;
            const edidPath = path.join(dir, 'edid');
            const edid = status === 'connected' ? parseEdidPath(edidPath) : { ok: false, error: 'disconnected' };
            const portNum = Number((/HDMI-A-(\d+)$/.exec(name) || [])[1]);
            const xrandrName = Number.isFinite(portNum) ? `HDMI-${portNum}` : null;
            const cecDevice = Number.isFinite(portNum) ? `/dev/cec${portNum - 1}` : null;

            return {
                drmName: name,
                drmPath: dir,
                xrandrName,
                status,
                enabled,
                dpms,
                connectorId: connectorId ? Number(connectorId) : null,
                i2cBus,
                i2cDev: i2cNum != null ? `/dev/i2c-${i2cNum}` : null,
                i2cNum,
                cecDevice: cecDevice && fs.existsSync(cecDevice) ? cecDevice : null,
                edidPath,
                edid,
                connected: status === 'connected',
            };
        })
        .sort((a, b) => String(a.drmName).localeCompare(String(b.drmName)));
}

function parseXrandrVerbose(display = ':0') {
    const result = run('xrandr', ['--verbose'], { env: { DISPLAY: display } });
    if (!result.ok) {
        return { ok: false, error: result.stderr || result.error, outputs: [] };
    }

    const outputs = [];
    let current = null;
    for (const line of result.stdout.split('\n')) {
        const header = /^(\S+)\s+(connected|disconnected)(?:\s+(primary))?(?:\s+(\d+x\d+\+\d+\+\d+))?/.exec(line);
        if (header) {
            if (current) outputs.push(current);
            current = {
                name: header[1],
                connected: header[2] === 'connected',
                primary: Boolean(header[3]),
                geometry: header[4] || null,
                brightness: null,
                connectorId: null,
                edidHex: null,
                modes: [],
                rawLines: [line],
            };
            continue;
        }
        if (!current) continue;
        current.rawLines.push(line);

        const bright = /^\s*Brightness:\s+([0-9.]+)/.exec(line);
        if (bright) current.brightness = Number(bright[1]);

        const conn = /^\s*CONNECTOR_ID:\s+(\d+)/.exec(line);
        if (conn) current.connectorId = Number(conn[1]);

        if (/^\s*EDID:\s*$/.test(line)) {
            current._readingEdid = true;
            current.edidHex = '';
            continue;
        }
        if (current._readingEdid) {
            if (/^\s+[0-9a-f]+/.test(line)) {
                current.edidHex += line.trim();
                continue;
            }
            current._readingEdid = false;
        }

        const mode = /^\s+(\d+x\d+)\s+/.exec(line);
        if (mode && line.includes('*')) {
            current.currentMode = mode[1];
            const rate = /\b([0-9.]+)(?:\*|Hz)/.exec(line) || /\s([0-9.]+)\s*$/.exec(line);
            if (rate) current.currentRate = rate[1];
        }
    }
    if (current) outputs.push(current);
    return { ok: true, outputs, raw: result.stdout };
}

function getDisplayEnv() {
    return process.env.DISPLAY || ':0';
}

function discover({ display } = {}) {
    const disp = display || getDisplayEnv();
    const tools = {
        xrandr: which('xrandr'),
        xset: which('xset'),
        ddcutil: which('ddcutil'),
        cecClient: which('cec-client'),
        parseEdid: which('parse-edid'),
        i2cdetect: which('i2cdetect'),
    };

    const drm = listDrmHdmiConnectors();
    const xrandr = tools.xrandr ? parseXrandrVerbose(disp) : { ok: false, error: 'xrandr not found', outputs: [] };

    const monitors = drm
        .filter((d) => d.connected)
        .map((d) => {
            const xr = (xrandr.outputs || []).find((o) => o.name === d.xrandrName) || null;
            return {
                ...d,
                display: disp,
                xrandr: xr,
                identity: summarizeIdentity(d, xr),
            };
        });

    const disconnected = drm.filter((d) => !d.connected);

    return {
        timestamp: new Date().toISOString(),
        host: require('os').hostname(),
        display: disp,
        tools,
        monitors,
        disconnected,
        xrandrOk: xrandr.ok,
        xrandrError: xrandr.error || null,
    };
}

function summarizeIdentity(drmConn, xrandrOut) {
    const edid = drmConn.edid || {};
    const make =
        edid.manufacturerHint ||
        edid.manufacturerId ||
        edid.parseEdidCli?.vendorName ||
        null;
    const model = edid.modelName || edid.parseEdidCli?.modelName || null;
    return {
        make,
        model,
        manufacturerId: edid.manufacturerId || null,
        productCode: edid.productCode ?? null,
        serialAscii: edid.serialAscii || null,
        serialNumeric: edid.serialNumeric ?? null,
        manufactureYear: edid.manufactureYear || null,
        manufactureWeek: edid.manufactureWeek || null,
        currentMode: xrandrOut?.currentMode || null,
        geometry: xrandrOut?.geometry || null,
        primary: Boolean(xrandrOut?.primary),
        displaySizeMm: edid.displaySizeMm || null,
    };
}

function safeRead(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8').trim();
    } catch {
        return null;
    }
}

function resolveSymlink(linkPath) {
    try {
        return fs.realpathSync(linkPath);
    } catch {
        return null;
    }
}

module.exports = {
    discover,
    listDrmHdmiConnectors,
    parseXrandrVerbose,
    getDisplayEnv,
    run,
    which,
};
