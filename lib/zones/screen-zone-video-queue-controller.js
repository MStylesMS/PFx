const { spawn } = require('child_process');
const { VideoPlaybackTracker } = require('../media/video-playback-tracker');
const { probeDurationSeconds } = require('../media/ffprobe-duration');

class ScreenZoneVideoQueueController {
    constructor(zone) {
        this.zone = zone;
    }

    _scheduleProcessNext(delayMs = 0) {
        if (delayMs > 0) {
            setTimeout(() => this.zone._processVideoQueue(), delayMs);
            return;
        }
        this.zone._processVideoQueue();
    }

    async enqueueVideoCommand(command) {
        const zone = this.zone;
        const { command: incomingType } = command;
        const mediaPath = command.file || command.video || command.image;
        const mediaType = zone._isVideoFile(mediaPath) ? 'video' : 'image';
        const kind = incomingType === 'playVideo' ? 'playVideo' : 'setImage';

        zone.logger.debug(`VIDEO_QUEUE_ENQUEUE kind=${kind} file=${mediaPath} qlen=${zone.videoQueue.length}`);

        if (kind === 'playVideo' && zone.currentState.currentVideo === mediaPath && zone.currentState.status === 'playing_video') {
            zone.logger.debug(`VIDEO_QUEUE: duplicate playVideo ignored (already playing) ${mediaPath}`);
            return;
        }

        const dup = zone.videoQueue.find(item => item.file === mediaPath && item.kind === kind);
        if (dup) {
            zone.logger.debug(`VIDEO_QUEUE: duplicate suppressed (already queued) ${mediaPath}`);
            return;
        }

        if (kind === 'setImage' && zone.videoQueue.length > 0) {
            const last = zone.videoQueue[zone.videoQueue.length - 1];
            if (last.kind === 'setImage') {
                zone.logger.debug('VIDEO_QUEUE: replacing trailing setImage with new setImage');
                zone.videoQueue[zone.videoQueue.length - 1] = { kind, file: mediaPath, media_type: mediaType, enqueued_at: Date.now(), original: command };
                zone.currentState.videoQueueLength = zone.videoQueue.length;
                zone.publishStatus();
                if (!zone.isProcessingVideoQueue) this.processVideoQueue();
                return;
            }
        }

        if (kind === 'playVideo' && zone.videoQueue.length > 0) {
            const last = zone.videoQueue[zone.videoQueue.length - 1];
            if (last && last.kind === 'setImage') {
                zone.logger.debug(`VIDEO_QUEUE: dropping trailing setImage (${last.file}) because playVideo ${mediaPath} appended`);
                zone.videoQueue.pop();
            }
        }

        zone.videoQueue.push({ kind, file: mediaPath, media_type: mediaType, enqueued_at: Date.now(), original: command });

        const max = zone.zoneConfig.videoQueueMax || 5;
        if (zone.videoQueue.length > max) {
            zone.logger.debug('VIDEO_QUEUE: capacity reached, dropping oldest');
            zone.videoQueue.shift();
        }
        zone.currentState.videoQueueLength = zone.videoQueue.length;

        if (zone.loopState.isLooping) {
            zone.logger.info(`Canceling video loop: new item queued (${mediaPath})`);
            zone.loopState.isLooping = false;
        }

        zone.publishStatus();
        if (!zone.isProcessingVideoQueue) this.processVideoQueue();
    }

    async processVideoQueue() {
        const zone = this.zone;
        zone.logger.debug(`VIDEO_QUEUE_PROCESS start processing=${zone.isProcessingVideoQueue} qlen=${zone.videoQueue.length}`);
        if (zone.isProcessingVideoQueue || zone.videoQueue.length === 0) return;
        if (zone.currentState.status === 'playing_video') {
            zone.logger.debug('VIDEO_QUEUE_PROCESS: current video playing; will wait for completion');
            return;
        }

        zone.isProcessingVideoQueue = true;
        const item = zone.videoQueue.shift();
        if (!item) {
            zone.isProcessingVideoQueue = false;
            return;
        }

        const { kind, file, media_type: mediaType, original } = item;
        zone.logger.debug(`VIDEO_QUEUE_DEQUEUE kind=${kind} file=${file} remaining=${zone.videoQueue.length}`);
        zone.currentState.videoQueueLength = zone.videoQueue.length;
        zone.publishStatus();

        try {
            if (kind === 'setImage') {
                await this.handleSetImageQueue(file, mediaType, original);
                zone.isProcessingVideoQueue = false;
                if (zone.videoQueue.length > 0) this.processVideoQueue();
                return;
            }

            if (kind === 'playVideo') {
                await this.handlePlayVideoQueue(file, mediaType, original);
                if (mediaType === 'video') {
                    if (zone.currentState.status !== 'playing_video') {
                        zone.logger.warn(`VIDEO_QUEUE_PROCESS: playVideo did not enter playing_video state for ${file}; releasing queue lock`);
                        zone.isProcessingVideoQueue = false;
                        if (zone.videoQueue.length > 0) this.processVideoQueue();
                    }
                    return;
                }

                zone.isProcessingVideoQueue = false;
                if (zone.videoQueue.length > 0) this.processVideoQueue();
            }
        } catch (error) {
            zone.logger.error('VIDEO_QUEUE_PROCESS error:', error);
            zone.isProcessingVideoQueue = false;
            if (zone.videoQueue.length > 0) {
                setTimeout(() => this.processVideoQueue(), 500);
            }
        }
    }

