use p256::ecdsa::SigningKey;
use p256::elliptic_curve::Generate;
use rusqlite::{params, Connection};
use serde_json::Value;

use super::*;
use crate::common::encoding::{base64url_decode, base64url_encode};
use crate::passkey::pkcs8_to_jwk_pair;
use crate::sqlite_host::MemoryDatabase;

const PERSONAL: &str = "11111111-1111-4111-8111-111111111111";
const SHARED: &str = "22222222-2222-4222-8222-222222222222";
const LOGIN: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CARD: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOTE: &str = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ALIAS: &str = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FOLDER: &str = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SUBFOLDER: &str = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const PASSKEY: &str = "12345678-1234-4123-8123-123456789abc";
const DEFINITION: &str = "88888888-8888-4888-8888-888888888888";
const T0: &str = "2026-01-01 10:00:00.000";
const T1: &str = "2026-01-02 10:00:00.000";

fn with_vault<R>(f: impl FnOnce(&Connection) -> R) -> R {
    let db = MemoryDatabase::with_latest_schema().unwrap();
    db.with_connection(|conn| Ok(f(conn))).unwrap()
}

fn insert_item(conn: &Connection, manifest_id: &str, id: &str, name: &str, item_type: &str, folder_id: Option<&str>) {
    conn.execute(
        "INSERT INTO Items (Id, ManifestId, Name, ItemType, FolderId, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
        params![id, manifest_id, name, item_type, folder_id, T0, T1],
    )
    .unwrap();
}

fn insert_value(conn: &Connection, manifest_id: &str, item_id: &str, field_key: &str, value: &str, value_index: i64) {
    conn.execute(
        "INSERT INTO FieldValues (Id, ManifestId, ItemId, FieldKey, Value, Weight, ValueIndex, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?7, 0)",
        params![new_id(), manifest_id, item_id, field_key, value, value_index, T0],
    )
    .unwrap();
}

fn insert_custom_value(conn: &Connection, manifest_id: &str, item_id: &str, definition_id: &str, label: &str, field_type: &str, value: &str) {
    conn.execute(
        "INSERT OR IGNORE INTO FieldDefinitions (Id, ManifestId, Label, FieldType, IsMultiValue, IsHidden, EnableHistory, Weight, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, ?3, ?4, 0, 0, 0, 0, ?5, ?5, 0)",
        params![definition_id, manifest_id, label, field_type, T0],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO FieldValues (Id, ManifestId, ItemId, FieldDefinitionId, Value, Weight, ValueIndex, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, ?3, ?4, ?5, 100, 0, ?6, ?6, 0)",
        params![new_id(), manifest_id, item_id, definition_id, value, T0],
    )
    .unwrap();
}

/// A passkey of the LOGIN item with the given private key; the optional columns are NULL unless given.
fn insert_passkey(conn: &Connection, private_key: &str, credential_id: Option<&[u8]>, prf_key: Option<&[u8]>, additional_data: Option<&[u8]>) {
    conn.execute(
        "INSERT INTO Passkeys (Id, ManifestId, ItemId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey, DisplayName, CredentialId, AdditionalData, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, ?3, 'example.com', X'0102', '{}', ?4, ?5, 'Alice', ?6, ?7, ?8, ?8, 0)",
        params![PASSKEY, PERSONAL, LOGIN, private_key, prf_key, credential_id, additional_data, T0],
    )
    .unwrap();
}

fn new_id() -> String {
    crate::common::encoding::uuid_from_bytes(crate::common::rng::random_array(), 4)
}

fn p256_private_jwk() -> String {
    let key = SigningKey::try_generate().unwrap();
    let point = key.verifying_key().to_sec1_point(false);
    format!(
        "{{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"{}\",\"y\":\"{}\",\"d\":\"{}\"}}",
        base64url_encode(point.x().unwrap()),
        base64url_encode(point.y().unwrap()),
        base64url_encode(&key.to_bytes())
    )
}

fn options(manifest_id: &str) -> ExportOptions {
    ExportOptions {
        exporter_rp_id: "net.aliasvault.app".into(),
        exporter_display_name: "AliasVault".into(),
        account_username: "me@example.com".into(),
        manifest_ids: vec![manifest_id.to_string()],
    }
}

