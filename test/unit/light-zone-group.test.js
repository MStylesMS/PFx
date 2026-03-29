const LightZone = require('../../lib/zones/light-zone');

describe('LightZone group fan-out', () => {
    test('fans out scene command to all configured member lights', async () => {
        const mqttClient = {
            publish: jest.fn(),
            connected: true
        };

        const zoneManager = {
            config: {
                devices: {
                    'light:wiz-84': {
                        name: 'wiz-84',
                        type: 'light',
                        backend: 'passthrough',
                        baseTopic: 'paradox/agent22/lights/wiz-84',
                        forwardTopic: 'paradox/agent22/lights/wiz-84/native/commands'
                    },
                    'light:wiz-109': {
                        name: 'wiz-109',
                        type: 'light',
                        backend: 'passthrough',
                        baseTopic: 'paradox/agent22/lights/wiz-109',
                        forwardTopic: 'paradox/agent22/lights/wiz-109/native/commands'
                    }
                }
            }
        };

        const groupConfig = {
            name: 'room-lights',
            type: 'light_group',
            baseTopic: 'paradox/agent22/lights',
            backend: 'wiz',
            deviceList: ['wiz-84', 'wiz-109']
        };

        const zone = new LightZone(groupConfig, mqttClient, zoneManager);
        await zone.initialize();

        await zone.handleCommand({ command: 'scene', name: 'red' });

        expect(mqttClient.publish).toHaveBeenCalledWith(
            'paradox/agent22/lights/wiz-84/native/commands',
            expect.objectContaining({ command: 'setColorScene', scene: 'red' })
        );
        expect(mqttClient.publish).toHaveBeenCalledWith(
            'paradox/agent22/lights/wiz-109/native/commands',
            expect.objectContaining({ command: 'setColorScene', scene: 'red' })
        );

        await zone.shutdown();
    });
});