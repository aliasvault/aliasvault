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

# Stop emulator
echo "Stopping Android emulator..."
adb emu kill 2>/dev/null || true

# Clean up PID and log files
rm -f /tmp/api-server.pid /tmp/metro.pid /tmp/android-emulator.pid
rm -f /tmp/api-server.log /tmp/metro.log

echo "Cleanup complete"
