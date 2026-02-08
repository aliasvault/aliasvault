#!/bin/bash
# Run iOS E2E tests
# Usage: ./scripts/e2e-test.sh [SIMULATOR_ID]
#
# Prerequisites:
# - Run ./scripts/e2e-build.sh first to build the app
# - API server running on localhost:5092
# - Metro bundler running on localhost:8081

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

# Run tests (don't exit on failure, we want to parse results first)
echo ""
echo "=== Running E2E Tests ==="
TEST_EXIT_CODE=0
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
    IDEFileSystemSynchronizedGroupsAreEnabled=NO || TEST_EXIT_CODE=$?

# Parse and display test results summary
echo ""
echo "=============================================="
echo "           iOS E2E TEST RESULTS"
echo "=============================================="

if [ -d "TestResults.xcresult" ]; then
    # Extract test summary using xcresulttool
    SUMMARY_JSON=$(xcrun xcresulttool get --path TestResults.xcresult --format json 2>/dev/null || echo "{}")

    # Try to get test counts from the summary
    if command -v jq &> /dev/null; then
        # If jq is available, parse JSON properly
        TOTAL=$(echo "$SUMMARY_JSON" | jq -r '.metrics.testsCount.value // 0' 2>/dev/null || echo "?")
        FAILED=$(echo "$SUMMARY_JSON" | jq -r '.metrics.testsFailedCount.value // 0' 2>/dev/null || echo "?")
        PASSED=$((TOTAL - FAILED)) 2>/dev/null || PASSED="?"
    else
        # Fallback: grep for test counts in raw output
        TOTAL=$(echo "$SUMMARY_JSON" | grep -o '"testsCount"[^}]*' | grep -o '"value" : [0-9]*' | grep -o '[0-9]*' || echo "?")
        FAILED=$(echo "$SUMMARY_JSON" | grep -o '"testsFailedCount"[^}]*' | grep -o '"value" : [0-9]*' | grep -o '[0-9]*' || echo "?")
        if [ "$TOTAL" != "?" ] && [ "$FAILED" != "?" ]; then
            PASSED=$((TOTAL - FAILED))
        else
            PASSED="?"
        fi
    fi

    echo ""
    echo "  Total:  $TOTAL"
    echo "  Passed: $PASSED"
    echo "  Failed: $FAILED"
    echo ""

    # List individual test results
    echo "--- Test Details ---"

    # Get detailed test action info
    xcrun xcresulttool get --path TestResults.xcresult --format json 2>/dev/null | \
        grep -E '"(name|testStatus)"' | \
        paste - - | \
        sed 's/.*"name".*: "\([^"]*\)".*"testStatus".*: "\([^"]*\)".*/\2: \1/' | \
        while read line; do
            if echo "$line" | grep -q "^Success:"; then
                echo "  ✅ $(echo "$line" | sed 's/Success: //')"
            elif echo "$line" | grep -q "^Failure:"; then
                echo "  ❌ $(echo "$line" | sed 's/Failure: //')"
            fi
        done

    echo ""

    # If tests failed, try to get failure messages
    if [ "$TEST_EXIT_CODE" -ne 0 ]; then
        echo "--- Failure Details ---"
        # Extract failure summaries
        xcrun xcresulttool get --path TestResults.xcresult --format json 2>/dev/null | \
            grep -A5 '"Failure"' | \
            grep -o '"message"[^,]*' | \
            head -10 | \
            sed 's/"message" : "/  /' | \
            sed 's/"$//'
        echo ""
    fi
fi

echo "=============================================="

# Output for GitHub Actions job summary (if running in CI)
if [ -n "$GITHUB_STEP_SUMMARY" ]; then
    echo "## iOS E2E Test Results" >> "$GITHUB_STEP_SUMMARY"
    echo "" >> "$GITHUB_STEP_SUMMARY"
    if [ "$TEST_EXIT_CODE" -eq 0 ]; then
        echo "✅ **All tests passed**" >> "$GITHUB_STEP_SUMMARY"
    else
        echo "❌ **Some tests failed**" >> "$GITHUB_STEP_SUMMARY"
    fi
    echo "" >> "$GITHUB_STEP_SUMMARY"
    echo "| Metric | Count |" >> "$GITHUB_STEP_SUMMARY"
    echo "|--------|-------|" >> "$GITHUB_STEP_SUMMARY"
    echo "| Total | $TOTAL |" >> "$GITHUB_STEP_SUMMARY"
    echo "| Passed | $PASSED |" >> "$GITHUB_STEP_SUMMARY"
    echo "| Failed | $FAILED |" >> "$GITHUB_STEP_SUMMARY"
    echo "" >> "$GITHUB_STEP_SUMMARY"
fi

echo "Results bundle: TestResults.xcresult"
exit $TEST_EXIT_CODE
