#!/bin/bash
# Full iOS E2E test run - starts services, builds, and runs tests
# Usage: ./scripts/e2e-run.sh [--clean-simulator] [--show-simulator]
#
# This script handles everything needed for E2E testing:
# 1. Optionally resets the simulator to clean state
# 2. Starts API server (if not running)
# 3. Starts Metro bundler (if not running)
# 4. Builds the iOS app
# 5. Runs E2E tests
# 6. Cleans up services
#
# Options:
#   --clean-simulator   Erase all simulator content and settings before testing
#   --show-simulator    Open Simulator.app to show the simulator UI
#
# Prerequisites:
# - Development database running (./install.sh configure-dev-db start)
# - CocoaPods installed (pod install already run)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(dirname "$SCRIPT_DIR")"
MOBILE_APP_DIR="$(dirname "$IOS_DIR")"
PROJECT_ROOT="$(dirname "$(dirname "$MOBILE_APP_DIR")")"

# Parse arguments
CLEAN_SIMULATOR=0
SHOW_SIMULATOR="${SHOW_SIMULATOR:-0}"
BUILD_ARGS=""

for arg in "$@"; do
    case $arg in
        --clean-simulator)
            CLEAN_SIMULATOR=1
            ;;
        --show-simulator)
            SHOW_SIMULATOR=1
            BUILD_ARGS="$BUILD_ARGS --show-simulator"
            ;;
    esac
done

cd "$IOS_DIR"

echo "=== iOS E2E Full Run ==="
echo "Project root: $PROJECT_ROOT"

# Track what we started so we can clean up
STARTED_API=false
STARTED_METRO=false

cleanup() {
    echo ""
    echo "=== Cleaning up ==="

    if [ "$STARTED_API" = true ]; then
        echo "Stopping API server..."
        pkill -9 -f "dotnet.*AliasVault.Api" 2>/dev/null || true
        pkill -9 -f "AliasVault.Api" 2>/dev/null || true
    fi

    if [ "$STARTED_METRO" = true ]; then
        echo "Stopping Metro bundler..."
        pkill -9 -f "expo start" 2>/dev/null || true
        pkill -9 -f "metro" 2>/dev/null || true
        pkill -9 -f "@expo/metro-runtime" 2>/dev/null || true
        pkill -9 -f "node.*8081" 2>/dev/null || true
    fi

    rm -f /tmp/api-server.pid /tmp/metro.pid
    echo "Cleanup complete"
}

trap cleanup EXIT

# Check if API server is running
echo ""
echo "=== Checking API server ==="
if curl -s http://localhost:5092/v1/ > /dev/null 2>&1; then
    echo "API server already running"
else
    echo "Starting API server..."
    cd "$PROJECT_ROOT/apps/server/AliasVault.Api"

    # Build if needed
    if [ ! -d "bin" ]; then
        echo "Building API server..."
        dotnet build
    fi

    # Start API server
    export ConnectionStrings__AliasServerDbContext="Host=localhost;Port=5433;Database=aliasdb;Username=aliasvault;Password=password"
    export JWT_KEY="12345678901234567890123456789012"
    export DATA_PROTECTION_CERT_PASS="Development"
    export PUBLIC_REGISTRATION_ENABLED="true"
    export ADMIN_PASSWORD_HASH="AQAAAAIAAYagAAAAEKWfKfa2gh9Z72vjAlnNP1xlME7FsunRznzyrfqFte40FToufRwa3kX8wwDwnEXZag=="
    export ADMIN_PASSWORD_GENERATED="2024-01-01T00:00:00Z"
    export ASPNETCORE_URLS="http://0.0.0.0:5092"

    dotnet run --no-build > /tmp/api-server.log 2>&1 &
    echo $! > /tmp/api-server.pid
    STARTED_API=true

    # Wait for API
    echo "Waiting for API to start..."
    for i in {1..30}; do
        if curl -s http://localhost:5092/v1/ > /dev/null 2>&1; then
            echo "✅ API is ready!"
            break
        fi
        if [ $i -eq 30 ]; then
            echo "ERROR: API failed to start"
            cat /tmp/api-server.log
            exit 1
        fi
        sleep 2
    done
fi

# Check if Metro is running
echo ""
echo "=== Checking Metro bundler ==="
if curl -s http://localhost:8081/status 2>/dev/null | grep -q "packager-status:running"; then
    echo "Metro bundler already running"
else
    echo "Starting Metro bundler..."
    cd "$MOBILE_APP_DIR"

    npx expo start --offline > /tmp/metro.log 2>&1 &
    echo $! > /tmp/metro.pid
    STARTED_METRO=true

    # Wait for Metro
    echo "Waiting for Metro bundler to start..."
    for i in {1..30}; do
        if curl -s http://localhost:8081/status 2>/dev/null | grep -q "packager-status:running"; then
            echo "✅ Metro bundler is ready!"
            break
        fi
        if [ $i -eq 30 ]; then
            echo "ERROR: Metro bundler failed to start"
            cat /tmp/metro.log
            exit 1
        fi
        sleep 2
    done
fi

# Build and test
cd "$IOS_DIR"

# Clean simulator if requested
if [ "$CLEAN_SIMULATOR" = "1" ]; then
    echo ""
    echo "=== Resetting Simulator ==="

    # Find simulator ID first (same logic as e2e-build.sh)
    SIMULATOR_ID=$(xcrun simctl list devices available | grep -E "iPhone [0-9]+ Pro" | sort -t' ' -k2 -rn | head -1 | grep -oE '[A-F0-9-]{36}')

    if [ -n "$SIMULATOR_ID" ]; then
        echo "Shutting down simulator..."
        xcrun simctl shutdown "$SIMULATOR_ID" 2>/dev/null || true

        echo "Erasing simulator content and settings..."
        xcrun simctl erase "$SIMULATOR_ID"

        echo "✅ Simulator reset complete"
    else
        echo "WARNING: No simulator found to reset"
    fi
fi

echo ""
"$SCRIPT_DIR/e2e-build.sh" $BUILD_ARGS

echo ""
"$SCRIPT_DIR/e2e-test.sh" "$SIMULATOR_ID"

echo ""
echo "=== E2E Run Complete ==="
