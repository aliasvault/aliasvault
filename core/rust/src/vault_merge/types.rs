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
}

impl TableConfig {
    pub const fn new(name: &'static str) -> Self {
        Self {
            name,
            composite_key_columns: &[],
        }
    }

    pub const fn with_composite_key(mut self, columns: &'static [&'static str]) -> Self {
        self.composite_key_columns = columns;
        self
    }

    /// Returns true if this table uses composite key matching.
    pub const fn uses_composite_key(&self) -> bool {
        !self.composite_key_columns.is_empty()
    }
}

/// All tables that need LWW merge.
/// FieldValues uses composite key (ItemId + FieldKey) for merging.
/// Logos uses composite key (Source): Id is a per-client random GUID but Source is the natural unique
/// key (schema enforces UNIQUE(Source)). Merging by Source collapses two clients' rows for the same
/// domain into one — and the composite-key path keeps the local Id on conflict, so Items.LogoId stays
/// valid — instead of the by-Id path minting a second same-Source row that breaks materialize.
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
];
