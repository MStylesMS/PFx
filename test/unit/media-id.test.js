const path = require('path');
const { sanitizeMediaId, joinMediaPath, hasMediaIdField } = require('../../lib/utils/media-id');
const ScreenZone = require('../../lib/zones/screen-zone');
const AudioZone = require('../../lib/zones/audio-zone');

jest.mock('../../lib/utils/logger');
jest.mock('../../lib/utils/window-manager', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../lib/utils/screen-power-manager', () => {
    const Mock = jest.fn().mockImplementation(() => ({
        autoWakeForMedia: jest.fn().mockResolvedValue(),
        shouldWakeForAudio: jest.fn().mockReturnValue(false)
    }));
    Mock.normalizeMethod = jest.fn((method) => method || 'none');
    return Mock;
});

function stubMqtt() {
    return { publish: jest.fn() };
}

const MEDIA_DIR = path.resolve('/opt/media');

function makeScreenZone() {
    const mqtt = stubMqtt();
    const zone = new ScreenZone({
        name: 'screen-pack',
        type: 'screen',
        baseTopic: 'paradox/test/screen',
        media_dir: MEDIA_DIR,
        volume: 80
    }, mqtt, {});
    zone.isInitialized = true;
    return { zone, mqtt };
}

function makeAudioZone(name = 'audio-pack') {
    const mqtt = stubMqtt();
    const zone = new AudioZone({
        name,
        type: 'audio',
        baseTopic: `paradox/test/${name}`,
        media_dir: MEDIA_DIR,
        volume: 80
    }, mqtt, {});
    zone.isInitialized = true;
    return { zone, mqtt };
}

function published(mqtt, suffix) {
    return mqtt.publish.mock.calls
        .filter(call => typeof call[0] === 'string' && call[0].endsWith(suffix))
        .map(call => call[1]);
}

describe('sanitizeMediaId', () => {
    test('accepts JSON number and decimal string', () => {
        expect(sanitizeMediaId(1)).toEqual({ ok: true, mediaId: '1' });
        expect(sanitizeMediaId(2)).toEqual({ ok: true, mediaId: '2' });
        expect(sanitizeMediaId('2')).toEqual({ ok: true, mediaId: '2' });
        expect(sanitizeMediaId(999999999)).toEqual({ ok: true, mediaId: '999999999' });
    });

    test('null clears the pack', () => {
        expect(sanitizeMediaId(null)).toEqual({ ok: true, mediaId: null });
    });

    test('rejects 0, leading zeros, slugs, paths, empty', () => {
        for (const bad of [0, '0', '01', 'v1', '../etc', '/', '..', '', '2.0', -1, 1.5, true, {}, []]) {
            expect(sanitizeMediaId(bad).ok).toBe(false);
        }
    });

    test('undefined is required-missing', () => {
        expect(sanitizeMediaId(undefined).ok).toBe(false);
    });
});

describe('joinMediaPath / resolvers', () => {
    test('omit mediaId is bit-identical to media_dir/file', () => {
        const { zone } = makeScreenZone();
        expect(zone.mediaId).toBeUndefined();
        expect(zone._resolveMediaPath('foo.mp4')).toBe(path.resolve(path.join(MEDIA_DIR, 'foo.mp4')));
        expect(zone.audioManager.resolveMediaPath('foo.mp4')).toBe(path.join(MEDIA_DIR, 'foo.mp4'));
        expect(joinMediaPath(MEDIA_DIR, 'foo.mp4', undefined)).toBe(path.join(MEDIA_DIR, 'foo.mp4'));
    });

    test('mediaId=2 inserts pack segment for relative playVideo/setImage files', () => {
        const { zone } = makeScreenZone();
        zone._applyMediaPack('2');
        expect(zone._resolveMediaPath('foo.mp4')).toBe(path.resolve(path.join(MEDIA_DIR, '2', 'foo.mp4')));
        expect(zone.audioManager.resolveMediaPath('foo.mp4')).toBe(path.join(MEDIA_DIR, '2', 'foo.mp4'));
        expect(joinMediaPath(MEDIA_DIR, 'elevator/vo.mp3', '1')).toBe(path.join(MEDIA_DIR, '1', 'elevator/vo.mp3'));
    });

    test('absolute file skips pack insert', () => {
        const { zone } = makeScreenZone();
        zone._applyMediaPack('2');
        const abs = path.resolve(MEDIA_DIR, 'outside.mp4');
        expect(zone._resolveMediaPath(abs)).toBe(path.resolve(path.join(MEDIA_DIR, abs)));
        expect(zone.audioManager.resolveMediaPath(abs)).toBe(abs);
    });
});

