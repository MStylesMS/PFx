#!/usr/bin/env node
/**
 * Manual MQTT command smoke harness.
 *
 * This script publishes a batch of commands to a live PFx instance. It is not a
 * unit test and intentionally lives outside test/unit.
 */

const mqtt = require('mqtt');
const assert = require('assert');

const testCommands = [
    { command: 'playVideo', video: 'test.mp4', volume: 0.8 },
    { command: 'setImage', image: 'test.png' },
    { command: 'transition', image: 'test.png', video: 'test.mp4' },
    { command: 'playAudio', file: 'test.mp3', volume: 1.0 },
    { command: 'playAudioFX', file: 'test.mp3', type: 'one-shot', volume: 0.5 },
    { command: 'clearQueue' },
    { command: 'pauseVideo' },
    { command: 'resumeVideo' },
    { command: 'skipVideo' },
    { command: 'pauseAll' },
    { command: 'resumeAll' },
    { command: 'stopAll' }
];

const client = mqtt.connect('mqtt://localhost');

client.on('connect', () => {
    console.log('Connected to MQTT broker');

    testCommands.forEach((command) => {
        const topic = 'paradox/test/commands';
        client.publish(topic, JSON.stringify(command), (err) => {
            assert.strictEqual(err, undefined, `Failed to publish command: ${command.command}`);
            console.log(`Published command: ${command.command}`);
        });
    });

    client.end();
});

client.on('error', (err) => {
    console.error('MQTT error:', err);
});