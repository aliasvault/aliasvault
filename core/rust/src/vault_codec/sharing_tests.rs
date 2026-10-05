//! The shared-manifest split (canonicalize) and combine (materialize): every row routes to the manifest its stamp
//! names, each manifest is self-contained, and nothing crosses a manifest boundary that should not.

use super::*;
use super::row::rows_of;
use super::test_support::{b64, materialize_input, materialized_map, row, stamped, table, PERSONAL_MANIFEST_ID as PERSONAL, PERSONAL_SALT as SALT_PERSONAL, SHARED_MANIFEST_ID as SHARED};
use super::types::{is_bucketed_table, is_personal_table, manifest_scoped_tables, SCHEMA_VERSION};
use crate::vault_model::OVERFLOW_TABLE;
use serde_json::json;
use std::collections::{HashMap, HashSet};

const SALT_SHARED: &str = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";

fn spec(manifest_id: &str) -> ManifestSpec {
    let (salt, name) = if manifest_id == PERSONAL { (SALT_PERSONAL, None) } else { (SALT_SHARED, Some(format!("Share {manifest_id}"))) };
    ManifestSpec { manifest_id: manifest_id.to_string(), manifest_salt: salt.to_string(), name }
}

/// A canonicalize input for the personal manifest plus `shared` manifests; rows carry their stamps already.
fn input(tables: Vec<CodecTableData>, shared: &[&str]) -> CanonicalizeInput {
    CanonicalizeInput { tables, canonicalized_at: "2026-01-01T00:00:00.000Z".to_string(), manifests: std::iter::once(PERSONAL).chain(shared.iter().copied()).map(spec).collect(), stamp_unstamped_into: None }
}

fn canonicalize(tables: Vec<CodecTableData>, shared: &[&str]) -> CanonicalizedVault {
    canonicalize_from_sqlite(input(tables, shared)).unwrap()
}

/// The manifest with `id` in a canonicalize result.
fn manifest<'a>(out: &'a CanonicalizedVault, id: &str) -> &'a CanonicalizedManifest {
    out.manifests.iter().find(|m| m.manifest.manifest_id == id).unwrap_or_else(|| panic!("no manifest {id}"))
}

fn ids(records: &[CodecRecord]) -> Vec<&str> {
    let mut out: Vec<&str> = records.iter().filter_map(|r| r.get("Id").and_then(|v| v.as_str())).collect();
    out.sort();
    out
}

/// FieldValues rows are identified by their `Value`.
fn values(records: &[CodecRecord]) -> Vec<&str> {
    let mut out: Vec<&str> = records.iter().filter_map(|r| r.get("Value").and_then(|v| v.as_str())).collect();
    out.sort();
    out
}

fn find<'a>(records: &'a [CodecRecord], id: &str) -> &'a CodecRecord {
    records.iter().find(|r| r["Id"] == json!(id)).unwrap_or_else(|| panic!("no row {id}"))
}

fn find_mut<'a>(tables: &'a mut [CodecTableData], name: &str, id: &str) -> &'a mut CodecRecord {
    tables.iter_mut().find(|t| t.name == name).unwrap().records.iter_mut().find(|r| r["Id"] == json!(id)).unwrap()
}

fn find_mut_in<'a>(m: &'a mut Manifest, table: &str, id: &str) -> &'a mut CodecRecord {
    m.tables.get_mut(table).unwrap().iter_mut().find(|r| r["Id"] == json!(id)).unwrap()
}

fn logo_id(manifest_id: &str, source: &str) -> String {
    logo_id_for(manifest_id, "favicon", source)
}

/// The `Logos` row for `source` in a manifest, resolved through its derived id.
fn logo_row<'a>(m: &'a Manifest, source: &str) -> &'a CodecRecord {
    find(rows_of(&m.tables, "Logos"), &logo_id(&m.manifest_id, source))
}

fn logo_sources(m: &Manifest) -> Vec<&str> {
    let mut out: Vec<&str> = rows_of(&m.tables, "Logos").iter().filter_map(|r| r.get("Source").and_then(|v| v.as_str())).collect();
    out.sort();
    out
}

fn manifests_of(out: &CanonicalizedVault) -> Vec<Manifest> {
    out.manifests.iter().map(|m| m.manifest.clone()).collect()
}

/// Every string a manifest carries, so a test can ask whether a secret leaked into it, base64 blobs included.
fn mentions(m: &Manifest, needle: &str) -> bool {
    fn walk(value: &serde_json::Value, out: &mut Vec<String>) {
        match value {
            serde_json::Value::String(s) => out.push(s.clone()),
            serde_json::Value::Array(items) => items.iter().for_each(|v| walk(v, out)),
            serde_json::Value::Object(map) => map.values().for_each(|v| walk(v, out)),
            _ => {}
        }
    }
    let mut strings = Vec::new();
    m.tables.values().flatten().flat_map(|row| row.values()).for_each(|v| walk(v, &mut strings));
    let encoded = b64(needle.as_bytes());
    strings.iter().any(|s| s == needle || s == &encoded)
}

/// A representative owner vault, stamped as the client stamps it: a personal folder and item, a shared manifest
/// holding the "f-shared" folder tree with two items and their child rows, and the content both reference.
fn owner_tables() -> Vec<CodecTableData> {
    vec![
        table("Folders", vec![
            stamped(PERSONAL, &[("Id", json!("f-personal")), ("Name", json!("Personal")), ("ParentFolderId", serde_json::Value::Null)]),
            stamped(SHARED, &[("Id", json!("f-shared")), ("Name", json!("Family")), ("ParentFolderId", serde_json::Value::Null)]),
            stamped(SHARED, &[("Id", json!("f-sub")), ("Name", json!("Streaming")), ("ParentFolderId", json!("f-shared"))]),
        ]),
        table("Items", vec![
            stamped(PERSONAL, &[("Id", json!("i-personal")), ("FolderId", json!("f-personal")), ("LogoId", json!("logo-both"))]),
            stamped(SHARED, &[("Id", json!("i-shared")), ("FolderId", json!("f-shared")), ("LogoId", json!("logo-both"))]),
            stamped(SHARED, &[("Id", json!("i-sub")), ("FolderId", json!("f-sub")), ("LogoId", json!("logo-shared-only"))]),
            stamped(PERSONAL, &[("Id", json!("i-nofolder")), ("FolderId", serde_json::Value::Null), ("LogoId", serde_json::Value::Null)]),
        ]),
        table("FieldValues", vec![
            stamped(PERSONAL, &[("Id", json!("fv-personal")), ("ItemId", json!("i-personal")), ("FieldDefinitionId", json!("fd-1")), ("FieldKey", json!("username")), ("Value", json!("me"))]),
            stamped(SHARED, &[("Id", json!("fv-shared")), ("ItemId", json!("i-shared")), ("FieldDefinitionId", json!("fd-1")), ("FieldKey", json!("username")), ("Value", json!("family"))]),
            stamped(SHARED, &[("Id", json!("fv-sub")), ("ItemId", json!("i-sub")), ("FieldDefinitionId", serde_json::Value::Null), ("FieldKey", json!("password")), ("Value", json!("hunter2"))]),
        ]),
        table("TotpCodes", vec![stamped(SHARED, &[("Id", json!("totp-shared")), ("ItemId", json!("i-shared")), ("SecretKey", json!({ "__b64": b64(&[9, 9, 9]) }))])]),
        table("Attachments", vec![
            stamped(SHARED, &[("Id", json!("att-shared")), ("ItemId", json!("i-sub")), ("Blob", json!({ "__b64": b64(&[1, 2, 3, 4]) }))]),
            stamped(PERSONAL, &[("Id", json!("att-personal")), ("ItemId", json!("i-personal")), ("Blob", json!({ "__b64": b64(&[5, 6]) }))]),
        ]),
        table("Tags", vec![
            stamped(PERSONAL, &[("Id", json!("tag-both")), ("Name", json!("work"))]),
            stamped(PERSONAL, &[("Id", json!("tag-shared-only")), ("Name", json!("family"))]),
            stamped(PERSONAL, &[("Id", json!("tag-unused")), ("Name", json!("todo"))]),
        ]),
        table("ItemTags", vec![
            stamped(PERSONAL, &[("ItemId", json!("i-personal")), ("TagId", json!("tag-both"))]),
            stamped(SHARED, &[("ItemId", json!("i-shared")), ("TagId", json!("tag-both"))]),
            stamped(SHARED, &[("ItemId", json!("i-sub")), ("TagId", json!("tag-shared-only"))]),
        ]),
        table("FieldDefinitions", vec![stamped(PERSONAL, &[("Id", json!("fd-1")), ("Key", json!("username"))]), stamped(PERSONAL, &[("Id", json!("fd-unused")), ("Key", json!("custom"))])]),
        table("Logos", vec![
            stamped(PERSONAL, &[("Id", json!("logo-both")), ("Source", json!("github.com")), ("FileData", json!({ "__b64": b64(&[0xAA, 0xBB]) }))]),
            stamped(PERSONAL, &[("Id", json!("logo-shared-only")), ("Source", json!("netflix.com")), ("FileData", json!({ "__b64": b64(&[0xCC, 0xDD]) }))]),
        ]),
        table("EncryptionKeys", vec![stamped(PERSONAL, &[("Id", json!("ek-1")), ("PublicKey", json!("pub")), ("PrivateKey", json!("priv")), ("IsPrimary", json!(1)), ("IsDeleted", json!(0))])]),
        table("Settings", vec![stamped(PERSONAL, &[("Key", json!("theme")), ("Value", json!("dark"))])]),
    ]
}

