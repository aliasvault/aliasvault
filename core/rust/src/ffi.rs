//! C FFI exports for .NET P/Invoke.
//!
//! These functions provide a C-compatible interface for calling Rust functions from C#.
//! All functions use JSON strings for input/output to simplify marshalling.

use std::ffi::{c_char, CStr, CString};
use std::ptr;

use crate::credential_matcher::{filter_credentials, CredentialMatcherInput};
use crate::vault_merge::{merge_vaults, MergeInput, SYNCABLE_TABLE_NAMES};
use crate::vault_pruner::{prune_vault, PruneInput};

/// Merge two vaults using LWW strategy.
///
/// # Safety
///
/// - `input_json` must be a valid null-terminated C string
/// - The returned pointer must be freed by calling `free_string`
///
/// # Returns
///
/// A null-terminated C string containing the JSON result (MergeOutput).
/// Returns null on error.
#[no_mangle]
pub unsafe extern "C" fn merge_vaults_ffi(input_json: *const c_char) -> *mut c_char {
    if input_json.is_null() {
        return ptr::null_mut();
    }

    let c_str = match CStr::from_ptr(input_json).to_str() {
        Ok(s) => s,
        Err(_) => return ptr::null_mut(),
    };

    let input: MergeInput = match serde_json::from_str(c_str) {
        Ok(i) => i,
        Err(e) => {
            return create_error_response(&format!("Failed to parse input: {}", e));
        }
    };

    let output = match merge_vaults(input) {
        Ok(o) => o,
        Err(e) => {
            return create_error_response(&format!("Merge failed: {}", e));
        }
    };

    match serde_json::to_string(&output) {
        Ok(json) => string_to_c_char(json),
        Err(e) => create_error_response(&format!("Failed to serialize output: {}", e)),
    }
}

/// Prune expired items from trash.
///
/// Items with DeletedAt older than retention_days are marked as permanently deleted.
///
/// # Safety
///
/// - `input_json` must be a valid null-terminated C string
/// - The returned pointer must be freed by calling `free_string`
///
/// # Returns
///
/// A null-terminated C string containing the JSON result (PruneOutput).
/// Returns null on error.
#[no_mangle]
pub unsafe extern "C" fn prune_vault_ffi(input_json: *const c_char) -> *mut c_char {
    if input_json.is_null() {
        return ptr::null_mut();
    }

    let c_str = match CStr::from_ptr(input_json).to_str() {
        Ok(s) => s,
        Err(_) => return ptr::null_mut(),
    };

    let input: PruneInput = match serde_json::from_str(c_str) {
        Ok(i) => i,
        Err(e) => {
            return create_error_response(&format!("Failed to parse input: {}", e));
        }
    };

    let output = match prune_vault(input) {
        Ok(o) => o,
        Err(e) => {
            return create_error_response(&format!("Prune failed: {}", e));
        }
    };

    match serde_json::to_string(&output) {
        Ok(json) => string_to_c_char(json),
        Err(e) => create_error_response(&format!("Failed to serialize output: {}", e)),
    }
}

/// Filter credentials for autofill.
///
/// # Safety
///
/// - `input_json` must be a valid null-terminated C string
/// - The returned pointer must be freed by calling `free_string`
///
/// # Returns
///
/// A null-terminated C string containing the JSON result (CredentialMatcherOutput).
/// Returns null on error.
#[no_mangle]
pub unsafe extern "C" fn filter_credentials_ffi(input_json: *const c_char) -> *mut c_char {
    if input_json.is_null() {
        return ptr::null_mut();
    }

    let c_str = match CStr::from_ptr(input_json).to_str() {
        Ok(s) => s,
        Err(_) => return ptr::null_mut(),
    };

    let input: CredentialMatcherInput = match serde_json::from_str(c_str) {
        Ok(i) => i,
        Err(e) => {
            return create_error_response(&format!("Failed to parse input: {}", e));
        }
    };

    let output = filter_credentials(input);

    match serde_json::to_string(&output) {
        Ok(json) => string_to_c_char(json),
        Err(e) => create_error_response(&format!("Failed to serialize output: {}", e)),
    }
}

/// Get the list of syncable table names as a JSON array.
///
/// # Safety
///
/// - The returned pointer must be freed by calling `free_string`
///
/// # Returns
///
/// A null-terminated C string containing a JSON array of table names.
#[no_mangle]
pub extern "C" fn get_syncable_table_names_ffi() -> *mut c_char {
    let names = crate::vault_merge::merge_table_names();
    match serde_json::to_string(&names) {
        Ok(json) => string_to_c_char(json),
        Err(_) => ptr::null_mut(),
    }
}

