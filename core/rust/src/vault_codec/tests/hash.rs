use crate::vault_codec::hash::*;
use serde_json::json;

#[test]
fn canonical_sorts_keys_recursively() {
    let v = json!({ "b": 1, "a": { "d": 2, "c": 3 } });
    assert_eq!(canonical_json(&v), r#"{"a":{"c":3,"d":2},"b":1}"#);
}

#[test]
fn canonical_keeps_array_order() {
    let v = json!([3, 1, 2]);
    assert_eq!(canonical_json(&v), "[3,1,2]");
}

#[test]
fn canonical_matches_js_string_escaping() {
    // Control chars use short forms; quotes/backslashes escaped; non-ascii left raw.
    let v = json!("a\"b\\c\nd\té");
    assert_eq!(canonical_json(&v), "\"a\\\"b\\\\c\\nd\\té\"");
}

#[test]
fn derived_uuid_is_stable_and_well_formed() {
    let id = derived_uuid("aliasvault:test");
    // Known-answer vector: derived row ids must match on every platform, so this value must never change.
    assert_eq!(id, "eadc54c6-fb5f-89b0-93f0-18a3af670e1e");
    assert_eq!(id.len(), 36);
    assert_eq!(&id[14..15], "8");
    assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"));
}

/// Known-answer vector: a changed output re-addresses every stored blob. Never regenerate it.
#[test]
fn salted_hash_is_stable() {
    // HMAC-SHA256(key = 00 ff, message = 01 02 03).
    assert_eq!(salted_blob_hash(&[1, 2, 3], "00ff").unwrap(), "4307c7b0faa3e0b307fc467d8f3c3db3cd548860c7555955b2f3f00fe70cbea1");
}
