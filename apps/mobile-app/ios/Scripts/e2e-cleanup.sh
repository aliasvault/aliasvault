#!/bin/bash
# Clean up iOS E2E test environment
# Usage: ./scripts/e2e-cleanup.sh

echo "=== iOS E2E Cleanup ==="

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

# Shutdown simulators
echo "Shutting down simulators..."
xcrun simctl shutdown all 2>/dev/null || true

# Clean up PID and log files
rm -f /tmp/api-server.pid /tmp/metro.pid
rm -f /tmp/api-server.log /tmp/metro.log

echo "✅ Cleanup complete"
