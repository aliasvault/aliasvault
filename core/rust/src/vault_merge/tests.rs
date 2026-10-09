//! The canonical merge: last write wins per row, an item deleted as a unit, manifests merged independently.

use super::*;
use crate::vault_codec::test_support::{restamp, row, PERSONAL_MANIFEST_ID as PERSONAL, SHARED_MANIFEST_ID as SHARED};
use serde_json::json;

const SALT: &str = "0123456789abcdef0123456789abcdef";
const T_OLD: &str = "2024-01-01T00:00:00Z";
const T_MID: &str = "2024-01-05T00:00:00Z";
const T_NEW: &str = "2024-01-09T00:00:00Z";

fn manifest(manifest_id: &str, tables: &[(&str, Vec<CodecRecord>)]) -> Manifest {
    Manifest { schema_version: 1, manifest_salt: SALT.to_string(), canonicalized_at: T_OLD.to_string(), manifest_id: manifest_id.to_string(), name: None, tables: tables.iter().map(|(name, rows)| (name.to_string(), rows.clone())).collect(), extra: HashMap::new() }
}

/// A row in `PERSONAL` with the given columns plus an `UpdatedAt`.
fn at(updated_at: &str, pairs: &[(&str, serde_json::Value)]) -> CodecRecord {
    let mut r = row(pairs);
    r.insert("ManifestId".to_string(), json!(PERSONAL));
    r.insert("UpdatedAt".to_string(), json!(updated_at));
    r
}

fn item(id: &str, name: &str, updated_at: &str) -> CodecRecord {
    at(updated_at, &[("Id", json!(id)), ("Name", json!(name)), ("IsDeleted", json!(0))])
}

fn tombstone(id: &str, updated_at: &str) -> CodecRecord {
    at(updated_at, &[("Id", json!(id)), ("Name", json!("item")), ("IsDeleted", json!(1))])
}

/// A single-value `FieldValues` row of `item-1` in wire shape (no id).
fn field(key: &str, value: &str, deleted: bool, updated_at: &str) -> CodecRecord {
    at(updated_at, &[("ItemId", json!("item-1")), ("FieldKey", json!(key)), ("ValueIndex", json!(0)), ("Value", json!(value)), ("IsDeleted", json!(deleted as i32))])
}

/// A `login.url` row: multi-value, so it owns its id on the wire.
fn url(id: &str, index: i64, value: &str, updated_at: &str) -> CodecRecord {
    at(updated_at, &[("Id", json!(id)), ("ItemId", json!("item-1")), ("FieldKey", json!("login.url")), ("ValueIndex", json!(index)), ("Value", json!(value))])
}

fn schema() -> HashMap<String, Vec<String>> {
    let columns = |names: &[&str]| names.iter().map(|c| c.to_string()).collect::<Vec<_>>();
    [
        ("Items".to_string(), columns(&["ManifestId", "Id", "Name", "IsDeleted", "DeletedAt", "UpdatedAt"])),
        ("TotpCodes".to_string(), columns(&["ManifestId", "Id", "ItemId", "SecretKey", "IsDeleted", "UpdatedAt"])),
        ("Settings".to_string(), columns(&["ManifestId", "Key", "Value", "UpdatedAt"])),
        ("ItemStats".to_string(), columns(&["ManifestId", "Id", "DeviceId", "UseCount", "LastUsedAt", "UpdatedAt"])),
        ("FieldValues".to_string(), columns(&["ManifestId", "Id", "ItemId", "FieldKey", "FieldDefinitionId", "ValueIndex", "Value", "IsDeleted", "UpdatedAt"])),
        ("ItemTags".to_string(), columns(&["ManifestId", "ItemId", "TagId", "UpdatedAt"])),
        ("Attachments".to_string(), columns(&["ManifestId", "Id", "Blob", "UpdatedAt"])),
    ]
    .into_iter()
    .collect()
}

fn merge(server: Vec<Manifest>, local: Vec<Manifest>) -> CanonicalMergeOutput {
    merge_with_buckets(server, vec![], local, vec![])
}

