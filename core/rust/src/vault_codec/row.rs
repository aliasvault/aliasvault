//! Reading cells out of a row as the platforms hand them over: SQLite booleans arrive as 0/1
//! numbers, JSON booleans or "1"/"true" strings, byte cells as `{ "__b64" }` (inline bytes) or
//! `{ "__blobRef", "__blobKind" }` (an extracted blob) markers, and a missing table reads as no rows.

use std::collections::HashMap;

use serde_json::{json, Value};

use super::manifest::CodecRecord;
use crate::encoding::base64_encode;
use crate::vault_model::names::{IS_DELETED_COL, KIND_COL, LOGO_KIND_FAVICON};

/// The key of an inline byte cell: `{ "__b64": <base64> }`.
pub(crate) const INLINE_BYTES_KEY: &str = "__b64";

/// The hash key of an extracted blob cell: `{ "__blobRef": <hash>, "__blobKind": <kind> }`.
pub(crate) const BLOB_REF_KEY: &str = "__blobRef";

/// The kind key of an extracted blob cell.
pub(crate) const BLOB_KIND_KEY: &str = "__blobKind";

/// A cell as a string slice, `None` when absent or not a string.
pub(crate) fn str_col<'a>(row: &'a CodecRecord, column: &str) -> Option<&'a str> {
    row.get(column).and_then(Value::as_str)
}

/// SQLite-tolerant truthiness: boolean true, a non-zero number, or a "1"/"true" string.
pub(crate) fn truthy(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(Value::String(s)) => s == "1" || s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

/// True when the row's `IsDeleted` flag is set.
pub(crate) fn is_deleted(row: &CodecRecord) -> bool {
    truthy(row.get(IS_DELETED_COL))
}

/// The rows of `table`, empty when the table set does not carry it.
pub(crate) fn rows_of<'a>(tables: &'a HashMap<String, Vec<CodecRecord>>, table: &str) -> &'a [CodecRecord] {
    tables.get(table).map(Vec::as_slice).unwrap_or(&[])
}

/// A logo `Kind` in its comparison form: trimmed and lowercased, empty meaning [`LOGO_KIND_FAVICON`]
/// (the row was written before the column existed, when every logo was a favicon).
pub(crate) fn normalize_logo_kind(kind: &str) -> String {
    let trimmed = kind.trim();
    if trimmed.is_empty() { LOGO_KIND_FAVICON.to_string() } else { trimmed.to_lowercase() }
}

/// A logo row's `Kind`, normalized (see [`normalize_logo_kind`]).
pub(crate) fn logo_kind(row: &CodecRecord) -> String {
    normalize_logo_kind(str_col(row, KIND_COL).unwrap_or(""))
}

/// Bytes as the inline `{ "__b64" }` cell every platform binds and reads.
pub(crate) fn inline_bytes(bytes: &[u8]) -> Value {
    json!({ INLINE_BYTES_KEY: base64_encode(bytes) })
}

/// The base64 text of an inline `{ "__b64" }` cell, `None` for any other value.
pub(crate) fn inline_b64(value: &Value) -> Option<&str> {
    value.get(INLINE_BYTES_KEY).and_then(Value::as_str)
}

/// An extracted blob cell: the content hash and kind that stand in for the bytes inside a manifest.
pub(crate) fn blob_ref(hash: &str, kind: &str) -> Value {
    json!({ BLOB_REF_KEY: hash, BLOB_KIND_KEY: kind })
}

/// The `(hash, kind)` of an extracted blob cell, `None` for any other value.
pub(crate) fn blob_ref_of(value: &Value) -> Option<(&str, Option<&str>)> {
    let hash = value.get(BLOB_REF_KEY).and_then(Value::as_str)?;
    Some((hash, value.get(BLOB_KIND_KEY).and_then(Value::as_str)))
}

/// True when a cell holds bytes: a non-empty inline `{ __b64 }`, an extracted `{ __blobRef }`, or any
/// other non-empty string, array or object (the 1-byte presence marker the prune queries select).
/// A tombstoned row drops its bytes (NULL), which is present but carries nothing.
pub(crate) fn has_bytes(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => match o.get(INLINE_BYTES_KEY).and_then(Value::as_str) {
            Some(b64) => !b64.is_empty(),
            None => !o.is_empty(),
        },
        Some(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
}
