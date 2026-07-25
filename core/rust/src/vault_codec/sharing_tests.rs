//! Unit tests for the shared-folder split (canonicalize) and combine (materialize) logic.
//!
//! These cover the core contract of vault sharing: `canonicalize_from_sqlite` with shared-folder
//! specs pulls each shared folder's subtree into its own manifest, and `materialize_as_sqlite` with
//! shared manifests combines everything back into one unified table set — for both the owner (whose
//! local vault holds every row) and a recipient (whose root manifest knows nothing of the share).

use super::*;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::json;
use std::collections::HashMap;

const SALT_ROOT: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const SALT_SHARED: &str = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";

fn b64(bytes: &[u8]) -> String {
    BASE64.encode(bytes)
}

fn row(pairs: &[(&str, serde_json::Value)]) -> CodecRecord {
    pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
}

fn table(name: &str, records: Vec<CodecRecord>) -> CodecTableData {
    CodecTableData { name: name.to_string(), records }
}

fn spec(folder_id: &str) -> SharedFolderSpec {
    SharedFolderSpec { folder_id: folder_id.to_string(), user_salt: SALT_SHARED.to_string() }
}

fn input_with_shares(tables: Vec<CodecTableData>, shared_folders: Vec<SharedFolderSpec>) -> CanonicalizeInput {
    CanonicalizeInput {
        tables,
        user_salt: SALT_ROOT.to_string(),
        migration_id: "20250101000000_Init".to_string(),
        canonicalized_at: "2026-01-01T00:00:00.000Z".to_string(),
        shared_folders,
    }
}

/// The rows of `name` in a manifest (empty slice when the table is absent).
fn rows<'a>(m: &'a Manifest, name: &str) -> &'a [CodecRecord] {
    m.tables.get(name).map(Vec::as_slice).unwrap_or(&[])
}

fn ids(records: &[CodecRecord]) -> Vec<&str> {
    let mut out: Vec<&str> = records.iter().filter_map(|r| r.get("Id").and_then(|v| v.as_str())).collect();
    out.sort();
    out
}

/// A representative owner vault: a personal folder+item, and a shared folder "f-shared" carrying a
/// subfolder, two items (one in the subfolder), and their child rows.
fn owner_tables() -> Vec<CodecTableData> {
    vec![
        table("Folders", vec![
            row(&[("Id", json!("f-personal")), ("Name", json!("Personal")), ("ParentFolderId", serde_json::Value::Null)]),
            row(&[("Id", json!("f-shared")), ("Name", json!("Family")), ("ParentFolderId", serde_json::Value::Null)]),
            row(&[("Id", json!("f-sub")), ("Name", json!("Streaming")), ("ParentFolderId", json!("f-shared"))]),
        ]),
        table("Items", vec![
            row(&[("Id", json!("i-personal")), ("FolderId", json!("f-personal")), ("LogoId", json!("logo-both"))]),
            row(&[("Id", json!("i-shared")), ("FolderId", json!("f-shared")), ("LogoId", json!("logo-both"))]),
            row(&[("Id", json!("i-sub")), ("FolderId", json!("f-sub")), ("LogoId", json!("logo-shared-only"))]),
            row(&[("Id", json!("i-nofolder")), ("FolderId", serde_json::Value::Null), ("LogoId", serde_json::Value::Null)]),
        ]),
        table("FieldValues", vec![
            row(&[("Id", json!("fv-personal")), ("ItemId", json!("i-personal")), ("FieldDefinitionId", json!("fd-1")), ("FieldKey", json!("username")), ("Value", json!("me"))]),
            row(&[("Id", json!("fv-shared")), ("ItemId", json!("i-shared")), ("FieldDefinitionId", json!("fd-1")), ("FieldKey", json!("username")), ("Value", json!("family"))]),
            row(&[("Id", json!("fv-sub")), ("ItemId", json!("i-sub")), ("FieldDefinitionId", serde_json::Value::Null), ("FieldKey", json!("password")), ("Value", json!("hunter2"))]),
        ]),
        table("TotpCodes", vec![
            row(&[("Id", json!("totp-shared")), ("ItemId", json!("i-shared")), ("SecretKey", json!({ "__b64": b64(&[9, 9, 9]) }))]),
        ]),
        table("Attachments", vec![
            row(&[("Id", json!("att-shared")), ("ItemId", json!("i-sub")), ("Blob", json!({ "__b64": b64(&[1, 2, 3, 4]) }))]),
            row(&[("Id", json!("att-personal")), ("ItemId", json!("i-personal")), ("Blob", json!({ "__b64": b64(&[5, 6]) }))]),
        ]),
        table("Tags", vec![
            row(&[("Id", json!("tag-both")), ("Name", json!("work"))]),
            row(&[("Id", json!("tag-shared-only")), ("Name", json!("family"))]),
            row(&[("Id", json!("tag-unused")), ("Name", json!("todo"))]),
        ]),
        table("ItemTags", vec![
            row(&[("Id", json!("it-1")), ("ItemId", json!("i-personal")), ("TagId", json!("tag-both"))]),
            row(&[("Id", json!("it-2")), ("ItemId", json!("i-shared")), ("TagId", json!("tag-both"))]),
            row(&[("Id", json!("it-3")), ("ItemId", json!("i-sub")), ("TagId", json!("tag-shared-only"))]),
        ]),
        table("FieldDefinitions", vec![
            row(&[("Id", json!("fd-1")), ("Key", json!("username"))]),
            row(&[("Id", json!("fd-unused")), ("Key", json!("custom"))]),
        ]),
        table("Logos", vec![
            row(&[("Id", json!("logo-both")), ("Source", json!("github.com")), ("FileData", json!({ "__b64": b64(&[0xAA, 0xBB]) }))]),
            row(&[("Id", json!("logo-shared-only")), ("Source", json!("netflix.com")), ("FileData", json!({ "__b64": b64(&[0xCC, 0xDD]) }))]),
        ]),
        table("EncryptionKeys", vec![
            row(&[("Id", json!("ek-1")), ("PublicKey", json!("pub")), ("PrivateKey", json!("priv")), ("IsPrimary", json!(1)), ("IsDeleted", json!(0))]),
        ]),
        table("Settings", vec![
            row(&[("Key", json!("theme")), ("Value", json!("dark"))]),
        ]),
    ]
}

