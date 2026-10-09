//! Passkey reads and the passkey writes of the native authenticators.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::items::insert_field_value;
use super::logos::{refresh_item_logo, resolve_logo_id};
use super::{blob, sql_error, timestamp_ms, NewPasskey, PasskeyMergeCandidate, VaultPasskey, VaultPasskeyWithItem};
use crate::common::error::{VaultError, VaultResult};
use crate::common::timestamp::now_vault_datetime;
use crate::credential_matcher::{filter_credentials, AutofillMatchingMode, Credential, CredentialMatcherInput};
use crate::vault_model::id_key;

/// The passkey columns plus the name and account of the item, which must be live (not deleted, not in the trash).
const SELECT_WITH_ITEM: &str = "
    SELECT
      p.Id, p.ItemId, p.ManifestId, p.RpId, p.UserHandle, p.PublicKey, p.PrivateKey, p.PrfKey, p.DisplayName, p.AdditionalData,
      p.CreatedAt, p.UpdatedAt,
      i.Name AS ServiceName,
      (SELECT fv.Value FROM FieldValues fv WHERE fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId AND fv.FieldKey = 'login.username' AND fv.IsDeleted = 0 ORDER BY fv.ValueIndex LIMIT 1) AS Username,
      (SELECT fv.Value FROM FieldValues fv WHERE fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId AND fv.FieldKey = 'login.email' AND fv.IsDeleted = 0 ORDER BY fv.ValueIndex LIMIT 1) AS Email
    FROM Passkeys p
    INNER JOIN Items i ON i.Id = p.ItemId AND i.ManifestId = p.ManifestId AND i.IsDeleted = 0 AND i.DeletedAt IS NULL
    WHERE p.IsDeleted = 0";

/// Live Login items that have no live passkey yet, newest change first.
const GET_ITEMS_WITHOUT_PASSKEY: &str = "
    SELECT
      i.Id, i.ManifestId, i.Name, i.CreatedAt, i.UpdatedAt,
      (SELECT fv.Value FROM FieldValues fv WHERE fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId AND fv.FieldKey = 'login.username' AND fv.IsDeleted = 0 ORDER BY fv.ValueIndex LIMIT 1) AS Username,
      (SELECT fv.Value FROM FieldValues fv WHERE fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId AND fv.FieldKey = 'login.email' AND fv.IsDeleted = 0 ORDER BY fv.ValueIndex LIMIT 1) AS Email,
      EXISTS (SELECT 1 FROM FieldValues fv WHERE fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId AND fv.FieldKey = 'login.password' AND fv.IsDeleted = 0 AND fv.Value <> '') AS HasPassword
    FROM Items i
    WHERE i.IsDeleted = 0 AND i.DeletedAt IS NULL AND i.ArchivedAt IS NULL AND i.ItemType = 'Login'
      AND NOT EXISTS (SELECT 1 FROM Passkeys p WHERE p.ItemId = i.Id AND p.ManifestId = i.ManifestId AND p.IsDeleted = 0)
    ORDER BY i.UpdatedAt DESC";

/// The live URLs of every item, in value order.
const GET_ALL_URLS: &str = "SELECT ItemId, ManifestId, Value FROM FieldValues WHERE FieldKey = 'login.url' AND IsDeleted = 0 ORDER BY ValueIndex";

const INSERT_ITEM: &str = "
    INSERT INTO Items (Id, Name, ItemType, LogoId, FolderId, CreatedAt, UpdatedAt, IsDeleted, ManifestId)
    VALUES (?1, ?2, 'Login', ?3, NULL, ?4, ?4, 0, ?5)";

const INSERT_PASSKEY: &str = "
    INSERT INTO Passkeys (Id, ItemId, ManifestId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey, DisplayName, AdditionalData, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?10, 0)";

const SOFT_DELETE_PASSKEY: &str = "UPDATE Passkeys SET IsDeleted = 1, UpdatedAt = ?1 WHERE Id = ?2 AND ManifestId = ?3";

/// The passkey with this credential id in any manifest, newest first when several manifests hold it.
pub fn get_passkey_by_id(conn: &Connection, passkey_id: &str) -> VaultResult<Option<VaultPasskeyWithItem>> {
    let sql = format!("{SELECT_WITH_ITEM} AND p.Id = ?1 ORDER BY p.CreatedAt DESC, p.ManifestId LIMIT 1");
    conn.query_row(&sql, params![id_key(passkey_id)], passkey_with_item).optional().map_err(sql_error)
}

/// The passkey with this id inside one manifest.
pub fn get_passkey_in_manifest(conn: &Connection, passkey_id: &str, manifest_id: &str) -> VaultResult<Option<VaultPasskeyWithItem>> {
    let sql = format!("{SELECT_WITH_ITEM} AND p.Id = ?1 AND p.ManifestId = ?2");
    conn.query_row(&sql, params![id_key(passkey_id), manifest_id], passkey_with_item).optional().map_err(sql_error)
}

