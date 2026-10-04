---
sidebar_position: 1
sidebar_label: "Testing guide"
---
# Testing guide

This guide explains how to run the iOS test suite for the AliasVault mobile app.

## Overview

The iOS app has one test target: **VaultStoreKitTests**, the unit tests for the native VaultStoreKit framework.

## Prerequisites

- macOS with Xcode installed (15.0+)
- iOS Simulator configured
- Node.js 20+
- CocoaPods dependencies installed (`cd apps/mobile-app && npx pod-install`)

## Running Tests

### Via Xcode

1. Open the project in Xcode:
   ```bash
   cd apps/mobile-app/ios
   open AliasVault.xcworkspace
   ```

2. Select a simulator (e.g., iPhone 17 Pro)

3. Run tests:
   - **All tests**: `Cmd + U` or Product > Test
   - **Specific test class**: Click the diamond icon next to the test class in the Test Navigator
   - **Single test**: Click the diamond icon next to a specific test method

### Via Command Line (xcodebuild)

```bash
cd apps/mobile-app/ios

# Run all tests on iPhone 17 Pro simulator
xcodebuild test \
  -workspace AliasVault.xcworkspace \
  -scheme AliasVault \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:VaultStoreKitTests \
  -resultBundlePath ./test-results
```

### List Available Simulators

```bash
xcrun simctl list devices available
```
