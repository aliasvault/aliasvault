---
sidebar_position: 2
sidebar_label: "Build from Source"
---
# Building AliasVault iOS App from Source

This guide explains how to build and install the AliasVault iOS app from source code using React Native.

## Prerequisites

- macOS with Xcode installed (required for building iOS apps)
- [Homebrew](https://brew.sh) installed
- Node.js installed
- CocoaPods installed (`brew install cocoapods`)
- Git to clone the repository
- Xcode Command Line Tools (`xcode-select --install`)
- An Apple developer account for signing and installing on real devices (optional for simulator)

## Building the iOS App

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

4. Install iOS native dependencies via CocoaPods:
```bash
npx pod-install
```

5. Open the iOS workspace in Xcode:
```bash
./apps/mobile-app/ios/AliasVault.xcworkspace
```

6. In Xcode, select a simulator or a connected physical device.

7. Click Run (▶️) in Xcode to build and launch the app.

## Notes
- If you're running on a physical iPhone, you'll need to configure code signing with your Apple ID in Xcode under Signing & Capabilities.