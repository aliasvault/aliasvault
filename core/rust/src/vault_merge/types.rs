//! Common types used across the AliasVault core library.

/// Configuration for a syncable table.
#[derive(Debug, Clone)]
pub struct TableConfig {
    /// Table name in the database
    pub name: &'static str,
    /// Columns to use for composite key matching (if any).
    /// When empty, uses "Id" column for matching.
    /// When set, these columns are concatenated to form the composite key.
    pub composite_key_columns: &'static [&'static str],
    /// The single-column primary key used to address a row in generated UPDATE statements
    /// (the WHERE clause) and to identify local rows. Defaults to "Id"; tables whose primary
    /// key is a different column (e.g. Settings keyed by "Key") override this.
    pub primary_key: &'static str,
}

impl TableConfig {
    pub const fn new(name: &'static str) -> Self {
        Self {
            name,
            composite_key_columns: &[],
            primary_key: "Id",
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

    /// Returns true if this table uses composite key matching.
    pub const fn uses_composite_key(&self) -> bool {
        !self.composite_key_columns.is_empty()
    }
}

/// All tables that need LWW merge.
/// Allows for specifying optional (custom) composite key columns and primary key columns for each table.
pub static SYNCABLE_TABLES: &[TableConfig] = &[
    TableConfig::new("Items"),
    TableConfig::new("FieldValues").with_composite_key(&["ItemId", "FieldKey"]),
    TableConfig::new("Folders"),
    TableConfig::new("Tags"),
    TableConfig::new("ItemTags"),
    TableConfig::new("Attachments"),
    TableConfig::new("TotpCodes"),
    TableConfig::new("Passkeys"),
    TableConfig::new("FieldDefinitions"),
    TableConfig::new("FieldHistories"),
    TableConfig::new("Logos").with_composite_key(&["Source"]),
    TableConfig::new("EncryptionKeys"),
    TableConfig::new("Settings").with_primary_key("Key"),
];

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