fn merge_with_buckets(server: Vec<Manifest>, server_buckets: Vec<DataBucket>, local: Vec<Manifest>, local_buckets: Vec<DataBucket>) -> CanonicalMergeOutput {
    merge_canonical(CanonicalMergeInput { server_manifests: server, server_buckets, contentless_server_manifest_ids: vec![], local_manifests: local, local_buckets, schema_columns: schema() }).unwrap()
}

/// Merge one table of the personal manifest, rows out.
fn merge_table(table: &str, server_rows: Vec<CodecRecord>, local_rows: Vec<CodecRecord>) -> (Vec<CodecRecord>, MergeStats) {
    let output = merge(vec![manifest(PERSONAL, &[(table, server_rows)])], vec![manifest(PERSONAL, &[(table, local_rows)])]);
    assert_eq!(output.manifests.len(), 1);
    let merged = output.manifests.into_iter().next().unwrap();
    (merged.manifest.tables[table].clone(), merged.stats)
}

fn column<'a>(rows: &'a [CodecRecord], name: &str) -> Vec<&'a str> {
    rows.iter().filter_map(|r| r[name].as_str()).collect()
}

fn sorted(mut values: Vec<&str>) -> Vec<&str> {
    values.sort();
    values
}

/*
 * Rows.
 */

#[test]
fn the_newer_row_wins_the_server_keeps_ties_and_one_sided_rows_are_kept() {
    let (rows, stats) = merge_table(
        "Items",
        vec![item("local-wins", "server-old", T_OLD), item("server-wins", "server-new", T_NEW), item("tie", "server-tie", T_MID), item("server-only", "on-server", T_OLD)],
        vec![item("local-wins", "local-new", T_NEW), item("server-wins", "local-old", T_OLD), item("tie", "local-tie", T_MID), item("local-only", "made-offline", T_OLD)],
    );
    assert_eq!(column(&rows, "Name"), vec!["local-new", "server-new", "server-tie", "on-server", "made-offline"], "base rows first in base order, then the offline-made rows");
    assert_eq!(stats, MergeStats { base_kept: 2, incoming_won: 1, base_only: 1, incoming_only: 1 });
}

#[test]
fn ids_compare_case_insensitively() {
    // iOS and the extension generate uppercase GUIDs; the same id in two spellings is one row, and a differently
    // cased manifest id is the same manifest.
    let (rows, _) = merge_table("Items", vec![item("9d3f7a2c-1b4e-4f80-8a11-2c3d4e5f6a7b", "server-old", T_OLD)], vec![item("9D3F7A2C-1B4E-4F80-8A11-2C3D4E5F6A7B", "local-new", T_NEW)]);
    assert_eq!(column(&rows, "Name"), vec!["local-new"]);

    let output = merge(vec![manifest(&PERSONAL.to_uppercase(), &[("Items", vec![item("a", "server", T_OLD)])])], vec![manifest(PERSONAL, &[("Items", vec![item("b", "local", T_MID)])])]);
    assert!(output.dropped_local_manifest_ids.is_empty());
    assert_eq!(output.manifests[0].manifest.tables["Items"].len(), 2);

    let key_of = |manifest: &str, id: &str| get_key(&row(&[("ManifestId", json!(manifest)), ("Id", json!(id))]), &["ManifestId", "Id"]);
    assert_eq!(key_of("1dd1a3fd-8e0e-4b3f-9a3a-0f1a2b3c4d5e", "3ff3c50f-a020-4d51-9c5c-2b3c4d5e6f70"), key_of("1DD1A3FD-8E0E-4B3F-9A3A-0F1A2B3C4D5E", "3FF3C50F-A020-4D51-9C5C-2B3C4D5E6F70"));
    assert_eq!(get_key(&row(&[("Id", json!("x"))]), &["ManifestId", "Id"]), "\u{1f}x", "a column the row does not carry contributes an empty part, so the row still matches its counterpart");
}

