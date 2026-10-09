use rusqlite::{params, Connection};

use super::*;
use crate::sqlite_host::MemoryDatabase;
use crate::vault_codec::logo_id_for;

const PERSONAL: &str = "11111111-1111-4111-8111-111111111111";
const SHARED: &str = "22222222-2222-4222-8222-222222222222";
const ITEM: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE: &str = "6f1c1a2e-3b4d-4c5e-8f60-718293a4b5c6";
const OTHER_DEVICE: &str = "0a9b8c7d-6e5f-4a3b-9c2d-1e0f2a3b4c5d";
const T0: &str = "2026-01-01 10:00:00.000";
const T1: &str = "2026-01-02 10:00:00.000";

fn with_vault<R>(f: impl FnOnce(&Connection) -> R) -> R {
    let db = MemoryDatabase::with_latest_schema().unwrap();
    db.with_connection(|conn| Ok(f(conn))).unwrap()
}

fn insert_item(conn: &Connection, manifest_id: &str, id: &str, name: &str, created_at: &str) {
    conn.execute(
        "INSERT INTO Items (Id, ManifestId, Name, ItemType, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, ?3, 'Login', ?4, ?4, 0)",
        params![id, manifest_id, name, created_at],
    )
    .unwrap();
}

fn insert_value(conn: &Connection, manifest_id: &str, item_id: &str, field_key: &str, value: &str, value_index: i64) {
    conn.execute(
        "INSERT INTO FieldValues (Id, ManifestId, ItemId, FieldKey, Value, Weight, ValueIndex, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, 0)",
        params![new_id(), manifest_id, item_id, field_key, value, crate::vault_model::system_field(field_key).map_or(0, |f| f.default_display_order), value_index, T0],
    )
    .unwrap();
}

fn new_passkey(id: &str, rp_id: &str, user_handle: &[u8]) -> NewPasskey {
    NewPasskey {
        id: id.to_string(),
        rp_id: rp_id.to_string(),
        user_handle: Some(user_handle.to_vec()),
        public_key: "{\"kty\":\"EC\"}".to_string(),
        private_key: "{\"kty\":\"EC\",\"d\":\"x\"}".to_string(),
        prf_key: None,
        display_name: "me".to_string(),
    }
}

#[test]
fn active_items_carry_registry_metadata_and_skip_unknown_system_fields() {
    with_vault(|conn| {
        insert_item(conn, PERSONAL, ITEM, "Example", T0);
        insert_value(conn, PERSONAL, ITEM, "login.password", "secret", 0);
        insert_value(conn, PERSONAL, ITEM, "login.url", "https://a.example.com", 0);
        insert_value(conn, PERSONAL, ITEM, "login.url", "https://b.example.com", 1);
        insert_value(conn, PERSONAL, ITEM, "future.field", "x", 0);

        let items = get_all_active_items(conn).unwrap();
        assert_eq!(items.len(), 1);
        let keys: Vec<(&str, &str)> = items[0].fields.iter().map(|f| (f.field_key.as_str(), f.value.as_str())).collect();
        assert_eq!(keys, vec![("login.url", "https://a.example.com"), ("login.url", "https://b.example.com"), ("login.password", "secret")]);

        let password = &items[0].fields[2];
        assert_eq!((password.field_type.as_str(), password.is_hidden, password.enable_history, password.display_order), ("Password", true, true, 20));
        assert_eq!(items[0].created_at_ms, 1_767_261_600_000);
    });
}

