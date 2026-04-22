const InputZone = require('../../lib/zones/input-zone');

describe('InputZone mapping', () => {
    test('maps shelly i4 event to configured MQTT command', async () => {
        const subscribeCalls = [];
        const mqttClient = {
            connected: true,
            subscribe: jest.fn((topic, handler) => {
                subscribeCalls.push({ topic, handler });
            }),
            unsubscribe: jest.fn(),
            publish: jest.fn()
        };

        const zone = new InputZone({
            name: 'shelly-i4-main',
            type: 'input',
            baseTopic: 'paradox/agent22/inputs/main',
            backend: 'shelly',
            profile: 'input',
            inputTopic: 'shellyplusi4-abc/events/rpc',
            inputMap: {
                '0.single_push': {
                    topic: 'paradox/agent22/lights/commands',
                    payload: { command: 'setColorScene', scene: 'normal' }
                }
            }
        }, mqttClient, { config: { devices: {} } });

        await zone.initialize();

        const handler = subscribeCalls[0].handler;
        await handler('shellyplusi4-abc/events/rpc', {
            method: 'NotifyEvent',
            params: {
                events: [
                    { component: 'input:0', event: 'single_push', ts: 123 }
                ]
            }
        });

        expect(mqttClient.publish).toHaveBeenCalledWith(
            'paradox/agent22/lights/commands',
            expect.objectContaining({
                command: 'setColorScene',
                scene: 'normal'
            })
        );

        await zone.shutdown();
    });

    test('publishes compact input state without media status fields', async () => {
        const mqttClient = {
            connected: true,
            subscribe: jest.fn(),
            unsubscribe: jest.fn(),
            publish: jest.fn()
        };

        const zone = new InputZone({
            name: 'spell-box-contact',
            type: 'input',
            baseTopic: 'paradox/houdini/inputs/spell-box',
            backend: 'zwave',
            profile: 'contact',
            inputTopic: 'paradox/houdini/zwave/spell-box/events'
        }, mqttClient, { config: { devices: {} } });

        await zone.initialize();

        const statePublish = mqttClient.publish.mock.calls.find((call) => call[0] === 'paradox/houdini/inputs/spell-box/state');
        expect(statePublish).toBeDefined();

        const payload = statePublish[1];
        expect(payload.input).toBeDefined();
        expect(payload.input.profile).toBe('contact');
        expect(payload.mpv_instances).toBeUndefined();
        expect(payload.background).toBeUndefined();
        expect(payload.speech).toBeUndefined();
        expect(payload.effects).toBeUndefined();
        expect(payload.current_file).toBeUndefined();
        expect(payload.volume).toBeUndefined();
        expect(zone.statusInterval).toBeNull();

        await zone.shutdown();
    });

    test('tracks last_event and contact signal for open and opened payload variants', async () => {
        const subscribeCalls = [];
        const mqttClient = {
            connected: true,
            subscribe: jest.fn((topic, handler) => {
                subscribeCalls.push({ topic, handler });
            }),
            unsubscribe: jest.fn(),
            publish: jest.fn()
        };

        const zone = new InputZone({
            name: 'spell-box-contact',
            type: 'input',
            baseTopic: 'paradox/houdini/inputs/spell-box',
            backend: 'zwave',
            profile: 'contact',
            inputTopic: 'paradox/houdini/zwave/spell-box/events'
        }, mqttClient, { config: { devices: {} } });

        await zone.initialize();
        const handler = subscribeCalls[0].handler;

        await handler('paradox/houdini/zwave/spell-box/events', { input: '0', event: 'open', ts: 1713700000 });
        let statePublish = mqttClient.publish.mock.calls.filter((call) => call[0] === 'paradox/houdini/inputs/spell-box/state').pop();
        expect(statePublish[1].input.last_event.event).toBe('open');
        expect(statePublish[1].input.signals.contact.value).toBe('open');

        await handler('paradox/houdini/zwave/spell-box/events', { input: '0', event: 'opened', ts: 1713700001 });
        statePublish = mqttClient.publish.mock.calls.filter((call) => call[0] === 'paradox/houdini/inputs/spell-box/state').pop();
        expect(statePublish[1].input.last_event.event).toBe('open');
        expect(statePublish[1].input.signals.contact.value).toBe('open');

        await zone.shutdown();
    });

    test('normalizes contact boolean payloads to open/close in state', async () => {
        const subscribeCalls = [];
        const mqttClient = {
            connected: true,
            subscribe: jest.fn((topic, handler) => {
                subscribeCalls.push({ topic, handler });
            }),
            unsubscribe: jest.fn(),
            publish: jest.fn()
        };

        const zone = new InputZone({
            name: 'spell-box-contact',
            type: 'input',
            baseTopic: 'paradox/houdini/inputs/spell-box',
            backend: 'zwave',
            profile: 'contact',
            inputTopic: 'paradox/houdini/zwave/spell-box/events'
        }, mqttClient, { config: { devices: {} } });

        await zone.initialize();
        const handler = subscribeCalls[0].handler;

        await handler('paradox/houdini/zwave/spell-box/events', { input: '0', value: true, ts: 1713700002 });
        let statePublish = mqttClient.publish.mock.calls.filter((call) => call[0] === 'paradox/houdini/inputs/spell-box/state').pop();
        expect(statePublish[1].input.last_event.event).toBe('open');
        expect(statePublish[1].input.signals.contact.value).toBe('open');

        await handler('paradox/houdini/zwave/spell-box/events', { input: '0', value: false, ts: 1713700003 });
        statePublish = mqttClient.publish.mock.calls.filter((call) => call[0] === 'paradox/houdini/inputs/spell-box/state').pop();
        expect(statePublish[1].input.last_event.event).toBe('close');
        expect(statePublish[1].input.signals.contact.value).toBe('close');

        await zone.shutdown();
    });
});
