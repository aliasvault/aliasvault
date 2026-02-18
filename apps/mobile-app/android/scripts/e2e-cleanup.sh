#!/bin/bash
# Clean up Android E2E test environment
# Usage: ./scripts/e2e-cleanup.sh

# Ensure Android SDK tools are in PATH
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"

echo "=== Android E2E Cleanup ==="

# Kill API server
echo "Stopping API server..."
pkill -9 -f "dotnet.*AliasVault.Api" 2>/dev/null || true
pkill -9 -f "AliasVault.Api" 2>/dev/null || true

# Kill Metro bundler and related node processes
echo "Stopping Metro bundler..."
pkill -9 -f "expo start" 2>/dev/null || true
pkill -9 -f "metro" 2>/dev/null || true
pkill -9 -f "@expo/metro-runtime" 2>/dev/null || true
pkill -9 -f "node.*8081" 2>/dev/null || true

# Stop emulator only if it was started by e2e-build.sh (headless mode)
# This preserves manually started visible emulators from e2e-show-emulator.sh
if [ -f /tmp/android-emulator.pid ]; then
    EMULATOR_PID=$(cat /tmp/android-emulator.pid)
    echo "Stopping headless Android emulator (PID: $EMULATOR_PID)..."
    kill -9 "$EMULATOR_PID" 2>/dev/null || true
    adb emu kill 2>/dev/null || true
else
    echo "Skipping emulator shutdown (no headless emulator PID found - preserving visible emulator)"
fi

# Clean up PID and log files
rm -f /tmp/api-server.pid /tmp/metro.pid /tmp/android-emulator.pid
rm -f /tmp/api-server.log /tmp/metro.log

echo "Cleanup complete"