fn canonicalize_owner() -> CanonicalizedVault {
    canonicalize(owner_tables(), &[SHARED])
}

/// `owner_tables()` with `change` applied to the named table's rows.
fn owner_tables_with(name: &str, change: impl FnOnce(&mut Vec<CodecRecord>)) -> Vec<CodecTableData> {
    let mut tables = owner_tables();
    change(&mut tables.iter_mut().find(|t| t.name == name).unwrap().records);
    tables
}

/// Move `item_id` into `folder_id`, which lives in `manifest_id`: the client restamps the item and its children.
fn move_item(tables: &mut [CodecTableData], item_id: &str, folder_id: &str, manifest_id: &str) {
    for table in tables.iter_mut() {
        for row in table.records.iter_mut() {
            let is_item = table.name == "Items" && row["Id"] == json!(item_id);
            let is_child = row.get("ItemId") == Some(&json!(item_id));
            if is_item {
                row.insert("FolderId".to_string(), json!(folder_id));
            }
            if is_item || is_child {
                row.insert("ManifestId".to_string(), json!(manifest_id));
            }
        }
    }
}

/*
 * Canonicalize: routing by stamp.
 */

#[test]
fn every_row_routes_to_the_manifest_its_stamp_names() {
    let out = canonicalize_owner();
    let personal = &manifest(&out, PERSONAL).manifest;
    let shared = &manifest(&out, SHARED).manifest;

    assert_eq!(shared.name.as_deref(), Some(format!("Share {SHARED}").as_str()), "the manifest carries its display name");
    assert_eq!(shared.manifest_salt, SALT_SHARED);
    assert_eq!(ids(rows_of(&shared.tables, "Folders")), vec!["f-shared", "f-sub"]);
    assert_eq!(ids(rows_of(&personal.tables, "Folders")), vec!["f-personal"]);
    assert_eq!(ids(rows_of(&shared.tables, "Items")), vec!["i-shared", "i-sub"]);
    assert_eq!(ids(rows_of(&personal.tables, "Items")), vec!["i-nofolder", "i-personal"]);

    // Every table of rows hanging off an item follows it, with zero per-table wiring, and claims the manifest it joined.
    assert_eq!(values(rows_of(&shared.tables, "FieldValues")), vec!["family", "hunter2"]);
    assert_eq!(values(rows_of(&personal.tables, "FieldValues")), vec!["me"]);
    assert_eq!(ids(rows_of(&shared.tables, "TotpCodes")), vec!["totp-shared"]);
    assert_eq!(ids(rows_of(&shared.tables, "Attachments")), vec!["att-shared"]);
    assert_eq!(ids(rows_of(&personal.tables, "Attachments")), vec!["att-personal"]);
    assert_eq!(rows_of(&shared.tables, "ItemTags").len(), 2);
    assert_eq!(rows_of(&personal.tables, "ItemTags").len(), 1);

    // The blanket invariant: a row inside a manifest names that manifest, in every table and bucket.
    for canonicalized in &out.manifests {
        for (name, rows) in &canonicalized.manifest.tables {
            for row in rows {
                assert_eq!(row["ManifestId"], json!(canonicalized.manifest.manifest_id), "{name} row {:?} sits in manifest {} but names another", row.get("Id"), canonicalized.manifest.manifest_id);
            }
        }
    }
    for bucket in &out.data_buckets {
        assert!(bucket.tables.values().flatten().all(|row| row["ManifestId"] == json!(bucket.manifest_id)), "bucket {} of {} carries a row naming another manifest", bucket.category, bucket.manifest_id);
    }
    assert!(validate_manifest(personal).ok && validate_manifest(shared).ok);
}

#[test]
fn a_folder_parent_link_only_counts_within_the_folders_own_manifest() {
    // The shared tree's root was nested under a personal folder: the link leaves with the manifest. The subfolder's
    // link stays, also when a personal folder carries the id of the subfolder or of its parent.
    let tables = owner_tables_with("Folders", |folders| {
        folders.iter_mut().find(|r| r["Id"] == json!("f-shared")).unwrap().insert("ParentFolderId".to_string(), json!("f-personal"));
        folders.push(stamped(PERSONAL, &[("Id", json!("f-sub")), ("Name", json!("Mine, same id")), ("ParentFolderId", serde_json::Value::Null)]));
        folders.push(stamped(PERSONAL, &[("Id", json!("f-shared")), ("Name", json!("Mine, parent id")), ("ParentFolderId", serde_json::Value::Null)]));
    });
    let out = canonicalize(tables, &[SHARED]);
    let shared = &manifest(&out, SHARED).manifest;
    assert_eq!(find(rows_of(&shared.tables, "Folders"), "f-shared")["ParentFolderId"], serde_json::Value::Null, "a parent in another manifest is cut");
    assert_eq!(find(rows_of(&shared.tables, "Folders"), "f-sub")["ParentFolderId"], json!("f-shared"), "a parent in the same manifest stands");
}

#[test]
fn each_manifest_gets_its_own_copy_of_the_tags_and_definitions_its_rows_reference() {
    // The composite `(ManifestId, Id)` foreign key cannot reach into another namespace, so a referenced row is
    // copied, never moved: the base keeps every tag, including the unused one, which is still the user's.
    let out = canonicalize_owner();
    let shared = &manifest(&out, SHARED).manifest;
    assert_eq!(ids(rows_of(&shared.tables, "Tags")), vec!["tag-both", "tag-shared-only"]);
    assert_eq!(ids(rows_of(&manifest(&out, PERSONAL).manifest.tables, "Tags")), vec!["tag-both", "tag-shared-only", "tag-unused"]);
    assert_eq!(find(rows_of(&shared.tables, "Tags"), "tag-both")["Name"], json!("work"), "content copied as-is, id kept");
    assert_eq!(ids(rows_of(&shared.tables, "FieldDefinitions")), vec!["fd-1"]);
    assert_eq!(ids(rows_of(&manifest(&out, PERSONAL).manifest.tables, "FieldDefinitions")), vec!["fd-1", "fd-unused"]);

    // An item moving into the share brings the tag it carries along.
    let mut tables = owner_tables();
    move_item(&mut tables, "i-personal", "f-shared", SHARED);
    let out = canonicalize(tables, &[SHARED]);
    assert!(ids(rows_of(&manifest(&out, SHARED).manifest.tables, "Tags")).contains(&"tag-both"));
}

#[test]
fn canonicalize_refuses_input_it_cannot_route() {
    // No fallback manifest: a row that names no manifest is refused, naming the table, in a registered table, an
    // unregistered one, and under the all-zero sentinel the schema stamps when it cannot derive a manifest.
    let unstamped = [
        ("Items", owner_tables_with("Items", |items| items.iter_mut().for_each(|r| drop(r.insert("ManifestId".to_string(), json!("")))))),
        ("Tags", owner_tables_with("Tags", |tags| tags.iter_mut().for_each(|r| drop(r.insert("ManifestId".to_string(), json!("00000000-0000-0000-0000-000000000000")))))),
        ("Widgets", {
            let mut t = owner_tables();
            t.push(table("Widgets", vec![row(&[("Id", json!("w-1"))])]));
            t
        }),
    ];
    for (offending, tables) in unstamped {
        let err = canonicalize_from_sqlite(input(tables, &[SHARED])).unwrap_err().to_string();
        assert!(err.contains(offending) && err.contains("name no manifest"), "{err}");
    }

    let err = canonicalize_from_sqlite(input(owner_tables(), &[SHARED, SHARED])).unwrap_err().to_string();
    assert!(err.contains("duplicate"), "{err}");
    let mut without_id = input(owner_tables(), &[]);
    without_id.manifests[0].manifest_id = String::new();
    assert!(canonicalize_from_sqlite(without_id).is_err());
    assert!(canonicalize_from_sqlite(CanonicalizeInput { manifests: vec![], ..input(vec![], &[]) }).is_err());
}

