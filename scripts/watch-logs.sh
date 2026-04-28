#!/bin/bash

# PFX Log Monitor Script
# Monitors the latest PFX log file for real-time debugging

LOG_DIR="/opt/paradox/logs"
LATEST_LOG="$LOG_DIR/pfx-latest.log"

echo "PFX Log Monitor - Watching for log files..."
echo "Log directory: $LOG_DIR"
echo "Latest log link: $LATEST_LOG"
echo "=========================================="

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Function to tail the latest log
tail_latest() {
    if [ -f "$LATEST_LOG" ]; then
        echo "Following log file: $(readlink -f "$LATEST_LOG")"
        echo "----------------------------------------"
        tail -f "$LATEST_LOG"
    else
        echo "No latest log file found. Waiting for PFX to start..."
        # Wait for the latest log to be created
        while [ ! -f "$LATEST_LOG" ]; do
            sleep 1
        done
        echo "Log file created: $(readlink -f "$LATEST_LOG")"
        echo "----------------------------------------"
        tail -f "$LATEST_LOG"
    fi
}

# Check if any arguments passed
if [ "$1" = "list" ]; then
    echo "Available log files:"
    ls -la "$LOG_DIR"/pfx-*.log 2>/dev/null || echo "No log files found"
elif [ "$1" = "latest" ]; then
    if [ -f "$LATEST_LOG" ]; then
        echo "Latest log file: $(readlink -f "$LATEST_LOG")"
        cat "$LATEST_LOG"
    else
        echo "No latest log file found"
    fi
else
    # Default: tail the latest log
    tail_latest
fi
