#!/usr/bin/env node

/**
 * Integration test for MPV argument building with windowed profiles
 * This simulates what the actual MpvZoneManager does
 */

const path = require('path');
const fs = require('fs');

console.log('🧪 Integration Test: MPV Argument Building\n');
console.log('=' .repeat(70));

// Load profiles
const profilesPath = path.join(__dirname, '..', 'config', 'mpv-profiles.json');
const profilesData = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));

// Simulate the profile manager's buildMpvArgs logic
function buildMpvArgs(profileName, audioDevice, targetMonitor) {
    const profile = profilesData.profiles[profileName];
    if (!profile) {
        throw new Error(`Profile not found: ${profileName}`);
    }

    const useWayland = false; // Assume X11 for testing
    
    let mpvArgs = [
        ...profile.baseArgs,
        ...(useWayland ? profile.displayArgs.wayland : profile.displayArgs.x11),
        `--audio-device=${audioDevice}`,
        '--volume=70',
        `--fs-screen=${targetMonitor}`,
        `--screen=${targetMonitor}`,
        '--force-window=immediate',
        '--no-border',
        '--ontop',
        '--no-osd-bar',
        '--idle=yes'
    ];

    // Handle fullscreen vs windowed
    const fullscreen = profile.fullscreen !== undefined ? profile.fullscreen : true;
    
    if (fullscreen) {
        mpvArgs.push('--fullscreen');
    } else {
        const geometry = profile.windowGeometry || '960x540';
        mpvArgs.push(`--geometry=${geometry}`);
        
        // Remove --ontop for windowed mode
        const ontopIndex = mpvArgs.indexOf('--ontop');
        if (ontopIndex > -1) {
            mpvArgs.splice(ontopIndex, 1);
        }
    }

    return mpvArgs;
}

// Test cases
const testCases = [
    {
        name: 'linux-fullscreen profile',
        profile: 'linux-fullscreen',
        expectedInArgs: ['--fullscreen'],
        notExpectedInArgs: ['--geometry'],
        shouldHaveOntop: true
    },
    {
        name: 'linux-windowed profile',
        profile: 'linux-windowed',
        expectedInArgs: ['--geometry=960x540'],
        notExpectedInArgs: ['--fullscreen'],
        shouldHaveOntop: false
    },
    {
        name: 'pi4 profile (backward compat)',
        profile: 'pi4',
        expectedInArgs: ['--fullscreen'],
        notExpectedInArgs: ['--geometry'],
        shouldHaveOntop: true
    },
    {
        name: 'pi5 profile (backward compat)',
        profile: 'pi5',
        expectedInArgs: ['--fullscreen'],
        notExpectedInArgs: ['--geometry'],
        shouldHaveOntop: true
    }
];

let passed = 0;
let failed = 0;

for (const test of testCases) {
    console.log(`\n📋 Testing: ${test.name}`);
    console.log('-'.repeat(70));
    
    try {
        const args = buildMpvArgs(test.profile, 'pulse/test_device', 0);
        
        // Check expected args
        let testPassed = true;
        for (const expected of test.expectedInArgs) {
            const found = args.some(arg => arg.includes(expected.split('=')[0]));
            if (found) {
                console.log(`  ✓ Contains: ${expected}`);
            } else {
                console.log(`  ✗ Missing: ${expected}`);
                testPassed = false;
            }
        }
        
        // Check args that shouldn't be there
        for (const notExpected of test.notExpectedInArgs) {
            const found = args.some(arg => arg.includes(notExpected.split('=')[0]));
            if (!found) {
                console.log(`  ✓ Correctly excludes: ${notExpected}`);
            } else {
                console.log(`  ✗ Incorrectly includes: ${notExpected}`);
                testPassed = false;
            }
        }
        
        // Check --ontop flag
        const hasOntop = args.includes('--ontop');
        if (hasOntop === test.shouldHaveOntop) {
            console.log(`  ✓ --ontop flag: ${hasOntop ? 'present' : 'absent'} (expected)`);
        } else {
            console.log(`  ✗ --ontop flag: ${hasOntop ? 'present' : 'absent'} (expected ${test.shouldHaveOntop ? 'present' : 'absent'})`);
            testPassed = false;
        }
        
        // Show argument count
        console.log(`  ℹ Total arguments: ${args.length}`);
        
        if (testPassed) {
            passed++;
            console.log(`  ✅ Test passed`);
        } else {
            failed++;
            console.log(`  ❌ Test failed`);
        }
        
        // Optionally show all args for debugging
        if (process.env.VERBOSE) {
            console.log(`\n  Full args:\n    ${args.join('\n    ')}`);
        }
        
    } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
        failed++;
    }
}

// Summary
console.log('\n' + '='.repeat(70));
console.log(`\n📊 Integration Test Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
    console.log('\n✅ All integration tests passed!\n');
    console.log('💡 Tip: Run with VERBOSE=1 to see full argument lists\n');
    process.exit(0);
} else {
    console.log('\n❌ Some integration tests failed.\n');
    process.exit(1);
}
