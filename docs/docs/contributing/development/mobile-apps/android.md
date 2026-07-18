---
sidebar_position: 1
sidebar_label: "Android"
---
# Android

Android-specific notes for the React Native AliasVault app. This assumes a working
Android dev setup (Android Studio, JDK 17, and the NDK installed via *SDK Tools →
NDK (Side by side)*).

## Test on a real device

To run in debug mode on a physical device, forward the Metro bundler port,
otherwise you'll hit an Expo bundler error:

```bash
adb reverse tcp:8081 tcp:8081
```

## Unit tests

The Android project has unit tests for the native Kotlin `VaultStore`, which
handles vault encryption/decryption, owns the SQLite client, and proxies all
queries from the React Native and autofill components.

```bash
./gradlew :app:testDebugUnitTest --tests "net.aliasvault.app.*"
```

You can also open the project in Android Studio and run/debug individual tests in
`VaultStoreTest.kt`.

## Linting

Linting runs automatically during a normal build; to run it manually:

```bash
./gradlew lintCheck    # check
./gradlew lintFormat   # auto-fix where possible
```
