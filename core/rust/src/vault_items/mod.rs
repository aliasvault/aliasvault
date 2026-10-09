//! Item, passkey, TOTP and usage-statistics reads and writes on an open vault database.

mod items;
mod logos;
mod passkeys;
mod stats;

#[cfg(test)]
mod tests;

pub use items::{append_field_value, get_all_active_items, get_totp_codes_for_item};
pub use passkeys::{
    add_passkey_to_item, create_item_with_passkey, get_all_passkeys_with_items, get_items_without_passkey_for_rp_id, get_passkey_by_id,
    get_passkey_in_manifest, get_passkeys_for_item, get_passkeys_for_rp_id, replace_passkey,
};
pub use stats::{record_item_use, ItemUsageAction};

use rusqlite::types::ValueRef;
use rusqlite::Row;
use serde::Serialize;

use crate::common::error::VaultError;
use crate::common::timestamp::parse_vault_datetime;

/// An active item with its fields, as the autofill layers read it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(rename_all = "camelCase")]
pub struct VaultItem {
    pub id: String,
    pub manifest_id: String,
    pub name: Option<String>,
    pub item_type: String,
    /// The logo bytes; None for a built-in logo, which the host draws from its catalog by `logo_source`.
    pub logo: Option<Vec<u8>>,
    pub logo_kind: Option<String>,
    pub logo_source: Option<String>,
    pub folder_id: Option<String>,
    /// Folder names from the root down to the item's folder; empty outside any folder.
    pub folder_path: Vec<String>,
    pub fields: Vec<VaultItemField>,
    pub has_passkey: bool,
    pub has_attachment: bool,
    pub has_totp: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

/// One value of an item field. A multi-value field yields one entry per value, in value order.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(rename_all = "camelCase")]
pub struct VaultItemField {
    /// The system field key, or the FieldDefinitionId of a custom field.
    pub field_key: String,
    /// The custom field's label; for a system field the key itself, which the UI translates.
    pub label: String,
    pub field_type: String,
    pub value: String,
    pub is_hidden: bool,
    pub display_order: i64,
    pub is_custom_field: bool,
    pub enable_history: bool,
}

/// A stored passkey. The keys are JWK text.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(rename_all = "camelCase")]
pub struct VaultPasskey {
    pub id: String,
    pub item_id: String,
    pub manifest_id: String,
    pub rp_id: String,
    pub user_handle: Option<Vec<u8>>,
    pub public_key: String,
    pub private_key: String,
    pub prf_key: Option<Vec<u8>>,
    pub display_name: String,
    pub additional_data: Option<Vec<u8>>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

/// A passkey with the name and account of the item it belongs to.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(rename_all = "camelCase")]
pub struct VaultPasskeyWithItem {
    pub passkey: VaultPasskey,
    pub service_name: Option<String>,
    pub username: Option<String>,
    pub email: Option<String>,
}

/// A passkey to write. The manifest and item come from the call it is passed to.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct NewPasskey {
    pub id: String,
    pub rp_id: String,
    pub user_handle: Option<Vec<u8>>,
    pub public_key: String,
    pub private_key: String,
    pub prf_key: Option<Vec<u8>>,
    pub display_name: String,
}

/// A Login item without a passkey that a new passkey could be added to.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(rename_all = "camelCase")]
pub struct PasskeyMergeCandidate {
    pub item_id: String,
    pub manifest_id: String,
    pub service_name: Option<String>,
    pub urls: Vec<String>,
    pub username: Option<String>,
    pub email: Option<String>,
    pub has_password: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

/// A TOTP code of an item.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(rename_all = "camelCase")]
pub struct VaultTotpCode {
    pub id: String,
    pub item_id: String,
    pub name: String,
    pub secret_key: String,
    pub algorithm: String,
    pub digits: u32,
    pub period: u32,
}

/// A stored timestamp as Unix milliseconds, 0 when it cannot be read.
fn timestamp_ms(text: Option<String>) -> i64 {
    text.as_deref().and_then(parse_vault_datetime).map(|at| at.timestamp_millis()).unwrap_or(0)
}

/// A BLOB column's bytes, None for NULL or any other type.
fn blob(row: &Row<'_>, column: &str) -> rusqlite::Result<Option<Vec<u8>>> {
    Ok(match row.get_ref(column)? {
        ValueRef::Blob(bytes) => Some(bytes.to_vec()),
        _ => None,
    })
}

/// A new lowercase v4 id.
fn new_id() -> String {
    let mut bytes = [0u8; 16];
    crate::common::rng::fill_random(&mut bytes);
    crate::common::encoding::uuid_from_bytes(bytes, 4)
}

/// The vault error for a failed statement.
fn sql_error(error: rusqlite::Error) -> VaultError {
    crate::sqlite_host::sql_error(error)
}