/// The passkeys of one item, newest first.
pub fn get_passkeys_for_item(conn: &Connection, item_id: &str, manifest_id: &str) -> VaultResult<Vec<VaultPasskey>> {
    let sql = format!("{SELECT_WITH_ITEM} AND p.ItemId = ?1 AND p.ManifestId = ?2 ORDER BY p.CreatedAt DESC");
    let rows = query_with_item(conn, &sql, params![id_key(item_id), manifest_id])?;
    Ok(rows.into_iter().map(|row| row.passkey).collect())
}

/// The passkeys for a relying party, newest first, narrowed to an account when `user_name` or `user_handle` is given.
pub fn get_passkeys_for_rp_id(conn: &Connection, rp_id: &str, user_name: Option<&str>, user_handle: Option<&[u8]>) -> VaultResult<Vec<VaultPasskeyWithItem>> {
    let sql = format!("{SELECT_WITH_ITEM} AND p.RpId = ?1 ORDER BY p.CreatedAt DESC, p.ManifestId");
    let rows = query_with_item(conn, &sql, params![rp_id])?;
    Ok(rows
        .into_iter()
        .filter(|row| user_name.is_none_or(|name| row.username.as_deref() == Some(name)))
        .filter(|row| user_handle.is_none_or(|handle| row.passkey.user_handle.as_deref() == Some(handle)))
        .collect())
}

/// Every passkey whose item is live, newest first.
pub fn get_all_passkeys_with_items(conn: &Connection) -> VaultResult<Vec<VaultPasskeyWithItem>> {
    let sql = format!("{SELECT_WITH_ITEM} ORDER BY p.CreatedAt DESC, p.ManifestId");
    query_with_item(conn, &sql, [])
}

/// The Login items without a passkey that match a relying party, best match first, which a new passkey could be added to.
pub fn get_items_without_passkey_for_rp_id(conn: &Connection, rp_id: &str, rp_name: Option<&str>, user_name: Option<&str>) -> VaultResult<Vec<PasskeyMergeCandidate>> {
    if rp_id.is_empty() {
        return Ok(Vec::new());
    }

    let mut urls = urls_by_item(conn)?;
    let mut statement = conn.prepare_cached(GET_ITEMS_WITHOUT_PASSKEY).map_err(sql_error)?;
    let candidates: Vec<PasskeyMergeCandidate> = statement
        .query_map([], |row| {
            let item_id: String = row.get("Id")?;
            let manifest_id: String = row.get("ManifestId")?;
            Ok(PasskeyMergeCandidate {
                urls: urls.remove(&(id_key(&manifest_id), id_key(&item_id))).unwrap_or_default(),
                service_name: row.get("Name")?,
                username: row.get("Username")?,
                email: row.get("Email")?,
                has_password: row.get("HasPassword")?,
                created_at_ms: timestamp_ms(row.get("CreatedAt")?),
                updated_at_ms: timestamp_ms(row.get("UpdatedAt")?),
                item_id,
                manifest_id,
            })
        })
        .map_err(sql_error)?
        .collect::<Result<_, _>>()
        .map_err(sql_error)?;

    // The matcher sees each candidate under its position, so an item id held by two manifests stays two candidates.
    let credentials = candidates
        .iter()
        .enumerate()
        .map(|(index, candidate)| Credential { id: index.to_string(), item_name: candidate.service_name.clone(), item_urls: candidate.urls.clone(), username: candidate.username.clone() })
        .collect();
    let output = filter_credentials(CredentialMatcherInput {
        credentials,
        current_url: format!("https://{rp_id}"),
        page_title: rp_name.unwrap_or_default().to_string(),
        matching_mode: AutofillMatchingMode::UrlSubdomain,
        ignore_port: false,
        max_results: None,
    });

    Ok(output
        .matched_ids
        .iter()
        .filter_map(|id| id.parse::<usize>().ok().and_then(|index| candidates.get(index)))
        .filter(|candidate| user_name.is_none_or(|name| candidate.username.as_deref() == Some(name)))
        .cloned()
        .collect())
}

