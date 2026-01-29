This folder contains the source code for the browser extensions for AliasVault.

The browser extension is built using WXT and React:
- [WXT](https://wxt.dev/) is a build tool for browser extensions.
- [React](https://reactjs.org/) is a JavaScript library for building user interfaces.

To build the browser extension, run the following command in this directory:

### Build the browser extension
```bash
npm install

# Build the Chrome extension (saves in dist/chrome-mv3)
npm run zip:chrome

# Build the Firefox extension (creates two zip files in dist)
npm run zip:firefox

# Build the Edge extension (saves in dist/edge-mv3)
npm run zip:edge

# Build the Safari extension (saves in dist/safari-mv2 which is referenced by the safari-xcode/AliasVault.xcodeproj project)
npm run build:safari
# Open the safari-xcode/AliasVault.xcodeproj project in MacOS Xcode and run the project. This will install the extension to your Safari browser locally.
```
