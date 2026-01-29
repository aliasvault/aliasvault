# Core Libraries

This folder contains core modules that are used by multiple applications in the AliasVault monorepo.

## rust (Primary)

**Primary cross-platform core library** written in Rust, providing shared business logic across ALL platforms:
- Browser extensions (Chrome, Firefox, Edge, Safari) via WebAssembly
- Mobile apps (iOS via Swift bindings, Android via Kotlin bindings)
- Server (.NET via P/Invoke)
- Desktop apps (future)

Currently implements:
- **merge** - Merges two SQLite vault databases using Last-Write-Wins (LWW) strategy
- **credential_matcher** - Cross-platform credential filtering for autofill

See [rust/README.md](rust/README.md) for detailed documentation.

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
- Web client (Blazor)

## typescript/ (Legacy)

Legacy TypeScript implementations that may be migrated to Rust in the future:

### typescript/identity-generator

TypeScript identity generator used by:
- Browser extension (React and custom TypeScript)
- Mobile apps (React Native)

### typescript/password-generator

TypeScript password generator used by:
- Browser extension (React and custom TypeScript)
- Mobile apps (React Native)
