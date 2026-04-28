/**
 * Speech Completion & Queue Integration Tests
 *
 * Verifies:
 * 1. Natural completion event timing for a 12s generated WAV.
 * 2. Queue sequencing: two files play back-to-back with completion events.
 * 3. Duplicate rejection while a file is playing.
 * 4. Duplicate rejection when duplicate is last in queue.
 *
 * These tests generate silent WAV files (12s & 14s) to avoid external media dependencies.
 * Requires `mpv` to be installed and accessible on PATH.
 */

const fs = require('fs');
const path = require('path');
const AudioZone = require('../../lib/zones/audio-zone');

jest.setTimeout(120000); // Up to 2 minutes for real-time playback tests

// Helper: create a silent mono 16-bit PCM WAV file of given duration
function createSilenceWav(filePath, durationSeconds, sampleRate = 8000) {
    const numSamples = sampleRate * durationSeconds;
    const dataSize = numSamples * 2; // 16-bit mono
    const buffer = Buffer.alloc(44 + dataSize);
    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4); // file size - 8
    buffer.write('WAVE', 8);
    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // PCM fmt chunk size
    buffer.writeUInt16LE(1, 20); // audio format = PCM
    buffer.writeUInt16LE(1, 22); // channels = 1
    buffer.writeUInt32LE(sampleRate, 24); // sample rate
    const byteRate = sampleRate * 2; // mono 16-bit
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(2, 32); // block align
    buffer.writeUInt16LE(16, 34); // bits per sample
    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    // data section already zeroed (silence)
    fs.writeFileSync(filePath, buffer);
}

// Simple async wait helper
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitFor(predicate, timeoutMs = 30000, intervalMs = 200) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (predicate()) return true;
        await wait(intervalMs);
    }
    throw new Error('waitFor timeout exceeded: ' + predicate.toString());
}

