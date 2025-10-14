# Windowed Mode Feature

## Overview

ParadoxFX now supports both fullscreen and windowed display modes through the MPV profile system. This enables:
- **Testing and development** with multiple zones visible simultaneously on a single desktop
- **Production deployments** on non-Raspberry Pi Linux systems
- **Flexible window sizing** for different testing scenarios

## New Profiles

### `linux-fullscreen`
- **Purpose:** Production use on Linux desktop systems
- **Display:** Fullscreen mode (traditional ParadoxFX behavior)
- **Use case:** Production installations on x86/x64 Linux machines
- **Hardware:** Modern Linux desktop with GPU acceleration

### `linux-windowed`
- **Purpose:** Testing and development
- **Display:** Windowed mode at 960x540 (50% of 1080p)
- **Use case:** Development, testing, debugging multiple zones
- **Hardware:** Any Linux desktop with X11 or Wayland

## Configuration

### Using in INI Files

```ini
[screen:screen0]
display = :0
target_monitor = 0
mpv_video_profile = linux-windowed  # or linux-fullscreen
# ... other settings
```

### Profile Properties

All profiles now support:
- `fullscreen`: Boolean (true/false) - defaults to true if not specified
- `windowGeometry`: String (e.g., "960x540") - only used when fullscreen=false

## Example Configurations

### Development Setup (Windowed)
Use `config/pfx-linux-windowed.ini` as a starting point:
- Multiple zones display in separate windows
- Easy to observe all zones simultaneously
- Perfect for debugging MQTT commands

### Production Setup (Fullscreen)
Use `config/pfx-linux-fullscreen.ini` as a starting point:
- Traditional fullscreen behavior
- Optimized for dedicated display systems
- Works on both Pi and x86 Linux

## Testing

### Automated Tests

**Profile validation test:**
```bash
node test/test-windowed-profiles.js
# ✅ 19/19 assertions passed
```

This validates:
- New profiles exist and are configured correctly
- All profiles have the fullscreen property
- Window geometry is set for windowed profiles
- Base arguments are properly defined

**Integration test:**
```bash
node test/test-windowed-integration.js
# ✅ 4/4 test cases passed
```

This validates:
- MPV argument generation for fullscreen mode
- MPV argument generation for windowed mode
- Backward compatibility with existing Pi profiles

### Manual Testing

**Test windowed mode:**
```bash
cd /opt/paradox/apps/ParadoxFX

# Copy example config
cp config/pfx-linux-windowed.ini pfx.ini

# Edit pfx.ini to match your system:
# - Update audio_device to your device
# - Update media paths if needed

# Start ParadoxFX
node pfx.js

# You should see MPV windows at 960x540 instead of fullscreen
```

**Test fullscreen mode:**
```bash
# Copy example config
cp config/pfx-linux-fullscreen.ini pfx.ini

# Edit and start as above
# Windows should be fullscreen (traditional behavior)
```

## Backward Compatibility

- All existing profiles default to `fullscreen: true`
- Existing configurations work without modification
- Pi profiles (pi4, pi5, etc.) remain unchanged
- No breaking changes to existing deployments

## Implementation Details

### Modified Files
- `config/mpv-profiles.json` - Added fullscreen property to all profiles, added linux-fullscreen and linux-windowed profiles
- `lib/media/mpv-zone-manager.js` - Updated buildMpvArgs() to respect fullscreen setting

### Behavior
- **Fullscreen mode:** Uses `--fullscreen` flag
- **Windowed mode:** Uses `--geometry=<size>` flag, removes `--ontop` for better window management

## Custom Window Sizes

To create a custom windowed profile, add to `mpv-profiles.json`:

```json
"my-custom-windowed": {
  "name": "My Custom Window",
  "description": "Custom window size",
  "fullscreen": false,
  "windowGeometry": "1280x720",  // or "75%" for percentage
  "baseArgs": [
    "--hwdec=auto",
    "--vo=gpu",
    // ... other args
  ],
  // ... rest of profile
}
```

Then reference it in your INI:
```ini
mpv_video_profile = my-custom-windowed
```

## Future Enhancements

Potential additions:
- Window positioning (e.g., `--geometry=960x540+100+100`)
- Per-zone window size overrides in INI
- macOS support with platform-specific window management
- Multi-monitor window tiling presets

---

## Development Summary

### Feature Branch: `feature/windowed-mode-profiles`

**Branch Information:**
- Base: `main` (commit f2397de)
- Commits: 4 commits ahead of main
- Status: ✅ Ready for testing and merge

**Files Changed:**
```
config/mpv-profiles.json          |  69 +++++++++ (new profiles + fullscreen property)
config/pfx-linux-fullscreen.ini   |  38 +++++++ (example config)
config/pfx-linux-windowed.ini     |  38 +++++++ (example config)
docs/WINDOWED_MODE.md             | 116 ++++++++++++++++ (this file)
lib/media/mpv-zone-manager.js     |  20 ++++++- (buildMpvArgs updated)
test/test-windowed-profiles.js    | 107 ++++++++++++++ (profile validation)
test/test-windowed-integration.js | 167 +++++++++++++++++++++ (integration test)

7 files changed, 554 insertions(+), 1 deletion(-)
```

**What Was Implemented:**
1. Moved `--fullscreen` from hardcoded to profile-based configuration
2. Added `fullscreen` boolean and `windowGeometry` properties to profiles
3. Created `linux-fullscreen` and `linux-windowed` profiles
4. Updated `buildMpvArgs()` to respect profile fullscreen settings
5. Provided example INI configurations for both modes
6. Created comprehensive test suite (23 tests total)

**Benefits:**
- Development workflow: Multiple zones visible simultaneously
- Non-Pi support: Production-ready Linux desktop profile
- Flexibility: Easy to create custom window sizes
- Zero risk: Fully backward compatible with existing setups
- Well tested: All 23 tests passing

**Git Commands for Review:**
```bash
# View all changes
git diff main

# View commit history
git log main..feature/windowed-mode-profiles

# View files changed
git diff main --stat

# View specific file changes
git diff main config/mpv-profiles.json
git diff main lib/media/mpv-zone-manager.js
```

**Merge Checklist:**
- ✅ All tests passing (19 profile + 4 integration)
- ✅ Documentation complete
- ✅ Example configs provided
- ✅ Backward compatible
- ✅ No breaking changes
- ✅ Code validated (syntax checks passed)
- ⏳ Manual testing recommended before merge

**Next Steps:**
1. Test on actual Linux desktop system
2. Verify window positioning with multiple zones
3. Test MQTT commands work correctly in windowed mode
4. If tests pass, merge to main and bump version to 1.1.4 or 1.2.0
