#!/usr/bin/env node

/**
 * Test script to verify windowed mode profile functionality
 */

const path = require('path');
const fs = require('fs');

// Load the profile manager
const profilesPath = path.join(__dirname, '..', 'config', 'mpv-profiles.json');
const profilesData = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));

console.log('🧪 Testing MPV Profile System\n');
console.log('=' .repeat(60));

// Test 1: Verify new profiles exist
console.log('\n📋 Test 1: New profiles exist');
const requiredProfiles = ['linux-fullscreen', 'linux-windowed'];
let passed = 0;
let failed = 0;

for (const profileName of requiredProfiles) {
    if (profilesData.profiles[profileName]) {
        console.log(`  ✓ ${profileName} profile exists`);
        passed++;
    } else {
        console.log(`  ✗ ${profileName} profile missing`);
        failed++;
    }
}

// Test 2: Verify fullscreen property
console.log('\n📋 Test 2: Fullscreen property configuration');
const testCases = [
    { profile: 'linux-fullscreen', expected: true },
    { profile: 'linux-windowed', expected: false },
    { profile: 'pi4', expected: true },
    { profile: 'pi5', expected: true }
];

for (const test of testCases) {
    const profile = profilesData.profiles[test.profile];
    if (profile) {
        const actual = profile.fullscreen;
        if (actual === test.expected) {
            console.log(`  ✓ ${test.profile}: fullscreen=${actual} (expected ${test.expected})`);
            passed++;
        } else {
            console.log(`  ✗ ${test.profile}: fullscreen=${actual} (expected ${test.expected})`);
            failed++;
        }
    } else {
        console.log(`  ✗ ${test.profile}: profile not found`);
        failed++;
    }
}

// Test 3: Verify windowGeometry for windowed profile
console.log('\n📋 Test 3: Window geometry configuration');
const windowedProfile = profilesData.profiles['linux-windowed'];
if (windowedProfile && windowedProfile.windowGeometry) {
    console.log(`  ✓ linux-windowed has windowGeometry: ${windowedProfile.windowGeometry}`);
    passed++;
} else {
    console.log(`  ✗ linux-windowed missing windowGeometry`);
    failed++;
}

// Test 4: All existing profiles have fullscreen property
console.log('\n📋 Test 4: All profiles have fullscreen property');
const allProfiles = Object.keys(profilesData.profiles);
for (const profileName of allProfiles) {
    const profile = profilesData.profiles[profileName];
    if (profile.fullscreen !== undefined) {
        console.log(`  ✓ ${profileName} has fullscreen property`);
        passed++;
    } else {
        console.log(`  ⚠ ${profileName} missing fullscreen property (will default to true)`);
        // Not counted as failure since we have a default
    }
}

// Test 5: Verify baseArgs are present
console.log('\n📋 Test 5: Profile baseArgs validation');
for (const profileName of requiredProfiles) {
    const profile = profilesData.profiles[profileName];
    if (profile && Array.isArray(profile.baseArgs) && profile.baseArgs.length > 0) {
        console.log(`  ✓ ${profileName} has valid baseArgs (${profile.baseArgs.length} args)`);
        passed++;
    } else {
        console.log(`  ✗ ${profileName} missing or invalid baseArgs`);
        failed++;
    }
}

// Summary
console.log('\n' + '='.repeat(60));
console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
    console.log('\n✅ All tests passed! Profiles are correctly configured.\n');
    process.exit(0);
} else {
    console.log('\n❌ Some tests failed. Please check the configuration.\n');
    process.exit(1);
}
