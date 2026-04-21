# ParadoxFX Documentation

This directory contains the complete documentation for ParadoxFX (Paradox Effects).

## Documentation Index

### User Documentation

- **[MQTT API Reference](MQTT_API.md)** - Complete MQTT command reference, message formats, and examples
- **[Configuration Guide](CONFIG_INI.md)** - Consolidated INI reference and configuration examples (merged from older CONFIGURATION.md / INI_REFERENCE.md)
- **Unified Volume & Ducking Model**: See the "Unified Volume & Ducking Model" section inside `CONFIG_INI.md` for precedence (volume > adjustVolume > base) and telemetry field descriptions.
- **[Pi5 Notes](Pi5-Notes.md)** - Pi5-specific deployment guidance
- **[Pi4 Notes](Pi4_Notes.md)** - Pi4-specific deployment guidance

### Technical Documentation

- **[Project Architecture](Scaffold_Summary.md)** - Technical implementation details, test results, and development status
- **[Browser Switching & Startup timing](Browser_Switching.md)** - Guidance matching runtime behavior for browser show/hide and settle times
- **[Media Format Testing](MEDIA_FORMAT_TEST_SUMMARY.md)** - Supported media formats and testing results

### Historical Documentation

- **[Original README](README-ORIGINAL.md)** - Original comprehensive README (archived)
- **[Legacy README](README-OLD.md)** - Previous version README (archived)

## Quick Links

### Getting Started

1. [Installation](../README.md#installation) - Basic setup
2. **[Pi5 Setup Guide](PI5_SETUP_GUIDE.md) - Complete Raspberry Pi 5 installation**
3. [Configuration Guide](CONFIGURATION.md) - Configure devices and MQTT
4. [MQTT API Reference](MQTT_API.md) - Send commands to devices

### Development

1. [Project Architecture](SCAFFOLD_SUMMARY.md) - Understand the codebase
2. [Running Tests](SCAFFOLD_SUMMARY.md#usage) - Test the application
3. [Media Testing](MEDIA_FORMAT_TEST_SUMMARY.md) - Test media playback

### Troubleshooting

1. [Configuration Issues](CONFIGURATION.md#troubleshooting) - Common setup problems
2. [MQTT Commands](MQTT_API.md#error-handling) - Command format and error codes
3. [Media Playback](MEDIA_FORMAT_TEST_SUMMARY.md) - Media file issues

## Documentation Maintenance

This documentation is organized to provide:

- Quick reference for users (MQTT API)
- Detailed setup guide (Configuration)
- Technical details for developers (Architecture)
- Testing information (Media Format Testing)

For updates or corrections, please ensure all documentation remains synchronized with the codebase.
