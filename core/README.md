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
- **password_generator** - Password and passphrase (Diceware) generation
- **identity_generator** - Random identity (alias persona) generation with per-language name dictionaries

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

