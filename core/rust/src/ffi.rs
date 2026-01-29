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
    let names: Vec<&str> = SYNCABLE_TABLE_NAMES.iter().map(|s| *s).collect();
    match serde_json::to_string(&names) {
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
