# AliasVault Rust Core

Cross-platform core library providing shared business logic for all AliasVault clients:

- **Browser Extensions** (Chrome, Firefox, Edge, Safari via WASM)
- **Web App and Blazor Client** (via the same WASM build)
- **Mobile Apps** (iOS via Swift bindings, Android via Kotlin bindings)
- **.NET** (C FFI exports for P/Invoke, built with `--dotnet`; nothing consumes them yet)

## Core Modules

### vault_model
The client vault datamodel registry (tables, keys, scoping, bucket layout), generated from
`core/models/src/vault/VaultTableRegistry.ts`.

### vault_codec
The manifest-v1 storage format: canonicalize the local SQLite tables into manifests, data buckets and
content-addressed blobs, and materialize them back.

### vault_merge
Last-Write-Wins (LWW) merge of a local vault onto the server's, one manifest at a time, rows out.

### vault_sharing
Which manifests a push writes and which the account can still open, for multi-manifest (shared) vaults.

### vault_pruner
Permanently deletes items in trash older than retention period (default: 30 days).

### vault_sync
The sync engine every client drives: a sans-IO command loop that asks the host for HTTP, state and
SQLite access and runs the status check, pull, merge, push and the storage-format migration.

### sqlite_host
An in-memory SQLite database (`SqliteMemoryDatabase`) that hosts every client's vault, so no platform
needs its own SQLite build or writes plaintext to disk.

### credential_matcher
Priority-based credential filtering for autofill with anti-phishing protection.

### email_parser
RFC 822 email parsing into html/plain bodies and attachment metadata, with on-demand attachment bytes.

### favicon
Which of an item's URLs a favicon is fetched from, and the `Logos.Source` key it is stored under.

### password_generator
Password and passphrase (Diceware) generation with embedded per-language wordlists.

### identity_generator
Random identity (alias persona) generation: names from embedded per-language dictionaries
(decade-based for de/it/ro), birth date, email prefix and username. See
`src/identity_generator/dictionaries/README.md` for the dictionary format.

### crypto
Argon2id key derivation, AES-256-GCM, RSA-OAEP key grants, the account key hierarchy and the SRP-6a handshake.

### timestamp and error
The vault datetime formats plus the `UpdatedAt` comparison the merge relies on, and the `VaultError`
type with the JSON-in/JSON-out call helper the bindings share.

## Building

```bash
./build.sh --web                # WASM for the web app and Blazor client
./build.sh --browser-extension  # WASM for the browser extension
./build.sh --ios                # iOS device + simulator with Swift bindings
./build.sh --android            # Android ABIs with Kotlin bindings
./build.sh --dotnet             # Native library for .NET
./build.sh --mobile             # iOS + Android
./build.sh --all                # All targets (WASM as --web)
```

Only the web app (fetched on page load) builds with the size-optimized `release` profile. The browser extension
(`extension` profile), iOS and Android (`mobile` profile) and .NET (`dotnet` profile) build with `opt-level = 3`, which
trades a few megabytes for faster sync, since those ship as a one time download or run server-side. Both WASM builds write to `core/client/wasm`, so locally the
apps run whichever was built last. Every build bundles SQLite behind
`SqliteMemoryDatabase` (the .NET C exports included), which hosts every client's vault database in
memory (the sync engine's staging database included), so all clients run one SQLite build and the phones never
write plaintext to disk. On wasm32 that SQLite is compiled by clang (sqlite-wasm-rs); macOS needs Homebrew LLVM
(`brew install llvm`), which `build.sh` finds on its own.

## Testing

```bash
cargo test                    # All tests
cargo test vault_merge        # Specific module
cargo test --features uniffi  # With UniFFI enabled
```
