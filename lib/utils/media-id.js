/**
 * Suite media pack id sanitizer and path insert.
 *
 * Canonical contract: PxH docs/standards/MQTT-CONTRACT.md § Media pack (`mediaId`).
 * When unset, path join is bit-identical to `{mediaDir}/{file}`.
 */

const path = require('path');

/** Positive integer, 1–9 digits, no leading zeros. */
const MEDIA_ID_RE = /^[1-9][0-9]{0,8}$/;

/**
 * @param {*} raw - JSON number, decimal string, or `null` (clear pack)
 * @returns {{ ok: true, mediaId: string|null } | { ok: false, reason: string }}
 */
function sanitizeMediaId(raw) {
    if (raw === null) {
        return { ok: true, mediaId: null };
    }
    if (raw === undefined) {
        return { ok: false, reason: 'mediaId is required' };
    }

    let asString;
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
            return { ok: false, reason: 'mediaId must be a positive integer' };
        }
        asString = String(raw);
    } else if (typeof raw === 'string') {
        asString = raw;
    } else {
        return { ok: false, reason: 'mediaId must be a JSON number or decimal string' };
    }

    if (!MEDIA_ID_RE.test(asString)) {
        return { ok: false, reason: 'mediaId must match ^[1-9][0-9]{0,8}$' };
    }

    return { ok: true, mediaId: asString };
}

function hasMediaIdField(command) {
    return command != null && Object.prototype.hasOwnProperty.call(command, 'mediaId');
}

/**
 * Insert pack segment for relative files when mediaId is set.
 * Absolute `file` skips the insert. When mediaId is unset, result is
 * `path.join(mediaDir, file)` (same as today's resolver).
 *
 * @param {string} mediaDir
 * @param {string} file
 * @param {string|null|undefined} mediaId
 * @returns {string}
 */
function joinMediaPath(mediaDir, file, mediaId) {
    if (mediaId && file && !path.isAbsolute(file)) {
        return path.join(mediaDir, String(mediaId), file);
    }
    return path.join(mediaDir, file);
}

module.exports = {
    MEDIA_ID_RE,
    sanitizeMediaId,
    hasMediaIdField,
    joinMediaPath
};