describe('Speech queue & completion events (real playback)', () => {
    const tmpDir = path.join(__dirname, '..', '..', 'media', 'test', 'general');
    const fileA = 'speech_a.wav'; // 12s
    const fileB = 'speech_b.wav'; // 14s
    let zone;
    const published = []; // capture all published MQTT-like messages
    const baseTopic = 'test/paradox';

    beforeAll(async () => {
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        createSilenceWav(path.join(tmpDir, fileA), 12);
        createSilenceWav(path.join(tmpDir, fileB), 14);
        // Minimal config for AudioZone
        const config = {
            name: 'speechzone',
            type: 'audio',
            topic: baseTopic + '/speechzone',
            baseTopic,
            mediaDir: tmpDir, // absolute path accepted
            volume: 80,
            mediaBasePath: tmpDir
        };
        const mqttClient = {
            publish: (topic, message) => {
                // Normalize object (BaseZone already sends object)
                published.push({ topic, message });
            }
        };
        zone = new AudioZone(config, mqttClient, {});
        await zone.initialize();
    });

    afterAll(async () => {
        if (zone) await zone.shutdown();
    });

    function extractEvents(key) {
        return published
            .filter(p => p.topic.endsWith('/events'))
            .map(p => p.message)
            .filter(m => m[key]);
    }

    function hasSpeechStartedFor(file) {
        return extractEvents('speech_started').some(e => e.speech_started === file) ||
            extractEvents('speech_started_actual').some(e => e.speech_started_actual === file);
    }

    function allEventKeys() {
        return published
            .filter(p => p.topic.endsWith('/events'))
            .map(p => Object.keys(p.message).join(':'));
    }

    function resetEvents() {
        published.length = 0;
    }

    function lastStartedFor(file) {
        const events = extractEvents('speech_started').filter(e => e.speech_started === file);
        return events[events.length - 1];
    }

    test('1. Natural completion timing for single 12s file', async () => {
        const startBaseline = Date.now();
        await zone.handleCommand({ command: 'playSpeech', file: fileA });

        // Wait for speech_started
        await waitFor(() => extractEvents('speech_started').some(e => e.speech_started === fileA));
        const startEvent = extractEvents('speech_started').find(e => e.speech_started === fileA);
        expect(startEvent).toBeTruthy();

        // Wait for speech_completed
        await waitFor(() => extractEvents('speech_completed').some(e => e.speech_completed === true && e.file === fileA), 40000);
        const completeEvent = extractEvents('speech_completed').find(e => e.file === fileA);
        expect(completeEvent).toBeTruthy();

        const endTs = new Date(completeEvent.timestamp).getTime();
        const startTs = new Date(startEvent.timestamp).getTime();
        const elapsed = endTs - startTs;
        console.log('Observed playback elapsed (ms):', elapsed);
        // Expected around 12000ms (12s) ± 1500ms tolerance for scheduling & load
        expect(elapsed).toBeGreaterThanOrEqual(10500);
        expect(elapsed).toBeLessThanOrEqual(13500);
    });

    test('2. Queue sequencing for two files (A then B)', async () => {
        const baseIndex = published.length;
        await zone.handleCommand({ command: 'playSpeech', file: fileA });
        // Queue second after short delay while first is playing
        setTimeout(() => zone.handleCommand({ command: 'playSpeech', file: fileB }), 1000);

        await waitFor(() => extractEvents('speech_started').filter(e => e.speech_started === fileA).length >= 1);
        await waitFor(() => extractEvents('speech_started').filter(e => e.speech_started === fileB).length >= 1, 70000);
        await waitFor(() => extractEvents('speech_completed').filter(e => e.file === fileA).length >= 1, 70000);
        await waitFor(() => extractEvents('speech_completed').filter(e => e.file === fileB).length >= 1, 90000);

        const startA = extractEvents('speech_started').find(e => e.speech_started === fileA);
        const completeA = extractEvents('speech_completed').find(e => e.file === fileA);
        const startB = extractEvents('speech_started').find(e => e.speech_started === fileB);
        const completeB = extractEvents('speech_completed').find(e => e.file === fileB);
        expect(startA && completeA && startB && completeB).toBeTruthy();

        const gap = new Date(startB.timestamp).getTime() - new Date(completeA.timestamp).getTime();
        console.log('Inter-file start gap (ms):', gap);
        // Gap should be small (< 1000ms) for immediate queue advancement
        expect(gap).toBeLessThan(1500);
    });

    test('Pause/Resume does not allow premature completion', async () => {
        // Start fileA (12s)
        await zone.handleCommand({ command: 'playSpeech', file: fileA });
        await waitFor(() => extractEvents('speech_started').some(e => e.speech_started === fileA));
        const startEvent = extractEvents('speech_started').find(e => e.speech_started === fileA);
        const startTs = new Date(startEvent.timestamp).getTime();

        // Pause after ~3s
        await wait(3000);
        await zone.handleCommand({ command: 'pauseSpeech' });
        const pauseAt = Date.now();
        await wait(2500); // remain paused 2.5s
        await zone.handleCommand({ command: 'resumeSpeech' });

        // Wait for completion
        await waitFor(() => extractEvents('speech_completed').some(e => e.file === fileA), 45000);
        const complete = extractEvents('speech_completed').find(e => e.file === fileA);
        const endTs = new Date(complete.timestamp).getTime();
        const elapsed = endTs - startTs;
        const pausedDuration = (Date.now() - pauseAt) - 0; // approx
        console.log('Elapsed with pause (ms):', elapsed, 'paused approx (ms):', Date.now() - pauseAt);
        // We only assert it did not complete too early (should not be < 11s)
        expect(elapsed).toBeGreaterThanOrEqual(11000);
        // Allow typical upper bound with pause slack (not strict because monitor removes paused time)
        expect(elapsed).toBeLessThan(15000);
        // Let it finish naturally for subsequent duplicate tests
    });

    test('3. Duplicate rejection for currently playing file', async () => {
        // Start playback of fileA
        await zone.handleCommand({ command: 'playSpeech', file: fileA });
        // Wait briefly for potential start event (but don't fail if not captured)
        try { await waitFor(() => hasSpeechStartedFor(fileA), 2000); } catch (_) { /* ignore */ }
        const before = extractEvents('speech_started').filter(e => e.speech_started === fileA).length + extractEvents('speech_started_actual').filter(e => e.speech_started_actual === fileA).length;
        // Duplicate while it's presumably playing
        await zone.handleCommand({ command: 'playSpeech', file: fileA });
        await wait(400);
        const after = extractEvents('speech_started').filter(e => e.speech_started === fileA).length + extractEvents('speech_started_actual').filter(e => e.speech_started_actual === fileA).length;
        const dupIgnored = extractEvents('speech_duplicate_ignored').length;
        expect(after).toBe(before); // no additional start
        expect(dupIgnored).toBeGreaterThanOrEqual(1);
    });

    test('4. Duplicate rejection for last item in queue', async () => {
        resetEvents();
        await zone.handleCommand({ command: 'playSpeech', file: fileA });
        try { await waitFor(() => hasSpeechStartedFor(fileA), 5000); } catch (e) { console.log('Could not detect speech_started for A (continuing)'); }
        await zone.handleCommand({ command: 'playSpeech', file: fileB });
        await zone.handleCommand({ command: 'playSpeech', file: fileB }); // duplicate tail
        await waitFor(() => extractEvents('speech_started').filter(e => e.speech_started === fileB).length === 1 || extractEvents('speech_completed').some(e => e.file === fileA), 70000);
        const countB = extractEvents('speech_started').filter(e => e.speech_started === fileB).length;
        expect(countB).toBe(1);
    });
});
