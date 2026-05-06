#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline/promises');
const { spawnSync } = require('child_process');
const ini = require('ini');

const ROOT_DIR = path.resolve(__dirname, '../..');
const MEDIA_ROOT = path.join(ROOT_DIR, 'media');
const DEFAULT_REPORT_DIR = path.join(__dirname, 'reports');

const DEFAULT_ASSETS = {
    image: 'defaults/default.png',
    video: 'defaults/intro_short.mp4',
    background: 'music/Classic_hip-hop_beat.mp3',
    effect: 'fx/Cymbal_Short.mp3',
    hdmi0Speech: 'devices/HDMI_0.mp3',
    hdmi1Speech: 'devices/HDMI_1.mp3',
    analogSpeech: 'devices/Analog_Headphones.mp3',
    transitionFirst: 'defaults/transition_first.png',
    transitionLast: 'defaults/transition_last.png',
    browserUrl: 'http://localhost/clock/'
};

function parseArgs(argv) {
    const options = {
        brokerHost: 'localhost',
        brokerPort: '1883',
        configPath: '',
        reportDir: DEFAULT_REPORT_DIR,
        help: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }

        if (arg === '--config') {
            options.configPath = argv[index + 1] || '';
            index += 1;
            continue;
        }

        if (arg === '--broker-host') {
            options.brokerHost = argv[index + 1] || 'localhost';
            index += 1;
            continue;
        }

        if (arg === '--broker-port') {
            options.brokerPort = argv[index + 1] || '1883';
            index += 1;
            continue;
        }

        if (arg === '--report-dir') {
            options.reportDir = argv[index + 1] || DEFAULT_REPORT_DIR;
            index += 1;
            continue;
        }

        throw new Error(`Unknown option: ${arg}`);
    }

    return options;
}

