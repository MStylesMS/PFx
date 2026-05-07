#!/usr/bin/env node
/**
 * Quick MQTT Command Demo
 * 
 * Shows all device commands without interactive mode
 */

const ConfigLoader = require('../../lib/core/config-loader');

async function showCommands() {
    console.log('🎮 ParadoxFX MQTT Command Examples\n');

    try {
        const config = await ConfigLoader.load('pfx-test.ini');

        for (const [deviceName, deviceConfig] of Object.entries(config.devices)) {
            console.log(`\n🔧 Device: ${deviceName} (${deviceConfig.type})`);
            console.log(`📡 Command Topic: ${deviceConfig.baseTopic}/commands`);
            console.log('='.repeat(60));

            switch (deviceConfig.type) {
                case 'screen':
                    showScreenCommands();
                    break;
                case 'light':
                    showLightCommands();
                    break;
                case 'light_group':
                    showLightGroupCommands();
                    break;
                case 'relay':
                    showRelayCommands();
                    break;
            }
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

function showScreenCommands() {
    const examples = [
        {
            name: 'setImage (minimal)',
            json: { command: 'setImage', file: 'test-image.jpg' }
        },
        {
            name: 'playVideo (with options)',
            json: { command: 'playVideo', file: 'videos/intro.mp4', volumeAdjust: -10, channel: 'default' }
        },
        {
            name: 'playAudio (minimal)',
            json: { command: 'playAudio', file: 'background.mp3' }
        },
        {
            name: 'playAudioFX (loop)',
            json: { command: 'playAudioFX', file: 'effects/ambient.wav', type: 'loop', volumeAdjust: -30 }
        },
        {
            name: 'transition',
            json: { command: 'transition', video: 'intro.mp4', image: 'final.jpg' }
        }
    ];

    examples.forEach(ex => {
        console.log(`\n📝 ${ex.name}:`);
        console.log(`   ${JSON.stringify(ex.json, null, 2)}`);
    });
}

function showLightCommands() {
    const examples = [
        {
            name: 'on (with brightness)',
            json: { command: 'on', brightness: 80 }
        },
        {
            name: 'setColor (RGB)',
            json: { command: 'setColor', color: { r: 255, g: 100, b: 0 }, brightness: 90 }
        }
    ];

    examples.forEach(ex => {
        console.log(`\n📝 ${ex.name}:`);
        console.log(`   ${JSON.stringify(ex.json, null, 2)}`);
    });
}

function showLightGroupCommands() {
    const examples = [
        {
            name: 'setGroupColor',
            json: { command: 'setGroupColor', color: { r: 255, g: 100, b: 0 }, brightness: 80, lights: ['light1', 'light2'] }
        }
    ];

    examples.forEach(ex => {
        console.log(`\n📝 ${ex.name}:`);
        console.log(`   ${JSON.stringify(ex.json, null, 2)}`);
    });
}

function showRelayCommands() {
    const examples = [
        {
            name: 'pulse (with duration)',
            json: { Command: 'pulse', Duration: 5000 }
        }
    ];

    examples.forEach(ex => {
        console.log(`\n📝 ${ex.name}:`);
        console.log(`   ${JSON.stringify(ex.json, null, 2)}`);
    });
}

if (require.main === module) {
    showCommands().catch(console.error);
}
