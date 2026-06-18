---
sidebar_position: 2
sidebar_label: "Build from Source"
---
# Building Firefox Extension from Source

This guide explains how to build and install the AliasVault Firefox extension from source code.

## Prerequisites

- Node.js installed on your computer
- Git to clone the repository (optional)

## Building the Firefox Extension

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
npm run build:firefox
```

## Installing in Firefox

1. Open Firefox and go to `about:debugging`
2. Click "This Firefox"
3. Click "Load Temporary Add-on"
4. Navigate to and select the file `apps/browser-extension/dist/firefox-mv2/manifest.json`
5. The AliasVault extension should now appear in your extensions list

## Development Mode (Optional)

If you plan to modify the extension code, see the [browser-extensions](../../../contributing/development/browser-extensions.md) developer documentation for more information.