function printUsage() {
    console.log('PFx install test');
    console.log('');
    console.log('Usage:');
    console.log('  node test/manual/install-test.js [--config /etc/pfx.ini] [--broker-host localhost] [--broker-port 1883]');
    console.log('');
    console.log('This interactive script publishes MQTT commands to the selected PFx zones,');
    console.log('asks for a pass/fail result after each step, and writes a markdown report.');
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function promptText(rl, question, defaultValue = '', options = {}) {
    const allowBlank = options.allowBlank !== false;

    while (true) {
        const suffix = defaultValue !== '' ? ` [${defaultValue}]` : '';
        const answer = (await rl.question(`${question}${suffix}: `)).trim();

        if (answer) {
            return answer;
        }

        if (defaultValue !== '') {
            return defaultValue;
        }

        if (allowBlank) {
            return '';
        }

        console.log('A value is required.');
    }
}

async function promptYesNo(rl, question, defaultValue) {
    const suffix = defaultValue ? ' [Y/n]' : ' [y/N]';

    while (true) {
        const answer = (await rl.question(`${question}${suffix}: `)).trim().toLowerCase();

        if (!answer) {
            return defaultValue;
        }

        if (answer === 'y' || answer === 'yes') {
            return true;
        }

        if (answer === 'n' || answer === 'no') {
            return false;
        }

        console.log('Enter y or n.');
    }
}

async function promptStepResult(rl, options = {}) {
    const allowPass = options.allowPass !== false;
    const prompt = allowPass
        ? 'Result? [p]ass, [f]ail, [s]kip, [q]uit'
        : 'Result? [f]ail, [s]kip, [q]uit';

    while (true) {
        const answer = (await rl.question(`${prompt}: `)).trim().toLowerCase();

        if (allowPass && (answer === 'p' || answer === 'pass')) {
            return { status: 'passed', note: '', quit: false };
        }

        if (answer === 'f' || answer === 'fail') {
            const note = await promptText(rl, 'Short problem description', '', { allowBlank: false });
            return { status: 'failed', note, quit: false };
        }

        if (answer === 's' || answer === 'skip') {
            const note = await promptText(rl, 'Reason for skipping', '', { allowBlank: false });
            return { status: 'skipped', note, quit: false };
        }

        if (answer === 'q' || answer === 'quit') {
            const note = await promptText(rl, 'Short reason for stopping early', 'Stopped by operator');
            return { status: 'aborted', note, quit: true };
        }

        console.log('Enter p, f, s, or q.');
    }
}

function readPiModel() {
    const modelPaths = ['/proc/device-tree/model', '/sys/firmware/devicetree/base/model'];

    for (const modelPath of modelPaths) {
        if (!fs.existsSync(modelPath)) {
            continue;
        }

        const value = fs.readFileSync(modelPath, 'utf8').replace(/\u0000/g, '').trim();
        if (value) {
            return value;
        }
    }

    if (fs.existsSync('/proc/cpuinfo')) {
        const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
        const modelMatch = cpuInfo.match(/^Model\s*:\s*(.+)$/m);
        if (modelMatch) {
            return modelMatch[1].trim();
        }
    }

    return 'Unknown host';
}

function detectPlatform() {
    const model = readPiModel();
    const normalized = model.toLowerCase();

    return {
        model,
        askHdmi1: normalized.includes('raspberry pi 4') || normalized.includes('raspberry pi 5'),
        askAnalog: normalized.includes('raspberry pi 3') || normalized.includes('raspberry pi 4')
    };
}

function loadConfig(configPath) {
    if (!configPath) {
        return { config: {}, warning: 'No config path provided; topics will need to be entered manually.' };
    }

    if (!fs.existsSync(configPath)) {
        return { config: {}, warning: `Config file not found: ${configPath}` };
    }

    try {
        const parsed = ini.parse(fs.readFileSync(configPath, 'utf8'));
        return { config: parsed, warning: '' };
    } catch (error) {
        return { config: {}, warning: `Failed to parse ${configPath}: ${error.message}` };
    }
}

function getSections(config, prefix) {
    return Object.entries(config || {}).filter(([name, value]) => name.toLowerCase().startsWith(prefix) && value && typeof value === 'object');
}

function normalizeCommandTopic(topicValue) {
    const trimmed = String(topicValue || '').trim().replace(/\/+$/, '');
    if (!trimmed) {
        return '';
    }

    if (trimmed.endsWith('/commands')) {
        return trimmed;
    }

    if (trimmed.match(/\/(state|warnings|events)$/)) {
        return trimmed.replace(/\/(state|warnings|events)$/, '/commands');
    }

    return `${trimmed}/commands`;
}

function commandTopicFromSection(section) {
    return normalizeCommandTopic(section.base_topic || section.baseTopic || section.topic || section.baseTopicRoot || '');
}

function parseMonitor(section) {
    const raw = section.target_monitor || section.targetMonitor || section.monitor || '';
    const parsed = Number.parseInt(String(raw), 10);
    return Number.isNaN(parsed) ? null : parsed;
}

function findScreenZone(config, monitor) {
    const candidates = getSections(config, 'screen:').map(([sectionName, section]) => ({
        sectionName,
        section,
        monitor: parseMonitor(section),
        commandTopic: commandTopicFromSection(section)
    }));

    const exact = candidates.find((candidate) => candidate.monitor === monitor && candidate.commandTopic);
    if (exact) {
        return exact;
    }

    if (monitor === 0) {
        return candidates.find((candidate) => candidate.commandTopic) || null;
    }

    return null;
}

function findAnalogAudioZone(config) {
    const analogPattern = /(analog|headphone|headphones|bcm2835|pwm)/i;

    const candidates = getSections(config, 'audio:').map(([sectionName, section]) => ({
        sectionName,
        section,
        device: String(section.device || section.audio_device || section.audioDevice || ''),
        commandTopic: commandTopicFromSection(section)
    }));

    return candidates.find((candidate) => analogPattern.test(candidate.device) && candidate.commandTopic) || null;
}

function inferMediaPrefix(config, selectedSections) {
    const candidates = [];
    const globalSection = config.global || {};

    for (const value of [globalSection.media_dir, globalSection.mediaDir, globalSection.media_base_path, globalSection.mediaBasePath]) {
        if (value) {
            candidates.push(String(value));
        }
    }

    for (const match of selectedSections) {
        if (!match || !match.section) {
            continue;
        }

        for (const value of [match.section.media_dir, match.section.mediaDir, match.section.media_base_path, match.section.mediaBasePath]) {
            if (value) {
                candidates.push(String(value));
            }
        }
    }

    for (const candidate of candidates) {
        const normalized = candidate.replace(/\\/g, '/').replace(/\/+$/, '');

        if (normalized.endsWith('/media/test')) {
            return '';
        }

        if (normalized.endsWith('/media')) {
            return 'test';
        }
    }

    return 'test';
}

function fsPrefix(mediaPrefix) {
    return mediaPrefix || 'test';
}

function runtimeAsset(mediaPrefix, assetPath) {
    return mediaPrefix ? `${mediaPrefix}/${assetPath}` : assetPath;
}

function assetExists(mediaPrefix, assetPath) {
    return fs.existsSync(path.join(MEDIA_ROOT, fsPrefix(mediaPrefix), assetPath));
}

function requiredAssets(outputs) {
    const assets = new Set([
        DEFAULT_ASSETS.image,
        DEFAULT_ASSETS.video,
        DEFAULT_ASSETS.background,
        DEFAULT_ASSETS.effect
    ]);

    for (const output of outputs) {
        assets.add(output.speechAsset);
    }

    if (outputs.some((output) => output.id === 'hdmi0') && outputs.some((output) => output.id === 'hdmi1')) {
        assets.add(DEFAULT_ASSETS.transitionFirst);
        assets.add(DEFAULT_ASSETS.transitionLast);
    }

    return Array.from(assets);
}

function checkMosquittoPub() {
    const result = spawnSync('mosquitto_pub', ['--help'], { encoding: 'utf8', timeout: 5000 });

    if (result.error) {
        throw result.error;
    }
}

function publishCommand(brokerHost, brokerPort, action) {
    const payload = JSON.stringify(action.payload);
    const result = spawnSync(
        'mosquitto_pub',
        ['-h', brokerHost, '-p', String(brokerPort), '-t', action.topic, '-m', payload],
        { encoding: 'utf8', timeout: 5000 }
    );

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || `mosquitto_pub exited with status ${result.status}`);
    }
}