#[test]
fn single_value_fields_match_on_their_natural_key_without_an_id() {
    let (rows, _) = merge_table("FieldValues", vec![field("username", "old", false, T_OLD)], vec![field("username", "new", false, T_NEW)]);
    assert_eq!(rows.len(), 1);
    assert!(!rows[0].contains_key("Id"), "the derived id is never carried on the wire");
    assert_eq!(rows[0]["Value"], json!("new"));

    // Custom fields carry no FieldKey, only a FieldDefinitionId, which is part of the key: each keeps its own row.
    let custom = |def: &str, value: &str, updated_at: &str| at(updated_at, &[("Id", json!(format!("cv-{def}"))), ("ItemId", json!("item-1")), ("FieldKey", serde_json::Value::Null), ("FieldDefinitionId", json!(def)), ("Value", json!(value))]);
    let (rows, _) = merge_table("FieldValues", vec![custom("fd-pin", "1234", T_OLD), custom("fd-member", "M-77", T_OLD)], vec![custom("fd-pin", "9999", T_NEW), custom("fd-member", "M-77", T_OLD)]);
    assert_eq!(sorted(column(&rows, "Value")), vec!["9999", "M-77"]);
}

#[test]
fn multi_value_fields_match_on_their_owned_id_not_their_position() {
    let two = vec![url("url-a", 0, "https://a.example", T_OLD), url("url-b", 1, "https://b.example", T_OLD)];
    // The same owned id on both sides is one row edited; identical sides merge to exactly themselves.
    let (rows, _) = merge_table("FieldValues", vec![url("url-1", 0, "https://a.example", T_OLD)], vec![url("url-1", 0, "https://a-edited.example", T_NEW)]);
    assert_eq!((rows.len(), rows[0]["Id"].as_str(), rows[0]["Value"].as_str()), (1, Some("url-1"), Some("https://a-edited.example")));
    let (rows, _) = merge_table("FieldValues", two.clone(), two.clone());
    assert_eq!(rows.len(), 2, "the second url must not replace the first");

    // Two devices each add a second url offline: both land at position 1 under different ids and are renumbered.
    let (rows, _) = merge_table("FieldValues", two.clone(), vec![url("url-a", 0, "https://a.example", T_OLD), url("url-c", 1, "https://c.example", T_MID)]);
    assert_eq!(sorted(column(&rows, "Value")), vec!["https://a.example", "https://b.example", "https://c.example"]);
    let mut indexes: Vec<i64> = rows.iter().map(|r| r["ValueIndex"].as_i64().unwrap()).collect();
    indexes.sort();
    assert_eq!(indexes, vec![0, 1, 2]);

    // A reorder changes only ValueIndex; the owned id keeps the rows matched, so nothing doubles.
    let (rows, _) = merge_table("FieldValues", two, vec![url("url-b", 0, "https://b.example", T_NEW), url("url-a", 1, "https://a.example", T_NEW)]);
    let by_id: HashMap<&str, i64> = rows.iter().map(|r| (r["Id"].as_str().unwrap(), r["ValueIndex"].as_i64().unwrap())).collect();
    assert_eq!((rows.len(), by_id["url-b"], by_id["url-a"]), (2, 0, 1));
}

#[test]
fn id_less_rows_converge_on_their_natural_key() {
    // History rows key on (item, field, ChangedAt): concurrent changes union, the same snapshot is one row.
    let history = |changed_at: &str, snapshot: &str| at(changed_at, &[("ItemId", json!("item-1")), ("FieldKey", json!("login.password")), ("ChangedAt", json!(changed_at)), ("ValueSnapshot", json!(snapshot))]);
    let shared = history("2024-01-01 10:00:00.000", "both-know-this");
    let (rows, _) = merge_table("FieldHistories", vec![shared.clone(), history("2024-02-01 10:00:00.000", "server-only")], vec![shared, history("2024-02-01 11:30:00.000", "local-only")]);
    assert_eq!(sorted(column(&rows, "ValueSnapshot")), vec!["both-know-this", "local-only", "server-only"]);
    assert!(rows.iter().all(|r| !r.contains_key("Id")));

    // Two devices tag the same item with the same tag: one link.
    let tag_link = |updated_at: &str| at(updated_at, &[("ItemId", json!("item-1")), ("TagId", json!("tag-1"))]);
    let (rows, _) = merge_table("ItemTags", vec![tag_link(T_OLD)], vec![tag_link(T_NEW)]);
    assert_eq!(rows.len(), 1);
    assert!(!rows[0].contains_key("Id"));
}

