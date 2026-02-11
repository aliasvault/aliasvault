#!/bin/bash
# Build Android app for E2E testing
# Usage: ./scripts/e2e-build.sh
#
# This script builds the Android app for testing on an emulator.
# If no emulator is running, it will start a headless one.
#
# To run with a visible emulator window for debugging:
#   1. First run: ./scripts/e2e-show-emulator.sh
#   2. Then run: ./scripts/e2e-build.sh (reuses the visible emulator)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ANDROID_DIR"

# Ensure Android SDK tools are in PATH
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"

echo "=== Android E2E Build ==="

# Check if adb is available
if ! command -v adb &> /dev/null; then
    echo "ERROR: adb not found. Please install Android SDK platform-tools."
    exit 1
fi

# Check if an emulator is already running (could be visible from e2e-show-emulator.sh)
EMULATOR_ID=$(adb devices 2>/dev/null | grep "emulator" | head -1 | awk '{print $1}')

if [ -n "$EMULATOR_ID" ]; then
    echo "Found running emulator: $EMULATOR_ID (reusing)"
else
    echo "No running emulator found, starting headless emulator..."
    echo "(For visible emulator, run ./scripts/e2e-show-emulator.sh first)"

    # Find an AVD to use
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

    echo "Using AVD: $AVD_NAME"

    # Start emulator in headless mode
    # Use -gpu auto to pick best available GPU mode (host if available, otherwise swiftshader)
    # -no-snapshot for clean state each run
    # Note: -gpu host requires display, -gpu swiftshader_indirect is slow but works headless
    # On macOS with Metal, -gpu auto should use hardware acceleration even headless
    "$ANDROID_HOME/emulator/emulator" -avd "$AVD_NAME" -no-window -no-audio -no-boot-anim -no-snapshot -gpu auto &

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

# Show Gradle cache status
if [ -n "$GRADLE_USER_HOME" ]; then
    echo "Using GRADLE_USER_HOME: $GRADLE_USER_HOME"
    if [ -d "$GRADLE_USER_HOME/caches" ]; then
        CACHE_SIZE=$(du -sh "$GRADLE_USER_HOME/caches" 2>/dev/null | cut -f1 || echo "unknown")
        echo "Gradle cache size: $CACHE_SIZE"
    fi
fi

# Build with caching enabled (--build-cache uses local and remote caches if configured)
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest --build-cache

echo ""
echo "=== Installing APKs ==="
adb -s "$EMULATOR_ID" install -r app/build/outputs/apk/debug/app-debug.apk
adb -s "$EMULATOR_ID" install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk

echo ""
echo "Build complete!"
echo "EMULATOR_ID=$EMULATOR_ID"
echo ""
echo "To run tests: ./scripts/e2e-test.sh"