#[test]
fn the_sqlite_blob_migration_stamps_the_rows_an_old_vault_left_unstamped() {
    // LEGACY. A vault whose schema predates the `ManifestId` column carries no stamp at all; the migration names
    // the manifest those rows join, rows that already name one keep it, and nothing is dropped.
    let mut tables = owner_tables();
    for table in tables.iter_mut().filter(|t| t.name != "Items" && t.name != "Folders") {
        table.records.iter_mut().for_each(|r| drop(r.remove("ManifestId")));
    }
    let mut legacy = input(tables, &[SHARED]);
    legacy.stamp_unstamped_into = Some(PERSONAL.to_string());

    let out = canonicalize_from_sqlite(legacy).unwrap();
    let personal = &manifest(&out, PERSONAL).manifest;
    assert_eq!(ids(rows_of(&personal.tables, "Tags")), vec!["tag-both", "tag-shared-only", "tag-unused"]);
    assert!(rows_of(&personal.tables, "Tags").iter().all(|r| r["ManifestId"] == json!(PERSONAL)), "stamped rows carry a real manifest id on the way out");
    assert_eq!(ids(rows_of(&manifest(&out, SHARED).manifest.tables, "Items")), vec!["i-shared", "i-sub"], "explicit stamps still route");
    assert_eq!(values(rows_of(&manifest(&out, SHARED).manifest.tables, "FieldValues")), vec!["family", "hunter2"], "unstamped children followed their item");

    let re = materialize_as_sqlite(materialize_input(manifests_of(&out), out.data_buckets.clone())).unwrap();
    for table in re.tables.iter().filter(|t| manifest_scoped_tables().contains(&t.name.as_str())) {
        assert!(table.records.iter().all(|r| r["ManifestId"].is_string()), "{} would violate the NOT NULL stamp", table.name);
    }

    // A vault with no stamp on any row and no share yet: every row, nothing dropped, comes out stamped the personal manifest.
    let mut tables = owner_tables();
    tables.iter_mut().flat_map(|t| t.records.iter_mut()).for_each(|r| drop(r.remove("ManifestId")));
    let mut legacy = input(tables, &[]);
    legacy.stamp_unstamped_into = Some(PERSONAL.to_string());
    let out = canonicalize_from_sqlite(legacy).unwrap();
    assert_eq!(ids(rows_of(&out.manifests[0].manifest.tables, "Items")), vec!["i-nofolder", "i-personal", "i-shared", "i-sub"]);
    let re = materialize_as_sqlite(materialize_input(manifests_of(&out), out.data_buckets.clone())).unwrap();
    for table in re.tables.iter().filter(|t| manifest_scoped_tables().contains(&t.name.as_str())) {
        assert!(table.records.iter().all(|r| r["ManifestId"] == json!(PERSONAL)), "{} row left unstamped or stamped elsewhere", table.name);
    }
}

#[test]
fn rows_of_a_manifest_this_push_does_not_declare_are_dropped_not_rehomed() {
    // The vault still holds rows stamped for the shared manifest, but this push declares only the personal one:
    // whoever wrote it no longer has that manifest. Those rows have no namespace to go to, and an item left behind
    // must not take the child rows of a live item that carries the same id down with it.
    let tables = owner_tables_with("Items", |items| items.push(stamped("m-revoked", &[("Id", json!("i-personal")), ("FolderId", serde_json::Value::Null)])));
    let out = canonicalize(tables, &[]);
    assert_eq!(out.manifests.len(), 1);
    let personal = &out.manifests[0].manifest;
    assert_eq!(ids(rows_of(&personal.tables, "Items")), vec!["i-nofolder", "i-personal"]);
    assert_eq!(ids(rows_of(&personal.tables, "Folders")), vec!["f-personal"]);
    assert_eq!(values(rows_of(&personal.tables, "FieldValues")), vec!["me"], "the dropped items' rows went with them, the live item kept its own");
    assert!(rows_of(&personal.tables, "TotpCodes").is_empty());
    assert!(!mentions(personal, "hunter2"), "a dropped item's secrets are not re-homed");
}

#[test]
fn several_shared_manifests_split_apart_and_an_empty_one_is_still_emitted() {
    // Two shares at once each get exactly their own subtree. A declared manifest with no rows left (its folder was
    // deleted) is still emitted, empty buckets included, so the emptying reaches the server.
    let mut tables = owner_tables();
    move_item(&mut tables, "i-sub", "f-sub", "m-other");
    find_mut(&mut tables, "Folders", "f-sub").insert("ManifestId".to_string(), json!("m-other"));
    let out = canonicalize(tables, &[SHARED, "m-other", "m-empty"]);
    assert_eq!(out.manifests.len(), 4);
    assert_eq!(ids(rows_of(&manifest(&out, SHARED).manifest.tables, "Items")), vec!["i-shared"]);
    assert_eq!(ids(rows_of(&manifest(&out, "m-other").manifest.tables, "Items")), vec!["i-sub"]);
    assert_eq!(values(rows_of(&manifest(&out, "m-other").manifest.tables, "FieldValues")), vec!["hunter2"]);
    assert_eq!(ids(rows_of(&manifest(&out, PERSONAL).manifest.tables, "Items")), vec!["i-nofolder", "i-personal"]);
    assert!(manifest(&out, "m-empty").manifest.tables.values().all(Vec::is_empty));
    let empty_settings = out.data_buckets.iter().find(|b| b.manifest_id == "m-empty" && b.category == "settings").unwrap();
    assert!(empty_settings.tables["Settings"].is_empty(), "the emptied table is declared, so the delete reaches the server");
}

#[test]
fn unregistered_tables_route_by_their_stamps_like_every_other() {
    // A newer writer's table carried through the codec overflow: the writing manifest is not special, it gets
    // exactly its own rows, a shared manifest gets its own, and a row for a manifest this vault lost is dropped.
    let mut tables = owner_tables();
    tables.push(table("Widgets", vec![stamped(PERSONAL, &[("Id", json!("w-personal"))]), stamped(SHARED, &[("Id", json!("w-shared"))]), stamped("m-revoked", &[("Id", json!("w-gone"))])]));
    let out = canonicalize(tables, &[SHARED]);
    assert_eq!(ids(rows_of(&manifest(&out, PERSONAL).manifest.tables, "Widgets")), vec!["w-personal"]);
    assert_eq!(ids(rows_of(&manifest(&out, SHARED).manifest.tables, "Widgets")), vec!["w-shared"]);
}

#[test]
fn overflow_columns_regraft_onto_a_row_that_changed_manifest() {
    // A newer writer added a column to an item; it rode in the overflow under the identity the row had before the
    // item moved into the share. The re-graft follows the row by its primary key.
    let overflow = CodecOverflow { columns: [("Items".to_string(), [(format!("{}\u{1f}i-shared", PERSONAL), row(&[("FutureCol", json!("keep-me"))]))].into_iter().collect())].into_iter().collect(), ..Default::default() };
    let mut tables = owner_tables();
    tables.push(table(OVERFLOW_TABLE, overflow.to_table_records()));
    let out = canonicalize(tables, &[SHARED]);
    assert_eq!(find(rows_of(&manifest(&out, SHARED).manifest.tables, "Items"), "i-shared")["FutureCol"], json!("keep-me"));
    assert!(rows_of(&manifest(&out, PERSONAL).manifest.tables, "Items").iter().all(|r| !r.contains_key("FutureCol")));
}

/*
 * Canonicalize: logos and blobs.
 */

#[test]
fn logos_are_scoped_per_manifest_and_hashed_with_its_salt() {
    let out = canonicalize_owner();
    let personal = manifest(&out, PERSONAL);
    let shared = manifest(&out, SHARED);

    // Each manifest holds exactly the domains its items use, under ids derived from its own id; the same domain in
    // two manifests is two rows, and items point at the row in their own manifest.
    assert_eq!(logo_sources(&shared.manifest), vec!["github.com", "netflix.com"]);
    assert_eq!(logo_sources(&personal.manifest), vec!["github.com"], "netflix.com left with the item that referenced it, and a favicon is refetchable");
    assert_ne!(logo_row(&personal.manifest, "github.com")["Id"], logo_row(&shared.manifest, "github.com")["Id"]);
    assert_eq!(find(rows_of(&personal.manifest.tables, "Items"), "i-personal")["LogoId"], logo_row(&personal.manifest, "github.com")["Id"]);
    assert_eq!(find(rows_of(&shared.manifest.tables, "Items"), "i-shared")["LogoId"], logo_row(&shared.manifest, "github.com")["Id"]);

    // Blob maps: every manifest hashes its blobs with its own salt, and the refs inside it point at its own map.
    assert_eq!(personal.blobs.len(), 2, "att-personal + github logo");
    assert_eq!(shared.blobs.len(), 3, "att-shared + both logos");
    let logo_bytes = [0xAAu8, 0xBB];
    let (personal_hash, shared_hash) = (hash::salted_blob_hash(&logo_bytes, SALT_PERSONAL).unwrap(), hash::salted_blob_hash(&logo_bytes, SALT_SHARED).unwrap());
    assert_ne!(personal_hash, shared_hash);
    assert_eq!(logo_row(&personal.manifest, "github.com")["FileData"]["__blobRef"], json!(personal_hash));
    assert_eq!(logo_row(&shared.manifest, "github.com")["FileData"]["__blobRef"], json!(shared_hash));
    assert!(personal.blobs.contains_key(&personal_hash) && shared.blobs.contains_key(&shared_hash));
}

#[test]
fn orphan_favicons_are_pruned_and_uploads_kept_in_every_manifest_alike() {
    // An item left the share: its favicon must not linger there (every member downloads it) and lands where the item
    // went. An image the user uploaded is not reproducible, so it stays, in every manifest alike.
    let mut tables = owner_tables_with("Logos", |logos| {
        logos.push(stamped(PERSONAL, &[("Id", json!("upload-personal")), ("Kind", json!("custom")), ("Source", json!("aa11")), ("FileData", json!({ "__b64": b64(&[0x55]) }))]));
        logos.push(stamped(SHARED, &[("Id", json!("upload-shared")), ("Kind", json!("custom")), ("Source", json!("bb22")), ("FileData", json!({ "__b64": b64(&[0x66]) }))]));
    });
    move_item(&mut tables, "i-sub", "f-personal", PERSONAL);
    let out = canonicalize(tables, &[SHARED]);
    assert_eq!(logo_sources(&manifest(&out, SHARED).manifest), vec!["bb22", "github.com"], "netflix logo left with its item, the upload stayed");
    assert_eq!(logo_sources(&manifest(&out, PERSONAL).manifest), vec!["aa11", "github.com", "netflix.com"]);
}