    async handleSetImageQueue(mediaPath, mediaType, command) {
        const zone = this.zone;
        if (mediaType === 'image') {
            await zone._setImage({ file: mediaPath });
            return;
        }
        await zone._setImage({ file: mediaPath });
    }

    async handlePlayVideoQueue(mediaPath, mediaType, command) {
        const zone = this.zone;
        if (mediaType === 'image') {
            await zone._playVideo({ file: mediaPath });
            return;
        }
        await zone._playVideo(command || { file: mediaPath });
    }

    async setupVideoEof(mediaPath, remainingDuration = null) {
        const zone = this.zone;
        this.clearEofHandlers();

        if (remainingDuration === null) {
            zone._videoStartedAt = Date.now();
        }

        let frames = null;
        try {
            frames = await zone.mpvZoneManager.getProperty('estimated-frame-count');
        } catch (_) {
            frames = null;
        }

        let duration;
        let usedProbe = false;

        if (remainingDuration !== null) {
            duration = remainingDuration;
            zone.logger.debug(`Using remaining duration: ${duration}s`);
        } else {
            duration = zone._videoEofCache.get(mediaPath);
            if (duration === undefined) {
                try {
                    duration = await zone.mpvZoneManager.getDuration();
                } catch (_) {
                    try {
                        duration = await this.probeDuration(mediaPath);
                        usedProbe = true;
                        zone._videoEofCache.set(mediaPath, duration);
                    } catch (error) {
                        zone.logger.warn(`Could not determine video duration: ${error.message}`);
                        duration = null;
                    }
                }
                if (duration != null) {
                    zone._videoEofCache.set(mediaPath, duration);
                    zone._originalDuration = duration;
                }
            } else {
                zone._originalDuration = duration;
            }
        }

        if (duration != null) {
            const durationLabel = remainingDuration !== null ? 'remaining time' : (usedProbe ? 'ffprobe fallback' : 'mpv duration');
            zone.logger.info(`EOF detection: ${durationLabel} (${duration}s${frames != null ? `, frames=${frames}` : ''})`);
            const timeoutMs = Math.max(0, duration * 1000);
            zone._videoEofTimeout = setTimeout(() => {
                zone.logger.debug('Video EOF timeout fired (duration-based)');
                this.handleMediaEnd();
            }, timeoutMs);
            return;
        }

        zone.logger.info(`EOF detection: playback-time polling (tick=50ms, epsilon=100ms)${frames != null ? `, frames=${frames}` : ''}`);
        zone._observerId = await zone.mpvZoneManager.observeProperty('playback-time');
        zone.mpvZoneManager.on('property-playback-time', event => this.onPlaybackTime(event));
    }

    async probeDuration(mediaPath) {
        const zone = this.zone;
        const probePath = zone._normalizeMediaPath(mediaPath);
        return new Promise((resolve, reject) => {
            const ffprobe = spawn('ffprobe', [
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                probePath
            ]);

            let output = '';
            let errOutput = '';
            ffprobe.stdout.on('data', data => output += data);
            ffprobe.stderr.on('data', data => errOutput += data);
            ffprobe.on('close', code => {
                if (code === 0) {
                    const duration = parseFloat(output.trim());
                    if (!Number.isNaN(duration)) {
                        resolve(duration);
                    } else {
                        reject(new Error(`ffprobe returned invalid duration for ${probePath}: ${output.trim()}`));
                    }
                    return;
                }
                reject(new Error(`ffprobe exited with code ${code} on ${probePath}: ${errOutput.trim()}`));
            });
        });
    }

    clearEofHandlers() {
        const zone = this.zone;
        if (zone._videoEofTimeout) {
            clearTimeout(zone._videoEofTimeout);
            zone._videoEofTimeout = null;
        }
        if (zone._observerId != null) {
            zone.mpvZoneManager.unobserveProperty(zone._observerId);
            zone._observerId = null;
        }
        zone._lastPlaybackTime = 0;
        zone._stallCount = 0;
    }

    onPlaybackTime(event) {
        const zone = this.zone;
        const time = event.data;
        if (time === zone._lastPlaybackTime) {
            zone._stallCount++;
        } else {
            zone._stallCount = 0;
            zone._lastPlaybackTime = time;
        }
        if (zone._stallCount >= 2) {
            zone.logger.debug('Playback-time stalled, assuming EOF');
            this.handleMediaEnd();
        }
    }

    handleMediaEnd() {
        this.zone.logger.debug('LEGACY _handleMediaEnd invoked - should be replaced by unified completion path.');
    }

