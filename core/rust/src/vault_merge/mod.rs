//! Vault merge logic using Last-Write-Wins (LWW) strategy.

mod canonical;

use serde::{Deserialize, Serialize};

pub use canonical::{merge_canonical, CanonicalManifestMerge, CanonicalMergeInput, CanonicalMergeOutput};

/// A record is a map of column names to JSON values.
pub type Record = crate::vault_codec::CodecRecord;

/// A SQL statement with its parameter values.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlStatement {
    /// The SQL query with ? placeholders
    pub sql: String,
    /// Parameter values in order
    pub params: Vec<serde_json::Value>,
}

/// Statistics about what was merged.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct MergeStats {
    pub tables_processed: u32,
    pub records_from_local: u32,
    pub records_from_server: u32,
    pub records_created_locally: u32,
    pub conflicts: u32,
    pub records_inserted: u32,
}

/// Stable string key over `columns`. A column the record does not carry contributes an empty part,
/// so a row missing one still matches its counterpart rather than dropping out of the merge. See
/// [`crate::vault_codec::identity_part`]: ids compare case-insensitively, everything else exactly as spelled.
fn get_key(record: &Record, columns: &[&str]) -> String {
    columns
        .iter()
        .map(|column| record.get(*column).filter(|v| !v.is_null()).map(crate::vault_codec::identity_part).unwrap_or_default())
        .collect::<Vec<_>>()
        .join(":")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn keys_compare_guids_case_insensitively_and_survive_a_missing_column() {
        const MANIFEST: &str = "1dd1a3fd-8e0e-4b3f-9a3a-0f1a2b3c4d5e";
        const OTHER_MANIFEST: &str = "2ee2b4fe-9f1f-4c40-8b4b-1a2b3c4d5e6f";
        const ROW: &str = "3ff3c50f-a020-4d51-9c5c-2b3c4d5e6f70";
        let row = |manifest: &str, id: &str| -> Record {
            HashMap::from([("ManifestId".to_string(), serde_json::json!(manifest)), ("Id".to_string(), serde_json::json!(id))])
        };
        let columns = ["ManifestId", "Id"];

        // Two writers spelling the same ids in different cases address one row (see `identity_part`).
        assert_eq!(get_key(&row(MANIFEST, ROW), &columns), get_key(&row(&MANIFEST.to_uppercase(), &ROW.to_uppercase()), &columns));
        assert_ne!(get_key(&row(MANIFEST, ROW), &columns), get_key(&row(OTHER_MANIFEST, ROW), &columns));
        assert_eq!(get_key(&HashMap::from([("Id".to_string(), serde_json::json!(ROW))]), &columns), format!(":{}", ROW));
    }
}
