/**
 * Validates example playback outcome & background recompute events against JSON Schemas.
 */
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
let draft2020;
try {
    draft2020 = require('ajv/dist/refs/json-schema-draft-2020-12.json');
} catch (e) {
    draft2020 = null; // fallback handled in beforeAll
}

function loadSchema(file) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/json-schemas', file), 'utf-8'));
}

describe('JSON Schema validation (telemetry events)', () => {
    let ajv;
    let playbackSchema;
    let recomputeSchema;
    beforeAll(() => {
    ajv = new Ajv({ strict: false, allErrors: true, validateSchema: false });
    addFormats(ajv, ['date-time']);
        playbackSchema = loadSchema('command-outcome-playback.schema.json');
        recomputeSchema = loadSchema('background-volume-recompute.schema.json');
        // Always strip $schema to avoid meta fetch requirement in offline/unit context
        delete playbackSchema.$schema;
        delete recomputeSchema.$schema;
    });

    test('playback outcome sample valid', () => {
        const sample = {
            timestamp: '2025-09-29T12:00:00.000Z',
            zone: 'mirror',
            type: 'events',
            command: 'playBackground',
            outcome: 'warning',
            parameters: {
                file: 'bg.mp3',
                volume: 120,
                warnings: ['adjust_ignored_due_to_absolute'],
                effective_volume: 118,
                pre_duck_volume: 118,
                ducked: false
            },
            message: 'Background playback started with volume resolution warnings',
            warning_type: 'volume_resolution_warning'
        };
        const validate = ajv.compile(playbackSchema);
        const ok = validate(sample);
        if (!ok) console.error(validate.errors);
        expect(ok).toBe(true);
    });

    test('background volume recompute sample valid', () => {
        const sample = {
            timestamp: '2025-09-29T12:00:10.000Z',
            zone: 'mirror',
            type: 'events',
            background_volume_recomputed: true,
            effective_volume: 72,
            pre_duck_volume: 120,
            ducked: true
        };
        const validate = ajv.compile(recomputeSchema);
        const ok = validate(sample);
        if (!ok) console.error(validate.errors);
        expect(ok).toBe(true);
    });
});