fn seed_vault(conn: &Connection) {
    conn.execute("INSERT INTO Folders (Id, ManifestId, Name, ParentFolderId, Weight, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, 'Work', NULL, 0, ?3, ?3, 0)", params![FOLDER, PERSONAL, T0]).unwrap();
    conn.execute("INSERT INTO Folders (Id, ManifestId, Name, ParentFolderId, Weight, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, 'Banking', ?3, 0, ?4, ?4, 0)", params![SUBFOLDER, PERSONAL, FOLDER, T0]).unwrap();

    insert_item(conn, PERSONAL, LOGIN, "Example", "Login", Some(SUBFOLDER));
    insert_value(conn, PERSONAL, LOGIN, "login.username", "alice", 0);
    insert_value(conn, PERSONAL, LOGIN, "login.password", "s3cret", 0);
    insert_value(conn, PERSONAL, LOGIN, "login.email", "alice@example.com", 0);
    insert_value(conn, PERSONAL, LOGIN, "login.url", "example.com", 0);
    insert_value(conn, PERSONAL, LOGIN, "login.url", "https://login.example.com/", 1);
    insert_value(conn, PERSONAL, LOGIN, "notes.content", "Some notes", 0);
    insert_custom_value(conn, PERSONAL, LOGIN, DEFINITION, "Recovery code", "Hidden", "ABC-123");
    conn.execute(
        "INSERT INTO TotpCodes (Id, ManifestId, ItemId, Name, SecretKey, Algorithm, Digits, Period, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, ?3, 'Example', 'jbsw y3dp ehpk3pxp', 'SHA256', 8, 60, ?4, ?4, 0)",
        params![new_id(), PERSONAL, LOGIN, T0],
    )
    .unwrap();
    insert_passkey(conn, &p256_private_jwk(), None, None, None);

    insert_item(conn, PERSONAL, CARD, "Visa", "CreditCard", None);
    insert_value(conn, PERSONAL, CARD, "card.number", "4111111111111111", 0);
    insert_value(conn, PERSONAL, CARD, "card.cardholder_name", "Alice Example", 0);
    insert_value(conn, PERSONAL, CARD, "card.cvv", "123", 0);
    insert_value(conn, PERSONAL, CARD, "card.expiry_month", "7", 0);
    insert_value(conn, PERSONAL, CARD, "card.expiry_year", "28", 0);

    insert_item(conn, PERSONAL, NOTE, "Wifi", "Note", None);
    insert_value(conn, PERSONAL, NOTE, "notes.content", "The password is on the router", 0);

    insert_item(conn, PERSONAL, ALIAS, "Shop alias", "Alias", None);
    insert_value(conn, PERSONAL, ALIAS, "login.email", "shop@alias.example", 0);
    insert_value(conn, PERSONAL, ALIAS, "login.password", "pw", 0);
    insert_value(conn, PERSONAL, ALIAS, "alias.first_name", "Ann", 0);
    insert_value(conn, PERSONAL, ALIAS, "alias.last_name", "Lee", 0);
    insert_value(conn, PERSONAL, ALIAS, "alias.birthdate", "1990-05-06", 0);

    // Not exported: a shared manifest item, a trashed item and an archived item.
    insert_item(conn, SHARED, "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1", "Shared", "Login", None);
    insert_item(conn, PERSONAL, "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2", "Trashed", "Login", None);
    conn.execute("UPDATE Items SET DeletedAt = ?1 WHERE Name = 'Trashed'", [T1]).unwrap();
    insert_item(conn, PERSONAL, "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3", "Archived", "Login", None);
    conn.execute("UPDATE Items SET ArchivedAt = ?1 WHERE Name = 'Archived'", [T1]).unwrap();
}

/// Export with the given options and parse the document.
fn export(conn: &Connection, options: &ExportOptions) -> (ExportResult, Value) {
    let result = export_document(conn, options).unwrap();
    let document = serde_json::from_str(&result.document).unwrap();
    (result, document)
}

fn item<'a>(document: &'a Value, title: &str) -> &'a Value {
    document["accounts"][0]["items"].as_array().unwrap().iter().find(|item| item["title"] == title).unwrap_or_else(|| panic!("no item {title}"))
}

fn credential<'a>(item: &'a Value, kind: &str) -> &'a Value {
    item["credentials"].as_array().unwrap().iter().find(|c| c["type"] == kind).unwrap_or_else(|| panic!("no {kind} credential"))
}

#[test]
fn exports_the_personal_manifest_as_one_account() {
    with_vault(|conn| {
        seed_vault(conn);
        let (result, document) = export(conn, &options(PERSONAL));

        assert_eq!(document["version"], serde_json::json!({ "major": 1, "minor": 0 }));
        assert_eq!(document["exporterRpId"], "net.aliasvault.app");
        assert!(document["timestamp"].as_u64().unwrap() > 0);
        let account = &document["accounts"][0];
        assert_eq!(account["username"], "me@example.com");
        assert_eq!(account["email"], "me@example.com");
        assert_eq!(base64url_decode(account["id"].as_str().unwrap()).unwrap().len(), 16);

        let titles: Vec<&str> = account["items"].as_array().unwrap().iter().map(|item| item["title"].as_str().unwrap()).collect();
        assert_eq!(titles.len(), 4);
        for title in ["Example", "Visa", "Wifi", "Shop alias"] {
            assert!(titles.contains(&title), "{title} missing from {titles:?}");
        }
        assert_eq!((result.item_count, result.passkey_count, result.totp_count), (4, 1, 1));
    });
}

