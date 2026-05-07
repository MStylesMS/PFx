#!/bin/bash

# Test script for pauseBackground and resumeBackground commands
# This script tests the newly added pause/resume background music functionality

echo "=== Testing pauseBackground and resumeBackground Commands ==="
echo "This test validates that ScreenZone now supports background music pause/resume"
echo

# Function to check if ParadoxFX is running
check_pfx_running() {
    if ! pgrep -f "node pfx.js" > /dev/null; then
        echo "ERROR: ParadoxFX is not running. Please start it first with:"
        echo "  DISPLAY=:0 node pfx.js"
        exit 1
    fi
}

# Function to send MQTT command and wait
send_command() {
    local zone="$1"
    local command="$2"
    echo "Sending: $command to $zone"
    mosquitto_pub -t "paradox/$zone/commands" -m "$command"
    echo "Command sent. Press Enter to continue..."
    read
}

echo "Checking if ParadoxFX is running..."
check_pfx_running
echo "✓ ParadoxFX is running"
echo

echo "=== Testing Zone 1 (ScreenZone) ==="
echo

send_command "zone1" '{"command":"playBackground","file":"music/Classic_hip-hop_beat.mp3","loop":true,"volume":80}'

send_command "zone1" '{"command":"pauseBackground"}'

send_command "zone1" '{"command":"resumeBackground"}'

send_command "zone1" '{"command":"stopBackground"}'

echo "=== Testing Zone 2 (ScreenZone) ==="
echo

send_command "zone2" '{"command":"playBackground","file":"music/Classic_hip-hop_beat.mp3","loop":true,"volume":80}'

send_command "zone2" '{"command":"pauseBackground"}'

send_command "zone2" '{"command":"resumeBackground"}'

send_command "zone2" '{"command":"stopBackground"}'

echo "=== Test Complete ==="
echo "If the above commands executed without errors, the pauseBackground and resumeBackground"
echo "functionality has been successfully added to ScreenZone!"
