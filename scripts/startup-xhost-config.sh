#!/bin/bash
# startup-xhost-config.sh
#
# This script ensures that the X11 display server allows the 'paradox' user (including SSH sessions)
# to open windows on the Pi's HDMI outputs. This is required for running ParadoxFX (PFX) remotely
# via SSH, such as when using VS Code Remote SSH or manual SSH sessions.
#
# Why is this needed?
# - By default, X11 only allows the user who started the desktop session to open windows.
# - When you SSH in and set DISPLAY=:0, you still need X11 permissions to open windows on the Pi's display.
# - This script uses 'xhost' to grant access to the 'paradox' user for the current X session.
#
# Usage:
# 1. Log in to the Pi's desktop as 'paradox' (the user running the X session).
# 2. Run this script ON THE PI DESKTOP (not over SSH):
#      ./scripts/startup-xhost-config.sh
# 3. Now, from your laptop, SSH into the Pi as 'paradox' and set DISPLAY=:0 before running PFX:
#      export DISPLAY=:0
#      node pfx.js
#
# You can also add this script to your autostart or desktop session if you want it to run automatically.

# Allow localuser 'paradox' to access the X server
xhost +SI:localuser:paradox

echo "X11 access granted to user 'paradox'. You can now run PFX remotely via SSH with DISPLAY=:0."
