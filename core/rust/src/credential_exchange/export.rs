//! Exports the active items of the given manifests as a CXF 1.0 document.

use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::common::encoding::base64url_encode;
use crate::common::error::{VaultError, VaultResult};
use crate::passkey::{guid_to_bytes, private_key_jwk_to_pkcs8};
use crate::vault_items::{get_all_active_items, get_totp_codes_for_item, VaultItem, VaultItemField};
use crate::vault_model::{id_key, ids_equal};

/// What the host supplies for an export: who exports, the AliasVault account name and the manifests to export.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub exporter_rp_id: String,
    pub exporter_display_name: String,
    pub account_username: String,
    /// The manifests to export, the personal manifest first: its id is the account id of the document.
    pub manifest_ids: Vec<String>,
}

/// The CXF document as JSON, with what it holds.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub document: String,
    pub item_count: usize,
    pub passkey_count: usize,
    pub totp_count: usize,
}

/// A row's (manifest id, row id), both as comparison keys.
type DocumentKey = (String, String);

struct PasskeyRow {
    id: String,
    credential_id: Option<Vec<u8>>,
    rp_id: String,
    user_handle: Vec<u8>,
    private_key: String,
    prf_key: Option<Vec<u8>>,
    display_name: String,
    additional_data: Option<Vec<u8>>,
}

struct FolderRow {
    id: String,
    manifest_id: String,
    name: String,
    parent_folder_id: Option<String>,
}

#[derive(Default)]
struct ItemFields<'a> {
    username: Option<&'a str>,
    password: Option<&'a str>,
    email: Option<&'a str>,
    urls: Vec<&'a str>,
    notes: Option<&'a str>,
    card_number: Option<&'a str>,
    card_holder: Option<&'a str>,
    card_cvv: Option<&'a str>,
    card_pin: Option<&'a str>,
    card_expiry_month: Option<&'a str>,
    card_expiry_year: Option<&'a str>,
    first_name: Option<&'a str>,
    last_name: Option<&'a str>,
    gender: Option<&'a str>,
    birthdate: Option<&'a str>,
    custom: Vec<&'a VaultItemField>,
}

/// The active items of the manifests in `options` as one CXF document with one account.
pub fn export_document(conn: &Connection, options: &ExportOptions) -> VaultResult<ExportResult> {
    let personal_manifest_id = options.manifest_ids.first().ok_or_else(|| VaultError::General("An export needs at least one manifest".to_string()))?;
    let in_scope = |manifest_id: &str| options.manifest_ids.iter().any(|id| ids_equal(id, manifest_id));
    let items: Vec<VaultItem> = get_all_active_items(conn)?.into_iter().filter(|item| in_scope(&item.manifest_id)).collect();
    let mut passkeys = passkeys_by_item(conn)?;
    let folders: Vec<FolderRow> = folders(conn)?.into_iter().filter(|folder| in_scope(&folder.manifest_id)).collect();

    let item_ids = document_ids(&options.manifest_ids, items.iter().map(|item| (item.manifest_id.as_str(), item.id.as_str())))?;
    let folder_ids = document_ids(&options.manifest_ids, folders.iter().map(|folder| (folder.manifest_id.as_str(), folder.id.as_str())))?;

    let mut result = ExportResult { document: String::new(), item_count: 0, passkey_count: 0, totp_count: 0 };
    let mut exported_items = Vec::with_capacity(items.len());
    for item in &items {
        let key = (id_key(&item.manifest_id), id_key(&item.id));
        let totp_codes = get_totp_codes_for_item(conn, &item.id, &item.manifest_id)?;
        let item_passkeys = passkeys.remove(&key).unwrap_or_default();
        exported_items.push(export_item(item, &item_ids[&key], &totp_codes, &item_passkeys, &mut result)?);
    }
    result.item_count = exported_items.len();

    let account_id = guid_to_bytes(personal_manifest_id)?;
    let account = json!({
        "id": base64url_encode(&account_id),
        "username": options.account_username,
        "email": options.account_username,
        "collections": collections(&folders, &items, &item_ids, &folder_ids),
        "items": exported_items,
    });
    let document = json!({
        "version": { "major": 1, "minor": 0 },
        "exporterRpId": options.exporter_rp_id,
        "exporterDisplayName": options.exporter_display_name,
        "timestamp": chrono::Utc::now().timestamp().max(0) as u64,
        "accounts": [account],
    });
    result.document = serde_json::to_string(&document)?;
    Ok(result)
}