async function runActions(brokerHost, brokerPort, actions) {
    for (const action of actions) {
        console.log(`Publishing to ${action.topic}: ${JSON.stringify(action.payload)}`);
        publishCommand(brokerHost, brokerPort, action);

        if (action.delayAfterMs) {
            await sleep(action.delayAfterMs);
        }
    }
}

function screenSteps(output, mediaPrefix) {
    return [
        {
            output: output.label,
            title: `${output.label}: show still image`,
            description: `Shows a static image on ${output.label}.`,
            lookFor: `The default image should appear on ${output.label} only, remain stable, and not affect other outputs.`,
            actions: [
                { topic: output.topic, payload: { command: 'setImage', image: runtimeAsset(mediaPrefix, DEFAULT_ASSETS.image) }, delayAfterMs: 1000 }
            ]
        },
        {
            output: output.label,
            title: `${output.label}: play short video`,
            description: `Plays a short test video on ${output.label}.`,
            lookFor: `The short intro video should play on ${output.label} without routing to the wrong display.`,
            actions: [
                { topic: output.topic, payload: { command: 'playVideo', video: runtimeAsset(mediaPrefix, DEFAULT_ASSETS.video), volume: 80 }, delayAfterMs: 1000 }
            ],
            cleanupActions: [
                { topic: output.topic, payload: { command: 'stopVideo' }, delayAfterMs: 500 }
            ]
        },
        {
            output: output.label,
            title: `${output.label}: start looping background audio`,
            description: `Starts looping background music on ${output.label}.`,
            lookFor: `Looping background music should start on ${output.label} and continue until a later cleanup step.`,
            actions: [
                { topic: output.topic, payload: { command: 'playBackground', audio: runtimeAsset(mediaPrefix, DEFAULT_ASSETS.background), loop: true, volume: 70 }, delayAfterMs: 1000 }
            ]
        },
        {
            output: output.label,
            title: `${output.label}: pause and resume background audio`,
            description: `Pauses the background loop, waits briefly, then resumes it.`,
            lookFor: `The background loop should pause cleanly and then resume on ${output.label}.`,
            actions: [
                { topic: output.topic, payload: { command: 'pauseBackground' }, delayAfterMs: 1500 },
                { topic: output.topic, payload: { command: 'resumeBackground' }, delayAfterMs: 1500 }
            ]
        },
        {
            output: output.label,
            title: `${output.label}: speech ducking check`,
            description: `Plays a spoken device-identification clip over the background loop.`,
            lookFor: `The spoken clip should be heard on ${output.label}, the background should duck while it plays, and then recover.`,
            actions: [
                { topic: output.topic, payload: { command: 'playSpeech', audio: runtimeAsset(mediaPrefix, output.speechAsset), volume: 85 }, delayAfterMs: 1000 }
            ]
        },
        {
            output: output.label,
            title: `${output.label}: sound effect over background`,
            description: `Plays a short sound effect while background audio is still running.`,
            lookFor: `The sound effect should be audible on ${output.label} without permanently stopping the background loop.`,
            actions: [
                { topic: output.topic, payload: { command: 'playSoundEffect', audio: runtimeAsset(mediaPrefix, DEFAULT_ASSETS.effect), volume: 85 }, delayAfterMs: 1000 }
            ]
        },
        {
            output: output.label,
            title: `${output.label}: stop all zone media`,
            description: `Stops the active media on ${output.label}.`,
            lookFor: `Audio should stop on ${output.label}, and any active video playback should be cleared.`,
            actions: [
                { topic: output.topic, payload: { command: 'stopAll' }, delayAfterMs: 1000 }
            ]
        },
        ...(output.testBrowser ? [
            {
                output: output.label,
                title: `${output.label}: show browser overlay`,
                description: `Enables the browser overlay and brings it to the front.`,
                lookFor: `A Chromium window should appear on ${output.label}. The page content may be blank or show a local error page if no clock/UI is being served.`,
                actions: [
                    { topic: output.topic, payload: { command: 'enableBrowser', url: DEFAULT_ASSETS.browserUrl }, delayAfterMs: 1500 },
                    { topic: output.topic, payload: { command: 'showBrowser' }, delayAfterMs: 1500 }
                ]
            },
            {
                output: output.label,
                title: `${output.label}: hide browser overlay`,
                description: `Hides and disables the browser overlay after the visibility check.`,
                lookFor: `The Chromium window should disappear from ${output.label}.`,
                actions: [
                    { topic: output.topic, payload: { command: 'hideBrowser' }, delayAfterMs: 1000 },
                    { topic: output.topic, payload: { command: 'disableBrowser' }, delayAfterMs: 1000 }
                ]
            }
        ] : [])
    ];
}

