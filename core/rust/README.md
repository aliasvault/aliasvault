# AliasVault Rust Core

Cross-platform core library providing shared business logic for all AliasVault clients:

- **Browser Extensions** (Chrome, Firefox, Edge, Safari via WASM)
- **Mobile Apps** (iOS via Swift bindings, Android via Kotlin bindings)
- **Server** (.NET via P/Invoke - prepared, not yet consumed by current API version)

## Core Modules

### vault_model
The client vault datamodel registry (tables, keys, scoping, bucket layout), generated from
`core/models/src/vault/VaultTableRegistry.ts`.

### vault_codec
The manifest-v1 storage format: canonicalize the local SQLite tables into manifests, data buckets and
content-addressed blobs, and materialize them back.

### vault_merge
Last-Write-Wins (LWW) merge of a local vault onto the server's, one manifest at a time, rows out.

### vault_pruner
Permanently deletes items in trash older than retention period (default: 30 days).

### credential_matcher
Priority-based credential filtering for autofill with anti-phishing protection.

### password_generator
Password and passphrase (Diceware) generation with embedded per-language wordlists.

### identity_generator
Random identity (alias persona) generation: names from embedded per-language dictionaries
(decade-based for de/it/ro), birth date, email prefix and username. See
`src/identity_generator/dictionaries/README.md` for the dictionary format.

## Building

```bash
./build.sh --browser    # WASM for browser extension
./build.sh --ios        # iOS device + simulator with Swift bindings
./build.sh --android    # Android ABIs with Kotlin bindings
./build.sh --dotnet     # Native library for .NET
./build.sh --mobile     # iOS + Android
./build.sh --all        # All targets
```

## Testing

```bash
cargo test                    # All tests
cargo test vault_merge        # Specific module
cargo test --features uniffi  # With UniFFI enabled
```
