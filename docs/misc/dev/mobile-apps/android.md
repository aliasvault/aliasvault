---
layout: default
title: Android
parent: Mobile Apps
grand_parent: Development
nav_order: 1
---

# Android
This article covers Android specific parts of the React Native AliasVault app codebase.

Install OpenJDK for Android dev:

```
brew install openjdk@17

# Add to path
sudo ln -sfn /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-17.jdk

# Test if Java works on CLI
java --version
```

Make sure NDK is installed:

1. Open Android Studio.
2. Go to: `Preferences > Appearance & Behavior > System Settings > Android SDK > SDK Tools tab`.
3. Check NDK (Side by side).
4. Click Apply or OK to install it.

If getting `node` errors in Android studio, close and re-open Android Studio from CLI via:

```
open -a "Android Studio"
```

## Test on real device
In order to test on a real device in debug mode, make sure to forward the port 8081 from local dev machine to phone. Without this an error regarding expo bundler can appear.

```bash
adb reverse tcp:8081 tcp:8081
```

## Unit tests
The Android project contains unit tests that test the `VaultStore` native Kotlin implementation. The `VaultStore` logic is responsible for handling vault encryption/decryption, contains the SQLite client and acts as a proxy for all queries made by the React Native and autofill components.

In order to run the Android unit tests:

```
./gradlew :app:testDebugUnitTest --tests "net.aliasvault.app.*"
```

You can also open up the project in Android Studio, navigate to the `VaultStoreTest.kt` file and run/debug individual tests.

## Linting
Linting is ran automatically during normal Android app build. You can however also run the linting checks manually:

### Kotlin
```bash
./gradlew lintCheck
```

### Auto fix linting issues
To automatically fix linting issues (where possible), run this command:
```bash
./gradlew lintFormat
```