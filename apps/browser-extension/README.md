This folder contains the source code for the browser extensions for AliasVault.

The browser extension is built using WXT and React:
- [WXT](https://wxt.dev/) is a build tool for browser extensions.
- [React](https://reactjs.org/) is a JavaScript library for building user interfaces.

The extension links the shared core packages (`core/client`, `core/models`, `core/vault`) as `file:`
dependencies, so this folder expects to sit in the repository next to the `core` folder. `npm install`
also installs the dependencies of those linked packages (see `scripts/install-core-deps.mjs`), so one
install in this directory is all that is needed.

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

# Build the Safari extension (saves in dist/safari-mv2 which is referenced by the build-assets/safari-xcode/AliasVault.xcodeproj project)
npm run build:safari
# Open the build-assets/safari-xcode/AliasVault.xcodeproj project in MacOS Xcode and run the project. This will install the extension to your Safari browser locally.
```

### Rebuild the Rust WASM module (optional)
`core/client/wasm` holds the prebuilt WASM module that the extension bundles, and the builds above use it
as is. To rebuild it from the Rust sources in `core/rust`, install the [Rust toolchain](https://rustup.rs)
and run:

```bash
npm run build:rust
```
