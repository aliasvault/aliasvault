---
sidebar_position: 1
sidebar_label: "Build from Source"
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
