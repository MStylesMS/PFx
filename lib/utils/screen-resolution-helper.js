const { spawn } = require('child_process');
const Logger = require('./logger');

/**
 * Applies a desired resolution to an X11 output using xrandr, with optional fallback.
 *
 * @param {Object} options
 * @param {string} [options.display=':0'] - Target DISPLAY value for xrandr
 * @param {string} [options.outputName] - Desired xrandr output name (e.g. HDMI-1)
 * @param {number} [options.targetMonitor] - Optional monitor index (used when outputName missing)
 * @param {string} [options.resolutionMode] - Target mode string (e.g. 640x480@60)
 * @param {string} [options.resolutionFallback] - Fallback mode string if primary fails
 * @param {Logger} [options.logger] - Logger instance for structured output
 * @returns {Promise<{applied:boolean, skipped?:boolean, fallbackUsed?:boolean, reason?:string}>}
 */
async function applyScreenResolution(options = {}) {
    const {
        display = ':0',
        outputName,
        targetMonitor,
        resolutionMode,
        resolutionFallback,
        logger
    } = options;

    const log = logger || new Logger('ScreenResolution');

    if (!resolutionMode) {
        log.debug('No resolution_mode configured for this screen; skipping xrandr step.');
        return { applied: false, skipped: true, reason: 'no_mode' };
    }

    const env = { ...process.env };
    if (display) env.DISPLAY = display;
    if (!env.DISPLAY) {
        log.warn('DISPLAY environment is not set; cannot apply resolution.');
        return { applied: false, skipped: true, reason: 'no_display' };
    }

    const primaryMode = parseMode(resolutionMode);
    if (!primaryMode) {
        log.warn(`Invalid resolution_mode value '${resolutionMode}'. Expected formats like 640x480@60.`);
        return { applied: false, skipped: true, reason: 'invalid_mode' };
    }

    let resolvedOutput = outputName ? outputName.trim() : '';
    try {
        if (!resolvedOutput) {
            resolvedOutput = await resolveOutputByMonitor(targetMonitor, env, log);
        }
    } catch (error) {
        log.warn(`Failed to resolve monitor by index: ${error.message}`);
    }

    if (!resolvedOutput) {
        log.warn('Resolution requested but no output name could be determined.');
        return { applied: false, skipped: true, reason: 'no_output' };
    }

    // Check current mode so we can exit early when already correct.
    let currentMode = null;
    try {
        const query = await runXrandr(['--query'], env);
        currentMode = extractCurrentMode(query.stdout, resolvedOutput);
        if (currentMode && modesMatch(currentMode, primaryMode)) {
            log.info(`Display ${resolvedOutput} already set to ${formatMode(primaryMode)}; skipping change.`);
            return { applied: false, skipped: true, reason: 'already_set' };
        }
    } catch (error) {
        log.warn(`Could not inspect current mode for ${resolvedOutput}: ${error.message}`);
    }

    const attempts = [primaryMode];
    const fallbackMode = parseMode(resolutionFallback);
    if (fallbackMode) {
        attempts.push(fallbackMode);
    } else if (resolutionFallback) {
        log.warn(`Invalid resolution_fallback '${resolutionFallback}' ignored.`);
    }

    let lastError = null;
    for (let idx = 0; idx < attempts.length; idx += 1) {
        const mode = attempts[idx];
        const args = buildXrandrArgs(resolvedOutput, mode);
        try {
            await runXrandr(args, env);
            const usedFallback = idx > 0;
            log.info(`Set display ${resolvedOutput} to ${formatMode(mode)}${usedFallback ? ' (fallback)' : ''}.`);
            return { applied: true, fallbackUsed: usedFallback };
        } catch (error) {
            lastError = error;
            log.warn(`Failed to set ${resolvedOutput} to ${formatMode(mode)}: ${error.message}`);
        }
    }

    const detail = lastError ? lastError.message : 'Unknown failure';
    log.warn(`Unable to apply resolution for ${resolvedOutput}. ${detail}`);
    return { applied: false, reason: 'apply_failed', error: lastError };
}

function parseMode(value) {
    if (!value) return null;
    const str = String(value).trim();
    if (!str) return null;

    const simple = str.match(/^(\d{2,5})x(\d{2,5})(?:@(\d{1,3}(?:\.\d+)?))?$/);
    if (simple) {
        return {
            kind: 'parsed',
            mode: `${simple[1]}x${simple[2]}`,
            rate: simple[3] ? parseFloat(simple[3]) : null,
            original: str
        };
    }

    return { kind: 'raw', mode: str, rate: null, original: str };
}

