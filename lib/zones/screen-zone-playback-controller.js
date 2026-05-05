const { VideoPlaybackTracker } = require('../media/video-playback-tracker');
const { probeDurationSeconds } = require('../media/ffprobe-duration');
const { resolveEffectiveVolume } = require('../audio/resolve-effective-volume');

class ScreenZonePlaybackController {
    constructor(zone) {
        this.zone = zone;
    }

    async setImage(command) {
        const zone = this.zone;
        const imagePath = command.file || command.image;
        if (!imagePath) {
            throw new Error('Image path is required');
        }

        const fileValidation = await zone._validateMediaFile(imagePath);
        if (!fileValidation.exists) {
            zone.publishMessage('warning', {
                message: fileValidation.error,
                command: 'setImage',
                file: imagePath
            });
            zone.logger.warn(fileValidation.error);
            return;
        }

        await zone.screenPowerManager.autoWakeForMedia('image');

        const fullPath = fileValidation.path;
        const isVideo = zone._isVideoFile(imagePath);

        if (isVideo) {
            zone.logger.info(`🎬 Smart setImage: Detected video file, loading and pausing on first frame: ${imagePath}`);
            await zone.mpvZoneManager.loadMedia(fullPath);
            await new Promise(resolve => setTimeout(resolve, 100));
            await zone.mpvZoneManager.pause();

            zone.smartMediaState.lastCommand = 'setImage';
            zone.smartMediaState.lastMediaPath = imagePath;
            zone.smartMediaState.currentLoadedPath = imagePath;
            zone.smartMediaState.isVideoPaused = true;

            zone.currentState.currentImage = imagePath;
            zone.currentState.currentVideo = null;
            zone.currentState.status = 'showing_image';
            zone.mpvInstances.media.currentFile = imagePath;
        } else {
            zone.logger.info(`🖼️ Smart setImage: Loading image file: ${imagePath}`);
            await zone.mpvZoneManager.loadMedia(fullPath);

            zone.smartMediaState.lastCommand = 'setImage';
            zone.smartMediaState.lastMediaPath = imagePath;
            zone.smartMediaState.currentLoadedPath = imagePath;
            zone.smartMediaState.isVideoPaused = false;

            zone.currentState.currentImage = imagePath;
            zone.currentState.currentVideo = null;
            zone.currentState.status = 'showing_image';
            zone.mpvInstances.media.currentFile = imagePath;
        }

        zone.publishStatus();
        zone.publishEvent({
            command: 'setImage',
            file: imagePath,
            started: true,
            media_type: isVideo ? 'video' : 'image',
            paused_first_frame: isVideo ? true : undefined,
            queue_remaining: zone.videoQueue.length,
            ts: new Date().toISOString()
        });
        zone.logger.debug(`Image set: ${imagePath} (${isVideo ? 'video paused on first frame' : 'static image'})`);
    }

    async setDefaultImage() {
        const zone = this.zone;
        try {
            const fileValidation = await zone._validateMediaFile(zone.defaultImage);
            if (!fileValidation.exists) {
                zone.logger.warn(`Default image not found: ${fileValidation.error}`);
                return;
            }

            const imagePath = fileValidation.path;
            await zone.mpvZoneManager.loadMedia(imagePath, 'image');

            zone.currentState.currentImage = zone.defaultImage;
            zone.currentState.status = 'showing_image';
            zone.mpvInstances.media.currentFile = zone.defaultImage;

            zone.logger.debug(`Default image set: ${zone.defaultImage}`);
        } catch (error) {
            zone.logger.warn(`Failed to set default image ${zone.defaultImage}:`, error.message);
        }
    }

