#!/bin/bash
# Build iOS app for E2E testing
# Usage: ./scripts/e2e-build.sh [SIMULATOR_ID] [--show-simulator]
#
# This script builds the iOS app for testing on a simulator.
# If SIMULATOR_ID is not provided, it will find and boot a suitable simulator.
#
# Options:
#   --show-simulator    Open Simulator.app to show the simulator UI (useful for debugging)
#   SHOW_SIMULATOR=1    Environment variable alternative to --show-simulator

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(dirname "$SCRIPT_DIR")"
cd "$IOS_DIR"

# Parse arguments
SHOW_SIMULATOR="${SHOW_SIMULATOR:-0}"
SIMULATOR_ID=""

for arg in "$@"; do
    case $arg in
        --show-simulator)
            SHOW_SIMULATOR=1
            ;;
        *)
            if [ -z "$SIMULATOR_ID" ]; then
                SIMULATOR_ID="$arg"
            fi
            ;;
    esac
done

echo "=== iOS E2E Build ==="

if [ -z "$SIMULATOR_ID" ]; then
    echo "Finding available simulator..."

    # Shutdown any existing simulators first
    xcrun simctl shutdown all 2>/dev/null || true

    # Find the highest numbered iPhone Pro simulator available
    SIMULATOR_ID=$(xcrun simctl list devices available | grep -E "iPhone [0-9]+ Pro" | sort -t' ' -k2 -rn | head -1 | grep -oE '[A-F0-9-]{36}')

    if [ -n "$SIMULATOR_ID" ]; then
        MODEL=$(xcrun simctl list devices available | grep "$SIMULATOR_ID" | sed 's/(.*//' | xargs)
        echo "Found simulator: $MODEL ($SIMULATOR_ID)"
    fi

    if [ -z "$SIMULATOR_ID" ]; then
        echo "ERROR: No iPhone simulator found!"
        echo "Available simulators:"
        xcrun simctl list devices available
        exit 1
    fi
fi

# Boot simulator if not already booted
BOOT_STATUS=$(xcrun simctl list devices | grep "$SIMULATOR_ID" | grep -c "Booted" || true)
if [ "$BOOT_STATUS" -eq 0 ]; then
    echo "Booting simulator: $SIMULATOR_ID"
    xcrun simctl boot "$SIMULATOR_ID" || true

    echo "Waiting for simulator to be ready..."
    xcrun simctl bootstatus "$SIMULATOR_ID" -b
fi

# Open Simulator.app to show the UI if requested
if [ "$SHOW_SIMULATOR" = "1" ]; then
    echo "Opening Simulator.app to show simulator UI..."
    open -a Simulator
    sleep 2
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
xcodebuild build-for-testing \
    -workspace AliasVault.xcworkspace \
    -scheme AliasVault \
    -configuration Debug \
    -sdk iphonesimulator \
    -destination "id=$SIMULATOR_ID" \
    -derivedDataPath build \
    CODE_SIGN_IDENTITY="-" \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGNING_ALLOWED=YES \
    IDEFileSystemSynchronizedGroupsAreEnabled=NO \
    COMPILER_INDEX_STORE_ENABLE=NO \
    ONLY_ACTIVE_ARCH=YES

echo ""
echo "✅ Build complete!"
echo "SIMULATOR_ID=$SIMULATOR_ID"
echo ""
echo "To run tests: ./scripts/e2e-test.sh $SIMULATOR_ID"