#[test]
fn blob_references_and_server_metadata_ride_through() {
    let attachment = |blob_ref: &str, updated_at: &str| at(updated_at, &[("Id", json!("att-1")), ("Blob", json!({ "__blobRef": blob_ref, "__blobKind": "attachment" }))]);
    let (rows, _) = merge_table("Attachments", vec![attachment("hash-old", T_OLD)], vec![attachment("hash-new", T_NEW)]);
    assert_eq!(rows[0]["Blob"], json!({ "__blobRef": "hash-new", "__blobKind": "attachment" }), "no byte payload ever crosses the merge");

    let mut server = manifest(PERSONAL, &[("Items", vec![item("a", "server", T_OLD)])]);
    server.name = Some("Family".to_string());
    let output = merge(vec![server], vec![manifest(PERSONAL, &[("Items", vec![item("b", "local", T_MID)])])]);
    let merged = &output.manifests[0].manifest;
    assert_eq!((merged.manifest_salt.as_str(), merged.name.as_deref()), (SALT, Some("Family")), "salt and name come from the server manifest");
    assert!(crate::vault_codec::validate_manifest(merged).ok);
}

/// `item-1` with the given name and trash stamp.
fn trashable(name: &str, deleted_at: Option<&str>, updated_at: &str) -> CodecRecord {
    let mut r = item("item-1", name, updated_at);
    r.insert("DeletedAt".to_string(), json!(deleted_at));
    r
}

fn totp(id: &str, secret: &str, deleted: bool, updated_at: &str) -> CodecRecord {
    at(updated_at, &[("Id", json!(id)), ("ItemId", json!("item-1")), ("SecretKey", json!(secret)), ("IsDeleted", json!(deleted as i32))])
}

/// One concurrent-edit scenario: what the server holds and what the local device holds for `item-1` and its codes.
struct Concurrent {
    what: String,
    server: (CodecRecord, Vec<CodecRecord>),
    local: (CodecRecord, Vec<CodecRecord>),
    /// `Name|DeletedAt` of the merged item.
    item: String,
    live_secrets: Vec<&'static str>,
}

