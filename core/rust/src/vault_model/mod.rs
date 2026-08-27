//! The client vault datamodel registry.
//!
//! The data (table list, keys, scoping, bucket layout, format sentinels) is generated from the
//! TypeScript source of truth in core/models/src/vault/VaultTableRegistry.ts; see generated.rs.
//! This module owns the [`TableConfig`] type the generated data instantiates.

mod generated;

pub use generated::*;

/// Configuration for a syncable table.
#[derive(Debug, Clone)]
pub struct TableConfig {
    /// Table name in the database
    pub name: &'static str,
    /// Columns to use for composite key matching (if any).
    /// When empty, matching falls back to the table's [`identity_columns`](TableConfig::identity_columns).
    /// When set, these columns are concatenated to form the composite key.
    pub composite_key_columns: &'static [&'static str],
    /// Match columns for the canonical merge only, where both sides are first normalized to the manifest
    /// shape (see `vault_codec::normalize`). Empty means the canonical merge uses the same rule as
    /// the statement merge (composite key, else identity).
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
            composite_key_columns: &[],
            canonical_key_columns: &[],
            primary_key_columns: &["Id"],
            manifest_scoped: false,
            item_child: false,
        }
    }

    pub const fn with_composite_key(mut self, columns: &'static [&'static str]) -> Self {
        self.composite_key_columns = columns;
        self
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

    /// Returns true if this table uses composite key matching.
    pub const fn uses_composite_key(&self) -> bool {
        !self.composite_key_columns.is_empty()
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