function audioSteps(output, mediaPrefix) {
    return [
        {
            output: output.label,
            title: `${output.label}: start looping background audio`,
            description: `Starts looping background music on ${output.label}.`,
            lookFor: `Looping background music should start on ${output.label}.`,
            actions: [
                { topic: output.topic, payload: { command: 'playBackground', audio: runtimeAsset(mediaPrefix, DEFAULT_ASSETS.background), loop: true, volume: 70 }, delayAfterMs: 1000 }
            ]
        },
        {
            output: output.label,
            title: `${output.label}: pause and resume background audio`,
            description: `Pauses and resumes the background loop.`,
            lookFor: `The background loop should pause and then resume on ${output.label}.`,
            actions: [
                { topic: output.topic, payload: { command: 'pauseBackground' }, delayAfterMs: 1500 },
                { topic: output.topic, payload: { command: 'resumeBackground' }, delayAfterMs: 1500 }
            ]
        },
        {
            output: output.label,
            title: `${output.label}: speech ducking check`,
            description: `Plays the analog-device speech cue over the background loop.`,
            lookFor: `The speech cue should play on ${output.label}, the background should duck, and then return.`,
            actions: [
                { topic: output.topic, payload: { command: 'playSpeech', audio: runtimeAsset(mediaPrefix, output.speechAsset), volume: 85 }, delayAfterMs: 1000 }
            ]
        },
        {
            output: output.label,
            title: `${output.label}: sound effect over background`,
            description: `Plays a short effect while the background loop is still active.`,
            lookFor: `The sound effect should be audible on ${output.label} without killing the background loop.`,
            actions: [
                { topic: output.topic, payload: { command: 'playSoundEffect', audio: runtimeAsset(mediaPrefix, DEFAULT_ASSETS.effect), volume: 85 }, delayAfterMs: 1000 }
            ]
        },
        {
            output: output.label,
            title: `${output.label}: stop all audio`,
            description: `Stops the active media on ${output.label}.`,
            lookFor: `All playback should stop on ${output.label}.`,
            actions: [
                { topic: output.topic, payload: { command: 'stopAll' }, delayAfterMs: 1000 }
            ]
        }
    ];
}

