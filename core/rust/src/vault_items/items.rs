//! Item reads with their fields and folder paths, TOTP codes, and single field-value appends.

use std::collections::HashMap;

use rusqlite::{params, Connection};

use super::{blob, new_id, sql_error, timestamp_ms, VaultItem, VaultItemField, VaultTotpCode};
use crate::common::error::VaultResult;
use crate::common::timestamp::now_vault_datetime;
use crate::vault_model::{id_key, system_field};

/// Folder nesting cap (root is depth 0), the same as core/client `FolderUtils.MAX_FOLDER_DEPTH`.
const MAX_FOLDER_DEPTH: usize = 4;

/// Every active item: not deleted, not in the trash and not archived. This is what autofill reads.
const GET_ALL_ACTIVE: &str = "
    SELECT
      i.Id, i.ManifestId, i.Name, i.ItemType, i.FolderId,
      l.FileData AS Logo, l.Kind AS LogoKind, l.Source AS LogoSource,
      EXISTS (SELECT 1 FROM Passkeys pk WHERE pk.ItemId = i.Id AND pk.ManifestId = i.ManifestId AND pk.IsDeleted = 0) AS HasPasskey,
      EXISTS (SELECT 1 FROM Attachments att WHERE att.ItemId = i.Id AND att.ManifestId = i.ManifestId AND att.IsDeleted = 0) AS HasAttachment,
      EXISTS (SELECT 1 FROM TotpCodes tc WHERE tc.ItemId = i.Id AND tc.ManifestId = i.ManifestId AND tc.IsDeleted = 0) AS HasTotp,
      i.CreatedAt, i.UpdatedAt
    FROM Items i
    LEFT JOIN Logos l ON l.Id = i.LogoId AND l.ManifestId = i.ManifestId
    WHERE i.IsDeleted = 0 AND i.DeletedAt IS NULL AND i.ArchivedAt IS NULL
    ORDER BY i.CreatedAt DESC";

/// The live field values of every active item, in display order.
const GET_ACTIVE_FIELD_VALUES: &str = "
    SELECT
      fv.ItemId, fv.ManifestId, fv.FieldKey, fv.FieldDefinitionId, fv.Value, fv.Weight,
      fd.Label AS CustomLabel, fd.FieldType AS CustomFieldType, fd.IsHidden AS CustomIsHidden, fd.EnableHistory AS CustomEnableHistory
    FROM FieldValues fv
    INNER JOIN Items i ON i.Id = fv.ItemId AND i.ManifestId = fv.ManifestId
    LEFT JOIN FieldDefinitions fd ON fd.ManifestId = fv.ManifestId AND fd.Id = fv.FieldDefinitionId
    WHERE fv.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL AND i.ArchivedAt IS NULL
    ORDER BY fv.Weight, fv.ValueIndex";

/// Every live folder.
const GET_ALL_FOLDERS: &str = "SELECT Id, ManifestId, Name, ParentFolderId FROM Folders WHERE IsDeleted = 0";

/// An item's live TOTP codes.
const GET_TOTP_CODES: &str = "
    SELECT Id, ItemId, Name, SecretKey, Algorithm, Digits, Period
    FROM TotpCodes
    WHERE ItemId = ?1 AND ManifestId = ?2 AND IsDeleted = 0";

/// Insert one field value after the field's existing values.
pub(super) const INSERT_FIELD_VALUE: &str = "
    INSERT INTO FieldValues (Id, ItemId, FieldDefinitionId, FieldKey, Value, Weight, ValueIndex, CreatedAt, UpdatedAt, IsDeleted, ManifestId)
    VALUES (?1, ?2, NULL, ?3, ?4, ?5,
        (SELECT COALESCE(MAX(ValueIndex), -1) + 1 FROM FieldValues WHERE ItemId = ?2 AND ManifestId = ?7 AND FieldKey = ?3 AND IsDeleted = 0),
        ?6, ?6, 0, ?7)";

/// Every active item with its fields and folder path, newest first.
pub fn get_all_active_items(conn: &Connection) -> VaultResult<Vec<VaultItem>> {
    let mut fields = active_fields(conn)?;
    let folder_paths = folder_paths(conn)?;

    let mut statement = conn.prepare_cached(GET_ALL_ACTIVE).map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            let id: String = row.get("Id")?;
            let manifest_id: String = row.get("ManifestId")?;
            let folder_id: Option<String> = row.get("FolderId")?;
            let folder_path = folder_id.as_deref().and_then(|folder| folder_paths.get(&(id_key(&manifest_id), id_key(folder)))).cloned().unwrap_or_default();
            Ok(VaultItem {
                fields: fields.remove(&(id_key(&manifest_id), id_key(&id))).unwrap_or_default(),
                name: row.get("Name")?,
                item_type: row.get("ItemType")?,
                logo: blob(row, "Logo")?,
                logo_kind: row.get("LogoKind")?,
                logo_source: row.get("LogoSource")?,
                folder_id,
                folder_path,
                has_passkey: row.get("HasPasskey")?,
                has_attachment: row.get("HasAttachment")?,
                has_totp: row.get("HasTotp")?,
                created_at_ms: timestamp_ms(row.get("CreatedAt")?),
                updated_at_ms: timestamp_ms(row.get("UpdatedAt")?),
                id,
                manifest_id,
            })
        })
        .map_err(sql_error)?;
    rows.collect::<Result<_, _>>().map_err(sql_error)
}

