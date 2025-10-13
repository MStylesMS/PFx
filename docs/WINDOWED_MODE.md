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

Run the validation test:
```bash
node test/test-windowed-profiles.js
```

This validates:
- New profiles exist and are configured correctly
- All profiles have the fullscreen property
- Window geometry is set for windowed profiles
- Base arguments are properly defined

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