fn export_item(item: &VaultItem, document_id: &str, totp_codes: &[crate::vault_items::VaultTotpCode], passkeys: &[PasskeyRow], result: &mut ExportResult) -> VaultResult<Value> {
    let fields = read_fields(item);
    let mut credentials: Vec<Value> = Vec::new();
    let mut custom_fields: Vec<Value> = Vec::new();

    let is_card = item.item_type.eq_ignore_ascii_case("CreditCard");
    let is_note = item.item_type.eq_ignore_ascii_case("Note");
    let login_name = fields.username.or(fields.email);

    if !is_card && !is_note && (login_name.is_some() || fields.password.is_some()) {
        let mut basic_auth = Map::new();
        basic_auth.insert("type".into(), json!("basic-auth"));
        if let Some(username) = login_name {
            basic_auth.insert("username".into(), editable_field("string", username, None));
        }
        if let Some(password) = fields.password {
            basic_auth.insert("password".into(), editable_field("concealed-string", password, None));
        }
        credentials.push(Value::Object(basic_auth));
    }
    // The email only has a place of its own when the username already took the basic-auth slot.
    if let (Some(_), Some(email)) = (fields.username, fields.email) {
        custom_fields.push(editable_field("email", email, Some("Email")));
    }

    for passkey in passkeys {
        // A passkey whose stored key cannot be read is left out; the rest of its item is still exported.
        if let Ok(credential) = passkey_credential(passkey, login_name) {
            credentials.push(credential);
            result.passkey_count += 1;
        }
    }

    for totp in totp_codes {
        let secret: String = totp.secret_key.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_uppercase();
        if secret.is_empty() {
            continue;
        }
        let mut credential = Map::new();
        credential.insert("type".into(), json!("totp"));
        credential.insert("secret".into(), json!(secret));
        credential.insert("period".into(), json!(totp.period));
        credential.insert("digits".into(), json!(totp.digits));
        credential.insert("algorithm".into(), json!(totp.algorithm.to_lowercase()));
        if let Some(username) = login_name {
            credential.insert("username".into(), json!(username));
        }
        let issuer = if totp.name.trim().is_empty() { item.name.clone().unwrap_or_default() } else { totp.name.clone() };
        if !issuer.is_empty() {
            credential.insert("issuer".into(), json!(issuer));
        }
        credentials.push(Value::Object(credential));
        result.totp_count += 1;
    }

    if let Some(notes) = fields.notes {
        credentials.push(json!({ "type": "note", "content": editable_field("string", notes, None) }));
    }

    if is_card {
        let mut card = Map::new();
        card.insert("type".into(), json!("credit-card"));
        insert_field(&mut card, "number", "concealed-string", fields.card_number);
        insert_field(&mut card, "fullName", "string", fields.card_holder);
        insert_field(&mut card, "verificationNumber", "concealed-string", fields.card_cvv);
        insert_field(&mut card, "pin", "concealed-string", fields.card_pin);
        if let Some(expiry) = year_month(fields.card_expiry_year, fields.card_expiry_month) {
            card.insert("expiryDate".into(), editable_field("year-month", &expiry, None));
        }
        if card.len() > 1 {
            credentials.push(Value::Object(card));
        }
    }

    if fields.first_name.is_some() || fields.last_name.is_some() {
        let mut name = Map::new();
        name.insert("type".into(), json!("person-name"));
        insert_field(&mut name, "given", "string", fields.first_name);
        insert_field(&mut name, "surname", "string", fields.last_name);
        credentials.push(Value::Object(name));
    }
    if let Some(birthdate) = fields.birthdate {
        custom_fields.push(editable_field("date", birthdate, Some("Birth date")));
    }
    if let Some(gender) = fields.gender {
        custom_fields.push(editable_field("string", gender, Some("Gender")));
    }

    for field in &fields.custom {
        if field.field_type.eq_ignore_ascii_case("Section") || field.value.is_empty() {
            continue;
        }
        custom_fields.push(editable_field(custom_field_type(&field.field_type), &field.value, Some(&field.label)));
    }
    if !custom_fields.is_empty() {
        credentials.push(json!({ "type": "custom-fields", "fields": custom_fields }));
    }

    let mut exported = Map::new();
    exported.insert("id".into(), json!(document_id));
    if let Some(seconds) = unix_seconds(item.created_at_ms) {
        exported.insert("creationAt".into(), json!(seconds));
    }
    if let Some(seconds) = unix_seconds(item.updated_at_ms) {
        exported.insert("modifiedAt".into(), json!(seconds));
    }
    exported.insert("title".into(), json!(item_title(item, passkeys)));
    let urls: Vec<String> = fields.urls.iter().filter_map(|url| exported_url(url)).collect();
    if !urls.is_empty() {
        exported.insert("scope".into(), json!({ "urls": urls, "androidApps": [] }));
    }
    exported.insert("credentials".into(), Value::Array(credentials));
    Ok(Value::Object(exported))
}

