---
sidebar_position: 4
---
# Mobile apps

The AliasVault mobile apps are built with [Expo](https://docs.expo.dev/) /
React Native. Standard Expo workflow applies (`npx expo run:ios` /
`run:android`); this section only covers the AliasVault-specific pieces. See also
the platform notes for [Android](android.md) and [iOS](ios/index.md).

## Native Turbo Module: VaultManager

The app implements its native `VaultManager` as a React Native
[Turbo Module](https://reactnative.dev/docs/the-new-architecture/pillars-turbo-modules),
so the vault and encryption key can be stored on the native side using low-level
secure keychain storage.

To change the native interface, edit the spec at `specs/NativeVaultManager.ts`,
then regenerate the codegen artifacts and implement the new/changed methods in the
native code (`ios/NativeVaultManager` for iOS).

### Regenerate the spec

**iOS**: from the mobile-app root (not the `ios/` directory, which can error):

```bash
npx pod-install
```

**Android**: from the `mobile-app/android` directory:

```bash
./gradlew generateCodegenArtifactsFromSchema
```
