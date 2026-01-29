---
layout: default
title: Build from Source
parent: Android App
grand_parent: Mobile Apps
nav_order: 1
---

# Building AliasVault Android App from Source

This guide explains how to build and install the AliasVault Android app from source code using React Native.

## Prerequisites

- MacOS or Windows machine with Android Studio installed
- Git to clone the repository

## Building the Android app

1. Clone the repository:
```bash
git clone https://github.com/aliasvault/aliasvault.git
```

2. Navigate to the mobile app directory:
```bash
cd aliasvault/apps/mobile-app
```

3. Install JavaScript dependencies:
```bash
npm install
```

4. Deploy release build to your device via React Native automatically:

```bash
npx react-native run-android --mode release
```


5. For publishing to Google Play:
Create a local gradle file in your user directory where the keystore credentials will be placed
```bash
nano ~/.gradle/gradle.properties
```

Input the following contents and input the correct password:

```bash
ALIASVAULT_UPLOAD_STORE_FILE=aliasvault-upload-key.keystore     # Path to the keystore file
ALIASVAULT_UPLOAD_KEY_ALIAS=aliasvault-key-alias                # Replace with value of the `keystore.keyAlias`
ALIASVAULT_UPLOAD_STORE_PASSWORD=*****                  # Replace with the password to the keystore
ALIASVAULT_UPLOAD_KEY_PASSWORD=*****                    # Replace with the password to the keystore
```

Then create the bundle for upload to Google Play:

```bash
cd android
./gradlew app:bundleRelease
```

The resulting .aab file will be available in:

```bash
app/build/outputs/bundle/release
```
