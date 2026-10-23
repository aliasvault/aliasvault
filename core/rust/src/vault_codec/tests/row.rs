use std::collections::HashMap;

use serde_json::json;

use crate::vault_codec::row::*;
use crate::vault_model::names::LOGO_KIND_FAVICON;

#[test]
fn truthy_accepts_every_spelling_sqlite_hands_over() {
    for value in [json!(true), json!(1), json!(1.0), json!(2), json!("1"), json!("true"), json!("TRUE")] {
        assert!(truthy(Some(&value)), "{value} should be truthy");
    }
    for value in [json!(false), json!(0), json!(0.0), json!("0"), json!(""), json!("false"), json!(null)] {
        assert!(!truthy(Some(&value)), "{value} should be falsy");
    }
    assert!(!truthy(None));
}

#[test]
fn byte_markers_round_trip_and_presence_reads_every_shape() {
    assert_eq!(inline_b64(&inline_bytes(&[1, 2, 3])), Some("AQID"));
    assert_eq!(blob_ref_of(&blob_ref("hash", "favicon")), Some(("hash", Some("favicon"))));
    assert_eq!(blob_ref_of(&inline_bytes(&[1])), None);
    assert!(has_bytes(Some(&inline_bytes(&[1]))));
    assert!(!has_bytes(Some(&inline_bytes(&[]))));
    assert!(has_bytes(Some(&blob_ref("hash", "attachment"))));
    assert!(has_bytes(Some(&json!("x"))) && has_bytes(Some(&json!([1]))) && has_bytes(Some(&json!({ "0": 1 }))));
    for empty in [json!(""), json!([]), json!({}), json!(null)] {
        assert!(!has_bytes(Some(&empty)), "{empty} holds no bytes");
    }
    assert!(!has_bytes(None));
}

#[test]
fn logo_kind_normalizes_case_whitespace_and_absence() {
    assert_eq!(normalize_logo_kind(" Custom "), "custom");
    assert_eq!(normalize_logo_kind(""), LOGO_KIND_FAVICON);
    assert_eq!(logo_kind(&HashMap::new()), LOGO_KIND_FAVICON);
}
