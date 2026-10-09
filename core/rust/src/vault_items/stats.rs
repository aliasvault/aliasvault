//! Per-item usage statistics, one row per item per device.

use rusqlite::{params, Connection, OptionalExtension};

use super::sql_error;
use crate::common::error::VaultResult;
use crate::common::timestamp::now_vault_datetime;

/// What the user did with an item. Each action bumps its own timestamp and counter next to the aggregate pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum ItemUsageAction {
    /// A credential filled into a form.
    Autofill,
    /// A value copied to the clipboard.
    Copy,
    /// A passkey assertion.
    Passkey,
}

impl ItemUsageAction {
    /// The UPDATE for this action. The column names are a closed set, never caller input.
    fn update_sql(self) -> &'static str {
        match self {
            Self::Autofill => "UPDATE ItemStats SET LastUsedAt = ?1, UseCount = UseCount + 1, LastAutofilledAt = ?1, AutofillCount = AutofillCount + 1, UpdatedAt = ?1, IsDeleted = 0 WHERE ManifestId = ?2 AND Id = ?3 AND DeviceId = ?4",
            Self::Copy => "UPDATE ItemStats SET LastUsedAt = ?1, UseCount = UseCount + 1, LastCopiedAt = ?1, CopyCount = CopyCount + 1, UpdatedAt = ?1, IsDeleted = 0 WHERE ManifestId = ?2 AND Id = ?3 AND DeviceId = ?4",
            Self::Passkey => "UPDATE ItemStats SET LastUsedAt = ?1, UseCount = UseCount + 1, LastPasskeyAuthAt = ?1, PasskeyAuthCount = PasskeyAuthCount + 1, UpdatedAt = ?1, IsDeleted = 0 WHERE ManifestId = ?2 AND Id = ?3 AND DeviceId = ?4",
        }
    }
}

const ITEM_EXISTS: &str = "SELECT 1 FROM Items WHERE Id = ?1 AND ManifestId = ?2";

const INSERT_ROW: &str = "
    INSERT OR IGNORE INTO ItemStats (
      ManifestId, Id, DeviceId, LastUsedAt, UseCount, LastAutofilledAt, AutofillCount,
      LastCopiedAt, CopyCount, LastPasskeyAuthAt, PasskeyAuthCount, CreatedAt, UpdatedAt, IsDeleted
    )
    VALUES (?1, ?2, ?3, NULL, 0, NULL, 0, NULL, 0, NULL, 0, ?4, ?4, 0)";

/// Record one use of an item in this device's row. Returns false, writing nothing, when the item does not exist or
/// no device id is given. Clearing `IsDeleted` revives a row the pruner tombstoned.
pub fn record_item_use(conn: &Connection, item_id: &str, manifest_id: &str, device_id: &str, action: ItemUsageAction) -> VaultResult<bool> {
    let item_id = crate::vault_model::id_key(item_id);
    let device_id = crate::vault_model::id_key(device_id);
    if device_id.is_empty() {
        return Ok(false);
    }
    if conn.query_row(ITEM_EXISTS, params![item_id, manifest_id], |_| Ok(())).optional().map_err(sql_error)?.is_none() {
        return Ok(false);
    }
    let now = now_vault_datetime();
    conn.execute(INSERT_ROW, params![manifest_id, item_id, device_id, now]).map_err(sql_error)?;
    conn.execute(action.update_sql(), params![now, manifest_id, item_id, device_id]).map_err(sql_error)?;
    Ok(true)
}