/// Get the per-table SELECT queries used to build prune input, as a JSON array
/// of `{ "name": ..., "query": ... }` objects. Blob columns are reduced to a
/// 1-byte presence marker to avoid serializing large binary data to JSON.
#[no_mangle]
pub extern "C" fn get_prune_table_queries_ffi() -> *mut c_char {
    match serde_json::to_string(&crate::vault_pruner::get_prune_table_queries()) {
        Ok(json) => string_to_c_char(json),
        Err(_) => ptr::null_mut(),
    }
}

/// Free a string that was allocated by Rust.
///
/// # Safety
///
/// - `s` must be a pointer that was returned by one of the FFI functions
/// - This function must only be called once per pointer
/// - After calling this function, the pointer is invalid
#[no_mangle]
pub unsafe extern "C" fn free_string(s: *mut c_char) {
    if !s.is_null() {
        drop(CString::from_raw(s));
    }
}

/// Convert a Rust string to a C string pointer.
fn string_to_c_char(s: String) -> *mut c_char {
    match CString::new(s) {
        Ok(c_string) => c_string.into_raw(),
        Err(_) => ptr::null_mut(),
    }
}

/// Create an error response JSON string.
fn create_error_response(message: &str) -> *mut c_char {
    let error_json = format!(r#"{{"success":false,"error":"{}"}}"#, message.replace('"', r#"\""#));
    string_to_c_char(error_json)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Vault Codec FFI Functions (manifest-v1 storage format)
// ═══════════════════════════════════════════════════════════════════════════════

/// Read a JSON c-string argument, returning an error response on null / invalid UTF-8.
macro_rules! ffi_read_str {
    ($ptr:expr, $name:literal) => {{
        if $ptr.is_null() {
            return create_error_response(concat!("Null pointer argument: ", $name));
        }
        match CStr::from_ptr($ptr).to_str() {
            Ok(s) => s,
            Err(_) => return create_error_response(concat!("Invalid UTF-8 in ", $name)),
        }
    }};
}

/// Wrap a `fn(&str) -> VaultResult<String>` codec entry point as a C FFI function.
unsafe fn codec_json_ffi(
    input_json: *const c_char,
    arg_name: &'static str,
    f: impl Fn(&str) -> crate::error::VaultResult<String>,
) -> *mut c_char {
    if input_json.is_null() {
        return create_error_response(&format!("Null pointer argument: {}", arg_name));
    }
    let c_str = match CStr::from_ptr(input_json).to_str() {
        Ok(s) => s,
        Err(_) => return create_error_response(&format!("Invalid UTF-8 in {}", arg_name)),
    };
    match f(c_str) {
        Ok(json) => string_to_c_char(json),
        Err(e) => create_error_response(&format!("vault_codec error: {}", e)),
    }
}

/// Canonicalize normalized tables. Input: `CanonicalizeInput` JSON. Output: `CanonicalizedVault` JSON.
///
/// # Safety
/// `input_json` must be a valid null-terminated C string; free the result with `free_string`.
#[no_mangle]
pub unsafe extern "C" fn vault_codec_canonicalize_from_sqlite_ffi(input_json: *const c_char) -> *mut c_char {
    codec_json_ffi(input_json, "input_json", crate::vault_codec::canonicalize_from_sqlite_json)
}

/// Materialize manifest + metadata. Input: `MaterializeInput` JSON. Output: `MaterializedTables` JSON.
///
/// # Safety
/// `input_json` must be a valid null-terminated C string; free the result with `free_string`.
#[no_mangle]
pub unsafe extern "C" fn vault_codec_materialize_as_sqlite_ffi(input_json: *const c_char) -> *mut c_char {
    codec_json_ffi(input_json, "input_json", crate::vault_codec::materialize_as_sqlite_json)
}

/// Build a single data bucket. Input: `{ category, tables }` JSON. Output: `DataBucket` JSON.
///
/// # Safety
/// `input_json` must be a valid null-terminated C string; free the result with `free_string`.
#[no_mangle]
pub unsafe extern "C" fn vault_codec_extract_bucket_ffi(input_json: *const c_char) -> *mut c_char {
    codec_json_ffi(input_json, "input_json", crate::vault_codec::extract_bucket_json)
}

/// Validate a manifest. Input: `Manifest` JSON. Output: `ValidationResult` JSON.
///
/// # Safety
/// `input_json` must be a valid null-terminated C string; free the result with `free_string`.
#[no_mangle]
pub unsafe extern "C" fn vault_codec_validate_manifest_ffi(input_json: *const c_char) -> *mut c_char {
    codec_json_ffi(input_json, "input_json", crate::vault_codec::validate_manifest_json)
}

/// Validate a data bucket. Input: `DataBucket` JSON. Output: `ValidationResult` JSON.
///
/// # Safety
/// `input_json` must be a valid null-terminated C string; free the result with `free_string`.
#[no_mangle]
pub unsafe extern "C" fn vault_codec_validate_data_bucket_ffi(input_json: *const c_char) -> *mut c_char {
    codec_json_ffi(input_json, "input_json", crate::vault_codec::validate_data_bucket_json)
}

/// The bucket layout: `[{ category, tables: [<name>] }]` JSON.
///
/// # Safety
/// Free the result with `free_string`.
#[no_mangle]
pub extern "C" fn vault_codec_bucket_layout_ffi() -> *mut c_char {
    match crate::vault_codec::bucket_layout_json() {
        Ok(json) => string_to_c_char(json),
        Err(e) => create_error_response(&format!("vault_codec error: {}", e)),
    }
}

/// Generate a fresh per-user salt (lowercase hex).
///
/// # Safety
/// Free the result with `free_string`.
#[no_mangle]
pub extern "C" fn vault_codec_generate_user_salt_ffi() -> *mut c_char {
    string_to_c_char(crate::vault_codec::generate_user_salt())
}

/// SHA-256 (lowercase hex) of a base64 ciphertext string.
///
/// # Safety
/// `base64_ciphertext` must be a valid null-terminated C string; free the result with `free_string`.
#[no_mangle]
pub unsafe extern "C" fn vault_codec_compute_ciphertext_hash_ffi(base64_ciphertext: *const c_char) -> *mut c_char {
    let s = ffi_read_str!(base64_ciphertext, "base64_ciphertext");
    string_to_c_char(crate::vault_codec::compute_ciphertext_hash(s))
}

/// Pack a payload JSON string. Output: base64 of gzip(envelope{contentHash, payload}). The caller
/// base64-decodes, then encrypts.
///
/// # Safety
/// `payload_json` must be a valid null-terminated C string; free the result with `free_string`.
#[no_mangle]
pub unsafe extern "C" fn vault_codec_pack_payload_ffi(payload_json: *const c_char) -> *mut c_char {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;
    let s = ffi_read_str!(payload_json, "payload_json");
    match crate::vault_codec::pack_payload(s) {
        Ok(bytes) => string_to_c_char(BASE64.encode(bytes)),
        Err(e) => create_error_response(&format!("pack_payload error: {}", e)),
    }
}

/// Unpack a payload supplied as base64 of the decrypted bytes. Output: payload JSON string.
///
/// # Safety
/// `base64_plain_bytes` must be a valid null-terminated C string; free the result with `free_string`.
#[no_mangle]
pub unsafe extern "C" fn vault_codec_unpack_payload_ffi(base64_plain_bytes: *const c_char) -> *mut c_char {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;
    let s = ffi_read_str!(base64_plain_bytes, "base64_plain_bytes");
    let bytes = match BASE64.decode(s) {
        Ok(b) => b,
        Err(e) => return create_error_response(&format!("invalid base64: {}", e)),
    };
    match crate::vault_codec::unpack_payload(&bytes) {
        Ok(json) => string_to_c_char(json),
        Err(e) => create_error_response(&format!("unpack_payload error: {}", e)),
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SRP (Secure Remote Password) FFI Functions
// ═══════════════════════════════════════════════════════════════════════════════

/// Generate a cryptographic salt for SRP.
///
/// # Safety
///
/// - The returned pointer must be freed by calling `free_string`
///
/// # Returns
///
/// A null-terminated C string containing the salt as uppercase hex.
#[no_mangle]
pub extern "C" fn srp_generate_salt_ffi() -> *mut c_char {
    string_to_c_char(crate::srp::srp_generate_salt())
}

/// Derive the SRP private key from credentials.
///
/// # Safety
///
/// - All input pointers must be valid null-terminated C strings
/// - The returned pointer must be freed by calling `free_string`
///
/// # Returns
///
/// A null-terminated C string containing the private key as uppercase hex,
/// or an error JSON if the inputs are invalid.
#[no_mangle]
pub unsafe extern "C" fn srp_derive_private_key_ffi(
    salt: *const c_char,
    identity: *const c_char,
    password_hash: *const c_char,
) -> *mut c_char {
    if salt.is_null() || identity.is_null() || password_hash.is_null() {
        return create_error_response("Null pointer argument");
    }

    let salt_str = match CStr::from_ptr(salt).to_str() {
        Ok(s) => s,
        Err(_) => return create_error_response("Invalid UTF-8 in salt"),
    };

    let identity_str = match CStr::from_ptr(identity).to_str() {
        Ok(s) => s,
        Err(_) => return create_error_response("Invalid UTF-8 in identity"),
    };

    let password_hash_str = match CStr::from_ptr(password_hash).to_str() {
        Ok(s) => s,
        Err(_) => return create_error_response("Invalid UTF-8 in password_hash"),
    };

    match crate::srp::srp_derive_private_key(salt_str, identity_str, password_hash_str) {
        Ok(key) => string_to_c_char(key),
        Err(e) => create_error_response(&format!("SRP error: {}", e)),
    }
}

/// Derive the SRP verifier from a private key.
///
/// # Safety
///
/// - `private_key` must be a valid null-terminated C string
/// - The returned pointer must be freed by calling `free_string`
///
/// # Returns
///
/// A null-terminated C string containing the verifier as uppercase hex,
/// or an error JSON if the input is invalid.
#[no_mangle]
pub unsafe extern "C" fn srp_derive_verifier_ffi(private_key: *const c_char) -> *mut c_char {
    if private_key.is_null() {
        return create_error_response("Null pointer argument");
    }

    let private_key_str = match CStr::from_ptr(private_key).to_str() {
        Ok(s) => s,
        Err(_) => return create_error_response("Invalid UTF-8 in private_key"),
    };

    match crate::srp::srp_derive_verifier(private_key_str) {
        Ok(verifier) => string_to_c_char(verifier),
        Err(e) => create_error_response(&format!("SRP error: {}", e)),
    }
}

/// Generate a client ephemeral key pair.
///
/// # Safety
///
/// - The returned pointer must be freed by calling `free_string`
///
/// # Returns
///
/// A null-terminated C string containing JSON: {"public": "...", "secret": "..."}
#[no_mangle]
pub extern "C" fn srp_generate_ephemeral_ffi() -> *mut c_char {
    let ephemeral = crate::srp::srp_generate_ephemeral();
    match serde_json::to_string(&ephemeral) {
        Ok(json) => string_to_c_char(json),
        Err(e) => create_error_response(&format!("Failed to serialize ephemeral: {}", e)),
    }
}

/// Derive the client session from server response.
///
/// # Safety
///
/// - All input pointers must be valid null-terminated C strings
/// - The returned pointer must be freed by calling `free_string`
///
/// # Returns
///
/// A null-terminated C string containing JSON: {"proof": "...", "key": "..."}
/// or an error JSON if inputs are invalid.
#[no_mangle]
pub unsafe extern "C" fn srp_derive_session_ffi(
    client_secret: *const c_char,
    server_public: *const c_char,
    salt: *const c_char,
    identity: *const c_char,
    private_key: *const c_char,
) -> *mut c_char {
    if client_secret.is_null() || server_public.is_null() || salt.is_null()
        || identity.is_null() || private_key.is_null()
    {
        return create_error_response("Null pointer argument");
    }

    let client_secret_str = match CStr::from_ptr(client_secret).to_str() {
        Ok(s) => s,
        Err(_) => return create_error_response("Invalid UTF-8 in client_secret"),
    };

    let server_public_str = match CStr::from_ptr(server_public).to_str() {
        Ok(s) => s,
        Err(_) => return create_error_response("Invalid UTF-8 in server_public"),
    };

    let salt_str = match CStr::from_ptr(salt).to_str() {
        Ok(s) => s,
        Err(_) => return create_error_response("Invalid UTF-8 in salt"),
    };

    let identity_str = match CStr::from_ptr(identity).to_str() {
        Ok(s) => s,
        Err(_) => return create_error_response("Invalid UTF-8 in identity"),
    };

    let private_key_str = match CStr::from_ptr(private_key).to_str() {
        Ok(s) => s,
        Err(_) => return create_error_response("Invalid UTF-8 in private_key"),
    };

    match crate::srp::srp_derive_session(
        client_secret_str,
        server_public_str,
        salt_str,
        identity_str,
        private_key_str,
    ) {
        Ok(session) => match serde_json::to_string(&session) {
            Ok(json) => string_to_c_char(json),
            Err(e) => create_error_response(&format!("Failed to serialize session: {}", e)),
        },
        Err(e) => create_error_response(&format!("SRP error: {}", e)),
    }
}

/// Generate a server ephemeral key pair.
///
/// # Safety
///
/// - `verifier` must be a valid null-terminated C string
/// - The returned pointer must be freed by calling `free_string`
///
/// # Returns
///
/// A null-terminated C string containing JSON: {"public": "...", "secret": "..."}
/// or an error JSON if the input is invalid.
#[no_mangle]
pub unsafe extern "C" fn srp_generate_ephemeral_server_ffi(verifier: *const c_char) -> *mut c_char {
    if verifier.is_null() {
        return create_error_response("Null pointer argument");
    }

    let verifier_str = match CStr::from_ptr(verifier).to_str() {
        Ok(s) => s,
        Err(_) => return create_error_response("Invalid UTF-8 in verifier"),
    };

    match crate::srp::srp_generate_ephemeral_server(verifier_str) {
        Ok(ephemeral) => match serde_json::to_string(&ephemeral) {
            Ok(json) => string_to_c_char(json),
            Err(e) => create_error_response(&format!("Failed to serialize ephemeral: {}", e)),
        },
        Err(e) => create_error_response(&format!("SRP error: {}", e)),
    }
}

/// Derive and verify the server session from client response.
///
/// # Safety
///
/// - All input pointers must be valid null-terminated C strings
/// - The returned pointer must be freed by calling `free_string`
///
/// # Returns
///
/// A null-terminated C string containing JSON:
/// - {"proof": "...", "key": "..."} if client proof is valid
/// - "null" if client proof is invalid (authentication failed)
/// - Error JSON if inputs are invalid
#[no_mangle]
pub unsafe extern "C" fn srp_derive_session_server_ffi(
    server_secret: *const c_char,
    client_public: *const c_char,
    salt: *const c_char,
    identity: *const c_char,
    verifier: *const c_char,
    client_proof: *const c_char,
) -> *mut c_char {
    if server_secret.is_null() || client_public.is_null() || salt.is_null()
        || identity.is_null() || verifier.is_null() || client_proof.is_null()
    {
        return create_error_response("Null pointer argument");
    }

    let server_secret_str = match CStr::from_ptr(server_secret).to_str() {
        Ok(s) => s,
        Err(_) => return create_error_response("Invalid UTF-8 in server_secret"),
    };

    let client_public_str = match CStr::from_ptr(client_public).to_str() {
        Ok(s) => s,
        Err(_) => return create_error_response("Invalid UTF-8 in client_public"),
    };

    let salt_str = match CStr::from_ptr(salt).to_str() {
        Ok(s) => s,
        Err(_) => return create_error_response("Invalid UTF-8 in salt"),
    };

    let identity_str = match CStr::from_ptr(identity).to_str() {
        Ok(s) => s,
        Err(_) => return create_error_response("Invalid UTF-8 in identity"),
    };

    let verifier_str = match CStr::from_ptr(verifier).to_str() {
        Ok(s) => s,
        Err(_) => return create_error_response("Invalid UTF-8 in verifier"),
    };

    let client_proof_str = match CStr::from_ptr(client_proof).to_str() {
        Ok(s) => s,
        Err(_) => return create_error_response("Invalid UTF-8 in client_proof"),
    };

    match crate::srp::srp_derive_session_server(
        server_secret_str,
        client_public_str,
        salt_str,
        identity_str,
        verifier_str,
        client_proof_str,
    ) {
        Ok(Some(session)) => match serde_json::to_string(&session) {
            Ok(json) => string_to_c_char(json),
            Err(e) => create_error_response(&format!("Failed to serialize session: {}", e)),
        },
        Ok(None) => string_to_c_char("null".to_string()),
        Err(e) => create_error_response(&format!("SRP error: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    #[test]
    fn test_get_syncable_table_names() {
        let result = get_syncable_table_names_ffi();
        assert!(!result.is_null());

        unsafe {
            let c_str = CStr::from_ptr(result);
            let json = c_str.to_str().unwrap();
            let names: Vec<String> = serde_json::from_str(json).unwrap();
            assert!(names.contains(&"Items".to_string()));
            assert!(names.contains(&"FieldValues".to_string()));
            free_string(result);
        }
    }

    #[test]
    fn test_null_input() {
        unsafe {
            let result = merge_vaults_ffi(ptr::null());
            assert!(result.is_null());

            let result = prune_vault_ffi(ptr::null());
            assert!(result.is_null());

            let result = filter_credentials_ffi(ptr::null());
            assert!(result.is_null());
        }
    }

    #[test]
    fn test_invalid_json_input() {
        let invalid_json = CString::new("not valid json").unwrap();
        unsafe {
            let result = merge_vaults_ffi(invalid_json.as_ptr());
            assert!(!result.is_null());

            let c_str = CStr::from_ptr(result);
            let json = c_str.to_str().unwrap();
            assert!(json.contains("error"));
            free_string(result);
        }
    }
}
