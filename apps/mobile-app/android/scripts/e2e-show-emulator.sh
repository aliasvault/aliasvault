#!/bin/bash
# Show Android Emulator with visible window for debugging
# Usage: ./scripts/e2e-show-emulator.sh [--avd AVD_NAME]
#
# This script kills any existing emulator and starts a new one with a visible window.
# The emulator can then be reused by e2e-build.sh and e2e-test.sh.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ANDROID_DIR"

# Ensure Android SDK tools are in PATH
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"

# Parse arguments
AVD_NAME=""
for arg in "$@"; do
    case $arg in
        --avd=*)
            AVD_NAME="${arg#*=}"
            ;;
        --avd)
            shift
            AVD_NAME="$1"
            ;;
    esac
    shift 2>/dev/null || true
done

echo "=== Android Emulator - Show Window ==="

# Kill any existing emulators
EXISTING_EMULATOR=$(adb devices 2>/dev/null | grep "emulator" | head -1 | awk '{print $1}')
if [ -n "$EXISTING_EMULATOR" ]; then
    echo "Killing existing emulator: $EXISTING_EMULATOR"
    adb emu kill 2>/dev/null || true
    sleep 3
fi

# Find an AVD to use
if [ -z "$AVD_NAME" ]; then
    echo "Finding available AVDs..."
    AVAILABLE_AVDS=$(emulator -list-avds 2>/dev/null || true)

    if [ -z "$AVAILABLE_AVDS" ]; then
        echo "ERROR: No AVDs found. Please create an AVD using Android Studio."
        echo "Recommended: Create a Pixel device with API 34+"
        exit 1
    fi

    # Prefer Pixel_Pro_API_36 if available (matches CI), otherwise use first available
    if echo "$AVAILABLE_AVDS" | grep -q "Pixel_Pro_API_36"; then
        AVD_NAME="Pixel_Pro_API_36"
    else
        AVD_NAME=$(echo "$AVAILABLE_AVDS" | head -1)
    fi
fi

echo "Using AVD: $AVD_NAME"

# Start emulator with visible window
echo "Starting emulator with visible window..."
"$ANDROID_HOME/emulator/emulator" -avd "$AVD_NAME" -gpu host &

EMULATOR_PID=$!
echo "Emulator PID: $EMULATOR_PID"

# Wait for emulator to be ready
echo "Waiting for emulator to boot..."
adb wait-for-device

# Wait for boot to complete
for i in {1..90}; do
    if adb shell getprop sys.boot_completed 2>/dev/null | grep -q "1"; then
        echo "Emulator booted successfully!"
        break
    fi
    if [ $i -eq 90 ]; then
        echo "ERROR: Emulator failed to boot within 3 minutes"
        exit 1
    fi
    echo "Waiting for boot... attempt $i"
    sleep 2
done

EMULATOR_ID=$(adb devices | grep "emulator" | head -1 | awk '{print $1}')

# Unlock screen
adb -s "$EMULATOR_ID" shell input keyevent 82

# Set up port forwarding
echo "Setting up port forwarding..."
adb -s "$EMULATOR_ID" reverse tcp:5092 tcp:5092
adb -s "$EMULATOR_ID" reverse tcp:8081 tcp:8081

echo ""
echo "=== Emulator Ready ==="
echo "Emulator ID: $EMULATOR_ID"
echo "AVD Name: $AVD_NAME"
echo ""
echo "The emulator window should now be visible."
echo "Run e2e-build.sh and e2e-test.sh to run tests on this emulator."