async function resolveOutputByMonitor(targetMonitor, env, log) {
    if (typeof targetMonitor !== 'number' || Number.isNaN(targetMonitor) || targetMonitor < 0) {
        return null;
    }
    try {
        const list = await runXrandr(['--listmonitors'], env);
        const monitors = parseMonitorList(list.stdout);
        const match = monitors.find((m) => m.index === targetMonitor);
        if (match) {
            log.debug(`Resolved monitor index ${targetMonitor} -> output ${match.name} via --listmonitors.`);
            return match.name;
        }
    } catch (error) {
        log.debug(`xrandr --listmonitors failed: ${error.message}`);
    }

    const query = await runXrandr(['--query'], env);
    const outputs = parseConnectedOutputs(query.stdout);
    const match = outputs[targetMonitor];
    if (match) {
        log.debug(`Resolved monitor index ${targetMonitor} -> output ${match} via --query fallback.`);
        return match;
    }

    return null;
}

function parseMonitorList(stdout) {
    return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('Monitors:'))
        .map((line) => {
            const tokens = line.split(/\s+/);
            if (tokens.length < 2) return null;
            const indexToken = tokens[0].replace(':', '');
            const index = parseInt(indexToken, 10);
            if (Number.isNaN(index)) return null;
            const name = tokens[tokens.length - 1];
            return { index, name };
        })
        .filter(Boolean);
}

function parseConnectedOutputs(stdout) {
    const outputs = [];
    stdout.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (!/\bconnected\b/.test(trimmed)) return;
        const tokens = trimmed.split(/\s+/);
        if (tokens.length === 0) return;
        outputs.push(tokens[0]);
    });
    return outputs;
}

function extractCurrentMode(stdout, outputName) {
    const lines = stdout.split('\n');
    let inOutputBlock = false;
    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!inOutputBlock) {
            if (line.startsWith(`${outputName} `)) {
                inOutputBlock = true;
            }
            continue;
        }
        if (!line.startsWith(' ')) {
            break;
        }
        const trimmed = line.trim();
        if (!trimmed.includes('*')) {
            continue;
        }
        const parsed = parseXrandrModeLine(trimmed);
        if (parsed) {
            return parsed;
        }
    }
    return null;
}

function parseXrandrModeLine(line) {
    const tokens = line.split(/\s+/);
    if (tokens.length === 0) return null;
    const modeToken = tokens[0];
    let rate = null;
    for (let i = 1; i < tokens.length; i += 1) {
        const token = tokens[i].replace(/[+*]/g, '');
        const value = parseFloat(token);
        if (!Number.isNaN(value)) {
            rate = value;
            break;
        }
    }
    return { kind: 'parsed', mode: modeToken, rate, original: `${modeToken}@${rate || ''}` };
}

function modesMatch(current, desired) {
    if (!current || !desired) return false;
    if (!current.mode || !desired.mode) return false;
    if (current.mode !== desired.mode) return false;
    if (desired.rate == null || Number.isNaN(desired.rate)) {
        return true;
    }
    if (current.rate == null || Number.isNaN(current.rate)) {
        return false;
    }
    return Math.abs(current.rate - desired.rate) < 0.5;
}

function buildXrandrArgs(outputName, modeDescriptor) {
    const args = ['--output', outputName, '--mode', modeDescriptor.mode];
    if (modeDescriptor.kind === 'parsed' && modeDescriptor.rate != null && !Number.isNaN(modeDescriptor.rate)) {
        args.push('--rate', String(modeDescriptor.rate));
    }
    return args;
}

function formatMode(modeDescriptor) {
    if (!modeDescriptor) return 'unknown';
    if (modeDescriptor.rate != null && !Number.isNaN(modeDescriptor.rate)) {
        return `${modeDescriptor.mode}@${modeDescriptor.rate}`;
    }
    return modeDescriptor.mode || modeDescriptor.original || 'unknown';
}

function runXrandr(args, env) {
    return new Promise((resolve, reject) => {
        const child = spawn('xrandr', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        child.on('error', (error) => {
            if (error && error.code === 'ENOENT') {
                error = new Error('xrandr binary not found. Install x11-xserver-utils.');
            }
            reject(error);
        });
        child.on('close', (code) => {
            if (code !== 0) {
                const err = new Error(stderr.trim() || `xrandr exited with code ${code}`);
                err.code = code;
                err.stderr = stderr;
                err.stdout = stdout;
                reject(err);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

module.exports = {
    applyScreenResolution
};
