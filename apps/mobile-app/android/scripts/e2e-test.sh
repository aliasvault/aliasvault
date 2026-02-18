#!/bin/bash
# Run Android E2E tests
# Usage: ./scripts/e2e-test.sh [EMULATOR_ID]
#
# Prerequisites:
# - Run ./scripts/e2e-build.sh first to build the app and start emulator
# - API server running on localhost:5092
# - Metro bundler running on localhost:8081

# Enable pipefail so that pipeline exit code reflects gradle's exit code, not tee's
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ANDROID_DIR"

# Ensure Android SDK tools are in PATH
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"

echo "=== Android E2E Tests ==="

# Get emulator ID
EMULATOR_ID="${1:-$EMULATOR_ID}"

if [ -z "$EMULATOR_ID" ]; then
    # Try to find a running emulator
    EMULATOR_ID=$(adb devices 2>/dev/null | grep "emulator" | head -1 | awk '{print $1}')

    if [ -z "$EMULATOR_ID" ]; then
        echo "ERROR: No running emulator found!"
        echo "Run ./scripts/e2e-build.sh first to build and start an emulator."
        exit 1
    fi
    echo "Using running emulator: $EMULATOR_ID"
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

# Ensure port forwarding is set up
echo "Ensuring port forwarding..."
adb -s "$EMULATOR_ID" reverse tcp:5092 tcp:5092 2>/dev/null || true
adb -s "$EMULATOR_ID" reverse tcp:8081 tcp:8081 2>/dev/null || true

# Disable animations for reliable UI testing (critical for headless CI)
echo "Disabling animations for reliable testing..."
adb -s "$EMULATOR_ID" shell settings put global window_animation_scale 0.0 2>/dev/null || true
adb -s "$EMULATOR_ID" shell settings put global transition_animation_scale 0.0 2>/dev/null || true
adb -s "$EMULATOR_ID" shell settings put global animator_duration_scale 0.0 2>/dev/null || true

# Clear app data before running tests to ensure clean state
# This must be done via adb (not from within instrumentation) to avoid crashing the test runner
echo "Clearing app data for clean test state..."
adb -s "$EMULATOR_ID" shell pm clear net.aliasvault.app 2>/dev/null || true
sleep 1

# Detect CI environment
IS_CI="${CI:-${GITHUB_ACTIONS:-false}}"
echo "CI mode: $IS_CI"

# Run tests
echo ""
echo "=== Running E2E Tests ==="
TEST_EXIT_CODE=0
TEST_OUTPUT_FILE="/tmp/android-test-output.log"

# Use --console=plain to avoid ANSI escape codes that break parsing
# Use --build-cache to leverage cached compilation artifacts
# Pass CI environment variable to tests for timeout adjustments
CI_ARG=""
if [ "$IS_CI" = "true" ]; then
    CI_ARG="-Pandroid.testInstrumentationRunnerArguments.CI=true"
fi

./gradlew :app:connectedDebugAndroidTest \
    -Pandroid.testInstrumentationRunnerArguments.API_URL=http://10.0.2.2:5092 \
    $CI_ARG \
    --console=plain \
    --build-cache \
    --stacktrace 2>&1 | tee "$TEST_OUTPUT_FILE" || TEST_EXIT_CODE=$?

# Strip any remaining ANSI escape codes from the output file
sed -i.bak 's/\x1b\[[0-9;]*m//g' "$TEST_OUTPUT_FILE" 2>/dev/null || \
    sed -i '' 's/\x1b\[[0-9;]*m//g' "$TEST_OUTPUT_FILE" 2>/dev/null || true
rm -f "$TEST_OUTPUT_FILE.bak" 2>/dev/null || true

# Parse and display test results summary
echo ""
echo "=============================================="
echo "         Android E2E TEST RESULTS"
echo "=============================================="

# Parse test results from gradle output
# Gradle format: "ClassName > testMethodName[device info] PASSED/FAILED"
# Example: "net.aliasvault.app.AliasVaultUITests > test01CreateItem[Pixel_Pro_API_36(AVD) - 16] FAILED"
echo ""

