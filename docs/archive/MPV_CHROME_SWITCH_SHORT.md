# MPV / Chromium Z-order switching — Option 6 (xdotool windowactivate) and Option 3 (wmctrl -i -a)

## Purpose
Document how Option 6 (xdotool windowactivate) behaved during testing, and how Option 3 (wmctrl -i -a) behaved. Record backups and notes about failed attempts and restore operations.

## Environment
- Raspberry Pi OS Bookworm, X11/Openbox
- MPV used with IPC and borderless geometry on secondary display
- Chromium launched in app mode on the same display
- Tools: wmctrl, xdotool

## Option 6 — xdotool windowactivate
- Command used to show a window: `xdotool windowactivate <winId>`
- Behavior observed: This performed a focus+raise operation and successfully brought the target window to the front during the test cycles.
- Result: WORKING — behaved similarly to `wmctrl -i -a` (both focus and raise are required)

## Option 3 — wmctrl activate/raise
- Command used to show a window: `wmctrl -i -a <winId>`
- Behavior observed: Reliable. Both MPV and Chromium were raised and became visible when activated.
- Result: WORKING — this was the first working approach used and is still a reliable fallback.

## Other attempts
- Option 1 / Option 2: Using `wmctrl -b add,above` and `-b add,below` states — unreliable; windows did not consistently restack.
- Option 4: `xdotool windowraise` — failed; browser never became visible.
- Option 5: `wmctrl` restack / geometry tweaks — failed as implemented; browser never became visible.

````markdown
# MPV / Chromium Z-order switching — Consolidated

This short note has been consolidated into `MPV-Chrome-Switch-Notes.md`.

Please consult `docs/MPV-Chrome-Switch-Notes.md` for the authoritative, up-to-date guidance and implementation sketches.

````
## Next steps
