# Speech Socket End-of-File Detection Issue

## 1. Overview

This document outlines the investigation into a regression where the ParadoxFX `AudioManager` fails to detect the end of a speech file, causing the playback queue to hang. This issue is present in recent commits on the `main` branch, but not in older, known-working versions.

## 2. The Problem

When a speech file is requested via MQTT, the `AudioManager` successfully plays the first file. However, it never detects that the file has finished playing. As a result:
- The background music volume is never restored from its "ducked" state.
- Subsequent files in the speech queue are never processed.
- The `_processSpeechQueue` function eventually times out, logging an error.

In the working version, the log shows a "Speech playback completed" message shortly after the audio file's duration has passed, confirming successful completion detection. In the broken version, this message never appears, and the system hangs until a timeout error is thrown.

## 3. Core Findings

The root cause is **not** a change in the completion detection logic itself. The function responsible for listening to the MPV socket, `_monitorProperty`, is identical in both the working and broken versions.

The key finding is that the working version successfully receives an `eof-reached` event from the persistent MPV process over its IPC socket. The broken version does not receive this event, causing the `await` on `_monitorProperty` to time out.

This strongly suggests the problem lies in the **configuration and launch arguments of the MPV process itself**. A change in how the speech MPV instance is spawned is likely preventing it from emitting the `eof-reached` event as expected.

## 4. Relevant Code Snippets

The following functions from `lib/media/audio-manager.js` are central to this issue.

### `_initializeSpeech()` - MPV Process Creation (Most Likely Cause)

This function spawns the persistent MPV process for speech. Any difference in the `args` array between the working and broken versions is the most probable source of the regression.

```javascript
// From the working version
async _initializeSpeech() {
    this.logger.info('Initializing speech system...');

    const args = [
        '--idle=yes',
        `--input-ipc-server=${this.speechSocket}`,
        '--no-terminal',
        '--no-video',
        `--volume=${this.speechVolume}`,
        '--keep-open=yes',
        '--cache=yes',
        '--msg-level=all=info'
    ];

    // Add audio device if specified
    if (this.audioDevice !== 'auto') {
        args.push(`--audio-device=${this.audioDevice}`);
    }

    const speechProcess = spawn('mpv', args, { detached: false });

    speechProcess.on('error', (error) => {
        this.logger.error('Speech process error:', error);
    });

    speechProcess.on('exit', (code, signal) => {
        this.logger.warn(`Speech process exited with code ${code}, signal ${signal}`);
    });

    // Wait for socket to be ready
    await this._waitForSocket(this.speechSocket);
    this.logger.info('Speech system ready');
}
```

### `_processSpeechQueue()` - The Playback Logic

This function orchestrates the playback, including the call to monitor for completion.

```javascript
// From the working version
async _processSpeechQueue() {
    if (this.isProcessingSpeech || this.speechQueue.length === 0) {
        return;
    }

    this.isProcessingSpeech = true;

    while (this.speechQueue.length > 0) {
        const speechItem = this.speechQueue.shift();

        try {
            this.logger.info(`Playing speech: ${speechItem.filePath}`);
            await this.setBackgroundMusicVolume(this.duckingVolume);

            await this._sendMpvCommand(this.speechSocket, {
                command: ['loadfile', speechItem.filePath, 'replace']
            });

            await this._sendMpvCommand(this.speechSocket, {
                command: ['set_property', 'volume', speechItem.volume]
            });

            // This is where the system waits for the completion signal
            await this._monitorProperty(this.speechSocket, 'eof-reached', true);

            await this.setBackgroundMusicVolume(this.backgroundMusicVolume);
            this.logger.info('Speech playback completed');

        } catch (error) {
            // ... error handling
        }
    }
    this.isProcessingSpeech = false;
}
```

### `_monitorProperty()` - The Socket Listener

This function connects to the IPC socket and listens for the specific `property-change` event from MPV. Its logic is sound and has not changed between versions.

```javascript
// From the working version
_monitorProperty(socketPath, property, targetValue) {
    return new Promise((resolve, reject) => {
        const client = net.createConnection(socketPath, () => {
            const observeCmd = JSON.stringify({ command: ['observe_property', 1, property] }) + '\n';
            client.write(observeCmd);
        });

        let buffer = '';
        const timeout = setTimeout(() => {
            client.destroy();
            reject(new Error(`Property monitoring timed out for ${property}`));
        }, 30000);

        client.on('data', (chunk) => {
            buffer += chunk.toString();
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.substring(0, newlineIndex);
                buffer = buffer.substring(newlineIndex + 1);

                if (line.trim() === '') continue;

                try {
                    const responseJson = JSON.parse(line);
                    if (responseJson.event === 'property-change' &&
                        responseJson.name === property &&
                        responseJson.data === targetValue) {

                        clearTimeout(timeout);
                        client.end();
                        resolve();
                        return;
                    }
                } catch (parseError) {
                    // Ignore
                }
            }
        });
        // ... error and close handlers
    });
}
```
