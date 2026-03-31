/**
 * Unit Tests for ConfigLoader
 */

const ConfigLoader = require('../../lib/core/config-loader');
const fs = require('fs').promises;

// Mock fs module for testing
jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn()
    }
}));

describe('ConfigLoader', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('load', () => {
        test('should load valid configuration file', async () => {
            const mockConfig = `
[global]
MQTT_SERVER=localhost
MQTT_PORT=1883
HEARTBEAT_TOPIC=Paradox/Devices

[TestScreen]
DEVICE_TYPE=screen
DISPLAY=:0
BASE_TOPIC=Paradox/Room/TestScreen
STATUS_TOPIC=Paradox/Room/TestScreen/Status
MEDIA_DIR=/opt/paradox/media
`;

            fs.readFile.mockResolvedValue(mockConfig);

            const config = await ConfigLoader.load('test.ini');

            expect(config).toHaveProperty('global');
            expect(config).toHaveProperty('devices');
            expect(config.global.mqttServer).toBe('localhost');
            expect(config.global.mqttPort).toBe(1883);
            expect(config.devices.TestScreen.type).toBe('screen');
            expect(config.devices.TestScreen.display).toBe(':0');
        });

        test('should throw error if global section is missing', async () => {
            const mockConfig = `
[TestScreen]
DEVICE_TYPE=screen
DISPLAY=:0
`;

            fs.readFile.mockResolvedValue(mockConfig);

            await expect(ConfigLoader.load('test.ini')).rejects.toThrow('No [global] section found');
        });

        test('should throw error if required global fields are missing', async () => {
            const mockConfig = `
[global]
MQTT_PORT=1883

[TestScreen]
DEVICE_TYPE=screen
`;

            fs.readFile.mockResolvedValue(mockConfig);

            await expect(ConfigLoader.load('test.ini')).rejects.toThrow('Required global configuration field missing: MQTT_SERVER');
        });

        test('should handle device without DEVICE_TYPE', async () => {
            const mockConfig = `
[global]
MQTT_SERVER=localhost
HEARTBEAT_TOPIC=Paradox/Devices

[TestDevice]
BASE_TOPIC=Paradox/Room/TestDevice
`;

            fs.readFile.mockResolvedValue(mockConfig);

            await expect(ConfigLoader.load('test.ini')).rejects.toThrow('Device TestDevice missing DEVICE_TYPE');
        });

        test('should process screen device configuration correctly', async () => {
            const mockConfig = `
[global]
MQTT_SERVER=localhost
HEARTBEAT_TOPIC=Paradox/Devices

[TestScreen]
DEVICE_TYPE=screen
DISPLAY=:1
BASE_TOPIC=Paradox/Room/TestScreen
STATUS_TOPIC=Paradox/Room/TestScreen/Status
MEDIA_DIR=/custom/media
VIDEO_QUEUE_MAX=10
AUDIO_QUEUE_MAX=8
TRANSITION_DELAY_MS=200
OUTPUT_NAME= HDMI-1   
RESOLUTION_MODE= 640x480@60 
RESOLUTION_FALLBACK= 1024x768@60
`;

            fs.readFile.mockResolvedValue(mockConfig);

            const config = await ConfigLoader.load('test.ini');
            const device = config.devices.TestScreen;

            expect(device.type).toBe('screen');
            expect(device.display).toBe(':1');
            expect(device.mediaDir).toBe('/custom/media');
            expect(device.videoQueueMax).toBe(10);
            expect(device.audioQueueMax).toBe(8);
            expect(device.transitionDelay).toBe(200);
            expect(device.outputName).toBe('HDMI-1');
            expect(device.resolutionMode).toBe('640x480@60');
            expect(device.resolutionFallback).toBe('1024x768@60');
        });

        test('should process light device configuration correctly', async () => {
            const mockConfig = `
[global]
MQTT_SERVER=localhost
HEARTBEAT_TOPIC=Paradox/Devices

[TestLight]
DEVICE_TYPE=light
CONTROLLER=hue
DEVICE_ID=AX30F2
BASE_TOPIC=Paradox/Room/TestLight
STATUS_TOPIC=Paradox/Room/TestLight/Status
`;

            fs.readFile.mockResolvedValue(mockConfig);

            const config = await ConfigLoader.load('test.ini');
            const device = config.devices.TestLight;

            expect(device.type).toBe('light');
            expect(device.controller).toBe('hue');
            expect(device.deviceId).toBe('AX30F2');
        });

        test('should process lowercase light configuration and normalize light-group type', async () => {
            const mockConfig = `
[global]
MQTT_SERVER=localhost
HEARTBEAT_TOPIC=Paradox/Devices

[light-group:room-lights]
type=light-group
topic=paradox/room/lights
controller=wiz
device_id=bulb-01
lights=bulb-01, bulb-02
`;

            fs.readFile.mockResolvedValue(mockConfig);

            const config = await ConfigLoader.load('test.ini');
            const device = config.devices['light-group:room-lights'];

            expect(device.type).toBe('light_group');
            expect(device.name).toBe('room-lights');
            expect(device.controller).toBe('wiz');
            expect(device.deviceId).toBe('bulb-01');
            expect(device.deviceList).toEqual(['bulb-01', 'bulb-02']);
            expect(device.backend).toBe('passthrough');
        });

        test('should merge supplemental lights config when lights_config is set', async () => {
            const mainConfig = `
[global]
MQTT_SERVER=localhost
HEARTBEAT_TOPIC=Paradox/Devices
lights_config=./pfx-lights.ini

[screen:main]
type=screen
topic=paradox/main/screen
`;

            const lightsConfig = `
[light:room-lights]
type=light
topic=paradox/main/lights
backend=passthrough
`;

            fs.readFile
                .mockResolvedValueOnce(mainConfig)
                .mockResolvedValueOnce(lightsConfig);

            const config = await ConfigLoader.load('/tmp/pfx.ini');

            expect(fs.readFile).toHaveBeenCalledTimes(2);
            expect(config.devices['light:room-lights']).toBeDefined();
            expect(config.devices['light:room-lights'].type).toBe('light');
            expect(config.devices['light:room-lights'].baseTopic).toBe('paradox/main/lights');
        });

        test('should parse bulb_ips list for light groups', async () => {
            const mockConfig = `
[global]
MQTT_SERVER=localhost
HEARTBEAT_TOPIC=Paradox/Devices

[light-group:room-lights]
type=light-group
topic=paradox/room/lights
backend=wiz
bulb_ips=10.0.0.84,10.0.0.109,10.0.0.38,10.0.0.130
`;

            fs.readFile.mockResolvedValue(mockConfig);

            const config = await ConfigLoader.load('test.ini');
            const device = config.devices['light-group:room-lights'];

            expect(device.bulbIps).toEqual(['10.0.0.84', '10.0.0.109', '10.0.0.38', '10.0.0.130']);
        });

        test('should parse Shelly output fields', async () => {
            const mockConfig = `
[global]
MQTT_SERVER=localhost
HEARTBEAT_TOPIC=Paradox/Devices

[light:shelly-room-rgbw]
type=light
topic=paradox/room/lights/shelly
backend=shelly
generation=2
profile=rgbw
model=plus-rgbw
shelly_host=10.0.0.150
shelly_auth_user=admin
shelly_auth_pass=secret
channel=1
`;

            fs.readFile.mockResolvedValue(mockConfig);

            const config = await ConfigLoader.load('test.ini');
            const device = config.devices['light:shelly-room-rgbw'];

            expect(device.backend).toBe('shelly');
            expect(device.generation).toBe('2');
            expect(device.profile).toBe('rgbw');
            expect(device.model).toBe('plus-rgbw');
            expect(device.shellyHost).toBe('10.0.0.150');
            expect(device.shellyAuthUser).toBe('admin');
            expect(device.shellyAuthPass).toBe('secret');
            expect(device.shellyChannel).toBe(1);
        });

        test('should parse input zone fields and input_map', async () => {
            const mockConfig = `
[global]
MQTT_SERVER=localhost
HEARTBEAT_TOPIC=Paradox/Devices

[input:shelly-i4-main]
type=input
topic=paradox/agent22/inputs/main
backend=shelly
generation=2
profile=input
model=plus-i4
input_topic=shellyplusi4-abcd/events/rpc
input_map={"0.single_push":{"topic":"paradox/agent22/lights/commands","payload":{"command":"setColorScene","scene":"normal"}}}
`;

            fs.readFile.mockResolvedValue(mockConfig);

            const config = await ConfigLoader.load('test.ini');
            const device = config.devices['input:shelly-i4-main'];

            expect(device.type).toBe('input');
            expect(device.backend).toBe('shelly');
            expect(device.profile).toBe('input');
            expect(device.inputTopic).toBe('shellyplusi4-abcd/events/rpc');
            expect(device.inputMap['0.single_push']).toEqual({
                topic: 'paradox/agent22/lights/commands',
                payload: { command: 'setColorScene', scene: 'normal' }
            });
        });

        test('should parse Hue v2 light fields', async () => {
            const mockConfig = `
[global]
MQTT_SERVER=localhost
HEARTBEAT_TOPIC=Paradox/Devices

[light:hue-main-room]
type=light
topic=paradox/houdini/lights/main
backend=hue
hue_bridge_host=192.168.1.100
hue_app_key=abc123xyz
hue_resource_id=aaaa-bbbb-cccc-dddd
hue_resource_type=room
hue_profile=color
`;

            fs.readFile.mockResolvedValue(mockConfig);

            const config = await ConfigLoader.load('test.ini');
            const device = config.devices['light:hue-main-room'];

            expect(device.backend).toBe('hue');
            expect(device.hueBridgeHost).toBe('192.168.1.100');
            expect(device.hueAppKey).toBe('abc123xyz');
            expect(device.hueResourceId).toBe('aaaa-bbbb-cccc-dddd');
            expect(device.hueResourceType).toBe('room');
            expect(device.hueProfile).toBe('color');
        });

        test('should parse LIFX light fields', async () => {
            const mockConfig = `
[global]
MQTT_SERVER=localhost
HEARTBEAT_TOPIC=Paradox/Devices

[light:lifx-test]
type=light
topic=paradox/houdini/lights/lifx
backend=lifx
bulb_ip=192.168.1.55
lifx_port=56700
lifx_kelvin=4000
`;

            fs.readFile.mockResolvedValue(mockConfig);

            const config = await ConfigLoader.load('test.ini');
            const device = config.devices['light:lifx-test'];

            expect(device.backend).toBe('lifx');
            expect(device.bulbIp).toBe('192.168.1.55');
            expect(device.lifxPort).toBe(56700);
            expect(device.lifxKelvin).toBe(4000);
        });

        test('should leave lifxPort and lifxKelvin undefined when not set', async () => {
            const mockConfig = `
[global]
MQTT_SERVER=localhost
HEARTBEAT_TOPIC=Paradox/Devices

[light:lifx-minimal]
type=light
topic=paradox/houdini/lights/lifx
backend=lifx
bulb_ip=192.168.1.55
`;

            fs.readFile.mockResolvedValue(mockConfig);

            const config = await ConfigLoader.load('test.ini');
            const device = config.devices['light:lifx-minimal'];

            expect(device.lifxPort).toBeUndefined();
            expect(device.lifxKelvin).toBeUndefined();
        });

        test('should default hue_resource_type to room and hue_profile to color', async () => {
            const mockConfig = `
[global]
MQTT_SERVER=localhost
HEARTBEAT_TOPIC=Paradox/Devices

[light:hue-minimal]
type=light
topic=paradox/houdini/lights/main
backend=hue
hue_bridge_host=192.168.1.100
hue_app_key=abc123xyz
hue_resource_id=aaaa-bbbb-cccc-dddd
`;

            fs.readFile.mockResolvedValue(mockConfig);

            const config = await ConfigLoader.load('test.ini');
            const device = config.devices['light:hue-minimal'];

            expect(device.hueResourceType).toBe('room');
            expect(device.hueProfile).toBe('color');
        });

        test('should handle file read errors', async () => {
            fs.readFile.mockRejectedValue(new Error('File not found'));

            await expect(ConfigLoader.load('nonexistent.ini')).rejects.toThrow('File not found');
        });
    });
});
