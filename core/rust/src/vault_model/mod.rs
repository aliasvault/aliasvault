//! The client vault datamodel registry.
//!
//! The data (table list, keys, scoping, bucket layout, format sentinels) is generated from the
//! TypeScript source of truth in core/models/src/vault/VaultTableRegistry.ts; see generated.rs.
//! This module owns the [`TableConfig`] type the generated data instantiates.

mod generated;

pub use generated::*;

/// The comparison key of an id (GUIDs compare case-insensitively).
pub fn id_key(id: &str) -> String {
    id.trim().to_ascii_lowercase()
}

/// True when two ids name the same row.
pub fn ids_equal(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// Configuration for a syncable table.
#[derive(Debug, Clone)]
pub struct TableConfig {
    /// Table name in the database
    pub name: &'static str,
    /// Merge match columns, applied after both sides are normalized to the manifest shape (see
    /// `vault_codec::normalize`). Empty means rows match on [`identity_columns`](TableConfig::identity_columns).
    pub canonical_key_columns: &'static [&'static str],
    /// The columns that name a row within its manifest. Defaults to `["Id"]`; tables keyed
    /// differently (Settings by "Key", ItemTags by its natural key) override this.
    pub primary_key_columns: &'static [&'static str],
    /// True when the table's rows are namespaced per manifest.
    pub manifest_scoped: bool,
    /// True when the table's rows hang off an Item row (re-stamped with their item, cascaded on delete).
    pub item_child: bool,
}

impl TableConfig {
    pub const fn new(name: &'static str) -> Self {
        Self {
            name,
            canonical_key_columns: &[],
            primary_key_columns: &["Id"],
            manifest_scoped: false,
            item_child: false,
        }
    }

    pub const fn with_canonical_key(mut self, columns: &'static [&'static str]) -> Self {
        self.canonical_key_columns = columns;
        self
    }

    pub const fn with_primary_key(mut self, columns: &'static [&'static str]) -> Self {
        self.primary_key_columns = columns;
        self
    }

    pub const fn manifest_scoped(mut self) -> Self {
        self.manifest_scoped = true;
        self
    }

    pub const fn item_child(mut self) -> Self {
        self.item_child = true;
        self
    }

    /// The columns that together identify one row of this table: `(ManifestId, primary key columns)`
    /// for a manifest-scoped table, the primary key columns alone otherwise.
    pub fn identity_columns(&self) -> Vec<&'static str> {
        if self.manifest_scoped {
            let mut columns = Vec::with_capacity(1 + self.primary_key_columns.len());
            columns.push(MANIFEST_ID_COL);
            columns.extend_from_slice(self.primary_key_columns);
            columns
        } else {
            self.primary_key_columns.to_vec()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_syncable_table_is_manifest_scoped() {
        for config in SYNCABLE_TABLES {
            assert!(config.manifest_scoped, "{} must be manifest_scoped or it merges across manifests", config.name);
            assert_eq!(config.identity_columns().first(), Some(&MANIFEST_ID_COL), "{} must be addressed by its manifest first", config.name);
        }
    }

    #[test]
    fn id_keys_ignore_case_and_surrounding_whitespace() {
        assert_eq!(id_key(" 1DD1A3FD-8e0e-4b3f-9a3a-0f1a2b3c4d5e "), "1dd1a3fd-8e0e-4b3f-9a3a-0f1a2b3c4d5e");
        assert!(ids_equal("ABC", "abc "));
        assert!(!ids_equal("abc", "abd"));
    }
}