#[test]
fn active_items_keep_two_manifests_apart_and_leave_out_trash_and_archive() {
    with_vault(|conn| {
        insert_item(conn, PERSONAL, ITEM, "Personal", T0);
        insert_item(conn, SHARED, ITEM, "Shared", T1);
        insert_value(conn, SHARED, ITEM, "login.username", "shared-user", 0);
        insert_item(conn, PERSONAL, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Trashed", T0);
        conn.execute("UPDATE Items SET DeletedAt = ?1 WHERE Name = 'Trashed'", [T1]).unwrap();
        insert_item(conn, PERSONAL, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "Archived", T0);
        conn.execute("UPDATE Items SET ArchivedAt = ?1 WHERE Name = 'Archived'", [T1]).unwrap();

        let items = get_all_active_items(conn).unwrap();
        let names: Vec<_> = items.iter().map(|i| (i.name.clone().unwrap(), i.fields.len())).collect();
        assert_eq!(names, vec![("Shared".to_string(), 1), ("Personal".to_string(), 0)]);
    });
}

#[test]
fn folder_paths_resolve_within_the_item_manifest() {
    with_vault(|conn| {
        let parent = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
        let child = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
        for (manifest_id, id, name, parent_id) in [(PERSONAL, parent, "Work", None), (PERSONAL, child, "Mail", Some(parent)), (SHARED, parent, "Other", None)] {
            conn.execute(
                "INSERT INTO Folders (Id, ManifestId, Name, ParentFolderId, Weight, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5, 0)",
                params![id, manifest_id, name, parent_id, T0],
            )
            .unwrap();
        }
        insert_item(conn, PERSONAL, ITEM, "Example", T0);
        conn.execute("UPDATE Items SET FolderId = ?1", [child]).unwrap();

        assert_eq!(get_all_active_items(conn).unwrap()[0].folder_path, vec!["Work", "Mail"]);
    });
}

#[test]
fn passkey_item_is_created_with_url_username_and_favicon() {
    with_vault(|conn| {
        let passkey = new_passkey("ABCDEF00-0000-4000-8000-000000000001", "example.com", b"user-1");
        create_item_with_passkey(conn, PERSONAL, ITEM, "Example", "https://example.com", Some("alice"), &passkey, Some(b"icon")).unwrap();

        let item = &get_all_active_items(conn).unwrap()[0];
        assert!(item.has_passkey);
        assert_eq!(item.logo.as_deref(), Some(&b"icon"[..]));
        let weights: Vec<i64> = conn.prepare("SELECT Weight FROM FieldValues ORDER BY Weight").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
        assert_eq!(weights, vec![5, 15]);

        let found = get_passkeys_for_rp_id(conn, "example.com", Some("alice"), Some(b"user-1")).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].passkey.id, "abcdef00-0000-4000-8000-000000000001");
        assert_eq!(found[0].service_name.as_deref(), Some("Example"));
        assert!(get_passkeys_for_rp_id(conn, "example.com", None, Some(b"user-2")).unwrap().is_empty());
        assert!(get_passkey_by_id(conn, "ABCDEF00-0000-4000-8000-000000000001").unwrap().is_some());
    });
}

#[test]
fn replacing_a_passkey_keeps_the_item_and_drops_the_old_key() {
    with_vault(|conn| {
        create_item_with_passkey(conn, PERSONAL, ITEM, "Example", "https://example.com", None, &new_passkey("00000000-0000-4000-8000-000000000001", "example.com", b"u"), None).unwrap();
        let item_id = replace_passkey(conn, "00000000-0000-4000-8000-000000000001", PERSONAL, &new_passkey("00000000-0000-4000-8000-000000000002", "example.com", b"u"), "https://example.com", None).unwrap();

        assert_eq!(item_id, ITEM);
        let ids: Vec<String> = get_passkeys_for_item(conn, ITEM, PERSONAL).unwrap().into_iter().map(|p| p.id).collect();
        assert_eq!(ids, vec!["00000000-0000-4000-8000-000000000002"]);
        assert!(replace_passkey(conn, "00000000-0000-4000-8000-000000000009", PERSONAL, &new_passkey("00000000-0000-4000-8000-000000000003", "example.com", b"u"), "", None).is_err());
    });
}

#[test]
fn a_favicon_from_another_manifest_is_copied_into_the_item_manifest() {
    with_vault(|conn| {
        create_item_with_passkey(conn, SHARED, ITEM, "Shared", "https://example.com", None, &new_passkey("00000000-0000-4000-8000-000000000001", "example.com", b"u"), Some(b"icon")).unwrap();
        create_item_with_passkey(conn, PERSONAL, ITEM, "Personal", "https://example.com", None, &new_passkey("00000000-0000-4000-8000-000000000002", "example.com", b"u"), None).unwrap();

        let logo_id: String = conn.query_row("SELECT LogoId FROM Items WHERE ManifestId = ?1", [PERSONAL], |r| r.get(0)).unwrap();
        assert_eq!(logo_id, logo_id_for(PERSONAL, "favicon", "example.com"));
        let personal = get_all_active_items(conn).unwrap().into_iter().find(|i| i.manifest_id == PERSONAL).unwrap();
        assert_eq!(personal.logo.as_deref(), Some(&b"icon"[..]));
    });
}

