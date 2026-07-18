---
sidebar_position: 2
sidebar_label: "Build from Source"
---
# Building Microsoft Edge Extension from Source

This guide explains how to build and install the AliasVault Microsoft Edge extension from source code.

## Prerequisites

- Node.js installed on your computer
- Git to clone the repository (optional)

## Building the Microsoft Edge Extension

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
npm run build:edge
```

## Installing in Microsoft Edge

1. Open Microsoft Edge and go to `edge://extensions/`
2. Enable "Developer mode" using the toggle in the top right corner
3. Click "Load unpacked"
4. Navigate to and select the folder `apps/browser-extension/dist/edge-mv3`
5. The AliasVault extension should now appear in your extensions list

## Development Mode (Optional)

If you plan to modify the extension code, see the [browser-extensions](../../../contributing/development/browser-extensions.md) developer documentation for more information.