#[test]
fn a_logo_follows_its_item_into_a_share_reusing_the_rows_the_share_has() {
    // i-personal (github.com, like i-shared), i-nofolder (now pointing at an upload) and a built-in item move into
    // the share: the share gets one github row both items point at, and a per-manifest copy of every other kind.
    let content_hash = "a".repeat(64);
    let mut tables = owner_tables_with("Logos", |logos| {
        logos.push(stamped(PERSONAL, &[("Id", json!("personal-custom")), ("Kind", json!("custom")), ("Source", json!(content_hash.clone())), ("FileData", json!({ "__b64": b64(&[0xaa, 0xbb, 0xcc]) }))]));
        logos.push(stamped(PERSONAL, &[("Id", json!("builtin-row")), ("Kind", json!("builtin")), ("Source", json!("shopping")), ("FileData", serde_json::Value::Null)]));
    });
    tables.iter_mut().find(|t| t.name == "Items").unwrap().records.push(stamped(PERSONAL, &[("Id", json!("i-builtin")), ("FolderId", serde_json::Value::Null), ("LogoId", json!("builtin-row"))]));
    find_mut(&mut tables, "Items", "i-nofolder").insert("LogoId".to_string(), json!("personal-custom"));
    for item in ["i-personal", "i-nofolder", "i-builtin"] {
        move_item(&mut tables, item, "f-shared", SHARED);
    }

    let out = canonicalize(tables, &[SHARED]);
    let shared = manifest(&out, SHARED);
    assert_eq!(logo_sources(&shared.manifest), vec![content_hash.as_str(), "github.com", "netflix.com", "shopping"], "no duplicate github row");
    let github = logo_row(&shared.manifest, "github.com");
    assert_eq!(find(rows_of(&shared.manifest.tables, "Items"), "i-personal")["LogoId"], github["Id"]);
    assert_eq!(find(rows_of(&shared.manifest.tables, "Items"), "i-shared")["LogoId"], github["Id"]);
    assert!(github["FileData"]["__blobRef"].is_string(), "and it carries real bytes");

    let custom = find(rows_of(&shared.manifest.tables, "Logos"), &logo_id_for(SHARED, "custom", &content_hash));
    assert_eq!((custom["Kind"].as_str(), custom["ManifestId"].as_str()), (Some("custom"), Some(SHARED)));
    assert!(custom["FileData"]["__blobRef"].is_string(), "the upload travels with its bytes, so members can render it");
    assert_eq!(find(rows_of(&shared.manifest.tables, "Items"), "i-nofolder")["LogoId"], custom["Id"]);
    let builtin = find(rows_of(&shared.manifest.tables, "Logos"), &logo_id_for(SHARED, "builtin", "shopping"));
    assert_eq!(builtin["Source"], json!("shopping"), "a bytesless built-in logo still belongs in the manifest; the catalog key identifies it");
    assert_eq!(find(rows_of(&shared.manifest.tables, "Items"), "i-builtin")["LogoId"], builtin["Id"]);
}

#[test]
fn logo_ids_derive_from_scope_kind_and_source() {
    // Same (manifest id, kind, domain) -> same row on every platform; the domain is case-insensitive; kinds key apart so a
    // domain and a catalog key can never collide; a row without a Kind is a favicon and keeps its legacy derivation.
    assert_eq!(logo_id(PERSONAL, "github.com"), logo_id(&PERSONAL.to_uppercase(), "GitHub.com"));
    assert_ne!(logo_id(PERSONAL, "github.com"), logo_id(SHARED, "github.com"));
    assert_ne!(logo_id_for(PERSONAL, "favicon", "shopping"), logo_id_for(PERSONAL, "builtin", "shopping"));
    assert_eq!(logo_id(PERSONAL, "github.com").len(), 36);
    // Known-answer vectors: every platform must derive the same logo ids, so these values must never change.
    assert_eq!(logo_id_for("11111111-aaaa-4111-8111-111111111111", "favicon", "github.com"), "500424ce-570f-8807-a476-a64ccf8084e7");
    assert_eq!(logo_id_for("11111111-aaaa-4111-8111-111111111111", "builtin", "shopping"), "19f3ef9c-5a8b-87e7-bbea-08b60c2dfd66");

    let out = canonicalize(
        vec![
            table("Items", vec![stamped(PERSONAL, &[("Id", json!("i-fav")), ("LogoId", json!("legacy-fav"))]), stamped(PERSONAL, &[("Id", json!("i-builtin")), ("LogoId", json!("legacy-builtin"))])]),
            table("Logos", vec![
                stamped(PERSONAL, &[("Id", json!("legacy-fav")), ("Source", json!("shopping")), ("FileData", json!({ "__b64": b64(&[1, 2]) }))]),
                stamped(PERSONAL, &[("Id", json!("legacy-builtin")), ("Kind", json!("builtin")), ("Source", json!("shopping")), ("FileData", serde_json::Value::Null)]),
            ]),
        ],
        &[],
    );
    let logos = rows_of(&out.manifests[0].manifest.tables, "Logos");
    assert_eq!(logos.len(), 2, "both kinds survive: {logos:?}");
    let kindless = find(logos, &logo_id(PERSONAL, "shopping"));
    assert_eq!(kindless["Kind"], json!("favicon"), "a kindless row derives as a favicon and is stamped with the kind it had");
    assert_eq!(find(rows_of(&out.manifests[0].manifest.tables, "Items"), "i-builtin")["LogoId"], json!(logo_id_for(PERSONAL, "builtin", "shopping")));
}

/*
 * Buckets.
 */

#[test]
fn every_manifest_gets_its_own_buckets_and_rows_route_into_them_by_stamp() {
    // A bucketed table never enters a manifest; every declared manifest gets a bucket per category, empty or not
    // (leaving one out would read as "unchanged" rather than "emptied"), and a row names the bucket it lands in.
    let tables = owner_tables_with("Settings", |settings| {
        settings.push(stamped(SHARED, &[("Key", json!("sort")), ("Value", json!("name"))]));
        settings.push(stamped("m-gone", &[("Key", json!("stale")), ("Value", json!("x"))]));
    });
    let out = canonicalize(tables, &[SHARED]);
    assert!(out.manifests.iter().all(|m| !m.manifest.tables.contains_key("Settings")));
    let keys = |manifest_id: &str| -> Vec<String> {
        let bucket = out.data_buckets.iter().find(|b| b.category == "settings" && b.manifest_id == manifest_id).unwrap_or_else(|| panic!("no settings bucket for {manifest_id}"));
        assert!(validate_data_bucket(bucket).ok);
        let mut keys: Vec<String> = bucket.tables["Settings"].iter().map(|r| r["Key"].as_str().unwrap().to_string()).collect();
        keys.sort();
        keys
    };
    assert_eq!(keys(PERSONAL), vec!["theme"]);
    assert_eq!(keys(SHARED), vec!["sort"]);
    assert!(!out.data_buckets.iter().any(|b| b.manifest_id == "m-gone"), "a row stamped for a manifest this vault no longer carries is dropped");
    assert_eq!(out.data_buckets.iter().filter(|b| b.manifest_id == SHARED && b.category == "stats").count(), 1, "an empty bucket is still declared");

    // The bucket-only push path splits a category the same way.
    let settings = |rows: Vec<CodecRecord>| -> HashMap<String, Vec<CodecRecord>> { [("Settings".to_string(), rows)].into_iter().collect() };
    let buckets = extract_buckets(
        "settings".to_string(),
        vec![PERSONAL.to_string(), SHARED.to_string()],
        settings(vec![
            stamped(&SHARED.to_uppercase(), &[("Key", json!("sort")), ("Value", json!("name"))]),
            stamped(PERSONAL, &[("Key", json!("theme")), ("Value", json!("dark"))]),
            stamped("m-gone", &[("Key", json!("locale")), ("Value", json!("nl"))]),
        ]),
    )
    .unwrap();
    assert_eq!(buckets.iter().map(|b| b.manifest_id.as_str()).collect::<Vec<_>>(), vec![PERSONAL, SHARED], "one bucket per manifest asked for, in a stable order");
    let shared = buckets.iter().find(|b| b.manifest_id == SHARED).unwrap();
    assert_eq!(shared.tables["Settings"][0]["ManifestId"], json!(SHARED), "a casing difference is normalized to the declared id");
    assert_eq!(buckets[0].tables["Settings"].len(), 1, "the row for a lost manifest is dropped, not re-homed");
    let empty = extract_buckets("settings".to_string(), vec![PERSONAL.to_string()], settings(vec![])).unwrap();
    assert!(empty.len() == 1 && empty[0].tables["Settings"].is_empty(), "a manifest holding nothing still declares the emptied table");
    let unstamped = extract_buckets("settings".to_string(), vec![PERSONAL.to_string()], settings(vec![row(&[("Key", json!("k"))])])).unwrap_err().to_string();
    assert!(unstamped.contains("name no manifest"), "{unstamped}");
}

