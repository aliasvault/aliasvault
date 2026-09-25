# Build assets

Store specific packaging wrappers that are used to build the browser extension.

| Folder | Description |
| --- | --- |
| `firefox-sources` | `README.md` that `wxt.config.ts` injects into the root of the sources archive that accompanies every addons.mozilla.org submission. |
| `safari-xcode` | Xcode project that wraps the built extension (`../../dist/safari-mv2`) in the macOS app that Apple requires for Safari extensions. |