fn passkey_credential(passkey: &PasskeyRow, login_name: Option<&str>) -> VaultResult<Value> {
    let key = private_key_jwk_to_pkcs8(&passkey.private_key)?;
    // Without a stored CredentialId, the WebAuthn credential id falls back to the 16 bytes of the row id.
    let credential_id = match &passkey.credential_id {
        Some(bytes) if !bytes.is_empty() => bytes.clone(),
        _ => guid_to_bytes(&passkey.id)?,
    };
    let mut credential = json!({
        "type": "passkey",
        "credentialId": base64url_encode(&credential_id),
        "rpId": passkey.rp_id,
        "username": login_name.unwrap_or(passkey.display_name.as_str()),
        "userDisplayName": passkey.display_name,
        "userHandle": base64url_encode(&passkey.user_handle),
        "key": base64url_encode(&key),
    });
    if let Some(extensions) = fido2_extensions(passkey) {
        credential["fido2Extensions"] = extensions;
    }
    Ok(credential)
}

fn fido2_extensions(passkey: &PasskeyRow) -> Option<Value> {
    let kept = passkey.additional_data.as_deref().and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok());
    let mut extensions = match kept.and_then(|data| data.get("fido2Extensions").cloned()) {
        Some(Value::Object(map)) => map,
        _ => Map::new(),
    };
    if let Some(prf_key) = passkey.prf_key.as_deref().filter(|key| !key.is_empty()) {
        // The authenticator evaluates the PRF with one secret whether or not user verification was performed.
        let secret = base64url_encode(prf_key);
        extensions.insert("hmacCredentials".into(), json!({ "algorithm": "hmac-sha256", "credWithUV": secret, "credWithoutUV": secret }));
    }
    (!extensions.is_empty()).then_some(Value::Object(extensions))
}

/// The id each row gets in the document, keyed by (manifest id, row id). CXF knows a row by its id alone, so a row whose GUID an
/// earlier listed manifest already uses gets an id derived from its manifest id and its own id.
fn document_ids<'a>(manifest_ids: &[String], rows: impl Iterator<Item = (&'a str, &'a str)>) -> VaultResult<HashMap<DocumentKey, String>> {
    let mut rows: Vec<(&str, &str)> = rows.collect();
    rows.sort_by_key(|(manifest_id, _)| manifest_ids.iter().position(|id| ids_equal(id, manifest_id)));
    let mut taken = HashSet::new();
    let mut ids = HashMap::with_capacity(rows.len());
    for (manifest_id, id) in rows {
        let key = (id_key(manifest_id), id_key(id));
        let bytes = if taken.insert(key.1.clone()) { guid_to_bytes(id)?.to_vec() } else { Sha256::digest(format!("{}:{}", key.0, key.1))[..16].to_vec() };
        ids.insert(key, base64url_encode(&bytes));
    }
    Ok(ids)
}