# Extract test results - match the specific Gradle test output format
# The format is: "ClassName > testName[device info] STATUS"
# We need to match lines with " > test" and the status (allowing trailing whitespace)
PASSED_TESTS=$(grep -E " > test.*\] PASSED" "$TEST_OUTPUT_FILE" 2>/dev/null | wc -l | tr -d ' ')
FAILED_TESTS=$(grep -E " > test.*\] FAILED" "$TEST_OUTPUT_FILE" 2>/dev/null | wc -l | tr -d ' ')
SKIPPED_TESTS=$(grep -E " > test.*\] SKIPPED" "$TEST_OUTPUT_FILE" 2>/dev/null | wc -l | tr -d ' ')
TOTAL_TESTS=$((PASSED_TESTS + FAILED_TESTS + SKIPPED_TESTS))

echo "  Total:   $TOTAL_TESTS"
echo "  Passed:  $PASSED_TESTS"
echo "  Failed:  $FAILED_TESTS"
echo "  Skipped: $SKIPPED_TESTS"
echo ""

# Show individual test results
echo "--- Individual Tests ---"

# Show passed tests (extract test name from "ClassName > testName[device] PASSED")
grep -E " > test.*\] PASSED" "$TEST_OUTPUT_FILE" 2>/dev/null | \
    sed 's/.*> \(test[^[]*\).*/  ✅ \1/' || true

# Show failed tests
grep -E " > test.*\] FAILED" "$TEST_OUTPUT_FILE" 2>/dev/null | \
    sed 's/.*> \(test[^[]*\).*/  ❌ \1/' || true

# Show skipped tests
grep -E " > test.*\] SKIPPED" "$TEST_OUTPUT_FILE" 2>/dev/null | \
    sed 's/.*> \(test[^[]*\).*/  ⏭️  \1/' || true

echo ""

# If tests failed, show failure details and pull screenshots
if [ "$TEST_EXIT_CODE" -ne 0 ]; then
    echo "--- Failure Details ---"
    # Show assertion failures
    grep -A5 "AssertionError\|AssertionFailedError\|junit.*Exception" "$TEST_OUTPUT_FILE" 2>/dev/null | head -30 || true
    # Show test failure messages
    grep -B2 -A3 "FAILED" "$TEST_OUTPUT_FILE" 2>/dev/null | grep -v "^--$" | head -20 || true
    echo ""

    # Pull failure screenshots from device
    echo "--- Pulling failure screenshots ---"
    mkdir -p app/build/reports/androidTests/screenshots
    adb -s "$EMULATOR_ID" pull /sdcard/Download/ app/build/reports/androidTests/screenshots/ 2>/dev/null || true
    ls -la app/build/reports/androidTests/screenshots/*.png 2>/dev/null || echo "No screenshots found"
    echo ""
fi

echo "=============================================="

# Output for GitHub Actions job summary (if running in CI)
if [ -n "$GITHUB_STEP_SUMMARY" ]; then
    {
        echo "## Android E2E Test Results"
        echo ""
        if [ "$TEST_EXIT_CODE" -eq 0 ]; then
            echo "✅ **All tests passed**"
        else
            echo "❌ **Some tests failed**"
        fi
        echo ""
        echo "| Metric | Count |"
        echo "|--------|-------|"
        echo "| Total | $TOTAL_TESTS |"
        echo "| Passed | $PASSED_TESTS |"
        echo "| Failed | $FAILED_TESTS |"
        echo ""

        # Add individual test results
        echo "### Test Details"
        echo ""

        # Passed tests
        if [ "$PASSED_TESTS" -gt 0 ]; then
            grep -E " > test.*\] PASSED" "$TEST_OUTPUT_FILE" 2>/dev/null | \
                sed 's/.*> \(test[^[]*\).*/- ✅ \1/' || true
        fi

        # Failed tests
        if [ "$FAILED_TESTS" -gt 0 ]; then
            grep -E " > test.*\] FAILED" "$TEST_OUTPUT_FILE" 2>/dev/null | \
                sed 's/.*> \(test[^[]*\).*/- ❌ \1/' || true
        fi

        echo ""
    } >> "$GITHUB_STEP_SUMMARY"
fi

# Clean up temp file
rm -f "$TEST_OUTPUT_FILE"

echo "Results available at: app/build/reports/androidTests/"

# Sanity check: fail if no tests were executed (likely indicates skipped/broken tests)
if [ "$TOTAL_TESTS" -eq 0 ]; then
    echo ""
    echo "ERROR: No tests were executed! This likely indicates:"
    echo "  - Tests were skipped (API not available?)"
    echo "  - Test discovery failed"
    echo "  - Gradle output format changed"
    echo ""
    exit 1
fi

exit $TEST_EXIT_CODE
