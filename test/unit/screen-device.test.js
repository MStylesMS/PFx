/**
 * Unit Tests for ScreenDevice
 */

const ScreenDevice = require('../../lib/devices/screen-device');

describe('ScreenDevice', () => {
    let screenDevice;
    let mockMqttClient;
    let mockConfig;

    beforeEach(() => {
        // For unit tests, use a mock config object (do not load .ini)
        mockConfig = {
            name: 'TestScreen',
            type: 'screen',
            display: ':0',
            baseTopic: 'test/screen',
            statusTopic: 'test/screen/status',
            mediaDir: '/opt/paradox/apps/pfx/media/test',
            videoQueueMax: 5,
            audioQueueMax: 5,
            transitionDelay: 100
        };

        mockMqttClient = global.testUtils.createMockMqttClient();

        screenDevice = new ScreenDevice(mockConfig, mockMqttClient);
    });

    // Example for integration/system test:
    // const loadTestConfig = require('../utils/loadTestConfig');
    // let realConfig;
    // beforeAll(async () => {
    //     realConfig = await loadTestConfig();
    // });
    describe('initialization', () => {
        test('should initialize with correct configuration', async () => {
            await screenDevice.initialize();

            expect(screenDevice.config).toEqual(mockConfig);
            expect(screenDevice.currentState.status).toBe('idle');
            expect(mockMqttClient.publish).toHaveBeenCalledWith(
                'test/screen/status',
                expect.objectContaining({
                    device: 'TestScreen',
                    type: 'state',
                    status: 'idle'
                })
            );
        });
    });

    describe('command handling', () => {
        beforeEach(async () => {
            await screenDevice.initialize();
            jest.clearAllMocks();
        });

        test('should handle setImage command', async () => {
            const command = { command: 'setImage', file: 'test.png' };

            await screenDevice.handleCommand(command);

            expect(screenDevice.currentState.currentImage).toBe('test.png');
            expect(screenDevice.currentState.status).toBe('showing_image');
            expect(mockMqttClient.publish).toHaveBeenCalledWith(
                'test/screen/status',
                expect.objectContaining({
                    type: 'state',
                    currentimage: 'test.png',
                    status: 'showing_image'
                })
            );
        });

        test('should handle playVideo command', async () => {
            const command = { command: 'playVideo', file: 'test.mp4' };

            await screenDevice.handleCommand(command);

            expect(screenDevice.videoQueue).toContain('test.mp4');
            expect(screenDevice.currentState.currentVideo).toBe('test.mp4');
            expect(screenDevice.currentState.status).toBe('playing_video');
        });

        test('should handle playAudio command', async () => {
            const command = { command: 'playAudio', file: 'test.mp3' };

            await screenDevice.handleCommand(command);

            expect(screenDevice.audioQueue).toContain('test.mp3');
            expect(screenDevice.currentState.currentAudio).toBe('test.mp3');
        });

        test('should handle transition command', async () => {
            const command = {
                command: 'transition',
                video: 'transition.mp4',
                image: 'end.png'
            };

            await screenDevice.handleCommand(command);

            expect(screenDevice.currentState.currentVideo).toBe('transition.mp4');
            expect(screenDevice.currentState.status).toBe('playing_video');
        });

        test('should handle stopVideo command', async () => {
            // First add some videos
            await screenDevice.handleCommand({ command: 'playVideo', file: 'test1.mp4' });
            await screenDevice.handleCommand({ command: 'playVideo', file: 'test2.mp4' });

            jest.clearAllMocks();

            await screenDevice.handleCommand({ command: 'stopVideo' });

            expect(screenDevice.videoQueue).toHaveLength(0);
            expect(screenDevice.currentState.currentVideo).toBeNull();
            expect(screenDevice.currentState.videoQueueLength).toBe(0);
        });

        test('should handle stopAll command', async () => {
            // First add some media
            await screenDevice.handleCommand({ command: 'playVideo', file: 'test.mp4' });
            await screenDevice.handleCommand({ command: 'playAudio', file: 'test.mp3' });

            jest.clearAllMocks();

            await screenDevice.handleCommand({ command: 'stopAll' });

            expect(screenDevice.videoQueue).toHaveLength(0);
            expect(screenDevice.audioQueue).toHaveLength(0);
            expect(screenDevice.currentState.status).toBe('idle');
        });

        test('should handle getConfig command', async () => {
            await screenDevice.handleCommand({ command: 'getConfig' });

            expect(mockMqttClient.publish).toHaveBeenCalledWith(
                'test/screen/status',
                expect.objectContaining({
                    type: 'config',
                    config: mockConfig
                })
            );
        });

        test('should handle videoQueue command', async () => {
            await screenDevice.handleCommand({ command: 'playVideo', file: 'test.mp4' });
            jest.clearAllMocks();

            await screenDevice.handleCommand({ command: 'videoQueue' });

            expect(mockMqttClient.publish).toHaveBeenCalledWith(
                'test/screen/status',
                expect.objectContaining({
                    type: 'video_queue',
                    queue: ['test.mp4'],
                    current: 'test.mp4'
                })
            );
        });

        test('should throw error for unknown command', async () => {
            const command = { command: 'unknownCommand' };

            await expect(screenDevice.handleCommand(command)).rejects.toThrow('Unknown command: unknownCommand');
        });

        test('should handle command with missing parameters', async () => {
            const command = { command: 'setImage' }; // Missing File parameter

            await expect(screenDevice.handleCommand(command)).rejects.toThrow('File path is required');
        });
    });

    describe('queue management', () => {
        beforeEach(async () => {
            await screenDevice.initialize();
        });

        test('should respect video queue maximum', async () => {
            // Add videos up to the limit
            for (let i = 0; i < mockConfig.videoQueueMax + 2; i++) {
                await screenDevice.handleCommand({ command: 'playVideo', file: `test${i}.mp4` });
            }

            expect(screenDevice.videoQueue).toHaveLength(mockConfig.videoQueueMax);
            // Should contain the last 5 videos (test2.mp4 through test6.mp4)
            expect(screenDevice.videoQueue).not.toContain('test0.mp4');
            expect(screenDevice.videoQueue).not.toContain('test1.mp4');
        });

        test('should not add duplicate videos to queue', async () => {
            await screenDevice.handleCommand({ command: 'playVideo', file: 'test.mp4' });
            await screenDevice.handleCommand({ command: 'playVideo', file: 'test.mp4' });

            expect(screenDevice.videoQueue.filter(v => v === 'test.mp4')).toHaveLength(1);
        });

        test('should respect audio queue maximum', async () => {
            // Add audio files up to the limit
            for (let i = 0; i < mockConfig.audioQueueMax + 2; i++) {
                await screenDevice.handleCommand({ command: 'playAudio', file: `test${i}.mp3` });
            }

            expect(screenDevice.audioQueue).toHaveLength(mockConfig.audioQueueMax);
        });
    });

    describe('error handling', () => {
        beforeEach(async () => {
            await screenDevice.initialize();
            jest.clearAllMocks();
        });

        test('should publish error messages', async () => {
            await screenDevice._publishError('TEST_ERROR', 'Test error message');

            expect(mockMqttClient.publish).toHaveBeenCalledWith(
                'test/screen/status',
                expect.objectContaining({
                    type: 'error',
                    error_code: 'TEST_ERROR',
                    message: 'Test error message'
                })
            );

            // Should also send to global heartbeat topic
            expect(mockMqttClient.publish).toHaveBeenCalledWith(
                'test/heartbeat',
                expect.objectContaining({
                    type: 'error',
                    error_code: 'TEST_ERROR'
                })
            );
        });
    });

    describe('shutdown', () => {
        test('should shutdown cleanly', async () => {
            await screenDevice.initialize();

            // Add some media
            await screenDevice.handleCommand({ command: 'playVideo', file: 'test.mp4' });

            await expect(screenDevice.shutdown()).resolves.toBeUndefined();
        });
    });
});