#[test]
fn a_bucket_claims_the_manifest_that_delivered_it() {
    // The mirror rule of "the shipping manifest is the membership": a bucket arrives under one manifest, so its rows
    // claim that manifest, and two manifests holding the same setting key are two rows.
    let out = canonicalize_owner();
    let personal_bucket = out.data_buckets.iter().find(|b| b.category == "settings" && b.manifest_id == PERSONAL).unwrap().clone();
    let mut relabelled = personal_bucket.clone();
    relabelled.manifest_id = SHARED.to_string();

    let re = materialize_as_sqlite(materialize_input(manifests_of(&out), vec![personal_bucket, relabelled])).unwrap();
    let map = materialized_map(&re);
    let mut manifest_ids: Vec<&str> = map["Settings"].iter().filter_map(|r| r["ManifestId"].as_str()).collect();
    manifest_ids.sort();
    assert_eq!(manifest_ids, vec![PERSONAL, SHARED], "the delivering manifest decides the manifest id, not the row's own claim");

    let mut unaddressed = out.data_buckets[0].clone();
    unaddressed.manifest_id = String::new();
    assert!(validate_data_bucket(&unaddressed).failed_rules.contains(&"dataBucket-manifestId-missing".to_string()));
    let mut cross_stamped = out.data_buckets.iter().find(|b| b.manifest_id == PERSONAL).unwrap().clone();
    cross_stamped.manifest_id = SHARED.to_string();
    assert!(validate_data_bucket(&cross_stamped).failed_rules.contains(&"dataBucket-manifest-mismatch".to_string()));
}

/*
 * Materialize: combining.
 */

#[test]
fn an_owners_split_combines_back_to_the_original_vault_and_stays_stable() {
    let out = canonicalize_owner();
    let re = materialize_as_sqlite(materialize_input(manifests_of(&out), out.data_buckets.clone())).unwrap();
    let map = materialized_map(&re);

    assert_eq!(ids(&map["Items"]), vec!["i-nofolder", "i-personal", "i-shared", "i-sub"]);
    assert_eq!(ids(&map["Folders"]), vec!["f-personal", "f-shared", "f-sub"]);
    assert_eq!(values(&map["FieldValues"]), vec!["family", "hunter2", "me"]);
    assert_eq!(ids(&map["Attachments"]), vec!["att-personal", "att-shared"]);
    assert_eq!(ids(&map["TotpCodes"]), vec!["totp-shared"]);
    assert_eq!(map["ItemTags"].len(), 3);
    // Tags and definitions exist once in each manifest that uses them, side by side under `(ManifestId, Id)`.
    assert_eq!(ids(&map["Tags"]), vec!["tag-both", "tag-both", "tag-shared-only", "tag-shared-only", "tag-unused"]);
    assert_eq!(ids(&map["FieldDefinitions"]), vec!["fd-1", "fd-1", "fd-unused"]);
    // Logos do not collapse back to one row per domain: three rows, netflix.com only in the shared manifest.
    assert_eq!(map["Logos"].len(), 3);
    assert_eq!(map["EncryptionKeys"].len(), 1);
    assert_eq!(map["Settings"].len(), 1);
    // The bookkeeping rows record every manifest alike, in input order, without a claim about which one is whose.
    assert_eq!(map["Manifests"].iter().map(|r| r["Id"].as_str().unwrap()).collect::<Vec<_>>(), vec![PERSONAL, SHARED]);
    assert!(map["Manifests"].iter().all(|r| !r.contains_key("IsPersonal")));

    // Split -> combine -> split again reproduces the same manifests (no oscillation).
    let second = canonicalize(re.tables.iter().map(|t| table(&t.name, t.records.clone())).collect(), &[SHARED]);
    for name in ["Folders", "Items", "FieldValues", "Attachments", "TotpCodes", "ItemTags", "Tags", "FieldDefinitions", "Logos"] {
        for id in [PERSONAL, SHARED] {
            assert_eq!(ids(rows_of(&manifest(&second, id).manifest.tables, name)), ids(rows_of(&manifest(&out, id).manifest.tables, name)), "{id} {name} drifted");
        }
    }
}

/// A recipient's own vault (no knowledge of the share) canonicalized to a personal manifest.
fn recipient_personal_manifest() -> (Manifest, Vec<DataBucket>) {
    let out = canonicalize(
        vec![
            table("Folders", vec![stamped(PERSONAL, &[("Id", json!("f-mine")), ("ParentFolderId", serde_json::Value::Null)])]),
            table("Items", vec![stamped(PERSONAL, &[("Id", json!("i-mine")), ("FolderId", json!("f-mine")), ("LogoId", json!("logo-mine"))])]),
            table("Logos", vec![stamped(PERSONAL, &[("Id", json!("logo-mine")), ("Source", json!("netflix.com")), ("FileData", json!({ "__b64": b64(&[0x11]) }))])]),
            table("EncryptionKeys", vec![stamped(PERSONAL, &[("Id", json!("ek-r")), ("PublicKey", json!("pub-r")), ("PrivateKey", json!("priv-r")), ("IsPrimary", json!(1))])]),
        ],
        &[],
    );
    (out.manifests[0].manifest.clone(), out.data_buckets.clone())
}

/// Rebind every `{ "__blobRef": hash }` cell to inline bytes, as the platform inserts them into SQLite.
fn rebind_blobs(tables: &mut [CodecTableData], blobs: &HashMap<String, BlobEntry>) {
    for record in tables.iter_mut().flat_map(|t| t.records.iter_mut()) {
        let refs: Vec<(String, String)> = record.iter().filter_map(|(col, value)| Some((col.clone(), value.get("__blobRef")?.as_str()?.to_string()))).collect();
        for (col, hash) in refs {
            record.insert(col, json!({ "__b64": blobs.get(&hash).map(|b| b.bytes_base64.clone()).unwrap_or_default() }));
        }
    }
}

/// The member's SQLite after pulling the owner's share, blob bytes bound.
fn member_tables_after_pull(owner: &CanonicalizedVault) -> Vec<CodecTableData> {
    let (recipient_manifest, buckets) = recipient_personal_manifest();
    let re = materialize_as_sqlite(materialize_input(vec![recipient_manifest, manifest(owner, SHARED).manifest.clone()], buckets)).unwrap();
    let mut tables: Vec<CodecTableData> = re.tables.iter().map(|t| table(&t.name, t.records.clone())).collect();
    let mut all_blobs = manifest(owner, PERSONAL).blobs.clone();
    all_blobs.extend(manifest(owner, SHARED).blobs.clone());
    rebind_blobs(&mut tables, &all_blobs);
    tables
}

#[test]
fn a_recipient_combines_the_share_into_their_vault_and_pushes_it_back_unchanged() {
    let owner = canonicalize_owner();
    let (recipient_manifest, buckets) = recipient_personal_manifest();
    let re = materialize_as_sqlite(materialize_input(vec![recipient_manifest, manifest(&owner, SHARED).manifest.clone()], buckets)).unwrap();
    let map = materialized_map(&re);

    // Their own rows plus the shared tree; the owner's and the recipient's netflix.com logos both survive, in their own manifests.
    assert_eq!(ids(&map["Folders"]), vec!["f-mine", "f-shared", "f-sub"]);
    assert_eq!(ids(&map["Items"]), vec!["i-mine", "i-shared", "i-sub"]);
    assert_eq!(values(&map["FieldValues"]), vec!["family", "hunter2"]);
    let netflix_manifests: HashSet<&str> = map["Logos"].iter().filter(|r| r["Source"] == json!("netflix.com")).map(|r| r["ManifestId"].as_str().unwrap()).collect();
    assert_eq!(netflix_manifests, HashSet::from([PERSONAL, SHARED]));
    assert_eq!(find(&map["Items"], "i-mine")["LogoId"], json!(logo_id(PERSONAL, "netflix.com")), "the recipient's item still points at their own row");
    let logo_ids: HashSet<&str> = map["Logos"].iter().map(|r| r["Id"].as_str().unwrap()).collect();
    assert!(map["Items"].iter().filter_map(|i| i["LogoId"].as_str()).all(|id| logo_ids.contains(id)), "every reference resolves");
    assert_eq!(ids(&map["EncryptionKeys"]), vec!["ek-r"], "only the recipient's own key material is present");

    // Pushing back: the shared manifest is reproduced, nothing leaks into the personal one, and the member's own
    // netflix row never bleeds into the share (which would rewrite a manifest they merely participate in).
    let pushed = canonicalize(re.tables.iter().map(|t| table(&t.name, t.records.clone())).collect(), &[SHARED]);
    let shared = &manifest(&pushed, SHARED).manifest;
    let personal = &manifest(&pushed, PERSONAL).manifest;
    assert_eq!(ids(rows_of(&shared.tables, "Items")), vec!["i-shared", "i-sub"]);
    assert_eq!(ids(rows_of(&shared.tables, "Tags")), vec!["tag-both", "tag-shared-only"]);
    assert_eq!(ids(rows_of(&personal.tables, "Items")), vec!["i-mine"]);
    assert!(rows_of(&personal.tables, "FieldValues").is_empty() && rows_of(&personal.tables, "Tags").is_empty());
    assert_eq!(ids(rows_of(&shared.tables, "Logos")), ids(rows_of(&manifest(&owner, SHARED).manifest.tables, "Logos")));
    assert_ne!(logo_row(personal, "netflix.com")["Id"], logo_row(shared, "netflix.com")["Id"]);
}

