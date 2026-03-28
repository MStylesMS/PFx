/**
 * Media Player Factory
 * 
 * Creates MPV Zone Managers for unified media playback.
 * Replaces multiple media players with single MPV instance per zone.
 */

const path = require('path');
const MpvZoneManager = require('./mpv-zone-manager');
const Logger = require('../utils/logger');

class MediaPlayerFactory {
    constructor(config, processManager = null) {
        this.config = config || {};
        // processManager is deprecated and no longer used
        if (processManager) {
            this.logger = new Logger('MediaPlayerFactory');
            this.logger.warn('ProcessManager parameter is deprecated and will be ignored');
        }
        this.logger = new Logger('MediaPlayerFactory');

        // Track zone managers
        this.zoneManagers = new Map();
    }

    /**
     * Create or get MPV Zone Manager for a zone
     * @param {Object} zoneConfig - Zone configuration
     * @returns {MpvZoneManager} - Zone manager instance
     */
    async createZoneManager(zoneConfig) {
        const zoneName = zoneConfig.name;

        if (this.zoneManagers.has(zoneName)) {
            return this.zoneManagers.get(zoneName);
        }

        this.logger.info(`Creating MPV Zone Manager for zone: ${zoneName}`);

        // Debug logging for targetMonitor
        this.logger.debug(`🔍 zoneConfig.targetMonitor = ${zoneConfig.targetMonitor} (type: ${typeof zoneConfig.targetMonitor})`);

        // Resolve mediaDir: if absolute use as-is, otherwise join default base '/opt/paradox/media'
        const deviceMediaDir = zoneConfig.mediaDir || zoneConfig.media_dir || '';
        const resolvedMediaDir = path.isAbsolute(String(deviceMediaDir || ''))
            ? String(deviceMediaDir)
            : path.join('/opt/paradox/media', deviceMediaDir);

        const zoneManager = new MpvZoneManager({
            name: zoneName,
            mediaDir: resolvedMediaDir,
            audioDevice: zoneConfig.audioDevice,
            display: zoneConfig.display || ':0',
            targetMonitor: zoneConfig.targetMonitor || 0,
            videoQueueMax: zoneConfig.videoQueueMax || 5,
            mpvVideoOptions: zoneConfig.mpvVideoOptions,
            mpvVideoProfile: zoneConfig.mpvVideoProfile,
            maxVolume: zoneConfig.maxVolume || zoneConfig.max_volume
        });

        await zoneManager.initialize();
        this.zoneManagers.set(zoneName, zoneManager);

        return zoneManager;
    }

    /**
     * Get existing zone manager
     * @param {string} zoneName - Zone name
     * @returns {MpvZoneManager|null} - Zone manager or null if not found
     */
    getZoneManager(zoneName) {
        return this.zoneManagers.get(zoneName) || null;
    }

    /**
     * Create a legacy player object for a media file (for backward compatibility)
     * @param {string} filePath - Path to the media file
     * @returns {Object} - Legacy player object with command and args properties
     */
    createPlayer(filePath) {
        const mediaType = this.getMediaType(filePath);

        // Return a legacy-compatible player object for testing
        // This mimics the old player interface for the tests
        return {
            command: 'mpv',
            args: [
                '--no-terminal',
                '--fullscreen',
                '--no-osd-bar',
                filePath
            ],
            mediaType: mediaType,
            play: async () => {
                // Legacy compatibility - no-op for tests
                this.logger.debug(`Legacy play called for ${filePath}`);
            },
            stop: async () => {
                // Legacy compatibility - no-op for tests  
                this.logger.debug(`Legacy stop called for ${filePath}`);
            }
        };
    }

    /**
     * Check if a file is a supported media type
     * @param {string} filePath - Path to the media file
     * @returns {string} - Media type: 'image', 'video', 'audio', or 'unknown'
     */
    getMediaType(filePath) {
        const ext = path.extname(filePath).toLowerCase();

        if (this.isImageFile(ext)) {
            return 'image';
        } else if (this.isVideoFile(ext)) {
            return 'video';
        } else if (this.isAudioFile(ext)) {
            return 'audio';
        } else {
            return 'unknown';
        }
    }

    isImageFile(ext) {
        const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'];
        return imageExts.includes(ext);
    }

    isVideoFile(ext) {
        const videoExts = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'];
        return videoExts.includes(ext);
    }

    isAudioFile(ext) {
        const audioExts = ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.opus', '.m4a', '.wma'];
        return audioExts.includes(ext);
    }

    /**
     * Shutdown all zone managers
     */
    async shutdown() {
        this.logger.info('Shutting down all zone managers...');

        for (const [zoneName, zoneManager] of this.zoneManagers) {
            try {
                await zoneManager.shutdown();
                this.logger.debug(`Zone manager ${zoneName} shut down`);
            } catch (error) {
                this.logger.error(`Error shutting down zone manager ${zoneName}:`, error);
            }
        }

        this.zoneManagers.clear();
        this.logger.info('All zone managers shut down');
    }

    // Legacy static methods for backward compatibility (deprecated)
    static createImagePlayer(config) {
        const logger = new Logger('MediaPlayerFactory');
        logger.warn('Legacy createImagePlayer called - use createZoneManager instead');

        // Return a basic player object for compatibility
        return {
            play: (mediaPath) => logger.info(`Legacy image player: ${mediaPath}`),
            stop: () => logger.info('Legacy image player stopped')
        };
    }

    static createVideoPlayer(config) {
        const logger = new Logger('MediaPlayerFactory');
        logger.warn('Legacy createVideoPlayer called - use createZoneManager instead');

        // Return a basic player object for compatibility
        return {
            play: (mediaPath) => logger.info(`Legacy video player: ${mediaPath}`),
            stop: () => logger.info('Legacy video player stopped')
        };
    }

    static createAudioPlayer(config) {
        const logger = new Logger('MediaPlayerFactory');
        logger.warn('Legacy createAudioPlayer called - use createZoneManager instead');

        // Return a basic player object for compatibility
        return {
            play: (mediaPath) => logger.info(`Legacy audio player: ${mediaPath}`),
            stop: () => logger.info('Legacy audio player stopped')
        };
    }

    static createAudioFxPlayer(config) {
        const logger = new Logger('MediaPlayerFactory');
        logger.warn('Legacy createAudioFxPlayer called - use createZoneManager instead');

        // Return a basic player object for compatibility
        return {
            play: (mediaPath) => logger.info(`Legacy audio FX player: ${mediaPath}`),
            stop: () => logger.info('Legacy audio FX player stopped')
        };
    }

    static getAvailablePlayers() {
        // Only MPV is supported now
        return {
            image: ['mpv'],
            video: ['mpv'],
            audio: ['mpv']
        };
    }
}

module.exports = MediaPlayerFactory;

module.exports = MediaPlayerFactory;
