#!/bin/bash
# Build iOS app for E2E testing
# Usage: ./scripts/e2e-build.sh [SIMULATOR_ID]
#
# This script builds the iOS app for testing on a simulator.
# If SIMULATOR_ID is not provided, it will find and boot a suitable simulator.
#
# To run with a visible simulator window for debugging:
#   1. First run: ./scripts/e2e-show-simulator.sh
#   2. Then run: ./scripts/e2e-build.sh (reuses any visible simulator)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(dirname "$SCRIPT_DIR")"
cd "$IOS_DIR"

# Parse arguments
SIMULATOR_ID="${1:-}"

echo "=== iOS E2E Build ==="

# Check if Simulator.app is running (visible simulator from e2e-show-simulator.sh)
SIMULATOR_APP_RUNNING=$(pgrep -x "Simulator" >/dev/null 2>&1 && echo "1" || echo "0")

if [ -z "$SIMULATOR_ID" ]; then
    # Check for already booted simulator
    BOOTED_SIMULATOR=$(xcrun simctl list devices | grep "Booted" | grep -oE '[A-F0-9-]{36}' | head -1 || true)

    if [ -n "$BOOTED_SIMULATOR" ]; then
        SIMULATOR_ID="$BOOTED_SIMULATOR"
        echo "Found booted simulator: $SIMULATOR_ID (reusing)"
    else
        echo "No booted simulator found, starting one..."
        echo "(For visible simulator, run ./scripts/e2e-show-simulator.sh first)"

        # Find the highest numbered iPhone Pro simulator available
        SIMULATOR_ID=$(xcrun simctl list devices available | grep -E "iPhone [0-9]+ Pro" | sort -t' ' -k2 -rn | head -1 | grep -oE '[A-F0-9-]{36}')

        if [ -z "$SIMULATOR_ID" ]; then
            echo "ERROR: No iPhone simulator found!"
            echo "Available simulators:"
            xcrun simctl list devices available
            exit 1
        fi

        MODEL=$(xcrun simctl list devices available | grep "$SIMULATOR_ID" | sed 's/(.*//' | xargs)
        echo "Found simulator: $MODEL ($SIMULATOR_ID)"

        echo "Booting simulator..."
        xcrun simctl boot "$SIMULATOR_ID" || true

        echo "Waiting for simulator to be ready..."
        xcrun simctl bootstatus "$SIMULATOR_ID" -b
    fi
else
    echo "Using provided simulator: $SIMULATOR_ID"

    # Boot if not already booted
    BOOT_STATUS=$(xcrun simctl list devices | grep "$SIMULATOR_ID" | grep -c "Booted" || true)
    if [ "$BOOT_STATUS" -eq 0 ]; then
        echo "Booting simulator..."
        xcrun simctl boot "$SIMULATOR_ID" || true

        echo "Waiting for simulator to be ready..."
        xcrun simctl bootstatus "$SIMULATOR_ID" -b
    fi
fi

# Disable AutoFill to prevent "Save Password" prompts during tests
echo "Disabling AutoFill in simulator..."
xcrun simctl spawn "$SIMULATOR_ID" defaults write com.apple.Preferences AutoFillPasswords -bool NO 2>/dev/null || true
xcrun simctl spawn "$SIMULATOR_ID" defaults write -g AutoFillPasswords -bool NO 2>/dev/null || true

echo "Simulator ready: $SIMULATOR_ID"

# Clean previous test results
rm -rf TestResults.xcresult

# Build for testing
# Note: We allow code signing for simulator to ensure app group entitlements work
echo ""
echo "=== Building iOS app for testing ==="

# Determine number of parallel jobs (use all available cores)
PARALLEL_JOBS=$(sysctl -n hw.ncpu 2>/dev/null || echo 4)

# Use a persistent derived data path for faster incremental builds
# This survives across CI runs on self-hosted runners
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-$HOME/.cache/xcode-derived-data/AliasVault}"
mkdir -p "$DERIVED_DATA_PATH"
echo "Using derived data path: $DERIVED_DATA_PATH"

xcodebuild build-for-testing \
    -workspace AliasVault.xcworkspace \
    -scheme AliasVault \
    -configuration Debug \
    -sdk iphonesimulator \
    -destination "id=$SIMULATOR_ID" \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    -parallelizeTargets \
    -jobs "$PARALLEL_JOBS" \
    -quiet \
    CODE_SIGN_IDENTITY="-" \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGNING_ALLOWED=YES \
    IDEFileSystemSynchronizedGroupsAreEnabled=NO \
    COMPILER_INDEX_STORE_ENABLE=NO \
    ONLY_ACTIVE_ARCH=YES \
    DEBUG_INFORMATION_FORMAT=dwarf \
    GCC_OPTIMIZATION_LEVEL=0 \
    SWIFT_OPTIMIZATION_LEVEL=-Onone \
    SWIFT_COMPILATION_MODE=singlefile \
    ENABLE_TESTABILITY=YES

echo ""
echo "✅ Build complete!"
echo "SIMULATOR_ID=$SIMULATOR_ID"
echo ""
echo "To run tests: ./scripts/e2e-test.sh $SIMULATOR_ID"
