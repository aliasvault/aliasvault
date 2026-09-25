# AliasVault browser extension: source archive

This archive contains the source code of the AliasVault browser extension together with the shared packages 
that the extension is built from. It mirrors the layout of the public repository at https://github.com/aliasvault/aliasvault, 
which also holds the server and mobile app sources that are not needed to build the extension.

## Contents

| Path | Description |
| --- | --- |
| `apps/browser-extension` | The browser extension itself (WXT, React, TypeScript) |
| `core/client` | Shared client logic, linked as a `file:` dependency |
| `core/models` | Shared data models, linked as a `file:` dependency |
| `core/vault` | Shared vault schema definitions, linked as a `file:` dependency |
| `core/rust` | Rust sources of the WebAssembly module that the extension bundles |

## How to build

```bash
cd apps/browser-extension
npm install
npm run zip:firefox
```

This writes the unpacked extension to `apps/browser-extension/dist/firefox-mv2` and the packaged
extension to `apps/browser-extension/dist/aliasvault-browser-extension-<version>-firefox.zip`.

Node.js and npm are the only requirements; release builds are made with Node.js 24. The `npm install`
step also installs the dependencies of the linked `core/*` packages, so no other install is needed.

Full instructions are in `apps/browser-extension/README.md`.

## WebAssembly module

`core/client/wasm` holds the prebuilt WebAssembly module that the extension bundles, and the build above
uses it as is. To rebuild it from the Rust sources in `core/rust`, install the Rust toolchain
(https://rustup.rs) and run `npm run build:rust` from `apps/browser-extension`.