#[test]
fn adding_a_passkey_keeps_a_chosen_logo_and_the_domain_favicon() {
    with_vault(|conn| {
        insert_item(conn, PERSONAL, ITEM, "Example", T0);
        let builtin = logo_id_for(PERSONAL, "builtin", "github");
        conn.execute("INSERT INTO Logos (Id, Kind, Source, ManifestId, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, 'builtin', 'github', ?2, ?3, ?3, 0)", params![builtin, PERSONAL, T0]).unwrap();
        conn.execute("UPDATE Items SET LogoId = ?1", [&builtin]).unwrap();
        add_passkey_to_item(conn, ITEM, PERSONAL, &new_passkey("00000000-0000-4000-8000-000000000001", "example.com", b"u"), "https://example.com", Some(b"icon")).unwrap();
        let logo_id: String = conn.query_row("SELECT LogoId FROM Items", [], |r| r.get(0)).unwrap();
        assert_eq!(logo_id, builtin);

        conn.execute("UPDATE Items SET LogoId = NULL", []).unwrap();
        add_passkey_to_item(conn, ITEM, PERSONAL, &new_passkey("00000000-0000-4000-8000-000000000002", "example.com", b"u"), "https://example.com", Some(b"icon")).unwrap();
        add_passkey_to_item(conn, ITEM, PERSONAL, &new_passkey("00000000-0000-4000-8000-000000000003", "example.com", b"u"), "https://example.com", Some(b"newer")).unwrap();
        assert_eq!(get_all_active_items(conn).unwrap()[0].logo.as_deref(), Some(&b"icon"[..]));
    });
}

#[test]
fn merge_candidates_are_matched_by_rp_id_and_stay_apart_per_manifest() {
    with_vault(|conn| {
        insert_item(conn, PERSONAL, ITEM, "Example", T0);
        insert_value(conn, PERSONAL, ITEM, "login.url", "https://example.com/login", 0);
        insert_item(conn, SHARED, ITEM, "Example shared", T1);
        insert_value(conn, SHARED, ITEM, "login.url", "https://example.com", 0);
        insert_value(conn, SHARED, ITEM, "login.username", "bob", 0);
        insert_item(conn, PERSONAL, "ffffffff-ffff-4fff-8fff-ffffffffffff", "Other", T0);
        insert_value(conn, PERSONAL, "ffffffff-ffff-4fff-8fff-ffffffffffff", "login.url", "https://other.org", 0);

        let candidates = get_items_without_passkey_for_rp_id(conn, "example.com", None, None).unwrap();
        let mut manifests: Vec<&str> = candidates.iter().map(|c| c.manifest_id.as_str()).collect();
        manifests.sort();
        assert_eq!(manifests, vec![PERSONAL, SHARED]);

        let bob = get_items_without_passkey_for_rp_id(conn, "example.com", None, Some("bob")).unwrap();
        assert_eq!(bob.len(), 1);
        assert_eq!(bob[0].manifest_id, SHARED);
    });
}

#[test]
fn recording_a_use_counts_per_action_and_ignores_missing_items() {
    with_vault(|conn| {
        insert_item(conn, PERSONAL, ITEM, "Example", T0);
        assert!(record_item_use(conn, ITEM, PERSONAL, DEVICE, ItemUsageAction::Autofill).unwrap());
        assert!(record_item_use(conn, ITEM, PERSONAL, DEVICE, ItemUsageAction::Passkey).unwrap());
        assert!(!record_item_use(conn, ITEM, SHARED, DEVICE, ItemUsageAction::Copy).unwrap());
        assert!(!record_item_use(conn, ITEM, PERSONAL, "", ItemUsageAction::Copy).unwrap(), "a use without a device is not recorded");

        let counts: (i64, i64, i64) = conn.query_row("SELECT UseCount, AutofillCount, PasskeyAuthCount FROM ItemStats", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!(counts, (2, 1, 1));
    });
}

#[test]
fn each_device_counts_the_uses_of_an_item_in_its_own_row() {
    with_vault(|conn| {
        insert_item(conn, PERSONAL, ITEM, "Example", T0);
        assert!(record_item_use(conn, ITEM, PERSONAL, DEVICE, ItemUsageAction::Autofill).unwrap());
        assert!(record_item_use(conn, ITEM, PERSONAL, OTHER_DEVICE, ItemUsageAction::Copy).unwrap());
        assert!(record_item_use(conn, ITEM, PERSONAL, OTHER_DEVICE, ItemUsageAction::Copy).unwrap());

        let rows = conn.query_row("SELECT COUNT(*), SUM(UseCount) FROM ItemStats WHERE Id = ?1", [ITEM], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))).unwrap();
        assert_eq!(rows, (2, 3));
    });
}

#[test]
fn appended_values_go_after_the_existing_ones() {
    with_vault(|conn| {
        insert_item(conn, PERSONAL, ITEM, "Example", T0);
        insert_value(conn, PERSONAL, ITEM, "login.url", "https://a.example.com", 0);
        append_field_value(conn, ITEM, PERSONAL, "login.url", "https://b.example.com").unwrap();

        let urls: Vec<String> = get_all_active_items(conn).unwrap()[0].fields.iter().map(|f| f.value.clone()).collect();
        assert_eq!(urls, vec!["https://a.example.com", "https://b.example.com"]);
    });
}
