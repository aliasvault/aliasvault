# Core Libraries
This folder contains core modules that are used by multiple applications in the AliasVault monorepo.

## rust (Primary)
**Primary cross-platform core library** written in Rust, providing shared business logic across ALL platforms:
- Web app via Webassembly
- Browser extensions (Chrome, Firefox, Edge, Safari) via WebAssembly
- Mobile apps (iOS via Swift bindings, Android via Kotlin bindings)
- Desktop apps (future)

See [rust/README.md](rust/README.md) for detailed documentation.

## client
Platform-neutral TypeScript client logic (`@aliasvault/client`): API access, SRP and key hierarchy, vault sync and codec, sharing, the SQLite repositories and item helpers.

## assets
Shared image assets (logos, app icons, third-party logos) copied as-is into the apps by `assets/sync.sh`. See [assets/README.md](assets/README.md).

## models
TypeScript models that are auto-generated to platform-specific code:
- TypeScript (source of truth)
- C# (.NET)
- Swift (iOS)
- Kotlin (Android)

## vault
Vault database schema and SQL utilities for:
- Browser extension
- Mobile apps (React Native)
- Web app

