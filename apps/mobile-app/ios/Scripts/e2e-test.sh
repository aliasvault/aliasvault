#!/bin/bash
# Run iOS E2E tests
# Usage: ./scripts/e2e-test.sh [SIMULATOR_ID]
#
# Prerequisites:
# - Run ./scripts/e2e-build.sh first to build the app
# - API server running on localhost:5092
# - Metro bundler running on localhost:8081

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(dirname "$SCRIPT_DIR")"
cd "$IOS_DIR"

echo "=== iOS E2E Tests ==="

# Get simulator ID
SIMULATOR_ID="${1:-$SIMULATOR_ID}"

if [ -z "$SIMULATOR_ID" ]; then
    # Try to find a booted simulator
    SIMULATOR_ID=$(xcrun simctl list devices | grep "Booted" | head -1 | grep -oE '[A-F0-9-]{36}')

    if [ -z "$SIMULATOR_ID" ]; then
        echo "ERROR: No booted simulator found!"
        echo "Run ./scripts/e2e-build.sh first to build and boot a simulator."
        exit 1
    fi
    echo "Using booted simulator: $SIMULATOR_ID"
fi

# Verify prerequisites
echo "Checking prerequisites..."

if ! curl -s http://localhost:5092/v1/ > /dev/null 2>&1; then
    echo "WARNING: API server not responding on localhost:5092"
    echo "Start it with: cd apps/server/AliasVault.Api && dotnet run"
fi

if ! curl -s http://localhost:8081/status 2>/dev/null | grep -q "packager-status:running"; then
    echo "WARNING: Metro bundler not responding on localhost:8081"
    echo "Start it with: cd apps/mobile-app && npx expo start --offline"
fi

# Clean previous test results
rm -rf TestResults.xcresult

# Run tests
echo ""
echo "=== Running E2E Tests ==="
xcodebuild test-without-building \
    -workspace AliasVault.xcworkspace \
    -scheme AliasVault \
    -sdk iphonesimulator \
    -destination "id=$SIMULATOR_ID" \
    -derivedDataPath build \
    -only-testing:AliasVaultUITests \
    -resultBundlePath TestResults.xcresult \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGN_IDENTITY="-" \
    DEVELOPMENT_TEAM="" \
    IDEFileSystemSynchronizedGroupsAreEnabled=NO

echo ""
echo "✅ Tests complete!"
echo "Results: TestResults.xcresult"
