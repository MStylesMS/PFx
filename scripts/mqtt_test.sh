#!/bin/bash

# ParadoxFX Zone 2 MQTT Test Script
# =================================
# Tests all basic commands for Zone 2 (HDMI1) with user feedback

echo "Time to test Zone 2 (HDMI1)!"
echo "============================"
echo ""

# Initialize test results
declare -A test_results
test_count=0

# Function to run a test
run_test() {
    local test_name="$1"
    local command="$2"
    local file="$3"
    local mqtt_command="$4"
    
    test_count=$((test_count + 1))
    
    echo "[$test_count/5] Testing: $test_name"
    echo "File: $file"
    echo "Command: $mqtt_command"
    echo ""
    
    # Send MQTT command
    echo "Sending MQTT command..."
    mosquitto_pub -t "paradox/zone2/commands" -m "$mqtt_command"
    echo "Command sent!"
    echo ""
    
    # Get user feedback
    while true; do
        echo -n "Did the $test_name test work? (yes/no/kinda): "
        read -r response
        case $response in
            yes|y|YES|Y)
                test_results["$test_name"]="✅ PASS"
                echo "Great! Marking as PASS"
                break
                ;;
            no|n|NO|N)
                test_results["$test_name"]="❌ FAIL"
                echo "Sorry it didn't work. Marking as FAIL"
                break
                ;;
            kinda|k|KINDA|K)
                test_results["$test_name"]="⚠️ PARTIAL"
                echo "Partially working. Marking as PARTIAL"
                break
                ;;
            *)
                echo "Please enter 'yes', 'no', or 'kinda'"
                ;;
        esac
    done
    
    echo ""
    echo "-------------------------------------------"
    echo ""
}

# Test 1: Image Display
run_test "Image Display" \
         "setImage" \
         "defaults/default.png" \
         '{"command":"setImage","image":"defaults/default.png"}'

# Test 2: Video Playback
run_test "Video Playback" \
         "playVideo" \
         "defaults/default.mp4" \
         '{"command":"playVideo","video":"defaults/default.mp4"}'

# Test 3: Background Music
run_test "Background Music" \
         "playBackgroundMusic" \
         "music/Funky_Jazz_Saxophone.mp3" \
         '{"command":"playBackgroundMusic","audio":"music/Funky_Jazz_Saxophone.mp3","volume":70}'

# Test 4: Sound Effects
run_test "Sound Effects" \
         "playSoundEffect" \
         "fx/Lasergun.mp3" \
         '{"command":"playSoundEffect","audio":"fx/Lasergun.mp3","volume":100}'

# Test 5: Speech
run_test "Speech" \
         "playSpeech" \
         "general/PFX_Vocal_Queuing.mp3" \
         '{"command":"playSpeech","audio":"general/PFX_Vocal_Queuing.mp3","volume":90}'

# Print Summary
echo "=========================================="
echo "           ZONE 2 TEST SUMMARY"
echo "=========================================="
echo ""

pass_count=0
fail_count=0
partial_count=0

for test in "Image Display" "Video Playback" "Background Music" "Sound Effects" "Speech"; do
    result="${test_results[$test]}"
    printf "%-20s %s\n" "$test:" "$result"
    
    case $result in
        *"PASS"*) pass_count=$((pass_count + 1)) ;;
        *"FAIL"*) fail_count=$((fail_count + 1)) ;;
        *"PARTIAL"*) partial_count=$((partial_count + 1)) ;;
    esac
done

echo ""
echo "=========================================="
echo "RESULTS: $pass_count PASS | $fail_count FAIL | $partial_count PARTIAL"
echo "=========================================="

# Overall assessment
if [ $pass_count -eq 5 ]; then
    echo "🎉 Excellent! All Zone 2 functions are working perfectly!"
elif [ $fail_count -eq 0 ]; then
    echo "👍 Good! Zone 2 is mostly functional with some minor issues."
elif [ $pass_count -gt $fail_count ]; then
    echo "⚠️  Zone 2 has mixed results. Some functions need attention."
else
    echo "🔧 Zone 2 needs significant work. Most functions are not working."
fi

echo ""
echo "Test completed at $(date)"
echo "Ready for next testing phase!"
