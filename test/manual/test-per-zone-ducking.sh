#!/bin/bash

# Manual test script for per-zone ducking functionality
# Demonstrates the new ducking parameter in MQTT commands

MQTT_HOST=${MQTT_HOST:-"localhost"}
MQTT_PORT=${MQTT_PORT:-"1883"}
BASE_TOPIC=${BASE_TOPIC:-"paradox/living-room/screen"}

echo "🎵 Testing Per-Zone Ducking Enhancement"
echo "========================================"
echo "MQTT Host: $MQTT_HOST:$MQTT_PORT"
echo "Topic: $BASE_TOPIC/commands"
echo ""

# Test 1: Speech with default ducking (50%)
echo "🔊 Test 1: Speech with default ducking (50%)"
mosquitto_pub -h $MQTT_HOST -p $MQTT_PORT -t "$BASE_TOPIC/commands" \
  -m '{"command": "playSpeech", "file": "general/hello.mp3"}'
echo "Command sent: playSpeech without ducking parameter (uses default 50%)"
echo ""

sleep 3

# Test 2: Speech with custom ducking (70%)
echo "🔊 Test 2: Speech with custom ducking (70%)"
mosquitto_pub -h $MQTT_HOST -p $MQTT_PORT -t "$BASE_TOPIC/commands" \
  -m '{"command": "playSpeech", "file": "general/hello.mp3", "ducking": 70}'
echo "Command sent: playSpeech with 70% ducking"
echo ""

sleep 3

# Test 3: Speech with no ducking (0%)
echo "🔊 Test 3: Speech with no ducking (0%)"
mosquitto_pub -h $MQTT_HOST -p $MQTT_PORT -t "$BASE_TOPIC/commands" \
  -m '{"command": "playSpeech", "file": "general/hello.mp3", "ducking": 0}'
echo "Command sent: playSpeech with 0% ducking (no background reduction)"
echo ""

sleep 3

# Test 4: Video with default ducking (30%)
echo "🎬 Test 4: Video with default ducking (30%)"
mosquitto_pub -h $MQTT_HOST -p $MQTT_PORT -t "$BASE_TOPIC/commands" \
  -m '{"command": "playVideo", "file": "intro.mp4"}'
echo "Command sent: playVideo without ducking parameter (uses default 30%)"
echo ""

sleep 5

# Test 5: Video with custom ducking (60%)
echo "🎬 Test 5: Video with custom ducking (60%)"
mosquitto_pub -h $MQTT_HOST -p $MQTT_PORT -t "$BASE_TOPIC/commands" \
  -m '{"command": "playVideo", "file": "intro.mp4", "ducking": 60}'
echo "Command sent: playVideo with 60% ducking"
echo ""

sleep 5

# Test 6: Video with no ducking (0%)
echo "🎬 Test 6: Video with no ducking (0%)"
mosquitto_pub -h $MQTT_HOST -p $MQTT_PORT -t "$BASE_TOPIC/commands" \
  -m '{"command": "playVideo", "file": "intro.mp4", "ducking": 0}'
echo "Command sent: playVideo with 0% ducking"
echo ""

sleep 5

# Test 7: Overlapping speech requests (simulate)
echo "🔀 Test 7: Overlapping speech requests"
echo "Sending rapid speech commands to test overlapping ducking..."

mosquitto_pub -h $MQTT_HOST -p $MQTT_PORT -t "$BASE_TOPIC/commands" \
  -m '{"command": "playSpeech", "file": "general/hello.mp3", "ducking": 30}' &

sleep 1

mosquitto_pub -h $MQTT_HOST -p $MQTT_PORT -t "$BASE_TOPIC/commands" \
  -m '{"command": "playSpeech", "file": "general/goodbye.mp3", "ducking": 70}' &

sleep 1

mosquitto_pub -h $MQTT_HOST -p $MQTT_PORT -t "$BASE_TOPIC/commands" \
  -m '{"command": "playSpeech", "file": "general/thanks.mp3", "ducking": 20}' &

echo "Sent overlapping speech commands with ducking levels: 30%, 70%, 20%"
echo "System should use maximum ducking level (70%) while any speech is active"
echo ""

wait
sleep 3

# Test 8: Stop all to clean up
echo "🛑 Test 8: Stop all media"
mosquitto_pub -h $MQTT_HOST -p $MQTT_PORT -t "$BASE_TOPIC/commands" \
  -m '{"command": "stopAll"}'
echo "Command sent: stopAll (should restore original background volume)"
echo ""

echo "✅ Manual testing complete!"
echo ""
echo "📝 Expected behavior:"
echo "- Speech commands should duck background music by specified percentage"
echo "- Video commands should duck background music (default 30% or custom)"
echo "- Multiple overlapping duckers should use maximum ducking level"
echo "- Background volume should restore when all duckers are removed"
echo "- Each zone should handle ducking independently"
echo ""
echo "📊 Monitor the ParadoxFX logs to see ducking debug messages:"
echo "- 'Applying ducking: [ID] at level [X]%'"
echo "- 'Ducking background to [volume] ([X]% reduction from [original])'"
echo "- 'Removing ducking: [ID]'"
echo "- 'Restoring background volume to [original]'"