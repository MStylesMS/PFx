#!/usr/bin/env node
/**
 * Manual MQTT harness for the getState command.
 *
 * This is intentionally not a Jest unit test. Run it directly against a live PFx
 * instance when you want to verify retained state publication end-to-end.
 */

const mqtt = require('mqtt');

async function testGetStateCommand() {
    return new Promise((resolve, reject) => {
        const client = mqtt.connect('mqtt://localhost');
        let statusReceived = false;
        let testTimeout;

        client.on('connect', () => {
            console.log('Connected to MQTT broker');

            client.subscribe('paradox/houdini/mirror/state', (err) => {
                if (err) {
                    reject(new Error(`Failed to subscribe: ${err.message}`));
                    return;
                }

                console.log('Subscribed to state topic');

                const command = { command: 'getState' };
                client.publish('paradox/houdini/mirror/commands', JSON.stringify(command), (publishError) => {
                    if (publishError) {
                        reject(new Error(`Failed to publish command: ${publishError.message}`));
                        return;
                    }

                    console.log('Sent getState command');

                    testTimeout = setTimeout(() => {
                        if (!statusReceived) {
                            reject(new Error('Timeout: no state message received within 5 seconds'));
                        }
                    }, 5000);
                });
            });
        });

        client.on('message', (topic, message) => {
            if (topic === 'paradox/houdini/mirror/state') {
                statusReceived = true;
                clearTimeout(testTimeout);

                try {
                    const state = JSON.parse(message.toString());
                    console.log('State message received');
                    console.log('State data:', {
                        zone: state.zone || 'unknown',
                        status: state.current_state?.status || 'unknown',
                        lastCommand: state.current_state?.lastCommand || 'unknown'
                    });

                    if (state.current_state && typeof state.current_state === 'object') {
                        resolve();
                    } else {
                        reject(new Error('State message missing current_state field'));
                    }
                } catch (parseError) {
                    reject(new Error(`Failed to parse state message: ${parseError.message}`));
                }

                client.end();
            }
        });

        client.on('error', (err) => {
            clearTimeout(testTimeout);
            reject(new Error(`MQTT error: ${err.message}`));
        });
    });
}

if (require.main === module) {
    console.log('Testing getState command implementation...');
    console.log('===============================================');

    testGetStateCommand()
        .then(() => {
            console.log('===============================================');
            console.log('getState command test passed');
            process.exit(0);
        })
        .catch((error) => {
            console.log('===============================================');
            console.error('getState command test failed:', error.message);
            process.exit(1);
        });
}

module.exports = { testGetStateCommand };