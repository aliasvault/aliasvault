//! Fixtures shared by the codec, sharing and pruner tests.

use super::manifest::{CodecRecord, CodecTableData};

/// Standard base64 of `bytes`, the inline byte spelling the tests hand the codec.
pub(crate) fn b64(bytes: &[u8]) -> String {
    crate::encoding::base64_encode(bytes)
}

/// A row from `(column, value)` pairs.
pub(crate) fn row(pairs: &[(&str, serde_json::Value)]) -> CodecRecord {
    pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
}

/// A table with the given rows.
pub(crate) fn table(name: &str, records: Vec<CodecRecord>) -> CodecTableData {
    CodecTableData { name: name.to_string(), records }
}

/// The current instant in the ISO form the prune input takes.
pub(crate) fn now_iso() -> String {
    crate::timestamp::now_iso_utc()
}

/// The instant `days` days ago in the ISO form the prune input takes.
pub(crate) fn days_ago_iso(days: i64) -> String {
    crate::timestamp::iso_utc(&(chrono::Utc::now() - chrono::Duration::days(days)))
}