    completeCurrentVideo(reason, opts = {}) {
        const zone = this.zone;
        if (!zone.currentState.currentVideo) return;

        const file = zone.currentState.currentVideo;
        const wasLooping = zone.loopState.isLooping;
        const loopIterations = zone.loopState.loopIterations;

        let watched = null;
        let duration = null;
        if (zone._videoPlaybackTracker) {
            try { zone._videoPlaybackTracker.stop(); } catch (_) {}
            watched = zone._videoPlaybackTracker.getWatchedSeconds();
        }
        try {
            const cache = require('../media/ffprobe-duration').ffprobeDurationCache;
            const cached = cache.get ? cache.get(file) : null;
            if (cached != null) duration = cached;
        } catch (_) {}

        if (zone.currentState.currentVideoDuckId) {
            try {
                zone.duckLifecycle.removeTrigger(zone.currentState.currentVideoDuckId);
                zone._recomputeBackgroundAfterDuckChange().catch(() => {});
            } catch (_) {}
            delete zone.currentState.currentVideoDuckId;
        }

        try { zone.mpvZoneManager.pause(); } catch (_) {}

        let message;
        switch (reason) {
            case 'natural_end': message = 'Video completed (natural end)'; break;
            case 'stopped': message = 'Video stopped'; break;
            case 'queue_cleared': message = 'Video interrupted by queue clear'; break;
            case 'heuristic_eof': message = 'Video ended (heuristic EOF)'; break;
            case 'error': message = opts.error || 'Video error'; break;
            default: message = reason;
        }

        zone.publishEvent({
            command: 'playVideo',
            file,
            done: true,
            reason,
            message,
            watched_s: watched != null ? parseFloat(watched.toFixed(3)) : undefined,
            duration_s: duration != null ? duration : undefined,
            loop_iterations: wasLooping ? loopIterations : undefined,
            queue_remaining: zone.videoQueue.length,
            ts: new Date().toISOString()
        });

        zone.currentState.currentVideo = null;
        zone.currentState.status = 'showing_image';

        zone.loopState.isLooping = false;
        zone.loopState.loopStartedAt = null;
        zone.loopState.loopIterations = 0;
        zone.loopState.currentVideoFile = null;
        zone.loopState.isRestarting = false;

        zone.publishStatus();

        zone.isProcessingVideoQueue = false;
        if (zone.videoQueue.length > 0) {
            setTimeout(() => this.processVideoQueue(), 10);
        }
    }

    async handleLoopRestart() {
        const zone = this.zone;
        const videoPath = zone.loopState.currentVideoFile;
        if (!videoPath || !zone.loopState.isLooping) {
            zone.logger.warn('Loop restart called but no loop active');
            return;
        }

        if (zone.loopState.isRestarting) {
            zone.logger.warn('Loop restart already in progress, ignoring duplicate call');
            return;
        }
        zone.loopState.isRestarting = true;

        zone.loopState.loopIterations++;
        zone.logger.info(`Loop iteration ${zone.loopState.loopIterations} for ${videoPath}`);

        if (zone._videoPlaybackTracker) {
            try { zone._videoPlaybackTracker.stop(); } catch (_) {}
        }

        this.clearEofHandlers();

        try {
            const withTimeout = (promise, ms, operation) => Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error(`${operation} timeout after ${ms}ms`)), ms))
            ]);

            await withTimeout(zone.mpvZoneManager.stop(), 2000, 'MPV stop');
            await withTimeout(zone.mpvZoneManager.loadMedia(videoPath, 'video'), 3000, 'MPV loadMedia');
            await withTimeout(zone.mpvZoneManager.play(), 2000, 'MPV play');

            const probedDuration = await probeDurationSeconds(videoPath).catch(() => null);

            zone._videoPlaybackTracker = new VideoPlaybackTracker({
                targetDurationSec: probedDuration,
                onNaturalEnd: () => {
                    zone.logger.info('VIDEO_TRACKER natural end fired (loop iteration)');
                    if (zone.loopState.isLooping) {
                        zone._handleLoopRestart().catch(err => {
                            zone.logger.error('Loop restart failed:', err);
                            zone.loopState.isLooping = false;
                            zone.loopState.isRestarting = false;
                            zone._completeCurrentVideo('error', { error: err.message });
                        });
                    } else {
                        zone._completeCurrentVideo('natural_end');
                    }
                }
            });
            zone._videoPlaybackTracker.start();

            zone.publishEvent({
                command: 'playVideo',
                file: videoPath,
                loop_iteration: zone.loopState.loopIterations,
                ts: new Date().toISOString()
            });

            zone.loopState.isRestarting = false;
        } catch (error) {
            zone.logger.error('Loop restart failed:', error);
            zone.loopState.isLooping = false;
            zone.loopState.isRestarting = false;
            zone._completeCurrentVideo('error', { error: error.message });
        }
    }
}

module.exports = ScreenZoneVideoQueueController;