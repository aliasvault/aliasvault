//! Backfill manifest stamps for legacy vaults.
//! Can be deleted once all users have migrated.

use serde::{Deserialize, Serialize};
use serde_json::json;

use super::super::manifest::{CodecRecord, CodecTableData};
use super::super::types::{is_unstamped_scope, manifest_scoped_tables, MANIFEST_ID_COL};

/// Input for [`backfill_manifest_stamps`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StampBackfillInput {
    /// The vault's tables, as read from the local SQLite.
    pub tables: Vec<CodecTableData>,
    /// The manifest to adopt unstamped rows into: the one the vault is being written from.
    pub manifest_id: String,
}

/// Result of [`backfill_manifest_stamps`]: the tables with every stamp filled in, plus how many rows
/// were adopted (0 on a vault that was already stamped, which is every vault after the first run).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StampBackfillOutput {
    pub tables: Vec<CodecTableData>,
    pub adopted: usize,
}

/// Stamp every unstamped row of a stamped table with `manifest_id`.
///
/// Idempotent: a row that already names a manifest is left alone, so running this on an
/// already-stamped vault changes nothing and reports `adopted: 0`.
pub fn backfill_manifest_stamps(input: StampBackfillInput) -> StampBackfillOutput {
    let StampBackfillInput { mut tables, manifest_id } = input;
    let mut adopted = 0usize;

    let stamped = manifest_scoped_tables();
    for table in tables.iter_mut().filter(|t| stamped.contains(&t.name.as_str())) {
        for row in table.records.iter_mut() {
            if is_unstamped(row) {
                row.insert(MANIFEST_ID_COL.to_string(), json!(manifest_id));
                adopted += 1;
            }
        }
    }

    StampBackfillOutput { tables, adopted }
}

/// True when a row carries no usable `ManifestId`: absent, JSON null, a non-string, or the empty
/// string. `as_str` collapses the first three to `None`, which [`is_unstamped_scope`] already reads
/// as naming no manifest.
fn is_unstamped(row: &CodecRecord) -> bool {
    is_unstamped_scope(row.get(MANIFEST_ID_COL).and_then(|value| value.as_str()))
}

/// The stamped tables, for callers that need to know which tables the backfill touches.
pub fn stamped_tables() -> Vec<String> {
    manifest_scoped_tables().iter().map(|t| (*t).to_string()).collect()
}

/// Count the rows [`backfill_manifest_stamps`] would adopt, without rewriting anything. Lets a caller
/// decide whether a legacy conversion is needed at all.
pub fn count_unstamped_rows(tables: &[CodecTableData]) -> usize {
    let stamped = manifest_scoped_tables();
    tables
        .iter()
        .filter(|t| stamped.contains(&t.name.as_str()))
        .flat_map(|t| t.records.iter())
        .filter(|row| is_unstamped(row))
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(pairs: &[(&str, serde_json::Value)]) -> CodecRecord {
        pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
    }

    fn input(tables: Vec<CodecTableData>) -> StampBackfillInput {
        StampBackfillInput { tables, manifest_id: "m-1".to_string() }
    }

    #[test]
    fn adopts_absent_null_and_empty_stamps() {
        let out = backfill_manifest_stamps(input(vec![CodecTableData {
            name: "Items".to_string(),
            records: vec![
                row(&[("Id", json!("i1"))]),
                row(&[("Id", json!("i2")), ("ManifestId", serde_json::Value::Null)]),
                row(&[("Id", json!("i3")), ("ManifestId", json!(""))]),
            ],
        }]));
        assert_eq!(out.adopted, 3);
        for record in &out.tables[0].records {
            assert_eq!(record["ManifestId"], json!("m-1"));
        }
    }

    #[test]
    fn leaves_rows_that_already_name_a_manifest() {
        let out = backfill_manifest_stamps(input(vec![CodecTableData {
            name: "Folders".to_string(),
            records: vec![row(&[("Id", json!("f1")), ("ManifestId", json!("m-shared"))])],
        }]));
        assert_eq!(out.adopted, 0);
        assert_eq!(out.tables[0].records[0]["ManifestId"], json!("m-shared"));
    }

    #[test]
    fn ignores_tables_that_carry_no_stamp() {
        // Settings has no ManifestId column: it is not manifest-scoped and syncs in its own bucket.
        let out = backfill_manifest_stamps(input(vec![CodecTableData {
            name: "Settings".to_string(),
            records: vec![row(&[("Key", json!("theme")), ("Value", json!("dark"))])],
        }]));
        assert_eq!(out.adopted, 0);
        assert!(!out.tables[0].records[0].contains_key("ManifestId"));
    }

    #[test]
    fn is_idempotent() {
        let first = backfill_manifest_stamps(input(vec![CodecTableData {
            name: "Items".to_string(),
            records: vec![row(&[("Id", json!("i1"))])],
        }]));
        assert_eq!(first.adopted, 1);
        let second = backfill_manifest_stamps(input(first.tables.clone()));
        assert_eq!(second.adopted, 0, "a second run is a no-op");
        assert_eq!(second.tables[0].records[0]["ManifestId"], json!("m-1"));
    }

    #[test]
    fn count_matches_what_a_run_would_adopt() {
        let tables = vec![CodecTableData {
            name: "Logos".to_string(),
            records: vec![row(&[("Id", json!("l1"))]), row(&[("Id", json!("l2")), ("ManifestId", json!("m-x"))])],
        }];
        assert_eq!(count_unstamped_rows(&tables), 1);
        assert_eq!(backfill_manifest_stamps(input(tables)).adopted, 1);
    }
}
