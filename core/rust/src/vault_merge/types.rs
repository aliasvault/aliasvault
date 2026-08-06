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
    /// The column that names a row within its manifest. Defaults to "Id"; tables keyed by a
    /// different column (e.g. Settings keyed by "Key") override this.
    pub primary_key: &'static str,
    /// True when the table's rows are namespaced per manifest.
    pub manifest_scoped: bool,
}

impl TableConfig {
    pub const fn new(name: &'static str) -> Self {
        Self {
            name,
            composite_key_columns: &[],
            primary_key: "Id",
            manifest_scoped: false,
        }
    }

    pub const fn with_composite_key(mut self, columns: &'static [&'static str]) -> Self {
        self.composite_key_columns = columns;
        self
    }

    pub const fn with_primary_key(mut self, column: &'static str) -> Self {
        self.primary_key = column;
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

    /// The columns that together identify one row of this table: `(ManifestId, primary_key)` for a
    /// manifest-scoped table, the primary key alone otherwise. This is what a generated UPDATE
    /// addresses a row by, so it must match the table's declared PRIMARY KEY.
    pub fn identity_columns(&self) -> Vec<&'static str> {
        if self.manifest_scoped {
            vec![MANIFEST_ID_COL, self.primary_key]
        } else {
            vec![self.primary_key]
        }
    }
}

/// All tables that need LWW merge.
/// Allows for specifying manifest_scoped(), custom composite key columns and primary key columns for each table.
pub static SYNCABLE_TABLES: &[TableConfig] = &[
    TableConfig::new("Items").manifest_scoped(),
    TableConfig::new("FieldValues").manifest_scoped().with_composite_key(&[MANIFEST_ID_COL, "ItemId", "FieldKey"]),
    TableConfig::new("Folders").manifest_scoped(),
    TableConfig::new("Tags").manifest_scoped(),
    TableConfig::new("ItemTags").manifest_scoped(),
    TableConfig::new("Attachments").manifest_scoped(),
    TableConfig::new("TotpCodes").manifest_scoped(),
    TableConfig::new("Passkeys").manifest_scoped(),
    TableConfig::new("FieldDefinitions").manifest_scoped(),
    TableConfig::new("FieldHistories").manifest_scoped(),
    TableConfig::new("Logos").manifest_scoped(),
    TableConfig::new("EncryptionKeys").manifest_scoped(),
    TableConfig::new("Settings").with_primary_key("Key"),
];

/// The tables a platform must read into the merge input: the syncable tables.
pub fn merge_table_names() -> Vec<&'static str> {
    SYNCABLE_TABLE_NAMES.to_vec()
}

/// List of syncable table names (for clients to know which tables to read).
pub const SYNCABLE_TABLE_NAMES: &[&str] = &[
    "Items",
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