#[test]
fn concurrent_edits_to_an_item_and_its_children_settle_row_by_row() {
    let bank = || trashable("Bank", None, T_OLD);
    let code = |secret: &str, deleted: bool, updated_at: &str| totp("totp-1", secret, deleted, updated_at);
    let case = |what: &str, server: (CodecRecord, Vec<CodecRecord>), local: (CodecRecord, Vec<CodecRecord>), item: &str, live_secrets: Vec<&'static str>| Concurrent { what: what.to_string(), server, local, item: item.to_string(), live_secrets };
    let mut cases = vec![
        case("a code deleted while the item was renamed", (bank(), vec![code("S", true, T_MID)]), (trashable("Renamed", None, T_NEW), vec![code("S", false, T_OLD)]), "Renamed|-", vec![]),
        case("a delete newer than an edit", (bank(), vec![code("S", true, T_NEW)]), (bank(), vec![code("edited", false, T_MID)]), "Bank|-", vec![]),
        case("an edit newer than a delete", (bank(), vec![code("S", true, T_MID)]), (bank(), vec![code("edited", false, T_NEW)]), "Bank|-", vec!["edited"]),
        case("trash is an ordinary item edit", (trashable("Bank", Some(T_NEW), T_NEW), vec![code("S", false, T_OLD)]), (bank(), vec![code("S", false, T_OLD), totp("totp-2", "added", false, T_MID)]), &format!("Bank|{T_NEW}"), vec!["S", "added"]),
        case("a restore newer than the trash", (trashable("Bank", Some(T_MID), T_MID), vec![]), (trashable("Bank", None, T_NEW), vec![]), "Bank|-", vec![]),
    ];

    // Spellings older or other clients write (space vs 'T', a Z suffix, an offset, .NET's seven digits) compare as instants.
    for (server_at, local_at, local_wins) in [
        ("2026-01-02 00:00:00.000", "2026-01-02T00:00:00.001Z", true),
        ("2026-01-02T00:00:00.000Z", "2026-01-02 00:00:00.000", false),
        ("2026-01-02 00:00:00.123", "2026-01-02 00:00:00.1234567", true),
        ("2026-01-02 02:00:00.000", "2026-01-02T03:00:00+02:00", false),
        ("2026-01-02 00:00:00", "2026-01-02 00:00:01", true),
    ] {
        cases.push(case(&format!("server at {server_at} vs local at {local_at}"), (bank(), vec![code("SERVER", false, server_at)]), (bank(), vec![code("LOCAL", false, local_at)]), "Bank|-", vec![if local_wins { "LOCAL" } else { "SERVER" }]));
    }

    for c in cases {
        let side = |(item, codes): (CodecRecord, Vec<CodecRecord>)| manifest(PERSONAL, &[("Items", vec![item]), ("TotpCodes", codes)]);
        let merged = merge(vec![side(c.server)], vec![side(c.local)]).manifests.remove(0).manifest;
        let item = &merged.tables["Items"][0];
        assert_eq!(format!("{}|{}", item["Name"].as_str().unwrap(), item["DeletedAt"].as_str().unwrap_or("-")), c.item, "{}", c.what);
        assert_eq!(sorted(merged.tables["TotpCodes"].iter().filter(|r| r["IsDeleted"] == json!(0)).map(|r| r["SecretKey"].as_str().unwrap()).collect()), c.live_secrets, "{}", c.what);
    }
}

/*
 * Tables, buckets and manifests.
 */

#[test]
fn unknown_columns_and_tables_keep_the_server_version() {
    // A newer client added Items.NewColumn and a FutureTable this client's schema does not know. A local row winning
    // LWW must not regress the column, and an unknown table is taken from the server wholesale (a local-only one is dropped).
    let mut base = item("row", "server-old", T_OLD);
    base.insert("NewColumn".to_string(), json!("newer-client-value"));
    let mut incoming = item("row", "local-new", T_NEW);
    incoming.insert("NewColumn".to_string(), json!("stale-carried-value"));
    let (rows, _) = merge_table("Items", vec![base], vec![incoming]);
    assert_eq!((rows[0]["Name"].as_str(), rows[0]["NewColumn"].as_str()), (Some("local-new"), Some("newer-client-value")));

    let future = |payload: &str| manifest(PERSONAL, &[("Items", vec![]), ("FutureTable", vec![at(T_OLD, &[("Id", json!("f-1")), ("Payload", json!(payload))])])]);
    let output = merge(vec![future("server-version")], vec![future("local-carried-version")]);
    assert_eq!(output.manifests[0].manifest.tables["FutureTable"][0]["Payload"], json!("server-version"));
    let output = merge(vec![manifest(PERSONAL, &[("Items", vec![])])], vec![future("local-only")]);
    assert!(!output.manifests[0].manifest.tables.contains_key("FutureTable"));
}