    async playVideo(command) {
        const zone = this.zone;
        const videoPath = command.file || command.video;
        const { volume, adjustVolume, ducking, loop } = command;
        const skipDucking = command.skipDucking || command.skip_ducking;
        if (!videoPath) {
            throw new Error('Video path is required');
        }

        await zone.screenPowerManager.autoWakeForMedia('video');

        const fileValidation = await zone._validateMediaFile(videoPath);
        if (!fileValidation.exists) {
            zone.publishCommandOutcome({
                command: 'playVideo',
                outcome: 'failed',
                parameters: { file: videoPath },
                error_type: 'file_not_found',
                error_message: fileValidation.error,
                message: `Media file not found for playVideo: ${videoPath}`
            });
            zone.logger.warn(fileValidation.error);
            return;
        }

        const fullPath = fileValidation.path;
        const isVideo = zone._isVideoFile(videoPath);
        const defaultVideoDucking = zone.config.videoDucking !== undefined ? zone.config.videoDucking : (isVideo ? -24 : 0);
        const duckingLevel = skipDucking ? 0 : (ducking !== undefined ? ducking : defaultVideoDucking);
        let duckId = null;

        if (isVideo && duckingLevel < 0) {
            duckId = `video-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            zone.currentState.currentVideoDuckId = duckId;
            zone.duckLifecycle.addTrigger(duckId, 'video');
            await zone._recomputeBackgroundAfterDuckChange();
            zone.logger.debug(`Video duck trigger added: ${duckId} level=${duckingLevel}`);
        }

        const shouldResume = zone._shouldResumeExistingMedia(videoPath, 'playVideo');

        let probedDuration = null;
        try { probedDuration = await probeDurationSeconds(fullPath).catch(() => null); } catch (_) { }

        let resolvedVideo = null;
        const commandPayload = {};
        if (volume !== undefined) commandPayload.volume = volume;
        const adj = adjustVolume;
        if (adj !== undefined) commandPayload.adjustVolume = adj;
        if (Object.keys(commandPayload).length) {
            try {
                resolvedVideo = resolveEffectiveVolume({ type: 'video', zoneModel: zone.volumeModel, command: commandPayload, duckActive: false });
            } catch (error) {
                zone.logger.warn('Video volume resolution failed: ' + error.message);
            }
        }

        if (shouldResume) {
            zone.logger.info(`🎬 Smart playVideo: Resuming paused video instead of reloading: ${videoPath}`);
            await zone.mpvZoneManager.play();
            zone.smartMediaState.lastCommand = 'playVideo';
            zone.smartMediaState.isVideoPaused = false;
        } else {
            zone.logger.info(`🎬 Smart playVideo: Loading and auto-playing video: ${videoPath}`);
            const options = {};
            if (resolvedVideo && resolvedVideo.final !== undefined) options.volume = resolvedVideo.final;
            try { await zone.mpvZoneManager.stop(); } catch (_) { }
            await zone.mpvZoneManager.loadMedia(videoPath, 'video', options);
            await zone.mpvZoneManager.play();
            zone.smartMediaState.lastCommand = 'playVideo';
            zone.smartMediaState.lastMediaPath = videoPath;
            zone.smartMediaState.currentLoadedPath = videoPath;
            zone.smartMediaState.isVideoPaused = false;
        }

        zone.currentState.currentVideo = videoPath;
        zone.currentState.currentImage = null;
        zone.currentState.status = 'playing_video';
        zone.mpvInstances.media.currentFile = videoPath;

        if (duckId) {
            zone.currentState.currentVideoDuckId = duckId;
        }

        zone.currentState.videoQueueLength = zone.videoQueue.length;

        const shouldLoop = isVideo && loop === true && zone.videoQueue.length === 0;
        if (shouldLoop) {
            zone.loopState.isLooping = true;
            zone.loopState.loopStartedAt = Date.now();
            zone.loopState.loopIterations = 0;
            zone.loopState.currentVideoFile = videoPath;
            zone.logger.info(`Starting looped video: ${videoPath}`);
        } else {
            zone.loopState.isLooping = false;
            zone.loopState.currentVideoFile = null;
        }

        zone.publishStatus();
        if (zone._videoPlaybackTracker) zone._videoPlaybackTracker.stop();
        zone._videoPlaybackTracker = new VideoPlaybackTracker({
            targetDurationSec: probedDuration != null ? probedDuration : null,
            onNaturalEnd: () => {
                zone.logger.info('VIDEO_TRACKER natural end fired');
                if (zone.loopState.isLooping) {
                    zone._handleLoopRestart().catch(error => {
                        zone.logger.error('Loop restart failed:', error);
                        zone.loopState.isLooping = false;
                        zone._completeCurrentVideo('error', { error: error.message });
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
            started: true,
            resumed: shouldResume,
            looping: shouldLoop ? true : undefined,
            media_type: 'video',
            duration_s: probedDuration != null ? probedDuration : null,
            volume: resolvedVideo ? resolvedVideo.final : undefined,
            adjust_volume: adj !== undefined ? adj : undefined,
            ducking_applied: duckingLevel !== 0 ? duckingLevel : undefined,
            queue_remaining: zone.videoQueue.length,
            ts: new Date().toISOString()
        });

        if (resolvedVideo) {
            zone._lastPlaybackTelemetry = {
                command: 'playVideo',
                effective_volume: resolvedVideo.final,
                pre_duck_volume: resolvedVideo.preDuck,
                ducked: resolvedVideo.ducked
            };
        }
        if (resolvedVideo && resolvedVideo.warnings && resolvedVideo.warnings.length) {
            zone.publishCommandOutcome({
                command: 'playVideo',
                outcome: 'warning',
                parameters: {
                    file: videoPath,
                    volume: resolvedVideo.final,
                    warnings: resolvedVideo.warnings.map(warning => warning.code),
                    effective_volume: resolvedVideo.final,
                    pre_duck_volume: resolvedVideo.preDuck,
                    ducked: resolvedVideo.ducked
                },
                warning_type: 'volume_resolution_warning',
                message: 'Video playback started with volume resolution warnings'
            });
        }

        zone.logger.debug(`Video playing: ${videoPath} (${shouldResume ? 'resumed' : 'loaded'})`);
    }
}

module.exports = ScreenZonePlaybackController;