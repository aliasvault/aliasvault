#!/bin/bash
# Show iOS Simulator with visible window for debugging
# Usage: ./scripts/e2e-show-simulator.sh
#
# This script kills any existing simulator and starts a new one with a visible window.
# The simulator can then be reused by e2e-build.sh and e2e-test.sh.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(dirname "$SCRIPT_DIR")"
cd "$IOS_DIR"

echo "=== iOS Simulator - Show Window ==="

# Kill any existing simulators
echo "Shutting down existing simulators..."
xcrun simctl shutdown all 2>/dev/null || true
sleep 2

# Find the best available simulator (prefer iPhone Pro models)
echo "Finding available simulators..."
SIMULATOR_ID=$(xcrun simctl list devices available | grep -E "iPhone [0-9]+ Pro" | sort -t' ' -k2 -rn | head -1 | grep -oE '[A-F0-9-]{36}')

if [ -z "$SIMULATOR_ID" ]; then
    # Fallback to any iPhone
    SIMULATOR_ID=$(xcrun simctl list devices available | grep "iPhone" | head -1 | grep -oE '[A-F0-9-]{36}')
fi

if [ -z "$SIMULATOR_ID" ]; then
    echo "ERROR: No iPhone simulators found!"
    echo "Available devices:"
    xcrun simctl list devices available
    exit 1
fi

SIMULATOR_NAME=$(xcrun simctl list devices available | grep "$SIMULATOR_ID" | sed 's/(.*//' | xargs)
echo "Using simulator: $SIMULATOR_NAME ($SIMULATOR_ID)"

# Boot the simulator
echo "Booting simulator..."
xcrun simctl boot "$SIMULATOR_ID" 2>/dev/null || true

# Open Simulator.app to show the window
echo "Opening Simulator.app..."
open -a Simulator

# Wait for simulator to be ready
echo "Waiting for simulator to be ready..."
xcrun simctl bootstatus "$SIMULATOR_ID" -b

echo ""
echo "=== Simulator Ready ==="
echo "Simulator ID: $SIMULATOR_ID"
echo "Simulator Name: $SIMULATOR_NAME"
echo ""
echo "The simulator window should now be visible."
echo "Run e2e-build.sh and e2e-test.sh to run tests on this simulator."
