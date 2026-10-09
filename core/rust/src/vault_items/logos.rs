//! Which logo an item gets when it is written.

use rusqlite::{params, Connection, OptionalExtension};

use super::sql_error;
use crate::common::error::VaultResult;
use crate::favicon::favicon_source_key;
use crate::vault_codec::logo_id_for;

const FAVICON: &str = "favicon";
const FAVICON_MIME_TYPE: &str = "image/x-icon";

const GET_BY_ID: &str = "SELECT Kind, Source FROM Logos WHERE Id = ?1 AND ManifestId = ?2 AND IsDeleted = 0";
const GET_FAVICON_ID: &str = "SELECT Id FROM Logos WHERE ManifestId = ?1 AND Kind = 'favicon' AND Source = ?2 AND IsDeleted = 0 LIMIT 1";
const GET_BEST_FAVICON: &str = "
    SELECT FileData, MimeType FROM Logos
    WHERE Kind = 'favicon' AND Source = ?1 AND IsDeleted = 0
    ORDER BY (FileData IS NOT NULL AND LENGTH(FileData) > 0) DESC, UpdatedAt DESC
    LIMIT 1";
const UPSERT_FAVICON: &str = "
    INSERT INTO Logos (Id, Kind, Source, ManifestId, FileData, MimeType, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?1, 'favicon', ?2, ?3, ?4, ?5, ?6, ?6, 0)
    ON CONFLICT(ManifestId, Id) DO UPDATE SET
      FileData = excluded.FileData,
      MimeType = excluded.MimeType,
      UpdatedAt = excluded.UpdatedAt,
      IsDeleted = 0";
const GET_ITEM_LOGO_ID: &str = "SELECT LogoId FROM Items WHERE Id = ?1 AND ManifestId = ?2";
const SET_ITEM_LOGO_ID: &str = "UPDATE Items SET LogoId = ?1, UpdatedAt = ?2 WHERE Id = ?3 AND ManifestId = ?4";

/// The logo id an item in `scope` should carry for `url`, or None to keep what it has (or have none on create).
pub(super) fn resolve_logo_id(conn: &Connection, scope: &str, existing_logo_id: Option<&str>, url: &str, logo: Option<&[u8]>, now: &str) -> VaultResult<Option<String>> {
    let source = favicon_source_key(url);
    if let Some(id) = existing_logo_id {
        let existing: Option<(String, String)> = conn.query_row(GET_BY_ID, params![id, scope], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(sql_error)?;
        // A logo the user chose, or this domain's favicon, stays.
        if existing.is_some_and(|(kind, existing_source)| kind != FAVICON || existing_source == source) {
            return Ok(Some(id.to_string()));
        }
    }
    if source.is_empty() {
        return Ok(None);
    }
    if let Some(bytes) = logo.filter(|bytes| !bytes.is_empty()) {
        return upsert_favicon(conn, scope, &source, Some(bytes), Some(FAVICON_MIME_TYPE), now).map(Some);
    }
    favicon_in_scope(conn, scope, &source, now)
}

/// Point an existing item at the logo [`resolve_logo_id`] picks, when that differs from the one it has.
pub(super) fn refresh_item_logo(conn: &Connection, item_id: &str, manifest_id: &str, url: &str, logo: Option<&[u8]>, now: &str) -> VaultResult<()> {
    let current: Option<String> = conn.query_row(GET_ITEM_LOGO_ID, params![item_id, manifest_id], |row| row.get(0)).optional().map_err(sql_error)?.flatten();
    let Some(logo_id) = resolve_logo_id(conn, manifest_id, current.as_deref(), url, logo, now)? else { return Ok(()) };
    if current.as_deref() != Some(logo_id.as_str()) {
        conn.execute(SET_ITEM_LOGO_ID, params![logo_id, now, item_id, manifest_id]).map_err(sql_error)?;
    }
    Ok(())
}

/// The id of the domain's favicon inside `manifest_id`, copied in from another manifest when it is not there yet; None when the vault has none.
fn favicon_in_scope(conn: &Connection, manifest_id: &str, source: &str, now: &str) -> VaultResult<Option<String>> {
    if let Some(id) = conn.query_row(GET_FAVICON_ID, params![manifest_id, source], |row| row.get(0)).optional().map_err(sql_error)? {
        return Ok(Some(id));
    }
    let origin: Option<(Option<Vec<u8>>, Option<String>)> = conn.query_row(GET_BEST_FAVICON, params![source], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(sql_error)?;
    origin.map(|(data, mime_type)| upsert_favicon(conn, manifest_id, source, data.as_deref(), mime_type.as_deref(), now)).transpose()
}

/// Insert or refresh the domain's favicon in one manifest, under the id derived for that key.
fn upsert_favicon(conn: &Connection, manifest_id: &str, source: &str, data: Option<&[u8]>, mime_type: Option<&str>, now: &str) -> VaultResult<String> {
    let id = logo_id_for(manifest_id, FAVICON, source);
    conn.execute(UPSERT_FAVICON, params![id, source, manifest_id, data, mime_type, now]).map_err(sql_error)?;
    Ok(id)
}
