---
layout: default
title: Build from Source
parent: Safari
grand_parent: Browser Extensions
nav_order: 2
---

# Building Safari Extension from Source

This guide explains how to build and install the AliasVault Safari extension from source code.

## Prerequisites

- Node.js installed on your computer
- Git to clone the repository (optional)
- MacOS machine with Xcode installed

## Building the Safari Extension

1. Clone the repository:
```bash
git clone https://github.com/aliasvault/aliasvault.git
```

2. Navigate to the Browser Extension directory:
```bash
cd aliasvault/apps/browser-extension
```

3. Install the required dependencies:
```bash
npm install
```

4. Build the extension:
```bash
npm run build:safari
```

5. Open Xcode and open the `apps/browser-extension/safari-xcode/AliasVault.xcodeproj` file

6. Run the project. This will open up the AliasVault MacOS wrapper app and automatically install the extension to your Safari Extensions list.

## Installing and enabling the extension in Safari

1. Open Safari and go to menu > Safari > Settings
2. Click on the "Extensions" tab
3. Enable the AliasVault extension. If the extension is not visible, then you may need to enable developer mode in Safari settings first to allow unsigned extensions to run.

## Development Mode (Optional)

If you plan to modify the extension code, see the [browser-extensions](../../misc/dev/browser-extensions.md) developer documentation for more information.