fn collections(folders: &[FolderRow], items: &[VaultItem], item_ids: &HashMap<DocumentKey, String>, folder_ids: &HashMap<DocumentKey, String>) -> Vec<Value> {
    let mut items_by_folder: HashMap<DocumentKey, Vec<String>> = HashMap::new();
    for item in items {
        if let Some(folder_id) = &item.folder_id {
            let manifest_key = id_key(&item.manifest_id);
            items_by_folder.entry((manifest_key.clone(), id_key(folder_id))).or_default().push(item_ids[&(manifest_key, id_key(&item.id))].clone());
        }
    }
    let known: HashSet<DocumentKey> = folders.iter().map(|folder| (id_key(&folder.manifest_id), id_key(&folder.id))).collect();
    let roots: Vec<&FolderRow> = folders.iter().filter(|folder| folder.parent_folder_id.as_deref().is_none_or(|parent| !known.contains(&(id_key(&folder.manifest_id), id_key(parent))))).collect();
    let mut visited = HashSet::new();
    roots.iter().filter_map(|folder| collection(folder, folders, &items_by_folder, folder_ids, &mut visited)).collect()
}

fn collection(folder: &FolderRow, folders: &[FolderRow], items_by_folder: &HashMap<DocumentKey, Vec<String>>, folder_ids: &HashMap<DocumentKey, String>, visited: &mut HashSet<DocumentKey>) -> Option<Value> {
    let key = (id_key(&folder.manifest_id), id_key(&folder.id));
    if !visited.insert(key.clone()) {
        return None;
    }
    let children: Vec<Value> = folders
        .iter()
        .filter(|child| ids_equal(&child.manifest_id, &folder.manifest_id) && child.parent_folder_id.as_deref().is_some_and(|parent| ids_equal(parent, &folder.id)))
        .filter_map(|child| collection(child, folders, items_by_folder, folder_ids, visited))
        .collect();
    let linked: Vec<Value> = items_by_folder.get(&key).map(|ids| ids.iter().map(|id| json!({ "item": id })).collect()).unwrap_or_default();
    let mut value = Map::new();
    value.insert("id".into(), json!(folder_ids[&key]));
    value.insert("title".into(), json!(folder.name));
    value.insert("items".into(), Value::Array(linked));
    if !children.is_empty() {
        value.insert("subCollections".into(), Value::Array(children));
    }
    Some(Value::Object(value))
}

/// A multi-value system field other than the URL keeps its first value.
fn read_fields(item: &VaultItem) -> ItemFields<'_> {
    let mut fields = ItemFields::default();
    for field in &item.fields {
        if field.is_custom_field {
            fields.custom.push(field);
            continue;
        }
        let value = field.value.trim();
        if value.is_empty() {
            continue;
        }
        let slot = match field.field_key.to_lowercase().as_str() {
            "login.url" => {
                fields.urls.push(value);
                continue;
            }
            "login.username" => &mut fields.username,
            "login.password" => &mut fields.password,
            "login.email" => &mut fields.email,
            "notes.content" => &mut fields.notes,
            "card.number" => &mut fields.card_number,
            "card.cardholder_name" => &mut fields.card_holder,
            "card.cvv" => &mut fields.card_cvv,
            "card.pin" => &mut fields.card_pin,
            "card.expiry_month" => &mut fields.card_expiry_month,
            "card.expiry_year" => &mut fields.card_expiry_year,
            "alias.first_name" => &mut fields.first_name,
            "alias.last_name" => &mut fields.last_name,
            "alias.gender" => &mut fields.gender,
            "alias.birthdate" => &mut fields.birthdate,
            _ => continue,
        };
        if slot.is_none() {
            *slot = Some(value);
        }
    }
    fields
}

fn custom_field_type(field_type: &str) -> &'static str {
    match field_type.to_lowercase().as_str() {
        "password" | "hidden" => "concealed-string",
        "email" => "email",
        "number" => "number",
        "date" => "date",
        _ => "string",
    }
}

fn editable_field(field_type: &str, value: &str, label: Option<&str>) -> Value {
    let mut field = Map::new();
    field.insert("fieldType".into(), json!(field_type));
    field.insert("value".into(), json!(value));
    if let Some(label) = label {
        field.insert("label".into(), json!(label));
    }
    Value::Object(field)
}

