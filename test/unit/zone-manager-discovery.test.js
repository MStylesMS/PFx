/**
 * Unit Tests for ZoneManager discovery and schema publishing
 */

const ZoneManager = require('../../lib/core/zone-manager');

// Suppress Logger output during tests
jest.mock('../../lib/utils/logger', () => {
    return jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }));
});

function makeMqttClient() {
    return {
        publish: jest.fn(),
        subscribe: jest.fn(),
        unsubscribe: jest.fn(),
        setZoneManager: jest.fn(),
    };
}

function makeZone(type, baseTopic, commands = [], schemaMetadata = null) {
    const zone = {
        config: { type, baseTopic },
        getSupportedCommands: jest.fn().mockReturnValue(commands),
    };
    if (schemaMetadata) {
        zone.getSchemaMetadata = jest.fn().mockReturnValue(schemaMetadata);
    }
    return zone;
}

function makeZoneManager(baseTopicOverride) {
    const mqttClient = makeMqttClient();
    const config = {
        global: { baseTopic: baseTopicOverride !== undefined ? baseTopicOverride : 'paradox/test', logLevel: 'info' },
        devices: [],
    };
    const zm = new ZoneManager(config, mqttClient);
    return { zm, mqttClient };
}

describe('ZoneManager._publishDiscovery', () => {
    test('publishes retained payload to {baseTopic}/discovery', () => {
        const { zm, mqttClient } = makeZoneManager('paradox/test');
        zm.zones.set('screen1', makeZone('screen', 'paradox/test/screen1'));
        zm.zones.set('audio1', makeZone('audio', 'paradox/test/audio1'));

        zm._publishDiscovery();

        expect(mqttClient.publish).toHaveBeenCalledTimes(1);
        const [topic, payload, options] = mqttClient.publish.mock.calls[0];
        expect(topic).toBe('paradox/test/discovery');
        expect(options).toEqual({ retain: true });
        expect(payload.application).toBe('pfx');
        expect(payload.zones).toHaveLength(2);
        expect(payload.zones.map(z => z.name)).toEqual(expect.arrayContaining(['screen1', 'audio1']));
    });

    test('includes commandsTopic, stateTopic and schemaTopic for each zone', () => {
        const { zm, mqttClient } = makeZoneManager('paradox/test');
        zm.zones.set('audio1', makeZone('audio', 'paradox/test/audio1'));

        zm._publishDiscovery();

        const [, payload] = mqttClient.publish.mock.calls[0];
        const zoneObj = payload.zones[0];
        expect(zoneObj.commandsTopic).toBe('paradox/test/audio1/commands');
        expect(zoneObj.stateTopic).toBe('paradox/test/audio1/state');
        expect(zoneObj.schemaTopic).toBe('paradox/test/audio1/schema');
    });

    test('skips publish when baseTopic is an empty string', () => {
        const { zm, mqttClient } = makeZoneManager('');
        zm.zones.set('screen1', makeZone('screen', 'paradox/test/screen1'));

        zm._publishDiscovery();

        expect(mqttClient.publish).not.toHaveBeenCalled();
    });

    test('skips publish when global config is absent', () => {
        const { zm, mqttClient } = makeZoneManager('paradox/test');
        delete zm.config.global;
        zm.zones.set('screen1', makeZone('screen', 'paradox/test/screen1'));

        zm._publishDiscovery();

        expect(mqttClient.publish).not.toHaveBeenCalled();
    });

    test('publishes empty zones array when no zones are registered', () => {
        const { zm, mqttClient } = makeZoneManager('paradox/test');

        zm._publishDiscovery();

        const [, payload] = mqttClient.publish.mock.calls[0];
        expect(payload.zones).toEqual([]);
    });
});

describe('ZoneManager._publishZoneSchemas', () => {
    test('publishes retained schema for each zone', () => {
        const { zm, mqttClient } = makeZoneManager('paradox/test');
        const commands = [{ name: 'play', description: 'Play video' }];
        zm.zones.set('screen1', makeZone('screen', 'paradox/test/screen1', commands));

        zm._publishZoneSchemas();

        expect(mqttClient.publish).toHaveBeenCalledTimes(1);
        const [topic, payload, options] = mqttClient.publish.mock.calls[0];
        expect(topic).toBe('paradox/test/screen1/schema');
        expect(options).toEqual({ retain: true });
        expect(payload).toMatchObject({
            application: 'pfx',
            zone: 'screen1',
            type: 'screen',
            commandsTopic: 'paradox/test/screen1/commands',
            commands,
        });
    });

    test('skips zones without a baseTopic', () => {
        const { zm, mqttClient } = makeZoneManager('paradox/test');
        zm.zones.set('broken', { config: { type: 'audio' }, getSupportedCommands: jest.fn().mockReturnValue([]) });

        zm._publishZoneSchemas();

        expect(mqttClient.publish).not.toHaveBeenCalled();
    });

    test('publishes one message per zone', () => {
        const { zm, mqttClient } = makeZoneManager('paradox/test');
        zm.zones.set('z1', makeZone('audio', 'paradox/test/z1'));
        zm.zones.set('z2', makeZone('screen', 'paradox/test/z2'));
        zm.zones.set('z3', makeZone('light', 'paradox/test/z3'));

        zm._publishZoneSchemas();

        expect(mqttClient.publish).toHaveBeenCalledTimes(3);
        const topics = mqttClient.publish.mock.calls.map(c => c[0]);
        expect(topics).toEqual(expect.arrayContaining([
            'paradox/test/z1/schema',
            'paradox/test/z2/schema',
            'paradox/test/z3/schema',
        ]));
    });

    test('calls getSupportedCommands on each zone', () => {
        const { zm } = makeZoneManager('paradox/test');
        const zone = makeZone('screen', 'paradox/test/screen1');
        zm.zones.set('screen1', zone);

        zm._publishZoneSchemas();

        expect(zone.getSupportedCommands).toHaveBeenCalledTimes(1);
    });

    test('includes optional schema metadata when zone exposes it', () => {
        const { zm, mqttClient } = makeZoneManager('paradox/test');
        const schemaMetadata = {
            state_fields: { input: { profile: 'string' } },
            event_fields: { input_event: { event: 'string' } },
            warning_policy: { low_battery_threshold: 20 }
        };
        zm.zones.set('input1', makeZone('input', 'paradox/test/input1', ['getState'], schemaMetadata));

        zm._publishZoneSchemas();

        const [, payload] = mqttClient.publish.mock.calls[0];
        expect(payload.state_fields).toEqual(schemaMetadata.state_fields);
        expect(payload.event_fields).toEqual(schemaMetadata.event_fields);
        expect(payload.warning_policy).toEqual(schemaMetadata.warning_policy);
    });
});