describe('switchMedia / start / state', () => {
    test('illegal mediaId publishes warning and keeps previous pack', async () => {
        const { zone, mqtt } = makeScreenZone();
        zone._applyMediaPack('2');
        mqtt.publish.mockClear();

        for (const bad of ['../etc', '0', 'v1']) {
            await zone.handleCommand({ command: 'switchMedia', mediaId: bad, extra: 'ignored' });
            expect(zone.mediaId).toBe('2');
        }

        const warnings = published(mqtt, '/warnings');
        expect(warnings.length).toBeGreaterThanOrEqual(3);
        expect(warnings.some(w => /invalid mediaId/i.test(w.message) || w.warning_type === 'invalid_mediaId')).toBe(true);
    });

    test('refresh:false with looping bed does not call playBackground again', async () => {
        const { zone } = makeScreenZone();
        zone._playBackgroundMusic = jest.fn().mockResolvedValue(true);
        zone._setImage = jest.fn().mockResolvedValue();
        zone._playVideo = jest.fn().mockResolvedValue();
        zone._packBackground = { file: 'bed.mp3', loop: true };
        zone.mpvInstances.background = { status: 'playing', currentFile: 'bed.mp3' };

        await zone.handleCommand({ command: 'switchMedia', mediaId: 3, refresh: false });

        expect(zone.mediaId).toBe('3');
        expect(zone._playBackgroundMusic).not.toHaveBeenCalled();
        expect(zone._setImage).not.toHaveBeenCalled();
        expect(zone._playVideo).not.toHaveBeenCalled();
    });

    test('refresh:true reloads bed and default still from the new pack', async () => {
        const { zone, mqtt } = makeScreenZone();
        zone._playBackgroundMusic = jest.fn().mockResolvedValue(true);
        zone._setImage = jest.fn().mockResolvedValue();
        zone._playVideo = jest.fn().mockResolvedValue();
        zone.currentState.currentImage = 'idle.png';
        zone.currentState.status = 'showing_image';
        zone._packBackground = { file: 'bed.mp3', loop: true, id: 'bed-a' };
        zone.mpvInstances.background = { status: 'playing', currentFile: 'bed.mp3' };

        await zone.handleCommand({ command: 'switchMedia', mediaId: 2, refresh: true });

        expect(zone.mediaId).toBe('2');
        expect(zone._setImage).toHaveBeenCalledWith({ file: 'idle.png' });
        expect(zone._playBackgroundMusic).toHaveBeenCalledWith('bed.mp3', expect.objectContaining({ loop: true, id: 'bed-a' }));
        expect(zone._playVideo).not.toHaveBeenCalled();

        const events = published(mqtt, '/events');
        const switched = events.find(e => e.event === 'mediaSwitched');
        expect(switched).toBeTruthy();
        expect(switched.mediaId).toBe(2);
        expect(switched.refresh).toBe(true);
        expect(switched.refreshed).toEqual(['default_image', 'background']);
    });

    test('retained state omits mediaId until a pack is set, then includes it', () => {
        const { zone, mqtt } = makeScreenZone();
        zone.publishStatus();
        let state = published(mqtt, '/state').pop();
        expect(Object.prototype.hasOwnProperty.call(state, 'mediaId')).toBe(false);

        zone._applyMediaPack('2');
        mqtt.publish.mockClear();
        zone.publishStatus();
        state = published(mqtt, '/state').pop();
        expect(state.mediaId).toBe(2);

        zone._applyMediaPack(null);
        mqtt.publish.mockClear();
        zone.publishStatus();
        state = published(mqtt, '/state').pop();
        expect(Object.prototype.hasOwnProperty.call(state, 'mediaId')).toBe(true);
        expect(state.mediaId).toBeNull();
    });

    test('start without mediaId does not change pack; start with mediaId switches', async () => {
        const { zone } = makeScreenZone();
        await zone.handleCommand({ command: 'start' });
        expect(zone.mediaId).toBeUndefined();
        expect(zone._mediaPackEverSet).toBe(false);

        await zone.handleCommand({ command: 'start', mediaId: 2, refresh: false });
        expect(zone.mediaId).toBe('2');
    });

    test('restart command is accepted (alias of restartPfx)', async () => {
        const { zone } = makeScreenZone();
        zone._restartPfx = jest.fn().mockResolvedValue();
        await zone.handleCommand({ command: 'restart' });
        expect(zone._restartPfx).toHaveBeenCalledTimes(1);

        const { zone: audio } = makeAudioZone();
        audio._restartPfx = jest.fn().mockResolvedValue();
        await audio.handleCommand({ command: 'restart' });
        expect(audio._restartPfx).toHaveBeenCalledTimes(1);
    });

    test('pack is per zone, not global', async () => {
        const a = makeAudioZone('zone-a');
        const b = makeAudioZone('zone-b');
        await a.zone.handleCommand({ command: 'switchMedia', mediaId: 1 });
        await b.zone.handleCommand({ command: 'switchMedia', mediaId: 2 });
        expect(a.zone.mediaId).toBe('1');
        expect(b.zone.mediaId).toBe('2');
        expect(a.zone._resolveMediaPath('foo.mp3')).toBe(path.resolve(path.join(MEDIA_DIR, '1', 'foo.mp3')));
        expect(b.zone._resolveMediaPath('foo.mp3')).toBe(path.resolve(path.join(MEDIA_DIR, '2', 'foo.mp3')));
    });

    test('hasMediaIdField distinguishes omit from null', () => {
        expect(hasMediaIdField({ command: 'start' })).toBe(false);
        expect(hasMediaIdField({ command: 'start', mediaId: null })).toBe(true);
        expect(hasMediaIdField({ command: 'switchMedia', mediaId: 2 })).toBe(true);
    });
});
