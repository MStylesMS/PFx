'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

/**
 * Parse a binary EDID blob for manufacturer, model name, and serial.
 * Falls back to parse-edid(1) when available.
 */

const PNP_VENDOR_HINTS = {
    GSM: 'LG (Goldstar)',
    SAM: 'Samsung',
    SEC: 'Samsung',
    SNY: 'Sony',
    DEL: 'Dell',
    HPN: 'HP',
    ACR: 'Acer',
    AOC: 'AOC',
    BEN: 'BenQ',
    VSC: 'ViewSonic',
    PHL: 'Philips',
    TSB: 'Toshiba',
    VIZ: 'Vizio',
    SHP: 'Sharp',
    MEI: 'Panasonic',
    RGT: 'Regza / Toshiba',
};

function readEdidFile(path) {
    try {
        const buf = fs.readFileSync(path);
        if (!buf || buf.length < 128) return null;
        return buf;
    } catch {
        return null;
    }
}

function manufacturerFromEdid(buf) {
    const word = (buf[8] << 8) | buf[9];
    const c1 = ((word >> 10) & 0x1f) + 64;
    const c2 = ((word >> 5) & 0x1f) + 64;
    const c3 = (word & 0x1f) + 64;
    return String.fromCharCode(c1, c2, c3);
}

function descriptorText(buf, tag) {
    // Four 18-byte descriptors starting at offset 54
    for (let i = 0; i < 4; i += 1) {
        const off = 54 + i * 18;
        if (buf[off] === 0 && buf[off + 1] === 0 && buf[off + 2] === 0 && buf[off + 3] === tag) {
            const raw = buf.subarray(off + 5, off + 18);
            const text = raw.toString('ascii').split('\n')[0].replace(/\0/g, '').trim();
            if (text) return text;
        }
    }
    return null;
}

function productCode(buf) {
    return buf[10] | (buf[11] << 8);
}

function serialNumber(buf) {
    const numeric = buf[12] | (buf[13] << 8) | (buf[14] << 16) | (buf[15] << 24);
    const ascii = descriptorText(buf, 0xff);
    return {
        numeric: numeric >>> 0,
        ascii,
    };
}

function manufactureDate(buf) {
    const week = buf[16];
    const year = 1990 + buf[17];
    return { week, year };
}

function parseEdidBuffer(buf) {
    if (!buf || buf.length < 128) {
        return { ok: false, error: 'EDID too short or missing' };
    }
    if (buf[0] !== 0x00 || buf[1] !== 0xff) {
        return { ok: false, error: 'EDID header invalid' };
    }

    const manufacturerId = manufacturerFromEdid(buf);
    const modelName = descriptorText(buf, 0xfc);
    const serial = serialNumber(buf);
    const date = manufactureDate(buf);
    const code = productCode(buf);

    const parseEdidCli = tryParseEdidCli(buf);

    return {
        ok: true,
        manufacturerId,
        manufacturerHint: PNP_VENDOR_HINTS[manufacturerId] || null,
        modelName: modelName || parseEdidCli?.modelName || null,
        productCode: code,
        serialAscii: serial.ascii,
        serialNumeric: serial.numeric,
        manufactureWeek: date.week,
        manufactureYear: date.year,
        displaySizeMm: {
            width: buf[21] * 10,
            height: buf[22] * 10,
        },
        parseEdidCli,
        rawHex: buf.subarray(0, 128).toString('hex'),
    };
}

function tryParseEdidCli(buf) {
    try {
        const out = execFileSync('parse-edid', {
            input: buf,
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const model = /ModelName\s+"([^"]+)"/.exec(out)?.[1] || null;
        const vendor = /VendorName\s+"([^"]+)"/.exec(out)?.[1] || null;
        const ident = /Identifier\s+"([^"]+)"/.exec(out)?.[1] || null;
        return { modelName: model || ident, vendorName: vendor, raw: out.trim() };
    } catch {
        return null;
    }
}

function parseEdidPath(edidPath) {
    const buf = readEdidFile(edidPath);
    if (!buf) return { ok: false, error: `Could not read ${edidPath}` };
    return parseEdidBuffer(buf);
}

module.exports = {
    parseEdidBuffer,
    parseEdidPath,
    readEdidFile,
    PNP_VENDOR_HINTS,
};
