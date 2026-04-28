# PR Implementation Plan: MPV/Chromium Window Switching (Option 6)

## Overview

This document outlines the detailed implementation plan for integrating the proven Option 6 window switching approach (xdotool windowactivate) into the ParadoxFX production system. Based on successful testing, this will enable seamless transitions between MPV video content and Chromium browser content (e.g., clock displays) on screen zones.

## Architecture Integration

### Current State Analysis

**Existing Screen Zone Architecture:**
- `ScreenZone` class handles MPV media playback via `MpvZoneManager`
- MQTT command handling through `ZoneManager` 
- Status publishing via `BaseZone.publishStatus()`
- Window management currently limited to MPV instances

**MQTT API Gap:**
- Browser/Clock commands documented but not implemented
- No window focus tracking in zone state
- No browser process management in screen zones

### Proposed Integration Strategy

**Phase 1: Core Browser Management**
- Add browser process management to `ScreenZone` class
- Implement window detection and switching functions
- Add browser lifecycle commands (enable/disable/show/hide)

*** REMOVED - Consolidated into MPV-Chrome-Switch-Notes.md ***

This PR-level implementation plan was merged into `MPV-Chrome-Switch-Notes.md`.

Please consult `docs/MPV-Chrome-Switch-Notes.md` for the authoritative guidance and implementation details.

Backup of the original content is saved as `PR_MPV_CHROMIUM.md.orig_full` in this directory.