/// The live TOTP codes of one item.
pub fn get_totp_codes_for_item(conn: &Connection, item_id: &str, manifest_id: &str) -> VaultResult<Vec<VaultTotpCode>> {
    let mut statement = conn.prepare_cached(GET_TOTP_CODES).map_err(sql_error)?;
    let rows = statement
        .query_map(params![item_id, manifest_id], |row| {
            Ok(VaultTotpCode {
                id: row.get("Id")?,
                item_id: row.get("ItemId")?,
                name: row.get::<_, Option<String>>("Name")?.unwrap_or_default(),
                secret_key: row.get("SecretKey")?,
                algorithm: row.get::<_, Option<String>>("Algorithm")?.unwrap_or_else(|| "SHA1".to_string()),
                digits: row.get::<_, Option<u32>>("Digits")?.unwrap_or(6),
                period: row.get::<_, Option<u32>>("Period")?.unwrap_or(30),
            })
        })
        .map_err(sql_error)?;
    rows.collect::<Result<_, _>>().map_err(sql_error)
}

/// Append one value to a system field of an item, after the values it already has, and return the rows inserted.
pub fn append_field_value(conn: &Connection, item_id: &str, manifest_id: &str, field_key: &str, value: &str) -> VaultResult<u64> {
    insert_field_value(conn, item_id, manifest_id, field_key, value, &now_vault_datetime())
}

/// Insert one system field value, weighted with the field's default display order like every other writer.
pub(super) fn insert_field_value(conn: &Connection, item_id: &str, manifest_id: &str, field_key: &str, value: &str, now: &str) -> VaultResult<u64> {
    let weight = system_field(field_key).map(|field| field.default_display_order).unwrap_or(0);
    let changed = conn.execute(INSERT_FIELD_VALUE, params![new_id(), item_id, field_key, value, weight, now, manifest_id]).map_err(sql_error)?;
    Ok(changed as u64)
}

/// The fields of every active item, keyed by (manifest, item). Rows of a system field this build does not know are skipped.
fn active_fields(conn: &Connection) -> VaultResult<HashMap<(String, String), Vec<VaultItemField>>> {
    let mut statement = conn.prepare_cached(GET_ACTIVE_FIELD_VALUES).map_err(sql_error)?;
    let mut rows = statement.query([]).map_err(sql_error)?;
    let mut fields: HashMap<(String, String), Vec<VaultItemField>> = HashMap::new();
    while let Some(row) = rows.next().map_err(sql_error)? {
        let field_key: Option<String> = row.get("FieldKey").map_err(sql_error)?;
        let value: String = row.get::<_, Option<String>>("Value").map_err(sql_error)?.unwrap_or_default();
        let field = match field_key.filter(|key| !key.is_empty()) {
            Some(key) => {
                let Some(system) = system_field(&key) else { continue };
                VaultItemField {
                    label: key.clone(),
                    field_key: key,
                    field_type: system.field_type.to_string(),
                    value,
                    is_hidden: system.is_hidden,
                    display_order: system.default_display_order,
                    is_custom_field: false,
                    enable_history: system.enable_history,
                }
            }
            None => VaultItemField {
                field_key: row.get::<_, Option<String>>("FieldDefinitionId").map_err(sql_error)?.unwrap_or_default(),
                label: row.get::<_, Option<String>>("CustomLabel").map_err(sql_error)?.unwrap_or_default(),
                field_type: row.get::<_, Option<String>>("CustomFieldType").map_err(sql_error)?.unwrap_or_else(|| "Text".to_string()),
                value,
                is_hidden: row.get::<_, Option<i64>>("CustomIsHidden").map_err(sql_error)? == Some(1),
                display_order: row.get::<_, Option<i64>>("Weight").map_err(sql_error)?.unwrap_or(0),
                is_custom_field: true,
                enable_history: row.get::<_, Option<i64>>("CustomEnableHistory").map_err(sql_error)? == Some(1),
            },
        };
        let item_id: String = row.get("ItemId").map_err(sql_error)?;
        let manifest_id: String = row.get("ManifestId").map_err(sql_error)?;
        fields.entry((id_key(&manifest_id), id_key(&item_id))).or_default().push(field);
    }
    Ok(fields)
}

/// The path of folder names of every folder, keyed by (manifest, folder). A parent link only resolves inside its own manifest.
fn folder_paths(conn: &Connection) -> VaultResult<HashMap<(String, String), Vec<String>>> {
    struct Folder {
        name: String,
        parent: Option<String>,
    }

    let mut statement = conn.prepare_cached(GET_ALL_FOLDERS).map_err(sql_error)?;
    let mut rows = statement.query([]).map_err(sql_error)?;
    let mut folders: HashMap<(String, String), Folder> = HashMap::new();
    while let Some(row) = rows.next().map_err(sql_error)? {
        let id: String = row.get("Id").map_err(sql_error)?;
        let manifest_id: String = row.get("ManifestId").map_err(sql_error)?;
        let name: Option<String> = row.get("Name").map_err(sql_error)?;
        let parent: Option<String> = row.get("ParentFolderId").map_err(sql_error)?;
        folders.insert((id_key(&manifest_id), id_key(&id)), Folder { name: name.unwrap_or_default(), parent: parent.map(|p| id_key(&p)) });
    }

    let mut paths = HashMap::new();
    for (manifest_id, id) in folders.keys() {
        let mut path = Vec::new();
        let mut current = Some(id.clone());
        while let Some(folder) = current.and_then(|folder_id| folders.get(&(manifest_id.clone(), folder_id))) {
            if path.len() > MAX_FOLDER_DEPTH {
                break;
            }
            path.insert(0, folder.name.clone());
            current = folder.parent.clone();
        }
        paths.insert((manifest_id.clone(), id.clone()), path);
    }
    Ok(paths)
}