function crossOutputSteps(outputs, mediaPrefix) {
    const hdmi0 = outputs.find((output) => output.id === 'hdmi0');
    const hdmi1 = outputs.find((output) => output.id === 'hdmi1');

    if (!hdmi0 || !hdmi1) {
        return [];
    }

    return [
        {
            output: 'HDMI0 + HDMI1',
            title: 'HDMI routing split check',
            description: 'Shows different still images on HDMI0 and HDMI1 at the same time.',
            lookFor: 'HDMI0 should show the first transition image and HDMI1 should show the last transition image. The displays should not be swapped.',
            actions: [
                { topic: hdmi0.topic, payload: { command: 'setImage', image: runtimeAsset(mediaPrefix, DEFAULT_ASSETS.transitionFirst) }, delayAfterMs: 500 },
                { topic: hdmi1.topic, payload: { command: 'setImage', image: runtimeAsset(mediaPrefix, DEFAULT_ASSETS.transitionLast) }, delayAfterMs: 1000 }
            ]
        }
    ];
}

async function cleanupOutputs(brokerHost, brokerPort, outputs) {
    const actions = [];

    for (const output of outputs) {
        actions.push({ topic: output.topic, payload: { command: 'stopAll' }, delayAfterMs: 0 });

        if (output.kind === 'screen' && output.testBrowser) {
            actions.push({ topic: output.topic, payload: { command: 'hideBrowser' }, delayAfterMs: 0 });
            actions.push({ topic: output.topic, payload: { command: 'disableBrowser' }, delayAfterMs: 0 });
        }
    }

    const seen = new Set();
    for (const action of actions) {
        const key = `${action.topic}:${JSON.stringify(action.payload)}`;
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);

        try {
            publishCommand(brokerHost, brokerPort, action);
        } catch (error) {
            console.log(`Cleanup warning for ${action.topic}: ${error.message}`);
        }
    }
}

function summarizeResults(results) {
    return results.reduce((summary, result) => {
        summary[result.status] = (summary[result.status] || 0) + 1;
        return summary;
    }, { passed: 0, failed: 0, skipped: 0, aborted: 0 });
}

function sanitizeCell(value) {
    return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function reportTimestamp(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}-${hour}${minute}${second}`;
}

function buildReport(context, results) {
    const summary = summarizeResults(results);
    const lines = [];

    lines.push('# PFx install test report');
    lines.push('');
    lines.push(`- Generated: ${context.generatedAt.toISOString()}`);
    lines.push(`- Host: ${context.hostname}`);
    lines.push(`- Detected platform: ${context.platform.model}`);
    lines.push(`- Config path: ${context.configPath || '(not provided)'}`);
    lines.push(`- Config note: ${context.configWarning || 'none'}`);
    lines.push(`- MQTT broker: ${context.brokerHost}:${context.brokerPort}`);
    lines.push(`- Media prefix: ${context.mediaPrefix === '' ? '(blank; media_dir already points at media/test)' : context.mediaPrefix}`);
    lines.push('');
    lines.push('## Scope');
    lines.push('');

    for (const output of context.outputs) {
        const browserNote = output.kind === 'screen' ? `, browser checks: ${output.testBrowser ? 'yes' : 'no'}` : '';
        lines.push(`- ${output.label}: ${output.topic}${browserNote}`);
    }

    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(`- Passed: ${summary.passed}`);
    lines.push(`- Failed: ${summary.failed}`);
    lines.push(`- Skipped: ${summary.skipped}`);
    lines.push(`- Aborted: ${summary.aborted}`);
    lines.push('');

    const issueResults = results.filter((result) => result.status !== 'passed');
    lines.push('## Follow-up items');
    lines.push('');

    if (issueResults.length === 0) {
        lines.push('- No follow-up items recorded.');
    } else {
        for (const result of issueResults) {
            lines.push(`- Step ${result.stepNumber} (${result.title}) on ${result.output}: ${result.status} - ${result.note}`);
        }
    }

    lines.push('');
    lines.push('## Step results');
    lines.push('');
    lines.push('| # | Output | Step | Result | Note |');
    lines.push('|---|---|---|---|---|');

    for (const result of results) {
        lines.push(`| ${result.stepNumber} | ${sanitizeCell(result.output)} | ${sanitizeCell(result.title)} | ${result.status.toUpperCase()} | ${sanitizeCell(result.note || '')} |`);
    }

    lines.push('');
    lines.push('## Commands used');
    lines.push('');

    for (const result of results) {
        lines.push(`### Step ${result.stepNumber}: ${result.title}`);
        lines.push('');
        for (const action of result.actions) {
            lines.push(`- ${action.topic} ${JSON.stringify(action.payload)}`);
        }
        lines.push('');
    }

    return `${lines.join('\n')}\n`;
}

