# ParadoxFX Pi4 Configuration Update - Answers and Status

## Configuration Changes Completed

### 1. File Naming
✅ **COMPLETED**: Removed `.example` extension from configuration files
- File renamed: `pfx-pi4.ini.example` → `pfx-pi4.ini`
- Documentation updated to reflect new naming convention

### 2. MQTT Configuration Updates
✅ **COMPLETED**: Applied user-requested changes to Pi4 configuration:
- **Username/Password**: Commented out with explanation (not needed for unsecured brokers)
- **Media Base Path**: Updated to `/opt/paradox/media` 
- **Heartbeat Interval**: Set to 10 seconds (10000ms)
- **Heartbeat Topic**: Changed to `paradox/status/heartbeat`
- **Image Player**: Changed to `mpv` for consistent single-player control
- **Ducking Volume**: Reduced to 30% as requested

### 3. Fallback Player Support
✅ **COMPLETED**: Removed fallback player support entirely
- Only MPV is now supported across all media types
- Removed `fallback_video_player` and `fallback_image_player` settings
- Updated documentation to reflect MPV-only approach

## Technical Clarifications

### 4. Volume Calculation Formula
✅ **ANSWERED**: Volume calculations work exactly as you described:

**Formula**: `effective_volume = main_volume × specific_volume × ducking_factor`

**Example with your values**:
- Main volume: 80%
- Background music volume: 60% 
- Ducking volume: 30%
- **Result**: 80% × 60% × (100% - 30%) = 80% × 60% × 70% = **33.6%**

When background music is set to 60% and main volume is 80%, the background music plays at **48%** of maximum volume (80% × 60% = 48%) when NOT ducked.

### 5. Volume Range Specification
✅ **CLARIFIED**: All volume settings now documented with 0-150% range
- **0%**: Muted
- **100%**: MPV default volume
- **150%**: Maximum boost (may cause distortion)
- Range matches MPV's volume capabilities
- Updated all volume comments in configuration file

### 6. Media Path Resolution
✅ **DOCUMENTED**: Media paths work exactly as you specified:

Given `media_base_path = /opt/paradox/media`:

| Configuration Value | Resolved Path | Explanation |
|---------------------|---------------|-------------|
| `zone1` or `./zone1` | `/opt/paradox/media/zone1` | Relative path |
| `""` (empty/missing) | `/opt/paradox/media` | Uses base path |
| `/zone3` | `/zone3` | Absolute path (ignores base) |

**Implementation**: Based on `lib/media/players/base-player.js` line 103:
```javascript
_getMediaPath(mediaPath) {
    // If absolute path, use as-is
    if (mediaPath.startsWith('/')) {
        return mediaPath;
    }
    // Otherwise, prepend media directory
    return path.join(this.config.mediaDir, mediaPath);
}
```

### 7. Device Enabled Settings
✅ **IMPLEMENTED**: Added `enabled` setting for all screen and audio devices:
- `[screen:zone1-hdmi0]`: `enabled = true`
- `[screen:zone2-hdmi1]`: `enabled = true`  
- `[audio:headphones]`: `enabled = false` (disabled by default)

### 8. HDMI0 vs HDMI1 Settings Parity
✅ **VERIFIED**: Both HDMI screens now support identical settings:
- Both have: `enabled`, `video_volume`, `background_music_volume`, `ducking_volume`, `effects_volume`, `speech_volume`
- Both have: `display`, `target_monitor`, `monitor_geometry`, `player_type`, `video_queue_max`, `audio_queue_max`
- Only difference: Zone-specific audio device identifiers and default volumes

## Implementation Status Report

### 9. Automatic Recovery Implementation Status

**Device Recovery Status** (Current implementation):

| Device Type | Auto Recovery | Error Reporting | Graceful Shutdown |
|-------------|---------------|-----------------|-------------------|
| **Screen Devices** | ❌ No | ✅ Yes | ✅ Yes |
| **Light Devices** | ❌ No | ✅ Yes | ✅ Yes |
| **Light Groups** | ❌ No | ✅ Yes | ⚠️ Partial |
| **Relay Devices** | ❌ No | ✅ Yes | ⚠️ Partial |
| **Controllers** | ❌ No | ⚠️ Basic | ⚠️ Basic |

**What IS Implemented**:
- ✅ Error detection and MQTT reporting
- ✅ Heartbeat monitoring with error propagation
- ✅ Graceful device initialization/shutdown
- ✅ Basic process cleanup for media players

**What is PLANNED (not implemented)**:
- ❌ Automatic restart on device failure
- ❌ Watchdog monitoring
- ❌ Network healing for Z-Wave/Zigbee
- ❌ Device auto-discovery and re-initialization

### 10. Configuration Platform Strategy

**Current Approach**: **Multiple Platform-Specific Files**

**Rationale**:
1. **Hardware Differences**: Each platform has different device identifiers, capabilities, and optimization needs
2. **Clarity**: Platform-specific files are easier to understand and deploy
3. **Maintenance**: Simpler to update platform-specific optimizations
4. **User Experience**: Copy the right file and customize rather than navigate complex conditionals

**File Strategy**:
```
pfx-pi3.ini     → Single HDMI, lower performance settings
pfx-pi4.ini     → Dual HDMI, balanced performance  
pfx-pi5.ini     → Dual HDMI, enhanced performance, updated device IDs
pfx-pi0w.ini    → Mini HDMI, minimal resource usage
pfx-linux.ini   → Generic Linux, auto-detection where possible
```

**Alternative Considered**: Single file with platform sections was considered but rejected because:
- Device identifiers vary significantly between platforms
- Performance settings need platform-specific tuning
- Audio subsystems differ (ALSA vs PulseAudio vs PipeWire)
- Hardware capabilities vary dramatically (Pi0W vs Pi5)

## Next Steps

1. **Create Remaining Templates**: Generate `pfx-pi3.ini`, `pfx-pi5.ini`, `pfx-pi0w.ini`, and `pfx-linux.ini`
2. **Update Documentation**: Finalize functional specification and README files
3. **Test Consolidation**: Return to comprehensive testing as originally planned
4. **Commit Changes**: Stage and commit all configuration updates

## Summary

All requested changes have been implemented in the Pi4 configuration file. The system now:
- Uses MPV exclusively
- Has proper volume documentation and calculations  
- Supports enabled/disabled devices
- Has comprehensive media path resolution
- Documents what recovery features are implemented vs planned
- Uses a clear platform-specific configuration strategy

The configuration is ready for testing and deployment.