#[test]
fn a_members_push_keeps_the_shared_logo_and_its_bytes() {
    // The member edits a shared item. FaviconService only ever looks up personal-manifest rows, so the item ends up
    // pointing at a fresh personal row: the push folds it back onto the share's own row, bytes included, also when the
    // member's copy of the shared row is empty because its blob never arrived.
    let owner = canonicalize_owner();
    for shared_row_empty in [false, true] {
        let mut tables = member_tables_after_pull(&owner);
        let personal_id = logo_id(PERSONAL, "github.com");
        if shared_row_empty {
            find_mut(&mut tables, "Logos", &logo_id(SHARED, "github.com")).insert("FileData".to_string(), serde_json::Value::Null);
        }
        tables.iter_mut().find(|t| t.name == "Logos").unwrap().records.push(stamped(PERSONAL, &[("Id", json!(personal_id)), ("Source", json!("github.com")), ("FileData", json!({ "__b64": b64(&[0x77, 0x88]) }))]));
        find_mut(&mut tables, "Items", "i-shared").insert("LogoId".to_string(), json!(personal_id));

        let pushed = canonicalize(tables, &[SHARED]);
        let shared = manifest(&pushed, SHARED);
        let logo = logo_row(&shared.manifest, "github.com");
        let blob_ref = logo["FileData"]["__blobRef"].as_str().unwrap_or_else(|| panic!("shared row empty {shared_row_empty}: the pushed folder logo must still carry bytes, got {:?}", logo["FileData"]));
        assert!(shared.blobs.contains_key(blob_ref), "and registers them so the write keeps a live blob reference");
        if !shared_row_empty {
            assert_eq!(shared.blobs[blob_ref].bytes_base64, b64(&[0xAA, 0xBB]), "the folder keeps the logo its members agreed on");
        }
        assert_eq!(find(rows_of(&shared.manifest.tables, "Items"), "i-shared")["LogoId"], logo["Id"], "the item was folded back onto the folder's row");
    }
}

#[test]
fn combine_scopes_a_manifest_written_before_scoping_into_its_own_namespace() {
    // Rows with random logo ids and no stamps: combine stamps them with the manifest they arrived in and re-derives
    // their ids, so they land in their own uniqueness bucket next to the recipient's rows.
    let (recipient_manifest, buckets) = recipient_personal_manifest();
    let legacy_shared = Manifest {
        schema_version: SCHEMA_VERSION,
        manifest_salt: SALT_SHARED.to_string(),
        canonicalized_at: "2026-01-01T00:00:00.000Z".to_string(),
        manifest_id: "m-legacy".to_string(),
        name: Some("Legacy share".to_string()),
        tables: HashMap::from([
            ("Folders".to_string(), vec![row(&[("Id", json!("f-legacy")), ("ParentFolderId", serde_json::Value::Null)])]),
            ("Items".to_string(), vec![row(&[("Id", json!("i-legacy")), ("FolderId", json!("f-legacy")), ("LogoId", json!("their-random-id"))])]),
            ("Logos".to_string(), vec![row(&[("Id", json!("their-random-id")), ("Source", json!("netflix.com")), ("FileData", json!({ "__b64": b64(&[0x99]) }))])]),
        ]),
        extra: HashMap::new(),
    };
    let re = materialize_as_sqlite(materialize_input(vec![recipient_manifest, legacy_shared], buckets)).unwrap();
    let map = materialized_map(&re);
    let stamped: HashSet<(&str, &str)> = map["Logos"].iter().map(|r| (r["ManifestId"].as_str().unwrap(), r["Source"].as_str().unwrap())).collect();
    assert_eq!(stamped, HashSet::from([(PERSONAL, "netflix.com"), ("m-legacy", "netflix.com")]));
    assert_eq!(find(&map["Items"], "i-legacy")["LogoId"], json!(logo_id("m-legacy", "netflix.com")));
}

#[test]
fn combine_overflows_what_the_schema_lacks_on_a_shared_manifest_too() {
    // An older reader of a newer writer's share: an unknown column or table on its rows is kept in the overflow.
    let (recipient, buckets) = recipient_personal_manifest();
    let mut shared = manifest(&canonicalize_owner(), SHARED).manifest.clone();
    find_mut_in(&mut shared, "Items", "i-shared").insert("FutureCol".to_string(), json!("v"));
    shared.tables.insert("Widgets".to_string(), vec![row(&[("Id", json!("w-1"))])]);
    let mut input = materialize_input(vec![recipient, shared], buckets);
    input.schema_columns.get_mut("Items").unwrap().retain(|c| c != "FutureCol");
    input.schema_columns.remove("Widgets");
    let re = materialize_as_sqlite(input).unwrap();
    assert!(materialized_map(&re)["Items"].iter().all(|r| !r.contains_key("FutureCol")));
    assert_eq!(re.overflow.columns["Items"][&format!("{SHARED}\u{1f}i-shared")]["FutureCol"], json!("v"));
    assert_eq!(re.overflow.tables["Widgets"][0]["ManifestId"], json!(SHARED));
}

#[test]
fn combine_keeps_same_id_rows_of_two_manifests_apart() {
    // Ids are client-generated, so a shared manifest may carry a row whose Id equals one of the reader's own. Rows
    // are keyed by `(ManifestId, Id)`, so both survive in their own namespace and neither shadows the other.
    let mut personal = canonicalize(vec![table("Items", vec![stamped(PERSONAL, &[("Id", json!("i-dup")), ("Name", json!("personal-version"))])]), table("Tags", vec![stamped(PERSONAL, &[("Id", json!("t-1")), ("Name", json!("base-copy"))])])], &[]).manifests.remove(0).manifest;
    personal.tables.insert("Folders".to_string(), vec![]);
    let mut shared = personal.clone();
    shared.manifest_id = "m-x".to_string();
    shared.tables.insert("Items".to_string(), vec![row(&[("Id", json!("i-dup")), ("Name", json!("shared-version"))])]);
    shared.tables.insert("Tags".to_string(), vec![row(&[("Id", json!("t-1")), ("Name", json!("shared-copy"))])]);

    let map = materialized_map(&materialize_as_sqlite(materialize_input(vec![personal, shared], vec![])).unwrap());
    let by_manifest = |table: &str| -> HashSet<(String, String)> { map[table].iter().map(|r| (r["ManifestId"].as_str().unwrap().to_string(), r["Name"].as_str().unwrap().to_string())).collect() };
    assert_eq!(by_manifest("Items"), HashSet::from([(PERSONAL.to_string(), "personal-version".to_string()), ("m-x".to_string(), "shared-version".to_string())]));
    assert_eq!(by_manifest("Tags"), HashSet::from([(PERSONAL.to_string(), "base-copy".to_string()), ("m-x".to_string(), "shared-copy".to_string())]));
}

#[test]
fn combine_never_lets_a_manifest_reach_into_another_namespace() {
    // A manifest may only describe its own rows. One carrying a FieldValue for an item in the reader's personal
    // manifest, rows stamped for a manifest it cannot write, or key material, settings and bookkeeping tables it has
    // no business carrying is either stale or hand-crafted; none of it crosses over.
    let mut personal = canonicalize(
        vec![
            table("Items", vec![stamped(PERSONAL, &[("Id", json!("i-mine")), ("Name", json!("mine"))])]),
            table("FieldValues", vec![stamped(PERSONAL, &[("Id", json!("fv-mine")), ("ItemId", json!("i-mine")), ("FieldKey", json!("username")), ("Value", json!("me"))])]),
            table("EncryptionKeys", vec![stamped(PERSONAL, &[("Id", json!("ek-r")), ("PublicKey", json!("pub-r")), ("PrivateKey", json!("priv-r")), ("IsPrimary", json!(1))])]),
        ],
        &[],
    )
    .manifests
    .remove(0)
    .manifest;
    personal.tables.insert("Folders".to_string(), vec![]);

    let mut victim = personal.clone();
    victim.manifest_id = "m-victim".to_string();
    victim.tables.insert("Items".to_string(), vec![row(&[("Id", json!("i-victim")), ("Name", json!("theirs"))])]);
    victim.tables.insert("FieldValues".to_string(), vec![]);
    victim.tables.remove("EncryptionKeys");

    let mut hostile = victim.clone();
    hostile.manifest_id = "m-hostile".to_string();
    hostile.tables.insert("Items".to_string(), vec![stamped("m-victim", &[("Id", json!("i-planted")), ("Name", json!("planted"))]), stamped("m-victim", &[("Id", json!("i-victim")), ("Name", json!("overwritten"))])]);
    hostile.tables.insert("FieldValues".to_string(), vec![row(&[("Id", json!("fv-injected")), ("ItemId", json!("i-mine")), ("FieldKey", json!("password")), ("Value", json!("stolen"))])]);
    hostile.tables.insert("Tags".to_string(), vec![stamped(PERSONAL, &[("Id", json!("t-planted")), ("Name", json!("planted"))])]);
    hostile.tables.insert("EncryptionKeys".to_string(), vec![row(&[("Id", json!("ek-evil")), ("PrivateKey", json!("stolen"))])]);
    hostile.tables.insert("Settings".to_string(), vec![row(&[("Key", json!("theme")), ("Value", json!("evil"))])]);
    hostile.tables.insert(OVERFLOW_TABLE.to_string(), vec![row(&[("Id", json!("x")), ("Data", json!("{}"))])]);

    let map = materialized_map(&materialize_as_sqlite(materialize_input(vec![personal, victim, hostile], vec![])).unwrap());
    assert_eq!(values(&map["FieldValues"]), vec!["me"], "the foreign row never reaches the reader's item");
    let in_victim: Vec<&str> = map["Items"].iter().filter(|r| r["ManifestId"] == json!("m-victim")).map(|r| r["Name"].as_str().unwrap()).collect();
    assert_eq!(in_victim, vec!["theirs"], "the victim manifest holds only its own item, not overwritten");
    assert!(["i-planted", "i-victim"].iter().all(|id| map["Items"].iter().any(|r| r["Id"] == json!(id) && r["ManifestId"] == json!("m-hostile"))), "rows stay in the manifest they arrived in");
    assert!(map["Tags"].iter().all(|r| r["ManifestId"] == json!("m-hostile")));
    assert_eq!(ids(&map["EncryptionKeys"]), vec!["ek-r"], "injected key row dropped");
    assert!(!map.contains_key("Settings") && !map.contains_key(OVERFLOW_TABLE), "injected settings and overflow carrier dropped");
}

