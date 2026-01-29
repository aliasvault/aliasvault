---
layout: default
title: Testing guide
parent: iOS
grand_parent: Mobile Apps
nav_order: 1
---

# Testing guide

This guide explains how to run the iOS test suites for the AliasVault mobile app.

## Overview

The iOS app has two test targets:

1. **AliasVaultUITests** - End-to-end UI tests that test full user flows
2. **VaultStoreKitTests** - Unit tests for the native VaultStoreKit framework

## Prerequisites

- macOS with Xcode installed (15.0+)
- iOS Simulator configured
- Node.js 20+
- CocoaPods dependencies installed (`cd apps/mobile-app && npx pod-install`)
- For UI tests: Local API server running at `http://localhost:5092`

## Running Tests

### Via Xcode

1. Open the project in Xcode:
   ```bash
   cd apps/mobile-app/ios
   open AliasVault.xcworkspace
   ```

2. Select a simulator (e.g., iPhone 16 Pro)

3. Run tests:
   - **All tests**: `Cmd + U` or Product > Test
   - **Specific test class**: Click the diamond icon next to the test class in the Test Navigator
   - **Single test**: Click the diamond icon next to a specific test method

### Via Command Line (xcodebuild)

#### Run All Tests

```bash
cd apps/mobile-app/ios

# Run all tests on iPhone 17 Pro simulator
xcodebuild test \
  -workspace AliasVault.xcworkspace \
  -scheme AliasVault \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -resultBundlePath ./test-results
```

#### Run UI Tests Only

```bash
xcodebuild test \
  -workspace AliasVault.xcworkspace \
  -scheme AliasVault \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:AliasVaultUITests
```

#### Run VaultStoreKit Unit Tests Only

```bash
xcodebuild test \
  -workspace AliasVault.xcworkspace \
  -scheme AliasVault \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:VaultStoreKitTests
```

#### Run a Specific Test

```bash
# Run a specific test class
xcodebuild test \
  -workspace AliasVault.xcworkspace \
  -scheme AliasVault \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:AliasVaultUITests/AliasVaultUITests

# Run a specific test method
xcodebuild test \
  -workspace AliasVault.xcworkspace \
  -scheme AliasVault \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:AliasVaultUITests/AliasVaultUITests/test01AppLaunch
```

#### With Custom API URL (for UI tests)

```bash
API_URL="http://your-server:5092" xcodebuild test \
  -workspace AliasVault.xcworkspace \
  -scheme AliasVault \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:AliasVaultUITests
```

### List Available Simulators

```bash
xcrun simctl list devices available
```