//! WASM bindings for browser extension.

use wasm_bindgen::prelude::*;

use crate::credential_matcher::{
    filter_credentials, CredentialMatcherInput, CredentialMatcherOutput,
};
use crate::merge::{merge_vaults, MergeInput, MergeOutput};

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    pub fn log(s: &str);
}

/// Initialize panic hook for better error messages.
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// Get the list of table names that need to be synced.
#[wasm_bindgen(js_name = getSyncableTableNames)]
pub fn get_syncable_table_names() -> Vec<String> {
    crate::merge::SYNCABLE_TABLE_NAMES
        .iter()
        .map(|s| s.to_string())
        .collect()
}

/// Merge vaults using LWW strategy.
///
/// Takes a JsValue (MergeInput) and returns a JsValue (MergeOutput).
#[wasm_bindgen(js_name = mergeVaults)]
pub fn merge_vaults_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: MergeInput = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse input: {}", e)))?;

    let output: MergeOutput = merge_vaults(input)
        .map_err(|e| JsValue::from_str(&format!("Merge failed: {}", e)))?;

    serde_wasm_bindgen::to_value(&output)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize output: {}", e)))
}

/// Merge vaults using JSON strings (alternative API).
///
/// Takes a JSON string and returns a JSON string.
#[wasm_bindgen(js_name = mergeVaultsJson)]
pub fn merge_vaults_json_js(input_json: &str) -> Result<String, JsValue> {
    crate::merge::merge_vaults_json(input_json)
        .map_err(|e| JsValue::from_str(&format!("Merge failed: {}", e)))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Credential Matcher WASM Bindings
// ═══════════════════════════════════════════════════════════════════════════════

/// Filter credentials for autofill.
///
/// Takes a JsValue (CredentialMatcherInput) and returns a JsValue (CredentialMatcherOutput).
#[wasm_bindgen(js_name = filterCredentials)]
pub fn filter_credentials_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: CredentialMatcherInput = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse input: {}", e)))?;

    let output: CredentialMatcherOutput = filter_credentials(input);

    serde_wasm_bindgen::to_value(&output)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize output: {}", e)))
}

/// Filter credentials using JSON strings (alternative API).
///
/// Takes a JSON string and returns a JSON string.
#[wasm_bindgen(js_name = filterCredentialsJson)]
pub fn filter_credentials_json_js(input_json: &str) -> Result<String, JsValue> {
    crate::credential_matcher::filter_credentials_json(input_json)
        .map_err(|e| JsValue::from_str(&e))
}

/// Extract domain from URL.
///
/// Handles both full URLs and partial domains, returning normalized domain
/// without protocol, www prefix, path, query, or fragment.
#[wasm_bindgen(js_name = extractDomain)]
pub fn extract_domain_js(url: &str) -> String {
    crate::credential_matcher::extract_domain(url)
}

/// Extract root domain from a domain string.
///
/// E.g., "sub.example.com" -> "example.com"
/// E.g., "sub.example.co.uk" -> "example.co.uk"
#[wasm_bindgen(js_name = extractRootDomain)]
pub fn extract_root_domain_js(domain: &str) -> String {
    crate::credential_matcher::extract_root_domain(domain)
}