fn insert_field(target: &mut Map<String, Value>, name: &str, field_type: &str, value: Option<&str>) {
    if let Some(value) = value {
        target.insert(name.into(), editable_field(field_type, value, None));
    }
}

/// "YYYY-MM" from the stored expiry year and month; a two-digit year is taken as 20YY.
fn year_month(year: Option<&str>, month: Option<&str>) -> Option<String> {
    let year: u32 = year?.trim().parse().ok()?;
    let month: u32 = month?.trim().parse().ok()?;
    if !(1..=12).contains(&month) {
        return None;
    }
    let year = if year < 100 { 2000 + year } else { year };
    Some(format!("{year:04}-{month:02}"))
}

/// The item title; an item without a name is titled after its passkey's relying party.
fn item_title(item: &VaultItem, passkeys: &[PasskeyRow]) -> String {
    match item.name.as_deref().map(str::trim).filter(|name| !name.is_empty()) {
        Some(name) => name.to_string(),
        None => passkeys.first().map(|passkey| passkey.rp_id.clone()).unwrap_or_else(|| "Untitled".to_string()),
    }
}

/// A stored URL as it is exported: trimmed and otherwise as-is; a blank value or one with whitespace is left out.
fn exported_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    (!trimmed.is_empty() && !trimmed.chars().any(char::is_whitespace)).then(|| trimmed.to_string())
}

fn unix_seconds(millis: i64) -> Option<u64> {
    (millis > 0).then_some((millis / 1000) as u64)
}

fn passkeys_by_item(conn: &Connection) -> VaultResult<HashMap<(String, String), Vec<PasskeyRow>>> {
    const SQL: &str = "
        SELECT ManifestId, ItemId, Id, CredentialId, RpId, UserHandle, PrivateKey, PrfKey, DisplayName, AdditionalData
        FROM Passkeys
        WHERE IsDeleted = 0
        ORDER BY CreatedAt DESC";
    let mut statement = conn.prepare_cached(SQL).map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>("ManifestId")?,
                row.get::<_, String>("ItemId")?,
                PasskeyRow {
                    id: row.get("Id")?,
                    credential_id: blob(row, "CredentialId")?,
                    rp_id: row.get("RpId")?,
                    user_handle: blob(row, "UserHandle")?.unwrap_or_default(),
                    private_key: row.get("PrivateKey")?,
                    prf_key: blob(row, "PrfKey")?,
                    display_name: row.get::<_, Option<String>>("DisplayName")?.unwrap_or_default(),
                    additional_data: blob(row, "AdditionalData")?,
                },
            ))
        })
        .map_err(sql_error)?;
    let mut passkeys: HashMap<(String, String), Vec<PasskeyRow>> = HashMap::new();
    for row in rows {
        let (manifest_id, item_id, passkey) = row.map_err(sql_error)?;
        passkeys.entry((id_key(&manifest_id), id_key(&item_id))).or_default().push(passkey);
    }
    Ok(passkeys)
}

fn folders(conn: &Connection) -> VaultResult<Vec<FolderRow>> {
    const SQL: &str = "SELECT Id, ManifestId, Name, ParentFolderId FROM Folders WHERE IsDeleted = 0 ORDER BY Weight, Name";
    let mut statement = conn.prepare_cached(SQL).map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| Ok(FolderRow { id: row.get("Id")?, manifest_id: row.get("ManifestId")?, name: row.get("Name")?, parent_folder_id: row.get("ParentFolderId")? }))
        .map_err(sql_error)?;
    rows.collect::<Result<_, _>>().map_err(sql_error)
}

/// A BLOB column's bytes, None for NULL or any other type.
fn blob(row: &Row<'_>, column: &str) -> rusqlite::Result<Option<Vec<u8>>> {
    Ok(match row.get_ref(column)? {
        rusqlite::types::ValueRef::Blob(bytes) => Some(bytes.to_vec()),
        _ => None,
    })
}

fn sql_error(error: rusqlite::Error) -> VaultError {
    crate::sqlite_host::sql_error(error)
}
