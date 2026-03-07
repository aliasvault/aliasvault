#!/bin/bash
# Full Android E2E test run - starts services, builds, and runs tests
# Usage: ./scripts/e2e-run.sh [--clean-emulator] [--show-emulator] [--avd AVD_NAME]
#
# This script handles everything needed for E2E testing:
# 1. Optionally resets the emulator to clean state
# 2. Starts API server (if not running)
# 3. Starts Metro bundler (if not running)
# 4. Builds the Android app
# 5. Runs E2E tests
# 6. Cleans up services
#
# Options:
#   --clean-emulator    Wipe emulator data before testing
#   --show-emulator     Show the emulator window (useful for debugging)
#   --avd AVD_NAME      Specify the AVD name to use
#
# Prerequisites:
# - Development database running (./install.sh configure-dev-db start)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$(dirname "$SCRIPT_DIR")"
MOBILE_APP_DIR="$(dirname "$ANDROID_DIR")"
PROJECT_ROOT="$(dirname "$(dirname "$MOBILE_APP_DIR")")"

# Ensure Android SDK tools are in PATH
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"

# Parse arguments
CLEAN_EMULATOR=0
SHOW_EMULATOR="${SHOW_EMULATOR:-0}"
BUILD_ARGS=""
AVD_NAME=""

for arg in "$@"; do
    case $arg in
        --clean-emulator)
            CLEAN_EMULATOR=1
            ;;
        --show-emulator)
            SHOW_EMULATOR=1
            BUILD_ARGS="$BUILD_ARGS --show-emulator"
            ;;
        --avd)
            # Next arg will be the AVD name, handled by shift below
            ;;
        --avd=*)
            AVD_NAME="${arg#*=}"
            BUILD_ARGS="$BUILD_ARGS --avd=$AVD_NAME"
            ;;
        *)
            if [ "$PREV_ARG" = "--avd" ]; then
                AVD_NAME="$arg"
                BUILD_ARGS="$BUILD_ARGS --avd=$AVD_NAME"
            fi
            ;;
    esac
    PREV_ARG="$arg"
done

cd "$ANDROID_DIR"

echo "=== Android E2E Full Run ==="
echo "Project root: $PROJECT_ROOT"

# Track what we started so we can clean up
STARTED_API=false
STARTED_METRO=false
STARTED_EMULATOR=false

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
            echo "API is ready!"
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
            echo "Metro bundler is ready!"
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
cd "$ANDROID_DIR"

# Clean emulator if requested
if [ "$CLEAN_EMULATOR" = "1" ]; then
    echo ""
    echo "=== Resetting Emulator ==="

    # Find AVD name
    if [ -z "$AVD_NAME" ]; then
        AVAILABLE_AVDS=$(emulator -list-avds 2>/dev/null || true)
        if echo "$AVAILABLE_AVDS" | grep -q "Pixel_Pro_API_36"; then
            AVD_NAME="Pixel_Pro_API_36"
        else
            AVD_NAME=$(echo "$AVAILABLE_AVDS" | head -1)
        fi
    fi

    if [ -n "$AVD_NAME" ]; then
        echo "Stopping any running emulator..."
        adb emu kill 2>/dev/null || true
        sleep 2

        echo "Wiping emulator data for $AVD_NAME..."
        emulator -avd "$AVD_NAME" -wipe-data -no-window -no-audio -no-boot-anim &
        EMULATOR_PID=$!

        # Wait for emulator to start wiping
        sleep 5

        # Kill the emulator after wipe starts
        kill $EMULATOR_PID 2>/dev/null || true

        echo "Emulator data wiped"
    else
        echo "WARNING: No AVD found to reset"
    fi
fi

echo ""
"$SCRIPT_DIR/e2e-build.sh" $BUILD_ARGS

echo ""
"$SCRIPT_DIR/e2e-test.sh"

echo ""
echo "=== E2E Run Complete ==="