fn canonicalize_owner() -> CanonicalizedVault {
    canonicalize_from_sqlite(input_with_shares(owner_tables(), vec![spec("f-shared")])).unwrap()
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonicalize: splitting
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn split_moves_folder_subtree_and_items_into_shared_manifest() {
    let out = canonicalize_owner();
    assert_eq!(out.shared_vaults.len(), 1);
    let shared = &out.shared_vaults[0].manifest;

    assert_eq!(out.shared_vaults[0].folder_id, "f-shared");
    assert_eq!(shared.shared_folder_id.as_deref(), Some("f-shared"));
    assert_eq!(shared.user_salt, SALT_SHARED);

    // Folder subtree (root + subfolder) moved; personal folder stayed.
    assert_eq!(ids(rows(shared, "Folders")), vec!["f-shared", "f-sub"]);
    assert_eq!(ids(rows(&out.manifest, "Folders")), vec!["f-personal"]);

    // Items in the subtree moved (including nested subfolder items); others stayed.
    assert_eq!(ids(rows(shared, "Items")), vec!["i-shared", "i-sub"]);
    assert_eq!(ids(rows(&out.manifest, "Items")), vec!["i-nofolder", "i-personal"]);
}

#[test]
fn split_normalizes_shared_root_parent_to_null() {
    // Owner had nested the shared folder under a personal folder: the shared manifest must not leak
    // (or depend on) that personal placement.
    let mut tables = owner_tables();
    tables[0].records[1].insert("ParentFolderId".to_string(), json!("f-personal"));
    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();
    let shared_root = rows(&out.shared_vaults[0].manifest, "Folders").iter().find(|r| r["Id"] == json!("f-shared")).unwrap().clone();
    assert_eq!(shared_root["ParentFolderId"], serde_json::Value::Null);
    // The subfolder keeps its parent (it points inside the shared manifest).
    let sub = rows(&out.shared_vaults[0].manifest, "Folders").iter().find(|r| r["Id"] == json!("f-sub")).unwrap().clone();
    assert_eq!(sub["ParentFolderId"], json!("f-shared"));
}

#[test]
fn split_routes_item_scoped_tables_generically() {
    // FieldValues / TotpCodes / Attachments / ItemTags all follow their item with zero per-table wiring.
    let out = canonicalize_owner();
    let shared = &out.shared_vaults[0].manifest;

    assert_eq!(ids(rows(shared, "FieldValues")), vec!["fv-shared", "fv-sub"]);
    assert_eq!(ids(rows(&out.manifest, "FieldValues")), vec!["fv-personal"]);

    assert_eq!(ids(rows(shared, "TotpCodes")), vec!["totp-shared"]);
    assert!(rows(&out.manifest, "TotpCodes").is_empty());

    assert_eq!(ids(rows(shared, "Attachments")), vec!["att-shared"]);
    assert_eq!(ids(rows(&out.manifest, "Attachments")), vec!["att-personal"]);

    assert_eq!(ids(rows(shared, "ItemTags")), vec!["it-2", "it-3"]);
    assert_eq!(ids(rows(&out.manifest, "ItemTags")), vec!["it-1"]);
}

#[test]
fn split_copies_referenced_tags_logos_and_field_definitions() {
    let out = canonicalize_owner();
    let shared = &out.shared_vaults[0].manifest;

    // Tag referenced from both sides is copied to both; shared-only tag leaves the root; the
    // unreferenced tag stays personal.
    assert_eq!(ids(rows(shared, "Tags")), vec!["tag-both", "tag-shared-only"]);
    assert_eq!(ids(rows(&out.manifest, "Tags")), vec!["tag-both", "tag-unused"]);

    // Same rule for logos (referenced via Items.LogoId)...
    assert_eq!(ids(rows(shared, "Logos")), vec!["logo-both", "logo-shared-only"]);
    assert_eq!(ids(rows(&out.manifest, "Logos")), vec!["logo-both"]);

    // ...and field definitions (referenced via FieldValues.FieldDefinitionId).
    assert_eq!(ids(rows(shared, "FieldDefinitions")), vec!["fd-1"]);
    assert_eq!(ids(rows(&out.manifest, "FieldDefinitions")), vec!["fd-1", "fd-unused"]);
}

#[test]
fn split_hashes_blobs_with_per_manifest_salts() {
    let out = canonicalize_owner();
    let shared = &out.shared_vaults[0];

    // Root blob map: personal attachment + the logo copy referenced by the personal item.
    let root_hashes: Vec<&String> = out.blobs.keys().collect();
    assert_eq!(root_hashes.len(), 2, "root: att-personal + logo-both, got {:?}", out.blobs.values().map(|b| &b.kind).collect::<Vec<_>>());

    // Shared blob map: shared attachment + both logo copies, hashed with the SHARED salt.
    assert_eq!(shared.blobs.len(), 3);
    let logo_bytes = [0xAAu8, 0xBB];
    let expected_root_hash = hash::salted_blob_hash(&logo_bytes, SALT_ROOT);
    let expected_shared_hash = hash::salted_blob_hash(&logo_bytes, SALT_SHARED);
    assert!(out.blobs.contains_key(&expected_root_hash), "logo-both hashed with root salt in root manifest");
    assert!(shared.blobs.contains_key(&expected_shared_hash), "logo-both hashed with shared salt in shared manifest");
    assert_ne!(expected_root_hash, expected_shared_hash);

    // The blob refs inside each manifest point at their own map's hashes.
    let root_logo = rows(&out.manifest, "Logos").iter().find(|r| r["Id"] == json!("logo-both")).unwrap().clone();
    assert_eq!(root_logo["FileData"]["__blobRef"], json!(expected_root_hash));
    let shared_logo = rows(&shared.manifest, "Logos").iter().find(|r| r["Id"] == json!("logo-both")).unwrap().clone();
    assert_eq!(shared_logo["FileData"]["__blobRef"], json!(expected_shared_hash));
}

#[test]
fn split_keeps_personal_tables_out_of_shared_manifests() {
    let out = canonicalize_owner();
    let shared = &out.shared_vaults[0].manifest;
    assert!(!shared.tables.contains_key("EncryptionKeys"), "key material must never enter a shared manifest");
    assert!(!shared.tables.contains_key("Settings"), "settings are personal (and bucketed)");
    // Root keeps them in their own buckets (EncryptionKeys and Settings are both bucketed now).
    assert!(!out.manifest.tables.contains_key("EncryptionKeys"), "key material lives in its bucket, not the manifest");
    assert!(out.data_buckets.iter().any(|b| b.category == "EncryptionKeys" && !b.tables.get("EncryptionKeys").map(Vec::is_empty).unwrap_or(true)));
    assert!(out.data_buckets.iter().any(|b| b.category == "Settings" && !b.tables.is_empty()));
}

#[test]
fn split_supports_multiple_disjoint_shared_folders() {
    let tables = vec![
        table("Folders", vec![
            row(&[("Id", json!("f-a")), ("ParentFolderId", serde_json::Value::Null)]),
            row(&[("Id", json!("f-b")), ("ParentFolderId", serde_json::Value::Null)]),
        ]),
        table("Items", vec![
            row(&[("Id", json!("i-a")), ("FolderId", json!("f-a"))]),
            row(&[("Id", json!("i-b")), ("FolderId", json!("f-b"))]),
        ]),
    ];
    let mut spec_b = spec("f-b");
    spec_b.user_salt = SALT_ROOT.to_string();
    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-a"), spec_b])).unwrap();
    assert_eq!(out.shared_vaults.len(), 2);
    assert_eq!(out.shared_vaults[0].folder_id, "f-a");
    assert_eq!(out.shared_vaults[1].folder_id, "f-b");
    assert_eq!(ids(rows(&out.shared_vaults[0].manifest, "Items")), vec!["i-a"]);
    assert_eq!(ids(rows(&out.shared_vaults[1].manifest, "Items")), vec!["i-b"]);
    assert!(rows(&out.manifest, "Items").is_empty());
}

#[test]
fn split_rejects_nested_shared_folders() {
    let tables = vec![table("Folders", vec![
        row(&[("Id", json!("f-outer")), ("ParentFolderId", serde_json::Value::Null)]),
        row(&[("Id", json!("f-inner")), ("ParentFolderId", json!("f-outer"))]),
    ])];
    let err = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-outer"), spec("f-inner")])).unwrap_err();
    assert!(err.to_string().contains("nested"), "unexpected error: {err}");
}

#[test]
fn split_rejects_duplicate_shared_folder_specs() {
    let err = canonicalize_from_sqlite(input_with_shares(owner_tables(), vec![spec("f-shared"), spec("f-shared")])).unwrap_err();
    assert!(err.to_string().contains("duplicate"), "unexpected error: {err}");
}

#[test]
fn split_of_deleted_folder_yields_empty_shared_manifest() {
    // The shared folder was deleted locally: its manifest empties out (and would be pushed as such).
    let tables = vec![
        table("Folders", vec![row(&[("Id", json!("f-personal")), ("ParentFolderId", serde_json::Value::Null)])]),
        table("Items", vec![row(&[("Id", json!("i-1")), ("FolderId", json!("f-personal"))])]),
    ];
    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-gone")])).unwrap();
    assert_eq!(out.shared_vaults.len(), 1);
    assert!(rows(&out.shared_vaults[0].manifest, "Folders").is_empty());
    assert!(rows(&out.shared_vaults[0].manifest, "Items").is_empty());
    assert_eq!(ids(rows(&out.manifest, "Items")), vec!["i-1"]);
}

#[test]
fn split_includes_tombstoned_rows_in_subtree() {
    // Deleted (tombstoned) subfolders/items still sync through the shared manifest so other members
    // learn about the deletion via LWW merge.
    let tables = vec![
        table("Folders", vec![
            row(&[("Id", json!("f-shared")), ("ParentFolderId", serde_json::Value::Null), ("IsDeleted", json!(0))]),
            row(&[("Id", json!("f-sub")), ("ParentFolderId", json!("f-shared")), ("IsDeleted", json!(1))]),
        ]),
        table("Items", vec![row(&[("Id", json!("i-del")), ("FolderId", json!("f-sub")), ("IsDeleted", json!(1))])]),
    ];
    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();
    let shared = &out.shared_vaults[0].manifest;
    assert_eq!(ids(rows(shared, "Folders")), vec!["f-shared", "f-sub"]);
    assert_eq!(ids(rows(shared, "Items")), vec!["i-del"]);
}

#[test]
fn split_with_no_specs_matches_legacy_single_manifest_output() {
    let out = canonicalize_from_sqlite(input_with_shares(owner_tables(), vec![])).unwrap();
    assert!(out.shared_vaults.is_empty());
    assert_eq!(ids(rows(&out.manifest, "Items")), vec!["i-nofolder", "i-personal", "i-shared", "i-sub"]);
    // And the serialized output omits the field entirely (wire-compat with pre-sharing clients).
    let json = serde_json::to_value(&out).unwrap();
    assert!(json.get("sharedVaults").is_none());
    assert!(json["manifest"].get("sharedFolderId").is_none());
}

#[test]
fn shared_manifests_validate_clean_after_split() {
    let out = canonicalize_owner();
    let root_result = validate_manifest(&out.manifest);
    assert!(root_result.ok, "root manifest invalid: {:?}", root_result.failed_rules);
    let shared_result = validate_manifest(&out.shared_vaults[0].manifest);
    assert!(shared_result.ok, "shared manifest invalid: {:?}", shared_result.failed_rules);
}

#[test]
fn validate_rejects_shared_manifest_carrying_personal_tables() {
    let mut manifest = canonicalize_owner().shared_vaults[0].manifest.clone();
    manifest.tables.insert("EncryptionKeys".to_string(), vec![row(&[("Id", json!("ek-evil")), ("PrivateKey", json!("x"))])]);
    let result = validate_manifest(&manifest);
    assert!(!result.ok);
    assert!(result.failed_rules.iter().any(|r| r == "shared-manifest-carries-personal-table"));
}

#[test]
fn split_regrafts_overflow_columns_onto_shared_rows() {
    // A newer writer added a column to a shared item; this client's schema couldn't hold it, so it
    // rode in the overflow carrier. On push it must re-graft and travel with the row into the
    // shared manifest, not the root.
    let overflow = CodecOverflow {
        columns: [("Items".to_string(), [("i-shared".to_string(), row(&[("FutureCol", json!("keep-me"))]))].into_iter().collect())].into_iter().collect(),
        ..Default::default()
    };
    let mut tables = owner_tables();
    tables.push(table(OVERFLOW_TABLE, overflow.to_table_records()));
    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();
    let shared_item = rows(&out.shared_vaults[0].manifest, "Items").iter().find(|r| r["Id"] == json!("i-shared")).unwrap().clone();
    assert_eq!(shared_item["FutureCol"], json!("keep-me"));
    assert!(rows(&out.manifest, "Items").iter().all(|r| !r.contains_key("FutureCol")));
}

// ─────────────────────────────────────────────────────────────────────────────
// Materialize: combining
// ─────────────────────────────────────────────────────────────────────────────

/// Materialized tables as a name > rows map for easy assertions.
fn materialized_map(m: &MaterializedTables) -> HashMap<String, Vec<CodecRecord>> {
    m.tables.iter().map(|t| (t.name.clone(), t.records.clone())).collect()
}

#[test]
fn owner_split_then_combine_roundtrips_to_original_tables() {
    // The core round-trip contract: canonicalize with shares, then materialize root+shared —
    // semantically identical to the original unified vault.
    let out = canonicalize_owner();
    let re = materialize_as_sqlite(MaterializeInput {
        manifest: out.manifest.clone(),
        data_buckets: out.data_buckets.clone(),
        schema_columns: None,
        shared_manifests: out.shared_vaults.iter().map(|s| s.manifest.clone()).collect(),
    })
    .unwrap();
    let map = materialized_map(&re);

    assert_eq!(ids(&map["Items"]), vec!["i-nofolder", "i-personal", "i-shared", "i-sub"]);
    assert_eq!(ids(&map["Folders"]), vec!["f-personal", "f-shared", "f-sub"]);
    assert_eq!(ids(&map["FieldValues"]), vec!["fv-personal", "fv-shared", "fv-sub"]);
    assert_eq!(ids(&map["Attachments"]), vec!["att-personal", "att-shared"]);
    assert_eq!(ids(&map["TotpCodes"]), vec!["totp-shared"]);
    assert_eq!(ids(&map["ItemTags"]), vec!["it-1", "it-2", "it-3"]);
    // Reference-copied rows deduped back to one copy each.
    assert_eq!(ids(&map["Tags"]), vec!["tag-both", "tag-shared-only", "tag-unused"]);
    assert_eq!(ids(&map["FieldDefinitions"]), vec!["fd-1", "fd-unused"]);
    assert_eq!(map["Logos"].len(), 2, "logo copies deduped by Source");
    assert_eq!(map["EncryptionKeys"].len(), 1);
    assert_eq!(map["Settings"].len(), 1);
}

#[test]
fn owner_roundtrip_is_stable_across_a_second_split() {
    // Split -> combine -> split again must reproduce the same manifests (no oscillation).
    let first = canonicalize_owner();
    let re = materialize_as_sqlite(MaterializeInput {
        manifest: first.manifest.clone(),
        data_buckets: first.data_buckets.clone(),
        schema_columns: None,
        shared_manifests: first.shared_vaults.iter().map(|s| s.manifest.clone()).collect(),
    })
    .unwrap();

    // Simulate the platform read-back: blob refs stay as-is (the platform rebinds bytes, and a
    // re-canonicalize would read real bytes; for stability we compare table row id sets).
    let second = canonicalize_from_sqlite(input_with_shares(
        re.tables.iter().map(|t| table(&t.name, t.records.clone())).collect(),
        vec![spec("f-shared")],
    ))
    .unwrap();

    for name in ["Folders", "Items", "FieldValues", "Attachments", "TotpCodes", "ItemTags", "Tags", "FieldDefinitions", "Logos"] {
        assert_eq!(ids(rows(&second.manifest, name)), ids(rows(&first.manifest, name)), "root {name} drifted");
        assert_eq!(
            ids(rows(&second.shared_vaults[0].manifest, name)),
            ids(rows(&first.shared_vaults[0].manifest, name)),
            "shared {name} drifted"
        );
    }
}

/// A recipient's own vault (no knowledge of the share) canonicalized to a root manifest.
fn recipient_root_manifest() -> (Manifest, Vec<DataBucket>) {
    let out = canonicalize_from_sqlite(input_with_shares(
        vec![
            table("Folders", vec![row(&[("Id", json!("f-mine")), ("ParentFolderId", serde_json::Value::Null)])]),
            table("Items", vec![row(&[("Id", json!("i-mine")), ("FolderId", json!("f-mine")), ("LogoId", json!("logo-mine"))])]),
            table("Logos", vec![row(&[("Id", json!("logo-mine")), ("Source", json!("netflix.com")), ("FileData", json!({ "__b64": b64(&[0x11]) }))])]),
            table("EncryptionKeys", vec![row(&[("Id", json!("ek-r")), ("PublicKey", json!("pub-r")), ("PrivateKey", json!("priv-r")), ("IsPrimary", json!(1))])]),
        ],
        vec![],
    ))
    .unwrap();
    (out.manifest, out.data_buckets)
}

#[test]
fn recipient_combine_materializes_shared_folder_into_their_vault() {
    let owner = canonicalize_owner();
    let (recipient_manifest, buckets) = recipient_root_manifest();
    let re = materialize_as_sqlite(MaterializeInput {
        manifest: recipient_manifest,
        data_buckets: buckets,
        schema_columns: None,
        shared_manifests: vec![owner.shared_vaults[0].manifest.clone()],
    })
    .unwrap();
    let map = materialized_map(&re);

    // Recipient sees their own rows plus the shared subtree.
    assert_eq!(ids(&map["Folders"]), vec!["f-mine", "f-shared", "f-sub"]);
    assert_eq!(ids(&map["Items"]), vec!["i-mine", "i-shared", "i-sub"]);
    assert_eq!(ids(&map["FieldValues"]), vec!["fv-shared", "fv-sub"]);
    // Owner's netflix.com logo collides with the recipient's by Source: deduped to one row, and
    // every Items.LogoId resolves to a surviving logo.
    let sources: Vec<&str> = map["Logos"].iter().filter_map(|r| r.get("Source").and_then(|v| v.as_str())).collect();
    assert_eq!(sources.iter().filter(|s| **s == "netflix.com").count(), 1);
    let logo_ids: std::collections::HashSet<&str> = map["Logos"].iter().filter_map(|r| r.get("Id").and_then(|v| v.as_str())).collect();
    for item in &map["Items"] {
        if let Some(logo_id) = item.get("LogoId").and_then(|v| v.as_str()) {
            assert!(logo_ids.contains(logo_id), "Item {:?} points at missing logo {logo_id}", item.get("Id"));
        }
    }
    // Only the recipient's own key material is present.
    assert_eq!(ids(&map["EncryptionKeys"]), vec!["ek-r"]);
}

#[test]
fn recipient_roundtrip_reproduces_shared_manifest_without_leaking_into_root() {
    // Recipient pulls (combine), then pushes (split): the shared manifest must contain exactly the
    // shared rows, and none of them may leak into the recipient's root manifest.
    let owner = canonicalize_owner();
    let (recipient_manifest, buckets) = recipient_root_manifest();
    let re = materialize_as_sqlite(MaterializeInput {
        manifest: recipient_manifest,
        data_buckets: buckets,
        schema_columns: None,
        shared_manifests: vec![owner.shared_vaults[0].manifest.clone()],
    })
    .unwrap();

    let pushed = canonicalize_from_sqlite(input_with_shares(
        re.tables.iter().map(|t| table(&t.name, t.records.clone())).collect(),
        vec![spec("f-shared")],
    ))
    .unwrap();

    // Shared manifest reproduced.
    let shared = &pushed.shared_vaults[0].manifest;
    assert_eq!(ids(rows(shared, "Items")), vec!["i-shared", "i-sub"]);
    assert_eq!(ids(rows(shared, "Folders")), vec!["f-shared", "f-sub"]);
    assert_eq!(ids(rows(shared, "FieldValues")), vec!["fv-shared", "fv-sub"]);
    assert_eq!(ids(rows(shared, "Tags")), vec!["tag-both", "tag-shared-only"]);

    // Recipient's root holds only their own rows — no shared items/folders leaked in.
    assert_eq!(ids(rows(&pushed.manifest, "Items")), vec!["i-mine"]);
    assert_eq!(ids(rows(&pushed.manifest, "Folders")), vec!["f-mine"]);
    assert!(rows(&pushed.manifest, "FieldValues").is_empty());
    // Owner's tags are referenced only by shared items, so they stay out of the recipient's root.
    assert!(rows(&pushed.manifest, "Tags").is_empty());
}

#[test]
fn combine_root_wins_on_primary_key_collision() {
    let mut root = canonicalize_from_sqlite(input_with_shares(
        vec![table("Items", vec![row(&[("Id", json!("i-dup")), ("Name", json!("root-version")), ("FolderId", serde_json::Value::Null)])])],
        vec![],
    ))
    .unwrap()
    .manifest;
    root.tables.insert("Folders".to_string(), vec![]);

    let mut shared = root.clone();
    shared.shared_folder_id = Some("f-x".to_string());
    shared.tables.insert("Items".to_string(), vec![row(&[("Id", json!("i-dup")), ("Name", json!("shared-version")), ("FolderId", serde_json::Value::Null)])]);

    let re = materialize_as_sqlite(MaterializeInput { manifest: root, data_buckets: vec![], schema_columns: None, shared_manifests: vec![shared] }).unwrap();
    let map = materialized_map(&re);
    assert_eq!(map["Items"].len(), 1);
    assert_eq!(map["Items"][0]["Name"], json!("root-version"));
}

#[test]
fn combine_strips_personal_and_bookkeeping_tables_from_shared_manifests() {
    // A malicious/buggy shared manifest tries to inject key material, settings, and an overflow
    // carrier into the recipient's vault: all must be dropped.
    let owner = canonicalize_owner();
    let mut evil = owner.shared_vaults[0].manifest.clone();
    evil.tables.insert("EncryptionKeys".to_string(), vec![row(&[("Id", json!("ek-evil")), ("PrivateKey", json!("stolen"))])]);
    evil.tables.insert("Settings".to_string(), vec![row(&[("Key", json!("theme")), ("Value", json!("evil"))])]);
    evil.tables.insert(OVERFLOW_TABLE.to_string(), vec![row(&[("Id", json!("x")), ("Data", json!("{}"))])]);

    let (recipient_manifest, buckets) = recipient_root_manifest();
    let re = materialize_as_sqlite(MaterializeInput { manifest: recipient_manifest, data_buckets: buckets, schema_columns: None, shared_manifests: vec![evil] }).unwrap();
    let map = materialized_map(&re);
    assert_eq!(ids(&map["EncryptionKeys"]), vec!["ek-r"], "injected key row dropped");
    assert!(!map.contains_key("Settings"), "injected settings dropped");
    assert!(!map.contains_key(OVERFLOW_TABLE), "injected overflow carrier dropped");
}

#[test]
fn combine_nulls_dangling_parent_folder_references() {
    // A shared manifest written before parent normalization (or with a partial grant set) may carry
    // a ParentFolderId pointing outside every manifest this user holds: null it so FK checks pass.
    let mut shared = canonicalize_owner().shared_vaults[0].manifest.clone();
    for folder in shared.tables.get_mut("Folders").unwrap() {
        if folder["Id"] == json!("f-shared") {
            folder.insert("ParentFolderId".to_string(), json!("f-owner-personal-folder"));
        }
    }
    let (recipient_manifest, buckets) = recipient_root_manifest();
    let re = materialize_as_sqlite(MaterializeInput { manifest: recipient_manifest, data_buckets: buckets, schema_columns: None, shared_manifests: vec![shared] }).unwrap();
    let map = materialized_map(&re);
    let shared_root = map["Folders"].iter().find(|r| r["Id"] == json!("f-shared")).unwrap();
    assert_eq!(shared_root["ParentFolderId"], serde_json::Value::Null);
    // Intact parents are untouched.
    let sub = map["Folders"].iter().find(|r| r["Id"] == json!("f-sub")).unwrap();
    assert_eq!(sub["ParentFolderId"], json!("f-shared"));
}

#[test]
fn combine_applies_schema_overflow_to_shared_rows_too() {
    // An old client materializing a share written by a newer client: unknown columns on shared rows
    // must land in overflow, not crash the insert.
    let mut shared = canonicalize_owner().shared_vaults[0].manifest.clone();
    shared.tables.get_mut("Items").unwrap()[0].insert("FutureCol".to_string(), json!("v"));

    let schema: HashMap<String, Vec<String>> = [
        ("Items".to_string(), vec!["Id".to_string(), "FolderId".to_string(), "LogoId".to_string()]),
        ("Folders".to_string(), vec!["Id".to_string(), "Name".to_string(), "ParentFolderId".to_string()]),
        (OVERFLOW_TABLE.to_string(), vec!["Id".to_string(), "Data".to_string()]),
    ]
    .into_iter()
    .collect();

    let (recipient_manifest, buckets) = recipient_root_manifest();
    let re = materialize_as_sqlite(MaterializeInput { manifest: recipient_manifest, data_buckets: buckets, schema_columns: Some(schema), shared_manifests: vec![shared] }).unwrap();
    let map = materialized_map(&re);
    assert!(map["Items"].iter().all(|r| !r.contains_key("FutureCol")));
    let overflowed: Vec<&String> = re.overflow.columns.get("Items").map(|m| m.keys().collect()).unwrap_or_default();
    assert!(!overflowed.is_empty(), "unknown shared column stashed in overflow");
}

#[test]
fn combine_with_no_shared_manifests_is_unchanged_legacy_behavior() {
    let out = canonicalize_from_sqlite(input_with_shares(owner_tables(), vec![])).unwrap();
    let re = materialize_as_sqlite(MaterializeInput { manifest: out.manifest, data_buckets: out.data_buckets, schema_columns: None, shared_manifests: vec![] }).unwrap();
    let map = materialized_map(&re);
    assert_eq!(ids(&map["Items"]), vec!["i-nofolder", "i-personal", "i-shared", "i-sub"]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Primary encryption key extraction
// ─────────────────────────────────────────────────────────────────────────────

/// The `EncryptionKeys` data bucket produced by a canonicalize run (panics if the codec didn't emit one).
fn encryption_keys_bucket(out: &CanonicalizedVault) -> &DataBucket {
    out.data_buckets.iter().find(|b| b.category == "EncryptionKeys").expect("EncryptionKeys bucket emitted")
}

#[test]
fn extract_encryption_key_for_public_key_picks_matching_row_over_primary() {
    // A rotated vault: the old (non-primary) key must still be selectable so a grant wrapped for it unwraps.
    let out = canonicalize_from_sqlite(input_with_shares(
        vec![table("EncryptionKeys", vec![
            row(&[("Id", json!("ek-old")), ("PublicKey", json!("pub-old")), ("PrivateKey", json!("priv-old")), ("IsPrimary", json!(0))]),
            row(&[("Id", json!("ek-cur")), ("PublicKey", json!("pub-cur")), ("PrivateKey", json!("priv-cur")), ("IsPrimary", json!(1))]),
        ])],
        vec![],
    ))
    .unwrap();
    let key = extract_encryption_key_for_public_key_from_bucket(encryption_keys_bucket(&out), "pub-old").expect("old key present");
    assert_eq!(key["Id"], json!("ek-old"));
    assert_eq!(key["PrivateKey"], json!("priv-old"));

    let cur = extract_encryption_key_for_public_key_from_bucket(encryption_keys_bucket(&out), "pub-cur").expect("current key present");
    assert_eq!(cur["Id"], json!("ek-cur"));
}

#[test]
fn extract_encryption_key_for_public_key_skips_deleted_and_returns_none_on_miss() {
    let out = canonicalize_from_sqlite(input_with_shares(
        vec![table("EncryptionKeys", vec![
            row(&[("Id", json!("ek-del")), ("PublicKey", json!("pub-del")), ("PrivateKey", json!("priv-del")), ("IsPrimary", json!(1)), ("IsDeleted", json!(1))]),
        ])],
        vec![],
    ))
    .unwrap();
    // A deleted row is never returned even when its public key matches.
    assert!(extract_encryption_key_for_public_key_from_bucket(encryption_keys_bucket(&out), "pub-del").is_none());
    // An unknown public key yields nothing.
    assert!(extract_encryption_key_for_public_key_from_bucket(encryption_keys_bucket(&out), "pub-unknown").is_none());
}

#[test]
fn extract_encryption_key_for_public_key_from_bucket_json_sibling_roundtrips() {
    let out = canonicalize_from_sqlite(input_with_shares(owner_tables(), vec![])).unwrap();
    let bucket_json = serde_json::to_string(encryption_keys_bucket(&out)).unwrap();
    let key_json = extract_encryption_key_for_public_key_from_bucket_json(&bucket_json, "pub").unwrap();
    let key: serde_json::Value = serde_json::from_str(&key_json).unwrap();
    assert_eq!(key["PrivateKey"], json!("priv"));

    let miss = extract_encryption_key_for_public_key_from_bucket_json(&bucket_json, "nope").unwrap();
    assert_eq!(miss, "null");
}

// ─────────────────────────────────────────────────────────────────────────────
// Wire-format compatibility
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn shared_folder_specs_deserialize_from_camel_case_json() {
    let input_json = json!({
        "tables": [{ "name": "Items", "records": [] }],
        "userSalt": SALT_ROOT,
        "migrationId": "m",
        "canonicalizedAt": "2026-01-01T00:00:00.000Z",
        "sharedFolders": [{ "folderId": "f-1", "userSalt": SALT_SHARED }]
    })
    .to_string();
    let out_json = canonicalize_from_sqlite_json(&input_json).unwrap();
    let out: CanonicalizedVault = serde_json::from_str(&out_json).unwrap();
    assert_eq!(out.shared_vaults.len(), 1);
    assert_eq!(out.shared_vaults[0].folder_id, "f-1");
    let value: serde_json::Value = serde_json::from_str(&out_json).unwrap();
    assert_eq!(value["sharedVaults"][0]["manifest"]["sharedFolderId"], json!("f-1"));
}

#[test]
fn materialize_input_accepts_shared_manifests_from_json() {
    let owner = canonicalize_owner();
    let input_json = json!({
        "manifest": owner.manifest,
        "dataBuckets": owner.data_buckets,
        "sharedManifests": [owner.shared_vaults[0].manifest]
    })
    .to_string();
    let out_json = materialize_as_sqlite_json(&input_json).unwrap();
    let out: MaterializedTables = serde_json::from_str(&out_json).unwrap();
    let items = out.tables.iter().find(|t| t.name == "Items").unwrap();
    assert_eq!(items.records.len(), 4);
}
