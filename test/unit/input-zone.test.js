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
});