#[test]
fn buckets_merge_like_tables_and_come_back_as_buckets() {
    let setting = |value: &str, updated_at: &str| at(updated_at, &[("Key", json!("theme")), ("Value", json!(value))]);
    let bucket = |category: &str, table: &str, rows: Vec<CodecRecord>| DataBucket::new(PERSONAL, category, [(table.to_string(), rows)].into_iter().collect());
    let unknown_row = at(T_OLD, &[("Id", json!("u-1"))]);
    let mut server_settings = bucket("settings", "Settings", vec![setting("light", T_OLD)]);
    server_settings.tables.insert("SettingsExtras".to_string(), vec![unknown_row.clone()]);

    let output = merge_with_buckets(
        vec![manifest(PERSONAL, &[("Items", vec![])])],
        vec![server_settings, bucket("stats", "ItemStats", vec![])],
        vec![manifest(PERSONAL, &[("Items", vec![])])],
        vec![bucket("settings", "Settings", vec![setting("dark", T_NEW)]), bucket("FutureCategory", "FutureRows", vec![unknown_row])],
    );
    let merged = &output.manifests[0];
    assert!(!merged.manifest.tables.contains_key("Settings"), "bucketed tables never surface in manifest.tables");
    assert_eq!(merged.buckets.iter().filter(|b| b.category == "settings").count(), 1, "one bucket per category, whatever tables it carries");
    let settings = merged.buckets.iter().find(|b| b.category == "settings").unwrap();
    assert_eq!(settings.tables["Settings"][0]["Value"], json!("dark"), "the newer local setting wins inside the bucket");
    assert!(settings.tables.contains_key("SettingsExtras"), "the server's unknown bucket table rides through in its category's bucket");
    assert!(crate::vault_codec::validate_data_bucket(settings).ok);
    assert!(merged.buckets.iter().any(|b| b.category == "stats" && b.tables["ItemStats"].is_empty()), "a served bucket is emitted even when it holds no rows");
    assert!(!merged.buckets.iter().any(|b| b.category == "FutureCategory"), "a local-only unknown bucket is dropped with the rest of the local carrier");
}

#[test]
fn an_empty_table_the_server_carried_keeps_its_place() {
    // The merged manifest is pushed as-is and compared against a baseline canonicalize produced, which keeps empty
    // tables; dropping one here would rewrite the whole manifest on every merge.
    let (rows, _) = merge_table("Items", vec![], vec![]);
    assert!(rows.is_empty());
}

#[test]
fn manifests_merge_independently_and_a_lost_one_is_reported() {
    // Manifests are the partition: the same row id in two manifests never interacts, a local manifest the server no
    // longer serves is dropped and named, and one the server serves without content passes the local rows through.
    let output = merge(
        vec![manifest(PERSONAL, &[("Items", vec![item("same-id", "mine", T_OLD)])]), manifest(SHARED, &[("Items", vec![item("same-id", "theirs-old", T_OLD)])])],
        vec![manifest(PERSONAL, &[("Items", vec![item("same-id", "mine", T_OLD)])]), manifest(SHARED, &[("Items", vec![item("same-id", "theirs-new", T_NEW)])]), manifest("m-gone", &[("Items", vec![item("x", "gone", T_OLD)])])],
    );
    let by_id: HashMap<&str, &CanonicalManifestMerge> = output.manifests.iter().map(|m| (m.manifest_id.as_str(), m)).collect();
    assert_eq!(column(&by_id[PERSONAL].manifest.tables["Items"], "Name"), vec!["mine"]);
    assert_eq!(column(&by_id[SHARED].manifest.tables["Items"], "Name"), vec!["theirs-new"]);
    assert_eq!(by_id[PERSONAL].stats.incoming_won, 0);
    assert_eq!(output.dropped_local_manifest_ids, vec!["m-gone".to_string()]);

    let output = merge_canonical(CanonicalMergeInput {
        server_manifests: vec![manifest(PERSONAL, &[("Items", vec![])])],
        server_buckets: vec![],
        contentless_server_manifest_ids: vec![SHARED.to_string()],
        local_manifests: vec![manifest(PERSONAL, &[("Items", vec![])]), manifest(SHARED, &[("Items", vec![item("x", "kept-offline", T_OLD)])])],
        local_buckets: vec![],
        schema_columns: schema(),
    })
    .unwrap();
    assert!(output.dropped_local_manifest_ids.is_empty());
    let shared = output.manifests.iter().find(|m| m.manifest_id == SHARED).unwrap();
    assert_eq!(column(&shared.manifest.tables["Items"], "Name"), vec!["kept-offline"]);
    assert_eq!(shared.stats.incoming_only, 1);
}

