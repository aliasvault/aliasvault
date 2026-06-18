---
sidebar_position: 4
---
# React Native Expo

## MacOS:
Install watchman

```
brew install watchman
```

Run iOS on Simulator:

```
npx expo run:ios
```

## React Native Turbo Module VaultManager
The AliasVault React Native app uses the Turbo Module method for implementing the native VaultManager functionality which allows the app to store the AliasVault vault and encryption key safely on the native level enabling the use of low-level keychain secure storage methods.

In order to update the Native Turbo Module scheme, edit the specs file in: `specs/NativeVaultManager.ts`. Afterwards:
- For iOS, run pod install (see instructions below). Then make sure to implement the new or changed methods in the actual NativeVaultManager implementation of which the files are located in the `ios/NativeVaultManager` directory.

## (Re)generate native turbo module spec file

### iOS: run Pod install
1. Go to root of mobile-app directory
2. Run `npx pod-install` (don't run `pod install` directly from ios directory as this can cause errors)

### Android: run custom gradlew command
1. Go to mobile-app/android directory and run the gradlew codegen command:
```bash
cd mobile-app/android
./gradlew generateCodegenArtifactsFromSchema
```