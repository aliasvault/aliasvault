//! Fixtures shared by the codec, sharing and pruner tests.

use std::collections::{HashMap, HashSet};

use serde_json::json;

use super::manifest::{CodecRecord, CodecTableData, DataBucket, Manifest, MaterializeInput};
use super::types::manifest_scoped_tables;
use crate::vault_model::{MANIFESTS_TABLE, MANIFEST_ID_COL};

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

/// Stamp every row of a manifest-scoped table that carries no `ManifestId`, leaving rows that already name one alone.
pub(crate) fn stamp_unstamped(mut tables: Vec<CodecTableData>, manifest_id: &str) -> Vec<CodecTableData> {
    let scoped = manifest_scoped_tables();
    for table in tables.iter_mut().filter(|t| scoped.contains(&t.name.as_str())) {
        for record in table.records.iter_mut() {
            let unstamped = record.get(MANIFEST_ID_COL).and_then(|v| v.as_str()).is_none_or(str::is_empty);
            if unstamped {
                record.insert(MANIFEST_ID_COL.to_string(), json!(manifest_id));
            }
        }
    }
    tables
}

/// A schema map that knows every table and column the given manifests and buckets carry, so
/// materialize fits all of it and splits nothing off into overflow.
pub(crate) fn fitting_schema<'a>(manifests: impl IntoIterator<Item = &'a Manifest>, buckets: &[DataBucket]) -> HashMap<String, Vec<String>> {
    let mut schema: HashMap<String, HashSet<String>> = HashMap::new();
    let mut absorb = |tables: &HashMap<String, Vec<CodecRecord>>| {
        for (name, records) in tables {
            let columns = schema.entry(name.clone()).or_default();
            columns.insert(MANIFEST_ID_COL.to_string());
            for record in records {
                columns.extend(record.keys().cloned());
            }
        }
    };
    for manifest in manifests {
        absorb(&manifest.tables);
    }
    for bucket in buckets {
        absorb(&bucket.tables);
    }

    // Local bookkeeping materialize emits itself; it is never present in a manifest to be absorbed above.
    schema.insert(MANIFESTS_TABLE.to_string(), ["Id", "Name"].iter().map(|c| c.to_string()).collect());

    schema.into_iter().map(|(name, columns)| (name, columns.into_iter().collect())).collect()
}

/// A `MaterializeInput` for a personal manifest plus the other manifests combined into it, with the
/// buckets hung off it and a schema fitted to everything they carry (see [`fitting_schema`]).
pub(crate) fn materialize_input(own: Manifest, others: Vec<Manifest>, data_buckets: Vec<DataBucket>) -> MaterializeInput {
    let schema = fitting_schema(std::iter::once(&own).chain(others.iter()), &data_buckets);
    MaterializeInput { manifests: std::iter::once(own).chain(others).collect(), data_buckets, schema_columns: schema }
}

/// A `MaterializeInput` from an explicit manifest list, for the tests that assert on inputs
/// [`materialize_input`] cannot express (an empty manifest list, for one).
pub(crate) fn materialize_manifests(manifests: Vec<Manifest>, data_buckets: Vec<DataBucket>) -> MaterializeInput {
    let schema = fitting_schema(manifests.iter(), &data_buckets);
    MaterializeInput { manifests, data_buckets, schema_columns: schema }
}