/*
 * An item is deleted as a unit: a permanent delete only one side made is settled against everything the other
 * side did to the item (a field edit does not touch the item row), both ways, and the losing side's rows leave.
 */

fn item_manifest(items: Vec<CodecRecord>, field_values: Vec<CodecRecord>) -> Manifest {
    manifest(PERSONAL, &[("Items", items), ("FieldValues", field_values)])
}

fn live_values(merged: &CanonicalManifestMerge) -> Vec<&str> {
    sorted(merged.manifest.tables["FieldValues"].iter().filter(|r| r["IsDeleted"] == json!(0)).map(|r| r["Value"].as_str().unwrap()).collect())
}

#[test]
fn a_permanent_delete_is_settled_against_the_item_as_a_unit_both_ways() {
    let deleting = item_manifest(vec![tombstone("item-1", T_MID)], vec![field("login.username", "user", true, T_MID), field("login.password", "old-secret", true, T_MID)]);
    for (edit_at, survives) in [(T_NEW, true), (T_OLD, false)] {
        let editing = item_manifest(vec![item("item-1", "item", T_OLD)], vec![field("login.username", "user", false, T_OLD), field("login.password", "new-secret", false, edit_at)]);
        for (base, incoming) in [(deleting.clone(), editing.clone()), (editing, deleting.clone())] {
            let output = merge(vec![base], vec![incoming]);
            let merged = &output.manifests[0];
            assert_eq!(merged.manifest.tables["Items"].len(), 1);
            if survives {
                assert_eq!(merged.manifest.tables["Items"][0]["IsDeleted"], json!(0), "the later edit outlives the delete");
                assert_eq!(live_values(merged), vec!["new-secret", "user"], "with the untouched field intact: the delete's child tombstones do not wipe it");
            } else {
                assert_eq!(merged.manifest.tables["Items"][0]["IsDeleted"], json!(1), "the delete stands");
                assert!(merged.manifest.tables["FieldValues"].is_empty(), "and the deleted item keeps no rows, however the other side still held them");
            }
        }
    }

    // At the same instant the server side keeps the tie, whichever side it is.
    let deleting = item_manifest(vec![tombstone("item-1", T_NEW)], vec![]);
    let mut editing = item_manifest(vec![item("item-1", "item", T_OLD)], vec![field("login.password", "edited", false, T_NEW)]);
    let totp = at(T_NEW, &[("Id", json!("totp-1")), ("ItemId", json!("item-1")), ("SecretKey", json!("S")), ("IsDeleted", json!(0))]);
    editing.tables.insert("TotpCodes".to_string(), vec![totp]);
    let won = merge(vec![deleting.clone()], vec![editing.clone()]).manifests.remove(0).manifest;
    assert_eq!(won.tables["Items"][0]["IsDeleted"], json!(1));
    assert!(won.tables["FieldValues"].is_empty() && won.tables["TotpCodes"].is_empty(), "a bare tombstone takes the live children with it");
    let merged = merge(vec![editing], vec![deleting]);
    assert_eq!(merged.manifests[0].manifest.tables["Items"][0]["IsDeleted"], json!(0));
    assert_eq!(live_values(&merged.manifests[0]), vec!["edited"]);
}

#[test]
fn a_usage_counter_does_not_outlive_a_delete() {
    // ItemStats ticks on every autofill; that is not an edit and must not undo a delete.
    let stats = at(T_NEW, &[("Id", json!("item-1")), ("DeviceId", json!("device-a")), ("LastUsedAt", json!(T_NEW))]);
    let output = merge_with_buckets(vec![item_manifest(vec![tombstone("item-1", T_MID)], vec![])], vec![], vec![item_manifest(vec![item("item-1", "item", T_OLD)], vec![])], vec![DataBucket::new(PERSONAL, "stats", [("ItemStats".to_string(), vec![stats])].into_iter().collect())]);
    let merged = &output.manifests[0];
    assert_eq!(merged.manifest.tables["Items"][0]["IsDeleted"], json!(1));
    assert!(merged.buckets.iter().all(|b| b.tables.get("ItemStats").is_none_or(Vec::is_empty)), "the deleted item's stats row goes with it");
}

