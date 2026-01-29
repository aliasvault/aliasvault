# AliasVault Rust Core

Cross-platform core library providing shared business logic for all AliasVault clients:

- **Browser Extensions** (Chrome, Firefox, Edge, Safari via WASM)
- **Mobile Apps** (iOS via Swift bindings, Android via Kotlin bindings)
- **Server** (.NET via P/Invoke - currently only scaffolding, not actively used)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Rust Core Library                               │
│                                                                         │
│  src/                                                                   │
│  ├── lib.rs              Entry point, module exports                    │
│  ├── error.rs            VaultError type                                │
│  ├── vault_merge/        LWW merge algorithm                            │
│  ├── vault_pruner/       Trash retention cleanup                        │
│  └── credential_matcher/ Autofill filtering                             │
│                                                                         │
│  Platform Interfaces:                                                   │
│  ├── wasm.rs             WASM bindings (#[wasm_bindgen])                │
│  ├── uniffi_api.rs       UniFFI bindings (#[uniffi::export])            │
│  └── ffi.rs              C FFI for .NET (extern "C")                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
         ▼                          ▼                          ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   WASM Module   │      │   UniFFI (FFI)  │      │   C FFI (.NET)  │
│  wasm-bindgen   │      │ Swift + Kotlin  │      │    P/Invoke     │
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│    Browser      │      │   iOS & Android │      │     Server      │
│   Extensions    │      │   Mobile Apps   │      │     (.NET)      │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

## Core Modules

### vault_merge
Last-Write-Wins (LWW) merge algorithm for syncing local and server vaults.

### vault_pruner
Permanently deletes items in trash older than retention period (default: 30 days).

### credential_matcher
Priority-based credential filtering for autofill with anti-phishing protection.

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

---

# Developer Guide

This section documents the interface structure and how to add new functionality.

## Interface Overview

The Rust core exposes functions through three interface files, each targeting different platforms:

| Interface | File | Platforms | Attribute |
|-----------|------|-----------|-----------|
| WASM | `src/wasm.rs` | Browser extensions | `#[wasm_bindgen]` |
| UniFFI | `src/uniffi_api.rs` | iOS, Android | `#[uniffi::export]` |
| C FFI | `src/ffi.rs` | .NET Server | `#[no_mangle] extern "C"` |

All interfaces follow a JSON-in/JSON-out pattern for simplicity. Each platform handles its own database I/O and passes data as JSON to Rust.

## Current Exported Functions

| Function | WASM | UniFFI | C FFI | Description |
|----------|------|--------|-------|-------------|
| `getSyncableTableNames` | ✓ | ✓ | ✓ | Returns list of syncable table names |
| `mergeVaults` / `mergeVaultsJson` | ✓ | ✓ (JSON only) | ✓ | LWW merge of local + server vaults |
| `pruneVault` / `pruneVaultJson` | ✓ | ✓ (JSON only) | ✓ | Remove expired trash items |
| `filterCredentials` / `filterCredentialsJson` | ✓ | ✓ (JSON only) | ✓ | Credential matching for autofill |
| `extractDomain` | ✓ | ✓ | - | Extract domain from URL |
| `extractRootDomain` | ✓ | ✓ | - | Extract root domain (handles .co.uk etc) |

## Adding a New Function

When adding a new module or function to the Rust core, you need to update multiple files. Follow this checklist:

### 1. Implement the Core Logic

Create or update a module in `src/`:

```rust
// src/my_module/mod.rs

use serde::{Deserialize, Serialize};
use crate::error::VaultResult;

#[derive(Serialize, Deserialize)]
pub struct MyInput {
    pub data: String,
}

#[derive(Serialize, Deserialize)]
pub struct MyOutput {
    pub result: String,
}

/// Core function with typed input/output.
pub fn my_function(input: MyInput) -> VaultResult<MyOutput> {
    // Implementation
    Ok(MyOutput { result: input.data })
}

/// JSON wrapper for cross-platform convenience.
pub fn my_function_json(input_json: &str) -> VaultResult<String> {
    let input: MyInput = serde_json::from_str(input_json)?;
    let output = my_function(input)?;
    Ok(serde_json::to_string(&output)?)
}
```

### 2. Export from lib.rs

```rust
// src/lib.rs

pub mod my_module;
pub use my_module::{my_function, MyInput, MyOutput};
```

### 3. Add WASM Bindings (src/wasm.rs)

```rust
use crate::my_module::{my_function, MyInput, MyOutput};

/// Typed API - accepts/returns JsValue.
#[wasm_bindgen(js_name = myFunction)]
pub fn my_function_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: MyInput = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse input: {}", e)))?;

    let output: MyOutput = my_function(input)
        .map_err(|e| JsValue::from_str(&format!("Failed: {}", e)))?;

    serde_wasm_bindgen::to_value(&output)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize: {}", e)))
}

/// JSON API - accepts/returns strings.
#[wasm_bindgen(js_name = myFunctionJson)]
pub fn my_function_json_js(input_json: &str) -> Result<String, JsValue> {
    crate::my_module::my_function_json(input_json)
        .map_err(|e| JsValue::from_str(&format!("Failed: {}", e)))
}
```

### 4. Add UniFFI Bindings (src/uniffi_api.rs)

```rust
use crate::error::VaultError;

/// JSON API only - UniFFI handles type conversion automatically.
#[uniffi::export]
pub fn my_function_json(input_json: String) -> Result<String, VaultError> {
    crate::my_module::my_function_json(&input_json)
}
```

### 5. Add C FFI Bindings (src/ffi.rs) - If Needed for .NET

```rust
/// C-compatible function for .NET P/Invoke.
///
/// # Safety
/// - `input_json` must be a valid null-terminated C string
/// - Returned pointer must be freed with `free_string()`
#[no_mangle]
pub unsafe extern "C" fn my_function_ffi(input_json: *const c_char) -> *mut c_char {
    if input_json.is_null() {
        return ptr::null_mut();
    }

    let c_str = match CStr::from_ptr(input_json).to_str() {
        Ok(s) => s,
        Err(_) => return ptr::null_mut(),
    };

    let input: MyInput = match serde_json::from_str(c_str) {
        Ok(i) => i,
        Err(e) => return create_error_response(&format!("Parse failed: {}", e)),
    };

    let output = match my_function(input) {
        Ok(o) => o,
        Err(e) => return create_error_response(&format!("Failed: {}", e)),
    };

    match serde_json::to_string(&output) {
        Ok(json) => string_to_c_char(json),
        Err(e) => create_error_response(&format!("Serialize failed: {}", e)),
    }
}
```

### 6. Update Cargo.toml Features (If Needed)

If your module requires additional dependencies, ensure they're properly feature-gated:

```toml
[features]
wasm = ["dep:wasm-bindgen", "dep:serde-wasm-bindgen"]
uniffi = ["dep:uniffi"]
ffi = []

[dependencies]
my-new-dep = { version = "1.0", optional = true }
```

### 7. Add Tests

```rust
// In src/my_module/mod.rs or src/my_module/tests.rs

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_my_function() {
        let input = MyInput { data: "test".to_string() };
        let output = my_function(input).unwrap();
        assert_eq!(output.result, "test");
    }

    #[test]
    fn test_my_function_json() {
        let input = r#"{"data": "test"}"#;
        let output = my_function_json(input).unwrap();
        assert!(output.contains("test"));
    }
}
```

### 8. Build and Distribute

```bash
# Build for all targets you support
./build.sh --browser --ios --android

# Or just the ones you need during development
./build.sh --browser
```

## Platform Consumption

After building, the outputs are distributed to:

| Platform | Output Location | Files |
|----------|----------------|-------|
| Browser Extension | `apps/browser-extension/src/utils/dist/core/rust/` | `aliasvault_core.js`, `.wasm`, `.d.ts` |
| Blazor WASM | `apps/server/AliasVault.Client/wwwroot/wasm/` | `aliasvault_core.js`, `.wasm` |
| iOS | `apps/mobile-app/ios/VaultStoreKit/RustCore/` | `.a`, `.h`, `.swift` |
| Android | `apps/mobile-app/android/app/src/main/jniLibs/` | `.so` per ABI + `.kt` |

### Browser Extension Usage

```typescript
import init, { myFunction, myFunctionJson } from '@/utils/dist/core/rust/aliasvault_core.js';

// Initialize once
await init(wasmBytes);

// Typed API
const result = myFunction({ data: "test" });

// JSON API
const jsonResult = myFunctionJson('{"data": "test"}');
```

### iOS Usage (Swift)

```swift
// Generated UniFFI bindings in aliasvault_core.swift
let result = try myFunctionJson(inputJson: jsonString)
```

### Android Usage (Kotlin)

```kotlin
// Generated UniFFI bindings
val result = uniffi.aliasvault_core.myFunctionJson(jsonString)
```

## Design Decisions

### JSON-First Communication

All interfaces use JSON strings for input/output. This simplifies:
- Cross-language type marshalling
- Debugging (human-readable)
- Consistency across platforms

For WASM, we also provide typed APIs using `serde-wasm-bindgen` for better TypeScript integration.

### Feature Flags

| Feature | Purpose | Used By |
|---------|---------|---------|
| `uniffi` | UniFFI runtime support | iOS/Android builds |
| `uniffi-cli` | UniFFI binding generator | Build script only |
| `wasm` | WASM + JS interop | Browser extension |
| `ffi` | C-compatible exports | .NET server |

Use `uniffi` (not `uniffi-cli`) for library builds to avoid pulling in heavy bindgen dependencies.

### Error Handling

Use `VaultError` from `src/error.rs` for all errors:

```rust
use crate::error::{VaultError, VaultResult};

pub fn my_function() -> VaultResult<String> {
    // serde errors auto-convert via From impl
    let data: MyType = serde_json::from_str(json)?;

    // Manual error creation
    if data.invalid {
        return Err(VaultError::General("Invalid data".to_string()));
    }

    Ok("success".to_string())
}
```

## File Reference

| File | Purpose |
|------|---------|
| `src/lib.rs` | Entry point, exports all modules |
| `src/error.rs` | `VaultError` and `VaultResult` types |
| `src/vault_merge/mod.rs` | LWW merge implementation |
| `src/vault_merge/types.rs` | Table configurations, composite keys |
| `src/vault_pruner/mod.rs` | Trash cleanup implementation |
| `src/credential_matcher/mod.rs` | Autofill filtering algorithm |
| `src/credential_matcher/domain.rs` | URL/domain extraction utilities |
| `src/credential_matcher/stop_words.rs` | Text filtering for service name matching |
| `src/wasm.rs` | WASM bindings (browser) |
| `src/uniffi_api.rs` | UniFFI bindings (iOS/Android) |
| `src/ffi.rs` | C FFI bindings (.NET) |
| `uniffi-bindgen.rs` | UniFFI CLI binary entry point |
| `build.sh` | Multi-platform build script |
| `Cargo.toml` | Dependencies and feature flags |