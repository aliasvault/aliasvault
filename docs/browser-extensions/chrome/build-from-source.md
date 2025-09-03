---
layout: default
title: Build from Source
parent: Google Chrome
grand_parent: Browser Extensions
nav_order: 2
---

# Building Google Chrome Extension from Source

This guide explains how to build and install the AliasVault Google Chrome extension from source code.

## Prerequisites

- Node.js installed on your computer
- Git to clone the repository (optional)

## Building the Google Chrome Extension

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
npm run build:chrome
```

## Installing in Google Chrome

1. Open Google Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" using the toggle in the top right corner
3. Click "Load unpacked"
4. Navigate to and select the folder `apps/browser-extension/dist/chrome-mv3`
5. The AliasVault extension should now appear in your extensions list

## Development Mode (Optional)

If you plan to modify the extension code, see the [browser-extensions](../../misc/dev/browser-extensions.md) developer documentation for more information.
