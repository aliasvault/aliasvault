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
