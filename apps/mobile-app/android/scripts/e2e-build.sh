#!/bin/bash
# Build Android app for E2E testing
# Usage: ./scripts/e2e-build.sh [--show-emulator] [--avd AVD_NAME]
#
# This script builds the Android app for testing on an emulator.
# If no emulator is running, it will start one.
#
# Options:
#   --show-emulator     Show the emulator window (useful for debugging)
#   SHOW_EMULATOR=1     Environment variable alternative to --show-emulator
#   --avd AVD_NAME      Specify the AVD name to use (default: auto-detect)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ANDROID_DIR"

# Ensure Android SDK tools are in PATH
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"

# Parse arguments
SHOW_EMULATOR="${SHOW_EMULATOR:-0}"
AVD_NAME=""

for arg in "$@"; do
    case $arg in
        --show-emulator)
            SHOW_EMULATOR=1
            ;;
        --avd)
            shift
            AVD_NAME="$1"
            ;;
        --avd=*)
            AVD_NAME="${arg#*=}"
            ;;
    esac
    shift 2>/dev/null || true
done

echo "=== Android E2E Build ==="

# Check if adb is available
if ! command -v adb &> /dev/null; then
    echo "ERROR: adb not found. Please install Android SDK platform-tools."
    exit 1
fi

# Check if an emulator is already running
EMULATOR_ID=$(adb devices 2>/dev/null | grep "emulator" | head -1 | awk '{print $1}')

if [ -n "$EMULATOR_ID" ]; then
    echo "Found running emulator: $EMULATOR_ID"
else
    echo "No running emulator found, starting one..."

    # Find an AVD to use
    if [ -z "$AVD_NAME" ]; then
        # Try to find a suitable AVD
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

    # Start emulator
    if [ "$SHOW_EMULATOR" = "1" ]; then
        echo "Starting emulator with visible window..."
        # Use -gpu host for better performance on macOS with visible window
        # Don't use -no-audio or -no-boot-anim to ensure window appears properly
        "$ANDROID_HOME/emulator/emulator" -avd "$AVD_NAME" -gpu host &
    else
        echo "Starting emulator in headless mode..."
        "$ANDROID_HOME/emulator/emulator" -avd "$AVD_NAME" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect &
    fi

    EMULATOR_PID=$!
    echo $EMULATOR_PID > /tmp/android-emulator.pid

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
fi

# Set up port forwarding for API server and Metro bundler
echo "Setting up port forwarding..."
adb -s "$EMULATOR_ID" reverse tcp:5092 tcp:5092
adb -s "$EMULATOR_ID" reverse tcp:8081 tcp:8081

echo "Emulator ready: $EMULATOR_ID"

# Build the app
echo ""
echo "=== Building Android app for testing ==="
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest

echo ""
echo "=== Installing APKs ==="
adb -s "$EMULATOR_ID" install -r app/build/outputs/apk/debug/app-debug.apk
adb -s "$EMULATOR_ID" install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk

echo ""
echo "Build complete!"
echo "EMULATOR_ID=$EMULATOR_ID"
echo ""
echo "To run tests: ./scripts/e2e-test.sh"