#[test]
fn login_item_carries_basic_auth_passkey_totp_note_and_custom_fields() {
    with_vault(|conn| {
        seed_vault(conn);
        let (_, document) = export(conn, &options(PERSONAL));
        let login = item(&document, "Example");

        assert_eq!(login["creationAt"], 1_767_261_600);
        assert_eq!(login["modifiedAt"], 1_767_348_000);
        assert_eq!(login["scope"]["urls"], serde_json::json!(["example.com", "https://login.example.com/"]));
        assert_eq!(base64url_decode(login["id"].as_str().unwrap()).unwrap(), crate::passkey::guid_to_bytes(LOGIN).unwrap());

        let basic = credential(login, "basic-auth");
        assert_eq!(basic["username"]["value"], "alice");
        assert_eq!(basic["username"]["fieldType"], "string");
        assert_eq!(basic["password"]["value"], "s3cret");
        assert_eq!(basic["password"]["fieldType"], "concealed-string");

        let passkey = credential(login, "passkey");
        assert_eq!(passkey["rpId"], "example.com");
        assert_eq!(passkey["username"], "alice");
        assert_eq!(passkey["userDisplayName"], "Alice");
        assert_eq!(base64url_decode(passkey["userHandle"].as_str().unwrap()).unwrap(), vec![1, 2]);
        // No stored credential id: the row id's bytes are the WebAuthn credential id.
        assert_eq!(base64url_decode(passkey["credentialId"].as_str().unwrap()).unwrap(), crate::passkey::guid_to_bytes(PASSKEY).unwrap());
        let key = base64url_decode(passkey["key"].as_str().unwrap()).unwrap();
        assert!(pkcs8_to_jwk_pair(&key).is_ok(), "the exported key must be PKCS#8");
        assert!(passkey.get("fido2Extensions").is_none(), "a passkey without a PRF secret or kept extension data carries none");

        let totp = credential(login, "totp");
        assert_eq!(totp["secret"], "JBSWY3DPEHPK3PXP");
        assert_eq!(totp["algorithm"], "sha256");
        assert_eq!(totp["digits"], 8);
        assert_eq!(totp["period"], 60);
        assert_eq!(totp["issuer"], "Example");

        assert_eq!(credential(login, "note")["content"]["value"], "Some notes");

        let custom = credential(login, "custom-fields")["fields"].as_array().unwrap().clone();
        let labels: Vec<(&str, &str, &str)> = custom.iter().map(|f| (f["label"].as_str().unwrap(), f["fieldType"].as_str().unwrap(), f["value"].as_str().unwrap())).collect();
        assert_eq!(labels, vec![("Email", "email", "alice@example.com"), ("Recovery code", "concealed-string", "ABC-123")]);
    });
}

#[test]
fn card_note_and_alias_items_map_to_their_credential_types() {
    with_vault(|conn| {
        seed_vault(conn);
        let (_, document) = export(conn, &options(PERSONAL));

        let card = credential(item(&document, "Visa"), "credit-card");
        assert_eq!(card["number"]["value"], "4111111111111111");
        assert_eq!(card["fullName"]["value"], "Alice Example");
        assert_eq!(card["verificationNumber"]["value"], "123");
        assert_eq!(card["expiryDate"]["value"], "2028-07");
        assert_eq!(card["expiryDate"]["fieldType"], "year-month");
        assert!(item(&document, "Visa")["credentials"].as_array().unwrap().iter().all(|c| c["type"] != "basic-auth"));

        let note = item(&document, "Wifi");
        assert_eq!(note["credentials"].as_array().unwrap().len(), 1);
        assert_eq!(credential(note, "note")["content"]["value"], "The password is on the router");

        let alias = item(&document, "Shop alias");
        assert_eq!(credential(alias, "basic-auth")["username"]["value"], "shop@alias.example");
        let name = credential(alias, "person-name");
        assert_eq!((name["given"]["value"].as_str(), name["surname"]["value"].as_str()), (Some("Ann"), Some("Lee")));
        let custom = credential(alias, "custom-fields")["fields"].as_array().unwrap().clone();
        assert_eq!((custom[0]["label"].as_str(), custom[0]["fieldType"].as_str(), custom[0]["value"].as_str()), (Some("Birth date"), Some("date"), Some("1990-05-06")));
    });
}

