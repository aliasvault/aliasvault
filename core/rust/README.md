# AliasVault Rust Core

Cross-platform core library for AliasVault, providing shared business logic for **native platforms**:
- **Mobile Apps** (iOS via Swift bindings, Android via Kotlin bindings)
- **Server** (.NET via P/Invoke)
- **Desktop Apps** (future)

> **Note:** Browser extensions use the TypeScript [VaultMergeService](../../apps/browser-extension/src/utils/VaultMergeService.ts) with sql.js (pre-compiled SQLite WASM). This is more efficient than re-compiling SQLite via Rust to WASM.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Rust Core Library                                │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  src/lib.rs          - Main library entry point                     ││
│  │  src/merge.rs        - Vault merge service (LWW strategy)           ││
│  │  src/types.rs        - Common types and table configurations        ││
│  │  src/error.rs        - Error types                                  ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
         ▼                          ▼                          ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   UniFFI (FFI)  │      │   UniFFI (FFI)  │      │   C FFI (.NET)  │
│ Swift bindings  │      │ Kotlin bindings │      │    P/Invoke     │
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   iOS Mobile    │      │ Android Mobile  │      │     Server      │
│      App        │      │      App        │      │     (.NET)      │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

## Prerequisites

### Required
- **Rust** (1.70+): Install via [rustup](https://rustup.rs/)
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```

### For iOS builds (macOS only)
- **Xcode** with command line tools

### For Android builds
- **Android NDK**: Set `ANDROID_NDK_HOME` environment variable
- **cargo-ndk**: For Android cross-compilation (installed automatically)
  ```bash
  cargo install cargo-ndk
  ```

## Building

### Build all targets
```bash
./build.sh
```

### Build specific targets
```bash
./build.sh --ios       # iOS only (macOS required)
./build.sh --android   # Android only (NDK required)
./build.sh --csharp    # C#/.NET only
```

### Manual builds (for development)
```bash
# iOS (device)
cargo build --release --target aarch64-apple-ios --features uniffi

# Android (arm64)
cargo ndk --target aarch64-linux-android --platform 21 -- build --release --features uniffi

# Native (current platform)
cargo build --release
```

## Output Structure

After building, artifacts are placed in `dist/` and distributed to consumer apps:

```
dist/
├── ios/                     # iOS libraries
│   ├── device/
│   │   └── libaliasvault_core.a
│   ├── simulator/
│   │   └── libaliasvault_core.a (universal)
│   └── aliasvault_core.swift
├── android/                 # Android libraries
│   ├── arm64-v8a/
│   │   └── libaliasvault_core.so
│   ├── armeabi-v7a/
│   │   └── libaliasvault_core.so
│   ├── x86_64/
│   │   └── libaliasvault_core.so
│   ├── x86/
│   │   └── libaliasvault_core.so
│   └── aliasvault_core.kt
└── csharp/                  # C# libraries
    ├── osx-arm64/
    │   └── libaliasvault_core.dylib
    ├── osx-x64/
    │   └── libaliasvault_core.dylib
    ├── linux-x64/
    │   └── libaliasvault_core.so
    └── VaultMergeService.cs
```

## Usage

### Swift (iOS)

```swift
import AliasVaultCore

let mergeService = VaultMergeService()

do {
    let result = try mergeService.merge(
        localVaultBase64: localVault,
        serverVaultBase64: serverVault
    )

    print("Merged \(result.stats.tablesProcessed) tables")
    print("New vault: \(result.mergedVaultBase64.prefix(50))...")
} catch {
    print("Merge failed: \(error)")
}
```

### Kotlin (Android)

```kotlin
import net.aliasvault.core.VaultMergeService

val mergeService = VaultMergeService()

try {
    val result = mergeService.merge(
        localVaultBase64 = localVault,
        serverVaultBase64 = serverVault
    )

    println("Merged ${result.stats.tablesProcessed} tables")
    println("Conflicts: ${result.stats.conflicts}")
} catch (e: Exception) {
    println("Merge failed: ${e.message}")
}
```

### C# (.NET)

```csharp
using AliasVault.Shared.RustCore;

var result = VaultMergeService.Merge(localVaultBase64, serverVaultBase64);

Console.WriteLine($"Merged {result.Stats.TablesProcessed} tables");
Console.WriteLine($"Conflicts: {result.Stats.Conflicts}");
Console.WriteLine($"Records from server: {result.Stats.RecordsFromServer}");
```

## Development

### Running tests
```bash
cargo test
```

### Checking code
```bash
cargo clippy
cargo fmt --check
```

### Adding new functionality

1. Add Rust implementation in `src/`
2. Update `src/aliasvault_core.udl` for UniFFI bindings
3. Run `./build.sh` to generate all bindings

## Binary Size Considerations

The compiled native libraries include SQLite bundled statically. Approximate sizes:

| Target | Approximate Size |
|--------|-----------------|
| iOS (arm64 static) | ~20MB |
| Android (arm64 shared) | ~2-3MB |
| macOS (.dylib) | ~16KB (dynamic) |

> **Note:** Binaries are NOT committed to the repository. They are built:
> 1. Locally via `./build.sh` when needed
> 2. In CI pipelines for deployment
> 3. In Docker builds for containerized deployments

## Why Rust for Native, TypeScript for Browser?

- **Browser Extensions**: Already use sql.js (SQLite compiled to WASM). Re-compiling SQLite via Rust to WASM adds complexity without benefit since sql.js already handles this well.
- **Native Platforms**: Rust compiles to native code with excellent SQLite support. UniFFI generates idiomatic Swift/Kotlin bindings automatically.
- **Consistency**: Both implementations follow the same LWW merge algorithm, ensuring identical behavior across all platforms.

## License

MIT License - see the main AliasVault repository for details.
