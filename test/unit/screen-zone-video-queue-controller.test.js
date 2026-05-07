const ScreenZoneVideoQueueController = require('../../lib/zones/screen-zone-video-queue-controller');

function createZone(overrides = {}) {
    return {
        logger: {
            info: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            error: jest.fn()
        },
        _isVideoFile: jest.fn((mediaPath) => /\.(mp4|mov|mkv|webm)$/i.test(mediaPath || '')),
        videoQueue: [],
        currentState: {
            currentVideo: null,
            status: 'idle',
            videoQueueLength: 0
        },
        zoneConfig: {
            videoQueueMax: 5
        },
        loopState: {
            isLooping: false
        },
        publishStatus: jest.fn(),
        isProcessingVideoQueue: false,
        ...overrides
    };
}

describe('ScreenZoneVideoQueueController', () => {
    test('suppresses duplicate playVideo already queued', async () => {
        const zone = createZone({
            videoQueue: [
                { kind: 'playVideo', file: 'intro.mp4', media_type: 'video', enqueued_at: Date.now() }
            ]
        });
        const controller = new ScreenZoneVideoQueueController(zone);
        jest.spyOn(controller, 'processVideoQueue').mockResolvedValue(undefined);

        await controller.enqueueVideoCommand({ command: 'playVideo', file: 'intro.mp4' });

        expect(zone.videoQueue).toHaveLength(1);
        expect(zone.videoQueue[0].file).toBe('intro.mp4');
        expect(zone.publishStatus).not.toHaveBeenCalled();
        expect(controller.processVideoQueue).not.toHaveBeenCalled();
    });

    test('replaces trailing setImage with the newest setImage', async () => {
        const zone = createZone({
            videoQueue: [
                { kind: 'setImage', file: 'still-a.png', media_type: 'image', enqueued_at: Date.now() }
            ]
        });
        const controller = new ScreenZoneVideoQueueController(zone);
        jest.spyOn(controller, 'processVideoQueue').mockResolvedValue(undefined);

        await controller.enqueueVideoCommand({ command: 'setImage', file: 'still-b.png' });

        expect(zone.videoQueue).toHaveLength(1);
        expect(zone.videoQueue[0]).toEqual(expect.objectContaining({
            kind: 'setImage',
            file: 'still-b.png',
            media_type: 'image'
        }));
        expect(zone.currentState.videoQueueLength).toBe(1);
        expect(zone.publishStatus).toHaveBeenCalledTimes(1);
        expect(controller.processVideoQueue).toHaveBeenCalledTimes(1);
    });

    test('drops trailing setImage when playVideo is queued after it', async () => {
        const zone = createZone({
            videoQueue: [
                { kind: 'setImage', file: 'poster.png', media_type: 'image', enqueued_at: Date.now() }
            ]
        });
        const controller = new ScreenZoneVideoQueueController(zone);
        jest.spyOn(controller, 'processVideoQueue').mockResolvedValue(undefined);

        await controller.enqueueVideoCommand({ command: 'playVideo', file: 'scene.mp4' });

        expect(zone.videoQueue).toHaveLength(1);
        expect(zone.videoQueue[0]).toEqual(expect.objectContaining({
            kind: 'playVideo',
            file: 'scene.mp4',
            media_type: 'video'
        }));
        expect(zone.currentState.videoQueueLength).toBe(1);
        expect(zone.publishStatus).toHaveBeenCalledTimes(1);
        expect(controller.processVideoQueue).toHaveBeenCalledTimes(1);
    });
});