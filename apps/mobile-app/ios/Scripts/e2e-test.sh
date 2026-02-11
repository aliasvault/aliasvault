#!/bin/bash
# Run iOS E2E tests
# Usage: ./scripts/e2e-test.sh [SIMULATOR_ID]
#
# Prerequisites:
# - Run ./scripts/e2e-build.sh first to build the app
# - API server running on localhost:5092
# - Metro bundler running on localhost:8081

# Enable pipefail so that pipeline exit code reflects xcodebuild's exit code, not tee's
set -o pipefail

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
TEST_OUTPUT_FILE="/tmp/xcodebuild-test-output.log"

# Use the same derived data path as build script
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-$HOME/.cache/xcode-derived-data/AliasVault}"

xcodebuild test-without-building \
    -workspace AliasVault.xcworkspace \
    -scheme AliasVault \
    -sdk iphonesimulator \
    -destination "id=$SIMULATOR_ID" \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    -only-testing:AliasVaultUITests \
    -resultBundlePath TestResults.xcresult \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGN_IDENTITY="-" \
    DEVELOPMENT_TEAM="" \
    IDEFileSystemSynchronizedGroupsAreEnabled=NO 2>&1 | tee "$TEST_OUTPUT_FILE" || TEST_EXIT_CODE=$?

# Parse and display test results summary
echo ""
echo "=============================================="
echo "           iOS E2E TEST RESULTS"
echo "=============================================="

# Parse test results from xcodebuild output (more reliable than xcresult)
echo ""
echo "--- Test Results from xcodebuild output ---"
echo ""

# Extract test case results from output
PASSED_TESTS=$(grep -E "Test Case.*passed" "$TEST_OUTPUT_FILE" 2>/dev/null | wc -l | tr -d ' ')
FAILED_TESTS=$(grep -E "Test Case.*failed" "$TEST_OUTPUT_FILE" 2>/dev/null | wc -l | tr -d ' ')
TOTAL_TESTS=$((PASSED_TESTS + FAILED_TESTS))

# Check for crashes/timeouts
CRASHED=$(grep -c "Restarting after unexpected exit, crash, or test timeout" "$TEST_OUTPUT_FILE" 2>/dev/null || true)
CRASHED=${CRASHED:-0}
# Ensure CRASHED is a valid number (strip whitespace)
CRASHED=$(echo "$CRASHED" | tr -d ' ')

echo "  Total:   $TOTAL_TESTS"
echo "  Passed:  $PASSED_TESTS"
echo "  Failed:  $FAILED_TESTS"
if [ "$CRASHED" -gt 0 ]; then
    echo "  ⚠️  Crashes/Timeouts detected: $CRASHED"
fi
echo ""

# Show individual test results
echo "--- Individual Tests ---"

# Show passed tests
grep -E "Test Case.*passed" "$TEST_OUTPUT_FILE" 2>/dev/null | \
    sed "s/.*'\([^']*\)'.*/  ✅ \1/" || true

# Show failed tests
grep -E "Test Case.*failed" "$TEST_OUTPUT_FILE" 2>/dev/null | \
    sed "s/.*'\([^']*\)'.*/  ❌ \1/" || true

echo ""

# If tests failed or crashed, show failure details
if [ "$TEST_EXIT_CODE" -ne 0 ] || [ "$FAILED_TESTS" -gt 0 ] || [ "$CRASHED" -gt 0 ]; then
    echo "--- Failure Details ---"
    # Show assertion failures
    grep -A2 "XCTAssert" "$TEST_OUTPUT_FILE" 2>/dev/null | head -20 || true
    # Show any error messages
    grep -i "error:" "$TEST_OUTPUT_FILE" 2>/dev/null | grep -v "xcodebuild" | head -10 || true
    echo ""
fi

echo "=============================================="

# Output for GitHub Actions job summary (if running in CI)
if [ -n "$GITHUB_STEP_SUMMARY" ]; then
    {
        echo "## iOS E2E Test Results"
        echo ""
        # Determine pass/fail based on actual test results, not just exit code
        # If we have tests and none failed/crashed, tests passed (regardless of xcodebuild exit code)
        # Use -gt 0 for positive checks and ensure variables are treated as integers
        if [ "${TOTAL_TESTS:-0}" -gt 0 ] && [ "${FAILED_TESTS:-0}" -eq 0 ] && [ "${CRASHED:-0}" -eq 0 ]; then
            echo "✅ **All tests passed**"
        elif [ "${TOTAL_TESTS:-0}" -eq 0 ]; then
            echo "⚠️ **No tests were executed**"
        else
            echo "❌ **Some tests failed**"
        fi
        echo ""
        echo "| Metric | Count |"
        echo "|--------|-------|"
        echo "| Total | $TOTAL_TESTS |"
        echo "| Passed | $PASSED_TESTS |"
        echo "| Failed | $FAILED_TESTS |"
        if [ "$CRASHED" -gt 0 ]; then
            echo "| ⚠️ Crashes/Timeouts | $CRASHED |"
        fi
        echo ""

        # Add individual test results
        echo "### Test Details"
        echo ""

        # Passed tests
        if [ "$PASSED_TESTS" -gt 0 ]; then
            grep -E "Test Case.*passed" "$TEST_OUTPUT_FILE" 2>/dev/null | \
                sed "s/.*'\([^']*\)'.*/- ✅ \1/" || true
        fi

        # Failed tests
        if [ "$FAILED_TESTS" -gt 0 ]; then
            grep -E "Test Case.*failed" "$TEST_OUTPUT_FILE" 2>/dev/null | \
                sed "s/.*'\([^']*\)'.*/- ❌ \1/" || true
        fi

        echo ""
    } >> "$GITHUB_STEP_SUMMARY"
fi

# Clean up temp file
rm -f "$TEST_OUTPUT_FILE"

echo "Results bundle: TestResults.xcresult"

# Determine final exit code based on actual test results
# If we have tests and all passed, exit 0 (even if xcodebuild had other issues)
# If tests failed or crashed, exit 1
# If no tests ran, use xcodebuild exit code (likely indicates a problem)
if [ "${TOTAL_TESTS:-0}" -gt 0 ] && [ "${FAILED_TESTS:-0}" -eq 0 ] && [ "${CRASHED:-0}" -eq 0 ]; then
    exit 0
elif [ "${FAILED_TESTS:-0}" -gt 0 ] || [ "${CRASHED:-0}" -gt 0 ]; then
    exit 1
else
    exit $TEST_EXIT_CODE
fi