#[test]
fn folders_become_nested_collections_linking_their_items() {
    with_vault(|conn| {
        seed_vault(conn);
        let (_, document) = export(conn, &options(PERSONAL));

        let collections = document["accounts"][0]["collections"].as_array().unwrap();
        assert_eq!(collections.len(), 1);
        assert_eq!(collections[0]["title"], "Work");
        assert_eq!(collections[0]["items"].as_array().unwrap().len(), 0);
        let banking = &collections[0]["subCollections"][0];
        assert_eq!(banking["title"], "Banking");
        assert_eq!(banking["items"][0]["item"], item(&document, "Example")["id"]);
    });
}

#[test]
fn export_options_without_a_usable_manifest_are_rejected() {
    let json = r#"{"exporterRpId":"net.aliasvault.app","exporterDisplayName":"AliasVault","accountUsername":"me@example.com"}"#;
    assert!(serde_json::from_str::<ExportOptions>(json).is_err());
    with_vault(|conn| {
        assert!(export_document(conn, &options("not-a-guid")).is_err());
        assert!(export_document(conn, &ExportOptions { manifest_ids: vec![], ..options(PERSONAL) }).is_err());
    });
}

#[test]
fn every_listed_manifest_is_exported_into_the_one_account_with_unique_ids() {
    with_vault(|conn| {
        seed_vault(conn);
        // A second manifest may reuse an id of the first, here the id of the "Example" login.
        conn.execute("INSERT INTO Folders (Id, ManifestId, Name, ParentFolderId, Weight, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, 'Shared folder', NULL, 0, ?3, ?3, 0)", params![SHARED, SHARED, T0]).unwrap();
        insert_item(conn, SHARED, LOGIN, "Shared twin", "Login", Some(SHARED));
        let (result, document) = export(conn, &ExportOptions { manifest_ids: vec![PERSONAL.to_string(), SHARED.to_string()], ..options(PERSONAL) });

        assert_eq!(document["accounts"].as_array().unwrap().len(), 1);
        assert_eq!(result.item_count, 6);
        item(&document, "Shared");

        let items = document["accounts"][0]["items"].as_array().unwrap();
        let ids: std::collections::HashSet<&str> = items.iter().map(|item| item["id"].as_str().unwrap()).collect();
        assert_eq!(ids.len(), items.len());
        // The first listed manifest keeps the GUID; the folder of the second links its item by the new id.
        assert_eq!(base64url_decode(item(&document, "Example")["id"].as_str().unwrap()).unwrap(), crate::passkey::guid_to_bytes(LOGIN).unwrap());
        let shared_folder = document["accounts"][0]["collections"].as_array().unwrap().iter().find(|collection| collection["title"] == "Shared folder").unwrap();
        assert_eq!(shared_folder["items"][0]["item"], item(&document, "Shared twin")["id"]);
    });
}

#[test]
fn a_passkey_with_an_unusable_key_is_left_out() {
    with_vault(|conn| {
        insert_item(conn, PERSONAL, LOGIN, "Broken", "Login", None);
        insert_passkey(conn, r#"{"kty":"EC"}"#, None, None, None);
        let (result, document) = export(conn, &options(PERSONAL));
        assert_eq!(result.passkey_count, 0);
        assert!(item(&document, "Broken")["credentials"].as_array().unwrap().is_empty());
    });
}

#[test]
fn a_stored_credential_id_wins_over_the_row_id() {
    with_vault(|conn| {
        insert_item(conn, PERSONAL, LOGIN, "Imported", "Login", None);
        insert_passkey(conn, &p256_private_jwk(), Some(&[10, 11, 12]), None, None);
        let (_, document) = export(conn, &options(PERSONAL));
        let passkey = credential(item(&document, "Imported"), "passkey");
        assert_eq!(base64url_decode(passkey["credentialId"].as_str().unwrap()).unwrap(), vec![10, 11, 12]);
        // An item without a username names the passkey after its display name.
        assert_eq!(passkey["username"], "Alice");
    });
}

#[test]
fn a_prf_secret_is_exported_as_hmac_credentials_next_to_the_extension_data_an_import_kept() {
    with_vault(|conn| {
        insert_item(conn, PERSONAL, LOGIN, "With PRF", "Login", None);
        insert_passkey(conn, &p256_private_jwk(), None, Some(&[7, 7]), Some(br#"{"fido2Extensions":{"credBlob":"AQID"}}"#));
        let (_, document) = export(conn, &options(PERSONAL));
        let extensions = &credential(item(&document, "With PRF"), "passkey")["fido2Extensions"];
        assert_eq!(extensions["hmacCredentials"], serde_json::json!({ "algorithm": "hmac-sha256", "credWithUV": "Bwc", "credWithoutUV": "Bwc" }));
        assert_eq!(extensions["credBlob"], "AQID");
    });
}