/// Create a Login item in `manifest_id` that holds a new passkey, with its URL, username and favicon.
#[allow(clippy::too_many_arguments)]
pub fn create_item_with_passkey(
    conn: &Connection,
    manifest_id: &str,
    item_id: &str,
    item_name: &str,
    url: &str,
    user_name: Option<&str>,
    passkey: &NewPasskey,
    logo: Option<&[u8]>,
) -> VaultResult<()> {
    let now = now_vault_datetime();
    let item_id = id_key(item_id);
    let logo_id = resolve_logo_id(conn, manifest_id, None, url, logo, &now)?;
    conn.execute(INSERT_ITEM, params![item_id, item_name, logo_id, now, manifest_id]).map_err(sql_error)?;
    if !url.is_empty() {
        insert_field_value(conn, &item_id, manifest_id, "login.url", url, &now)?;
    }
    if let Some(user_name) = user_name.filter(|name| !name.is_empty()) {
        insert_field_value(conn, &item_id, manifest_id, "login.username", user_name, &now)?;
    }
    insert_passkey(conn, &item_id, manifest_id, passkey, &now)
}

/// Add a new passkey to an existing item, refreshing the item's favicon for `url`.
pub fn add_passkey_to_item(conn: &Connection, item_id: &str, manifest_id: &str, passkey: &NewPasskey, url: &str, logo: Option<&[u8]>) -> VaultResult<()> {
    let now = now_vault_datetime();
    let item_id = id_key(item_id);
    refresh_item_logo(conn, &item_id, manifest_id, url, logo, &now)?;
    insert_passkey(conn, &item_id, manifest_id, passkey, &now)
}

/// Replace a passkey with a new one on the same item, refreshing the item's favicon for `url`. Returns the item id.
pub fn replace_passkey(conn: &Connection, old_passkey_id: &str, manifest_id: &str, passkey: &NewPasskey, url: &str, logo: Option<&[u8]>) -> VaultResult<String> {
    let old = get_passkey_in_manifest(conn, old_passkey_id, manifest_id)?.ok_or_else(|| VaultError::General(format!("Passkey not found: {old_passkey_id}")))?;
    let now = now_vault_datetime();
    let item_id = old.passkey.item_id;
    refresh_item_logo(conn, &item_id, manifest_id, url, logo, &now)?;
    conn.execute(SOFT_DELETE_PASSKEY, params![now, old.passkey.id, manifest_id]).map_err(sql_error)?;
    insert_passkey(conn, &item_id, manifest_id, passkey, &now)?;
    Ok(item_id)
}

fn insert_passkey(conn: &Connection, item_id: &str, manifest_id: &str, passkey: &NewPasskey, now: &str) -> VaultResult<()> {
    conn.execute(
        INSERT_PASSKEY,
        params![id_key(&passkey.id), item_id, manifest_id, passkey.rp_id, passkey.user_handle, passkey.public_key, passkey.private_key, passkey.prf_key, passkey.display_name, now],
    )
    .map_err(sql_error)?;
    Ok(())
}

fn query_with_item<P: rusqlite::Params>(conn: &Connection, sql: &str, params: P) -> VaultResult<Vec<VaultPasskeyWithItem>> {
    let mut statement = conn.prepare_cached(sql).map_err(sql_error)?;
    let rows = statement.query_map(params, passkey_with_item).map_err(sql_error)?;
    rows.collect::<Result<_, _>>().map_err(sql_error)
}

fn passkey_with_item(row: &Row<'_>) -> rusqlite::Result<VaultPasskeyWithItem> {
    Ok(VaultPasskeyWithItem {
        passkey: VaultPasskey {
            id: row.get("Id")?,
            item_id: row.get("ItemId")?,
            manifest_id: row.get("ManifestId")?,
            rp_id: row.get("RpId")?,
            user_handle: blob(row, "UserHandle")?,
            public_key: row.get("PublicKey")?,
            private_key: row.get("PrivateKey")?,
            prf_key: blob(row, "PrfKey")?,
            display_name: row.get::<_, Option<String>>("DisplayName")?.unwrap_or_default(),
            additional_data: blob(row, "AdditionalData")?,
            created_at_ms: timestamp_ms(row.get("CreatedAt")?),
            updated_at_ms: timestamp_ms(row.get("UpdatedAt")?),
        },
        service_name: row.get("ServiceName")?,
        username: row.get("Username")?,
        email: row.get("Email")?,
    })
}

/// The live URLs of every item, keyed by (manifest, item).
fn urls_by_item(conn: &Connection) -> VaultResult<HashMap<(String, String), Vec<String>>> {
    let mut statement = conn.prepare_cached(GET_ALL_URLS).map_err(sql_error)?;
    let mut rows = statement.query([]).map_err(sql_error)?;
    let mut urls: HashMap<(String, String), Vec<String>> = HashMap::new();
    while let Some(row) = rows.next().map_err(sql_error)? {
        let item_id: String = row.get(0).map_err(sql_error)?;
        let manifest_id: String = row.get(1).map_err(sql_error)?;
        if let Some(value) = row.get::<_, Option<String>>(2).map_err(sql_error)?.filter(|value| !value.is_empty()) {
            urls.entry((id_key(&manifest_id), id_key(&item_id))).or_default().push(value);
        }
    }
    Ok(urls)
}