function defaultConfigPath(explicitPath) {
    if (explicitPath) {
        return explicitPath;
    }

    const candidates = [
        '/etc/pfx.ini',
        path.join(ROOT_DIR, 'pfx.ini')
    ];

    return candidates.find((candidate) => fs.existsSync(candidate)) || '/etc/pfx.ini';
}

async function promptTopic(rl, label, detectedTopic, fallbackTopic) {
    const topic = await promptText(rl, label, detectedTopic || fallbackTopic, { allowBlank: false });
    return normalizeCommandTopic(topic);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printUsage();
        return;
    }

    checkMosquittoPub();

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const platform = detectPlatform();
    const hostname = os.hostname();
    const generatedAt = new Date();
    const outputs = [];

    try {
        console.log('PFx install test');
        console.log('');
        console.log(`Detected platform: ${platform.model}`);
        console.log('This script publishes MQTT commands to the PFx zones you select, asks for a result after each step, and writes a markdown report at the end.');
        console.log('');

        const scope = {
            hdmi0: await promptYesNo(rl, 'Test HDMI0? (This is also the single HDMI port for the Pi3 and Pi Zero models.)', true),
            hdmi1: false,
            analog: false
        };

        if (platform.askHdmi1) {
            scope.hdmi1 = await promptYesNo(rl, 'Test HDMI1? (Only ask this if on a Pi4 or Pi5.)', true);
        }

        if (platform.askAnalog) {
            scope.analog = await promptYesNo(rl, 'Test analog audio? (Only ask this if on a Pi3 or Pi4.)', false);
        }

        const configPath = await promptText(rl, 'PFx config path', defaultConfigPath(options.configPath), { allowBlank: false });
        const { config, warning: configWarning } = loadConfig(configPath);

        if (configWarning) {
            console.log(configWarning);
        }

        const brokerHost = await promptText(rl, 'MQTT broker host', options.brokerHost, { allowBlank: false });
        const brokerPort = await promptText(rl, 'MQTT broker port', options.brokerPort, { allowBlank: false });

        const hdmi0Zone = scope.hdmi0 ? findScreenZone(config, 0) : null;
        const hdmi1Zone = scope.hdmi1 ? findScreenZone(config, 1) : null;
        const analogZone = scope.analog ? findAnalogAudioZone(config) : null;

        if (scope.hdmi0) {
            const detectedLabel = hdmi0Zone ? `HDMI0 command topic (${hdmi0Zone.sectionName})` : 'HDMI0 command topic';
            const topic = await promptTopic(rl, detectedLabel, hdmi0Zone && hdmi0Zone.commandTopic, 'paradox/zone1/commands');
            const testBrowser = await promptYesNo(rl, 'Include browser overlay checks on HDMI0?', false);
            outputs.push({ id: 'hdmi0', label: 'HDMI0', kind: 'screen', topic, speechAsset: DEFAULT_ASSETS.hdmi0Speech, testBrowser });
        }

        if (scope.hdmi1) {
            const detectedLabel = hdmi1Zone ? `HDMI1 command topic (${hdmi1Zone.sectionName})` : 'HDMI1 command topic';
            const topic = await promptTopic(rl, detectedLabel, hdmi1Zone && hdmi1Zone.commandTopic, 'paradox/zone2/commands');
            const testBrowser = await promptYesNo(rl, 'Include browser overlay checks on HDMI1?', false);
            outputs.push({ id: 'hdmi1', label: 'HDMI1', kind: 'screen', topic, speechAsset: DEFAULT_ASSETS.hdmi1Speech, testBrowser });
        }

        if (scope.analog) {
            const detectedLabel = analogZone ? `Analog audio command topic (${analogZone.sectionName})` : 'Analog audio command topic';
            const topic = await promptTopic(rl, detectedLabel, analogZone && analogZone.commandTopic, 'paradox/audio/analog/commands');
            outputs.push({ id: 'analog', label: 'Analog audio', kind: 'audio', topic, speechAsset: DEFAULT_ASSETS.analogSpeech, testBrowser: false });
        }

        if (outputs.length === 0) {
            console.log('No outputs selected. Nothing to test.');
            return;
        }

        const suggestedMediaPrefix = inferMediaPrefix(config, [hdmi0Zone, hdmi1Zone, analogZone].filter(Boolean));
        let mediaPrefix = suggestedMediaPrefix;
        const assets = requiredAssets(outputs);

        while (true) {
            mediaPrefix = await promptText(
                rl,
                'Media prefix relative to the configured PFx media_dir (use blank if media_dir already points at PFx/media/test)',
                suggestedMediaPrefix
            );

            const missingAssets = assets.filter((asset) => !assetExists(mediaPrefix, asset));
            if (missingAssets.length === 0) {
                break;
            }

            console.log('These PFx media files were not found for that prefix:');
            for (const asset of missingAssets) {
                console.log(`- ${path.join(MEDIA_ROOT, fsPrefix(mediaPrefix), asset)}`);
            }
        }

        console.log('');
        console.log('Planned outputs:');
        for (const output of outputs) {
            const browserNote = output.kind === 'screen' ? `, browser checks: ${output.testBrowser ? 'yes' : 'no'}` : '';
            console.log(`- ${output.label}: ${output.topic}${browserNote}`);
        }
        console.log('');

        const startNow = await promptYesNo(rl, 'Start the install test now?', true);
        if (!startNow) {
            console.log('Install test cancelled before execution.');
            return;
        }

        const steps = [];
        for (const output of outputs) {
            steps.push(...(output.kind === 'screen' ? screenSteps(output, mediaPrefix) : audioSteps(output, mediaPrefix)));
        }
        steps.push(...crossOutputSteps(outputs, mediaPrefix));

        const results = [];
        let aborted = false;

        for (let index = 0; index < steps.length; index += 1) {
            const step = steps[index];

            console.log('');
            console.log(`Step ${index + 1}/${steps.length}: ${step.title}`);
            console.log(`What it does: ${step.description}`);
            console.log(`What to look for: ${step.lookFor}`);

            let commandError = '';
            try {
                await runActions(brokerHost, brokerPort, step.actions);
            } catch (error) {
                commandError = error.message;
                console.log(`Command publish failed: ${commandError}`);
            }

            const outcome = await promptStepResult(rl, { allowPass: !commandError });
            const result = {
                stepNumber: index + 1,
                output: step.output,
                title: step.title,
                status: commandError ? 'failed' : outcome.status,
                note: commandError ? `${commandError}${outcome.note ? `; ${outcome.note}` : ''}` : outcome.note,
                actions: step.actions
            };

            results.push(result);

            if (step.cleanupActions) {
                try {
                    await runActions(brokerHost, brokerPort, step.cleanupActions);
                } catch (error) {
                    console.log(`Cleanup warning: ${error.message}`);
                    result.note = result.note ? `${result.note}; cleanup: ${error.message}` : `cleanup: ${error.message}`;
                    if (result.status === 'passed') {
                        result.status = 'failed';
                    }
                }
            }

            if (outcome.quit) {
                aborted = true;
                break;
            }
        }

        await cleanupOutputs(brokerHost, brokerPort, outputs);

        const reportContext = {
            generatedAt,
            hostname,
            platform,
            configPath,
            configWarning,
            brokerHost,
            brokerPort,
            mediaPrefix,
            outputs
        };

        fs.mkdirSync(options.reportDir, { recursive: true });
        const reportPath = path.join(options.reportDir, `install-test-${reportTimestamp(generatedAt)}.md`);
        fs.writeFileSync(reportPath, buildReport(reportContext, results), 'utf8');

        console.log('');
        console.log(`Install test complete. Report written to ${reportPath}`);

        if (aborted) {
            console.log('The run was stopped early. Review the report before the next pass.');
        }
    } finally {
        rl.close();
    }
}

main().catch((error) => {
    console.error(`Install test failed to start: ${error.message}`);
    process.exitCode = 1;
});