#[test]
fn combine_repairs_references_that_resolve_only_in_another_manifest() {
    // Folder ids are per manifest: a folder with the right Id in the wrong namespace is not this item's folder, and
    // a parent written before parent normalization may point outside every manifest this user holds.
    let (mut recipient, buckets) = recipient_personal_manifest();
    recipient.tables.get_mut("Items").unwrap()[0].insert("FolderId".to_string(), json!("f-shared"));
    let mut shared = manifest(&canonicalize_owner(), SHARED).manifest.clone();
    find_mut_in(&mut shared, "Folders", "f-shared").insert("ParentFolderId".to_string(), json!("f-owner-personal-folder"));

    let map = materialized_map(&materialize_as_sqlite(materialize_input(vec![recipient, shared], buckets)).unwrap());
    assert_eq!(find(&map["Items"], "i-mine")["FolderId"], serde_json::Value::Null);
    assert_eq!(find(&map["Folders"], "f-shared")["ParentFolderId"], serde_json::Value::Null);
    assert_eq!(find(&map["Folders"], "f-sub")["ParentFolderId"], json!("f-shared"), "intact parents are untouched");
}

/*
 * Delivery keypairs (manifest-stamped `EncryptionKeys` rows). One table serves every manifest: a personal key must
 * never travel INTO a shared manifest, and a shared manifest's key must never travel OUT of its own. Both are
 * attacks a co-owner can attempt by writing rows into a manifest the victim materializes.
 */

fn keypair(id: &str, manifest_id: &str, public_key: &str, is_primary: i32) -> CodecRecord {
    stamped(manifest_id, &[("Id", json!(id)), ("PublicKey", json!(public_key)), ("PrivateKey", json!(format!("priv-{}", public_key))), ("IsPrimary", json!(is_primary))])
}

fn owner_tables_with_keys(keys: Vec<CodecRecord>) -> Vec<CodecTableData> {
    owner_tables_with("EncryptionKeys", |rows| rows.extend(keys))
}

#[test]
fn a_keypair_travels_only_inside_the_manifest_its_stamp_names() {
    // A key stamped for a manifest not in this push (revoked, deleted, fabricated) has nowhere to go: dropped, never
    // demoted into the personal manifest, where it would resurrect on a re-share and escape revocation. The same
    // holds in the unshare window, when nothing is shared any more.
    let keys = vec![keypair("sfk-live", SHARED, "pub-folder", 1), keypair("sfk-orphan", "m-dead", "pub-orphan", 1)];
    let out = canonicalize(owner_tables_with_keys(keys.clone()), &[SHARED]);
    assert_eq!(ids(rows_of(&manifest(&out, SHARED).manifest.tables, "EncryptionKeys")), vec!["sfk-live"]);
    assert_eq!(ids(rows_of(&manifest(&out, PERSONAL).manifest.tables, "EncryptionKeys")), vec!["ek-1"], "the personal manifest keeps exactly its personal keys");

    let out = canonicalize(owner_tables_with_keys(keys), &[]);
    assert_eq!(ids(rows_of(&out.manifests[0].manifest.tables, "EncryptionKeys")), vec!["ek-1"], "stale shared keypairs dropped from the personal manifest");

    // Pinned: the keypair table travels inside its manifest, so it is neither personal-only nor bucketed; Settings is bucketed and not personal.
    assert!(!is_personal_table("EncryptionKeys") && !is_bucketed_table("EncryptionKeys"));
    assert!(is_bucketed_table("Settings") && !is_personal_table("Settings"));
}

#[test]
fn combine_accepts_a_manifests_own_keypair_and_drops_every_other_claim() {
    // A recipient materializes the share's keypair to decrypt mail to the share's aliases. A keypair claiming to be
    // another manifest's (Mallory co-owns A and writes B's key into A), or a shared key carried by a personal manifest,
    // is dropped rather than restamped: stamping it would merely turn the attack into displacing the real key.
    let owner = canonicalize(owner_tables_with_keys(vec![keypair("sfk-1", SHARED, "pub-folder", 1)]), &[SHARED]);
    let mut evil = manifest(&owner, SHARED).manifest.clone();
    evil.tables.get_mut("EncryptionKeys").unwrap().push(keypair("sfk-evil", "m-other", "pub-mallory", 1));
    let (mut recipient, buckets) = recipient_personal_manifest();
    recipient.tables.get_mut("EncryptionKeys").unwrap().push(keypair("sfk-orphan", "f-whatever", "pub-x", 1));

    let map = materialized_map(&materialize_as_sqlite(materialize_input(vec![recipient, evil], buckets)).unwrap());
    assert_eq!(ids(&map["EncryptionKeys"]), vec!["ek-r", "sfk-1"]);
    assert_eq!(find(&map["EncryptionKeys"], "sfk-1")["PrivateKey"], json!("priv-pub-folder"));
    assert!(!map["EncryptionKeys"].iter().any(|r| r["PublicKey"] == json!("pub-mallory")), "the injected key survives under no manifest");

    // And the owner's own round trip keeps both keypairs.
    let re = materialize_as_sqlite(materialize_input(manifests_of(&owner), owner.data_buckets.clone())).unwrap();
    assert_eq!(ids(&materialized_map(&re)["EncryptionKeys"]), vec!["ek-1", "sfk-1"]);
}

#[test]
fn a_keypair_resolves_by_public_key_within_its_manifest_only() {
    // After a rotation the superseded row stays so older mail remains decryptable; only the live primary is the
    // delivery key. A caller that skips combine must still not be handed another manifest's key material.
    let out = canonicalize(owner_tables_with_keys(vec![keypair("sfk-old", SHARED, "pub-old", 0), keypair("sfk-cur", SHARED, "pub-cur", 1)]), &[SHARED]);
    let mut shared = manifest(&out, SHARED).manifest.clone();
    assert_eq!(extract_encryption_key_for_public_key(&shared, "pub-old").unwrap()["PrivateKey"], json!("priv-pub-old"), "a rotated key still resolves");
    assert_eq!(extract_encryption_key_for_public_key(&shared, "pub-cur").unwrap()["Id"], json!("sfk-cur"));
    assert!(extract_encryption_key_for_public_key(&shared, "pub-nonexistent").is_none());

    shared.tables.get_mut("EncryptionKeys").unwrap().push(keypair("sfk-foreign", "m-other", "pub-foreign", 1));
    let mut deleted = keypair("sfk-dead", SHARED, "pub-dead", 0);
    deleted.insert("IsDeleted".to_string(), json!(1));
    shared.tables.get_mut("EncryptionKeys").unwrap().push(deleted);
    assert!(extract_encryption_key_for_public_key(&shared, "pub-foreign").is_none(), "another manifest's row ignored");
    assert!(extract_encryption_key_for_public_key(&shared, "pub-dead").is_none(), "deleted row ignored");
}

#[test]
fn validation_refuses_a_manifest_carrying_what_is_not_its_own() {
    // Catching this at validate time means a tampered vault fails loudly on push instead of quietly losing rows at
    // each recipient's combine step.
    let out = canonicalize(owner_tables_with_keys(vec![keypair("sfk-1", SHARED, "pub-folder", 1)]), &[SHARED]);
    assert!(validate_manifest(&manifest(&out, PERSONAL).manifest).ok && validate_manifest(&manifest(&out, SHARED).manifest).ok);

    let mut personal = manifest(&out, PERSONAL).manifest.clone();
    personal.tables.get_mut("EncryptionKeys").unwrap().push(keypair("sfk-orphan", SHARED, "pub-x", 1));
    assert!(validate_manifest(&personal).failed_rules.contains(&"encryption-keys-manifest-mismatch".to_string()));

    let mut shared = manifest(&out, SHARED).manifest.clone();
    shared.tables.get_mut("EncryptionKeys").unwrap().push(keypair("sfk-evil", "m-other", "pub-mallory", 1));
    assert!(validate_manifest(&shared).failed_rules.contains(&"encryption-keys-manifest-mismatch".to_string()));

    // A bucketed table trips the bucketed-table rule, not the personal-table one: it belongs in the manifest's own
    // bucket, settings are not personal as such.
    let mut shared = manifest(&out, SHARED).manifest.clone();
    shared.tables.insert("Settings".to_string(), vec![row(&[("Key", json!("theme")), ("Value", json!("evil"))])]);
    let result = validate_manifest(&shared);
    assert!(result.failed_rules.contains(&"manifest-carries-bucketed-table".to_string()));
    assert!(!result.failed_rules.contains(&"manifest-carries-personal-table".to_string()));
}

