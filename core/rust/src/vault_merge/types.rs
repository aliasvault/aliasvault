//! Common types used across the AliasVault core library.

use crate::vault_codec::MANIFEST_ID_COL;

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
}

impl TableConfig {
    pub const fn new(name: &'static str) -> Self {
        Self {
            name,
            composite_key_columns: &[],
            canonical_key_columns: &[],
            primary_key_columns: &["Id"],
            manifest_scoped: false,
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

/// All tables that need LWW merge.
/// Allows for specifying manifest_scoped(), custom composite key columns and primary key columns for each table.
pub static SYNCABLE_TABLES: &[TableConfig] = &[
    TableConfig::new("Items").manifest_scoped(),
    // Keyed by the item it describes: `Id` *is* the item's id, so recording a use is an upsert and two
    // devices never mint competing rows. Listed after Items so a merge inserts the item first.
    TableConfig::new("ItemStats").manifest_scoped(),
    // Legacy statement merge: a field value matches on the field it belongs to (FieldKey for system
    // fields, FieldDefinitionId for custom ones; exactly one is set), so independently minted rows of
    // the same field converge. Canonical merge: both sides are normalized first, which strips the
    // derived id of every single-value row, so adding `Id` to the key makes a single-value row match
    // by its field (id part empty on both sides) while a multi-value row matches by its OWNED id:
    // two devices each adding a `login.url` are two different rows that must both survive, and the id,
    // unlike ValueIndex, is stable under reordering. See vault_codec::normalize.
    TableConfig::new("FieldValues")
        .manifest_scoped()
        .with_composite_key(&[MANIFEST_ID_COL, "ItemId", "FieldKey", "FieldDefinitionId"])
        .with_canonical_key(&[MANIFEST_ID_COL, "ItemId", "FieldKey", "FieldDefinitionId", "Id"]),
    TableConfig::new("Folders").manifest_scoped(),
    TableConfig::new("Tags").manifest_scoped(),
    // A pure join table keyed by its natural key; it carries no surrogate id (since client schema 2.1.6),
    // so two devices tagging the same item converge on one row.
    TableConfig::new("ItemTags").manifest_scoped().with_primary_key(&["ItemId", "TagId"]),
    TableConfig::new("Attachments").manifest_scoped(),
    TableConfig::new("TotpCodes").manifest_scoped(),
    TableConfig::new("Passkeys").manifest_scoped(),
    TableConfig::new("FieldDefinitions").manifest_scoped(),
    // Canonical merge: every history row derives its id from `(item, field, ChangedAt)`, so after
    // normalization the natural key IS the identity: concurrent changes union (distinct ChangedAt),
    // same-millisecond snapshots converge. Legacy statement merge keeps plain (ManifestId, Id).
    TableConfig::new("FieldHistories").manifest_scoped().with_canonical_key(&[MANIFEST_ID_COL, "ItemId", "FieldKey", "FieldDefinitionId", "ChangedAt"]),
    TableConfig::new("Logos").manifest_scoped(),
    TableConfig::new("EncryptionKeys").manifest_scoped(),
    TableConfig::new("Settings").with_primary_key(&["Key"]).manifest_scoped(),
];

/// The tables a platform must read into the merge input: the syncable tables.
pub fn merge_table_names() -> Vec<&'static str> {
    SYNCABLE_TABLE_NAMES.to_vec()
}

/// List of syncable table names (for clients to know which tables to read).
pub const SYNCABLE_TABLE_NAMES: &[&str] = &[
    "Items",
    "ItemStats",
    "FieldValues",
    "Folders",
    "Tags",
    "ItemTags",
    "Attachments",
    "TotpCodes",
    "Passkeys",
    "FieldDefinitions",
    "FieldHistories",
    "Logos",
    "EncryptionKeys",
    "Settings",
];
