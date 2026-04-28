# Reverting Video Queue Logic in `screen-zone.js`

## 1. Problem Summary

The video queuing mechanism in `screen-zone.js` is failing. When multiple `playVideo` commands are sent sequentially, the second command does not wait for the first to complete.

The root cause is a race condition related to MPV's `end-file` event. When a new video is loaded via `mpvZoneManager.loadMedia()`, MPV first stops any currently playing media (e.g., the default image), which emits an initial `end-file` event. The queue processing logic incorrectly interprets this as the end of the *newly started* video, causing it to proceed to the next item in the queue prematurely.

## 2. Attempted Solutions & Failures

Several attempts were made to fix this by managing state around the `end-file` event.

### Attempt 1: Simple State Flag (`isAwaitingMediaEnd`)

- **Logic**: Before playing a video, set `this.isAwaitingMediaEnd = true`. The `_handleMediaEnd()` event handler would only proceed if this flag was true. A `Promise` (`mediaEndPromise`) was used to block the queue processor until the event handler resolved it.
- **Failure**: This did not solve the race condition. The premature `end-file` event was still being processed because the flag was set *before* the event occurred. The queue continued to terminate early.

### Attempt 2: Delayed State Flag

- **Logic**: The logic was refined to only set `isAwaitingMediaEnd = true` *after* the `_playVideo()` command was initiated, inside a `.then()` block. The goal was to let the premature `end-file` event fire *before* we started listening for the "real" one.
- **Failure**: This approach also failed. The timing of the events proved unpredictable. Logs showed that the `mediaEndPromise` was still being resolved almost instantly, indicating that the premature event was still being captured after the flag was set.

## 3. Side-Issue Discovered and Fixed

- **Problem**: During testing, it was discovered that terminating the application with `CNTL-C` while a video queue was active would cause the process to hang indefinitely.
- **Cause**: The `_processVideoQueue` loop was stuck awaiting the `mediaEndPromise`, which would never be resolved upon shutdown.
- **Solution**: The `shutdown()` method was modified to check for a pending `resolveMediaEnd` function and call it, forcefully unblocking the queue and allowing the application to terminate cleanly. **This fix is successful and should be preserved.**

## 4. Conclusion and Next Steps

The current approach of trying to patch the event handling logic with flags has proven to be unreliable due to the persistent race condition.

To move forward, the decision has been made to:
1.  **Document these findings** (this file).
2.  **Revert `lib/zones/screen-zone.js`** to its state from the `main` branch to provide a clean slate.
3.  **Re-implement the queuing logic** with a more robust approach, potentially involving a different strategy for managing MPV events or the player lifecycle.
