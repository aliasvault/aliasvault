//! Host bindings: wasm-bindgen for the browser, UniFFI for Swift and Kotlin.

#[cfg(feature = "wasm")]
pub mod wasm;

#[cfg(feature = "uniffi")]
pub mod uniffi_api;