#[test]
fn an_item_moved_to_another_manifest_does_not_stay_behind_in_the_one_it_left() {
    // The move leaves a tombstone in the source manifest, so the server's copy there loses instead of surviving next to the moved one.
    let server = vec![item_manifest(vec![item("item-1", "item", T_OLD)], vec![field("login.password", "secret", false, T_OLD)]), manifest(SHARED, &[("Items", vec![]), ("FieldValues", vec![])])];
    let local = vec![item_manifest(vec![tombstone("item-1", T_NEW)], vec![]), manifest(SHARED, &[("Items", vec![restamp(item("item-1", "item", T_NEW), SHARED)]), ("FieldValues", vec![restamp(field("login.password", "secret", false, T_OLD), SHARED)])])];
    let output = merge(server, local);
    let by_id: HashMap<&str, &CanonicalManifestMerge> = output.manifests.iter().map(|m| (m.manifest_id.as_str(), m)).collect();
    assert_eq!(by_id[PERSONAL].manifest.tables["Items"][0]["IsDeleted"], json!(1), "the source manifest keeps only the tombstone");
    assert!(by_id[PERSONAL].manifest.tables["FieldValues"].is_empty());
    assert_eq!(by_id[SHARED].manifest.tables["Items"][0]["IsDeleted"], json!(0));
    assert_eq!(live_values(by_id[SHARED]), vec!["secret"], "and the moved item arrives whole");
}

#[test]
fn two_devices_using_one_item_keep_both_counts() {
    // Each device writes only its own row, so the newer device's row cannot replace the other's count.
    let use_row = |device: &str, count: i64, updated_at: &str| at(updated_at, &[("Id", json!("item-1")), ("DeviceId", json!(device)), ("UseCount", json!(count)), ("LastUsedAt", json!(updated_at))]);
    let stats_bucket = |rows: Vec<CodecRecord>| DataBucket::new(PERSONAL, "stats", [("ItemStats".to_string(), rows)].into_iter().collect());
    let items = || item_manifest(vec![item("item-1", "item", T_OLD)], vec![]);

    let output = merge_with_buckets(vec![items()], vec![stats_bucket(vec![use_row("device-web", 51, T_NEW)])], vec![items()], vec![stats_bucket(vec![use_row("device-phone", 55, T_MID)])]);

    let stats = output.manifests[0].buckets.iter().find(|b| b.category == "stats").expect("stats bucket");
    let mut counts: Vec<(String, i64)> = stats.tables["ItemStats"].iter().map(|r| (r["DeviceId"].as_str().unwrap().to_string(), r["UseCount"].as_i64().unwrap())).collect();
    counts.sort();
    assert_eq!(counts, vec![("device-phone".to_string(), 55), ("device-web".to_string(), 51)]);
}

#[test]
fn a_stats_row_without_a_device_is_dropped() {
    // Rows from before stats were kept per device would collide on materialize, so they do not survive a merge.
    let legacy = at(T_NEW, &[("Id", json!("item-1")), ("UseCount", json!(9)), ("LastUsedAt", json!(T_NEW))]);
    let stats_bucket = |rows: Vec<CodecRecord>| DataBucket::new(PERSONAL, "stats", [("ItemStats".to_string(), rows)].into_iter().collect());
    let items = || item_manifest(vec![item("item-1", "item", T_OLD)], vec![]);

    let output = merge_with_buckets(vec![items()], vec![stats_bucket(vec![legacy])], vec![items()], vec![]);

    assert!(output.manifests[0].buckets.iter().all(|b| b.tables.get("ItemStats").is_none_or(Vec::is_empty)));
}
