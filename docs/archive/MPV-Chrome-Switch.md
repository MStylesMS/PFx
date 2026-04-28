# Z-Order Window Stacking Test Results

Testing different approaches for switching between MPV and Chromium browser windows without geometry changes.

## Test Environment
- **OS**: Raspberry Pi OS Bookworm with X11/Openbox
- **Setup**: MPV and Chromium both positioned fullscreen on secondary display (HDMI-2)
- **Goal**: Only change Z-order (which window is on top), never move/resize/fullscreen toggle

## Test Results

### ❌ Option 1: MPV-only manipulation
**Approach**: Only manipulate MPV window states, leave browser alone
- **Show browser**: `removeWinState(mpvWin, 'above')` + `addWinState(mpvWin, 'below')`
- **Show MPV**: `removeWinState(mpvWin, 'below')` + `addWinState(mpvWin, 'above')`
- **Result**: FAILED - Script completed but transitions didn't work visually
````markdown
# MPV ↔ Chromium Window Switching (CONSOLIDATED)

This file has been superseded by `MPV-Chrome-Switch-Notes.md` in this directory. Please read that consolidated, up-to-date document which includes the test results, implementation guidance, and production-ready algorithms.

See: `docs/MPV-Chrome-Switch-Notes.md`

*** REMOVED - Consolidated into MPV-Chrome-Switch-Notes.md ***

The content previously in this file was merged into `MPV-Chrome-Switch-Notes.md`.

Please consult `docs/MPV-Chrome-Switch-Notes.md` for the authoritative, up-to-date guidance.

Backup of the original content is saved as `MPV-Chrome-Switch.md.orig_full` in this directory.