#[test]
fn no_key_material_crosses_a_manifest_boundary_in_a_full_roundtrip() {
    // The delivery keypair decides who can read a manifest's alias mail, so it is the one row whose misrouting is
    // unrecoverable: the personal private key inside a shared manifest hands every member the user's own mail.
    let tables = owner_tables_with("EncryptionKeys", |keys| {
        keys.clear();
        keys.push(stamped(PERSONAL, &[("Id", json!("ek-personal")), ("PublicKey", json!("pub-personal")), ("PrivateKey", json!("priv_personal_only")), ("IsPrimary", json!(1)), ("IsDeleted", json!(0))]));
        keys.push(stamped(SHARED, &[("Id", json!("ek-shared")), ("PublicKey", json!("pub-shared")), ("PrivateKey", json!("priv_shared_only")), ("IsPrimary", json!(1)), ("IsDeleted", json!(0))]));
    });
    let out = canonicalize(tables, &[SHARED]);
    let personal = manifest(&out, PERSONAL).manifest.clone();
    let shared = manifest(&out, SHARED).manifest.clone();
    assert!(!mentions(&shared, "priv_personal_only"), "the personal private key must never be inside a manifest other people hold");
    assert!(!mentions(&personal, "priv_shared_only"), "nor the share's key inside the personal manifest");

    let map = materialized_map(&materialize_as_sqlite(materialize_input(vec![personal, shared], out.data_buckets.clone())).unwrap());
    assert_eq!(map["EncryptionKeys"].len(), 2);
    for key_row in &map["EncryptionKeys"] {
        let expected = if key_row["PrivateKey"] == json!("priv_personal_only") { PERSONAL } else { SHARED };
        assert_eq!(key_row["ManifestId"], json!(expected), "a key row materialized into the wrong manifest");
    }
}

/*
 * The same id in two manifests. A manifest is a namespace, so two of them may each hold a row with the same `Id`
 * (a member moved a shared item into their own vault, an item moved out came back through another member's push).
 * Every rule that resolves a reference therefore resolves it by `(ManifestId, Id)`; anything keyed on the bare id
 * sends rows across a manifest boundary, which for a shared manifest means handing them to other people.
 */

/// Two manifests each holding item `i-dup` with its own child rows; `personal_secret` must never appear in the share.
fn tables_with_a_duplicated_item_id() -> Vec<CodecTableData> {
    let child = |id: &str, column: &str, manifest_id: &str, value: serde_json::Value| stamped(manifest_id, &[("Id", json!(id)), ("ItemId", json!("i-dup")), (column, value)]);
    let bytes = |text: &str| json!({ "__b64": b64(text.as_bytes()) });
    vec![
        table("Folders", vec![stamped(PERSONAL, &[("Id", json!("f-personal")), ("ParentFolderId", serde_json::Value::Null)]), stamped(SHARED, &[("Id", json!("f-shared")), ("ParentFolderId", serde_json::Value::Null)])]),
        table("Items", vec![stamped(PERSONAL, &[("Id", json!("i-dup")), ("Name", json!("mine")), ("FolderId", json!("f-personal"))]), stamped(SHARED, &[("Id", json!("i-dup")), ("Name", json!("ours")), ("FolderId", json!("f-shared"))])]),
        table("FieldValues", vec![
            stamped(PERSONAL, &[("Id", json!("fv-personal")), ("ItemId", json!("i-dup")), ("FieldKey", json!("password")), ("Value", json!("personal_secret"))]),
            stamped(SHARED, &[("Id", json!("fv-shared")), ("ItemId", json!("i-dup")), ("FieldKey", json!("password")), ("Value", json!("shared_secret"))]),
        ]),
        table("TotpCodes", vec![child("totp-personal", "SecretKey", PERSONAL, bytes("personal_secret")), child("totp-shared", "SecretKey", SHARED, bytes("shared_secret"))]),
        table("Attachments", vec![child("att-personal", "Blob", PERSONAL, bytes("personal_secret"))]),
        table("Passkeys", vec![child("pk-personal", "PrivateKey", PERSONAL, json!("personal_secret"))]),
        table("FieldHistories", vec![child("fh-personal", "Value", PERSONAL, json!("personal_secret"))]),
        table("ItemTags", vec![stamped(PERSONAL, &[("ItemId", json!("i-dup")), ("TagId", json!("tag-personal"))])]),
        table("Tags", vec![stamped(PERSONAL, &[("Id", json!("tag-personal")), ("Name", json!("personal_secret"))])]),
    ]
}

#[test]
fn child_rows_never_follow_a_bare_item_id_into_another_manifest() {
    let out = canonicalize(tables_with_a_duplicated_item_id(), &[SHARED]);
    let personal = &manifest(&out, PERSONAL).manifest;
    let shared = &manifest(&out, SHARED).manifest;
    assert!(!mentions(shared, "personal_secret"), "a personal item's child rows must never follow a same-id item into a shared manifest");
    assert!(!mentions(personal, "shared_secret"), "and the share's rows stay in the share");
    assert!(mentions(personal, "personal_secret") && mentions(shared, "shared_secret"), "each keeps its own");
    for name in ["Attachments", "Passkeys", "FieldHistories", "ItemTags"] {
        assert!(rows_of(&shared.tables, name).is_empty() && rows_of(&personal.tables, name).len() == 1, "{name} of the personal item stayed with it");
    }

    // End to end: the duplicate survives a split and combine as two independent items, each with its own secrets.
    let map = materialized_map(&materialize_as_sqlite(materialize_input(manifests_of(&out), out.data_buckets.clone())).unwrap());
    let field_values: HashSet<(&str, &str)> = map["FieldValues"].iter().map(|r| (r["ManifestId"].as_str().unwrap(), r["Value"].as_str().unwrap())).collect();
    assert_eq!(field_values, HashSet::from([(PERSONAL, "personal_secret"), (SHARED, "shared_secret")]));
}

#[test]
fn children_left_unstamped_follow_their_item_only_while_that_is_unambiguous() {
    // The safety net for a client that moved an item between manifests without re-stamping its children (no
    // trigger, an older platform): while only one item carries the id, the child follows it and is re-stamped. With
    // two same-id items, a child naming neither routes by its own stamp rather than being guessed into a share.
    let mut tables = owner_tables();
    for table in tables.iter_mut().filter(|t| t.name == "FieldValues" || t.name == "TotpCodes") {
        table.records.iter_mut().for_each(|r| drop(r.insert("ManifestId".to_string(), json!(PERSONAL))));
    }
    let out = canonicalize(tables, &[SHARED]);
    let shared = &manifest(&out, SHARED).manifest;
    assert_eq!(values(rows_of(&shared.tables, "FieldValues")), vec!["family", "hunter2"], "children followed their item across the boundary");
    assert!(rows_of(&shared.tables, "FieldValues").iter().all(|r| r["ManifestId"] == json!(SHARED)), "and were re-stamped to agree with it");

    let mut tables = tables_with_a_duplicated_item_id();
    tables.push(table("FieldValues", vec![stamped("m-revoked", &[("Id", json!("fv-orphan")), ("ItemId", json!("i-dup")), ("FieldKey", json!("password")), ("Value", json!("orphan_secret"))])]));
    let out = canonicalize(tables, &[SHARED]);
    assert!(!mentions(&manifest(&out, SHARED).manifest, "orphan_secret"), "an ambiguous child is never guessed into a shared manifest");
    assert!(!mentions(&manifest(&out, PERSONAL).manifest, "orphan_secret"), "its own stamp names a lost manifest, so it is dropped");
}

/*
 * Wire format.
 */

#[test]
fn manifest_specs_deserialize_from_camel_case_json() {
    // Every manifest is described the same way on the wire (id, salt, optional name) with nothing marking one as special.
    let input_json = json!({
        "tables": [{ "name": "Items", "records": [] }],
        "canonicalizedAt": "2026-01-01T00:00:00.000Z",
        "manifests": [{ "manifestId": PERSONAL, "manifestSalt": SALT_PERSONAL }, { "manifestId": "m-1", "manifestSalt": SALT_SHARED, "name": "Team", "anchorFolderId": "f-1" }]
    })
    .to_string();
    let out_json = crate::common::error::json_call(&input_json, |input: CanonicalizeInput| canonicalize_from_sqlite(input)).unwrap();
    let value: serde_json::Value = serde_json::from_str(&out_json).unwrap();
    assert_eq!(value["manifests"][0]["manifest"]["manifestId"], json!(PERSONAL));
    assert_eq!(value["manifests"][1]["manifest"]["manifestId"], json!("m-1"));
    assert_eq!(value["manifests"][1]["manifest"]["name"], json!("Team"));
    assert!(value["manifests"].as_array().unwrap().iter().all(|m| m.get("isPersonal").is_none() && m["manifest"].get("anchorFolderId").is_none()), "nothing flags a manifest as the vault's own, and folder anchoring is never persisted");
    assert!(value["dataBuckets"].is_array() && value["manifests"][0].get("dataBuckets").is_none(), "buckets belong to the vault, beside the manifests");
}
