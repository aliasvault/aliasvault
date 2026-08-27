//! Unit tests for the shared-manifest split (canonicalize) and combine (materialize) logic.
//!
//! These cover the core contract of vault sharing: `canonicalize_from_sqlite` with shared-manifest
//! specs pulls each anchor folder's subtree into its own manifest, and `materialize_as_sqlite` with
//! shared manifests combines everything back into one unified table set, for both the owner (whose
//! local vault holds every row) and a recipient (whose personal manifest knows nothing of the share).

use super::*;
use super::tests::{fitting_schema, materialize_manifests, materialize_input, stamp_unstamped};
use super::types::manifest_scoped_tables;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::json;
use std::collections::{HashMap, HashSet};

const SALT_PERSONAL: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const SALT_SHARED: &str = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";

/// The personal manifest id every test canonicalizes against. Personal rows are stamped with it — there is
/// no NULL-scope convention anywhere in the format.
const PERSONAL_M: &str = "m-personal";

fn b64(bytes: &[u8]) -> String {
    BASE64.encode(bytes)
}

fn row(pairs: &[(&str, serde_json::Value)]) -> CodecRecord {
    pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
}

fn table(name: &str, records: Vec<CodecRecord>) -> CodecTableData {
    CodecTableData { name: name.to_string(), records }
}

/// A spec for `folder_id`, whose manifest id is derived as `m-<folder_id>` so every test can predict
/// the scope stamp of a partition's rows.
fn spec(folder_id: &str) -> ManifestSpec {
    ManifestSpec {
        manifest_id: format!("m-{folder_id}"),
        manifest_salt: SALT_SHARED.to_string(),
        name: Some(format!("Share {folder_id}")),
    }
}

/// A canonicalize input whose rows are stamped the way a real client writes them (see
/// [`super::tests::stamp_unstamped`]): fixtures declare the stamps that matter and this fills in the rest.
fn input_with_shares(tables: Vec<CodecTableData>, shared_manifests: Vec<ManifestSpec>) -> CanonicalizeInput {
    raw_input_with_shares(stamp_unstamped(tables, PERSONAL_M), shared_manifests)
}

/// [`input_with_shares`] without the stamping pass, for the tests that hand canonicalize rows a client
/// failed to stamp.
fn raw_input_with_shares(tables: Vec<CodecTableData>, shared_manifests: Vec<ManifestSpec>) -> CanonicalizeInput {
    let personal = ManifestSpec { manifest_id: PERSONAL_M.to_string(), manifest_salt: SALT_PERSONAL.to_string(), name: None };
    CanonicalizeInput {
        tables,
        canonicalized_at: "2026-01-01T00:00:00.000Z".to_string(),
        manifests: std::iter::once(personal).chain(shared_manifests).collect(),
        adopt_unstamped_into: None,
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

/// FieldValues rows are identified by their `Value` marker.
fn values(records: &[CodecRecord]) -> Vec<&str> {
    let mut out: Vec<&str> = records.iter().filter_map(|r| r.get("Value").and_then(|v| v.as_str())).collect();
    out.sort();
    out
}

/// ItemTags rows are identified by their natural key.
fn tag_links(records: &[CodecRecord]) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = records
        .iter()
        .filter_map(|r| Some((r.get("ItemId")?.as_str()?.to_string(), r.get("TagId")?.as_str()?.to_string())))
        .collect();
    out.sort();
    out
}

/// The scoped logo id the codec derives for `(manifest id, source)`, what tests assert against, since
/// a logo's identity is a function of its manifest and domain rather than whatever id the writer minted.
fn logo_id(scope: &str, source: &str) -> String {
    scoped_assets::logo_id_for(scope, scoped_assets::KIND_FAVICON, source)
}

/// The `Logos` row for `source` in a manifest, resolved through its manifest-id-derived id.
fn logo_row<'a>(m: &'a Manifest, source: &str) -> &'a CodecRecord {
    let id = logo_id(&m.manifest_id, source);
    rows(m, "Logos")
        .iter()
        .find(|r| r.get("Id").and_then(|v| v.as_str()) == Some(id.as_str()))
        .unwrap_or_else(|| panic!("no {source} logo in manifest {:?}", m.manifest_id))
}

/// The `Source` values of a manifest's logos, sorted.
fn logo_sources(m: &Manifest) -> Vec<&str> {
    let mut out: Vec<&str> = rows(m, "Logos").iter().filter_map(|r| r.get("Source").and_then(|v| v.as_str())).collect();
    out.sort();
    out
}

/// Stamp a folder's whole subtree — its folders and the items in them — into `manifest_id`. Mirrors
/// exactly what the client's `FolderRepository.restampSubtree` writes when a folder starts being
/// shared, so fixtures carry the membership the codec now routes on.
///
/// Logos are deliberately NOT stamped here, just as the client does not stamp them: a logo is a
/// per-manifest asset the codec reconciles itself (cloning a copy into every manifest whose items
/// reference it), so moving items between manifests never has to move logo rows.
fn stamp_subtree(mut tables: Vec<CodecTableData>, folder_id: &str, manifest_id: &str) -> Vec<CodecTableData> {
    // Walk the folder tree down from `folder_id`.
    let mut subtree: HashSet<String> = HashSet::new();
    subtree.insert(folder_id.to_string());
    loop {
        let mut grew = false;
        for t in tables.iter().filter(|t| t.name == "Folders") {
            for row in &t.records {
                let (Some(id), Some(parent)) = (row.get("Id").and_then(|v| v.as_str()), row.get("ParentFolderId").and_then(|v| v.as_str())) else { continue };
                if subtree.contains(parent) && subtree.insert(id.to_string()) {
                    grew = true;
                }
            }
        }
        if !grew {
            break;
        }
    }

    // Folders in the subtree join the manifest; every other folder keeps the stamp it already had.
    for t in tables.iter_mut().filter(|t| t.name == "Folders") {
        for row in t.records.iter_mut() {
            let id = row.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if subtree.contains(&id) {
                row.insert("ManifestId".to_string(), json!(manifest_id));
            } else if !row.contains_key("ManifestId") {
                row.insert("ManifestId".to_string(), json!(PERSONAL_M));
            }
        }
    }

    /*
     * Every item takes the stamp of the folder it sits in, which is what the client's INSERT/UPDATE/
     * MOVE statements resolve via `BaseQueries.MANIFEST_OF_FOLDER`. Deriving it here rather than
     * carrying it forward is what makes an item moved OUT of a shared folder leave that manifest.
     */
    let folder_scope: HashMap<String, String> = tables
        .iter()
        .filter(|t| t.name == "Folders")
        .flat_map(|t| t.records.iter())
        .filter_map(|row| {
            let id = row.get("Id").and_then(|v| v.as_str())?;
            let scope = row.get("ManifestId").and_then(|v| v.as_str()).unwrap_or(PERSONAL_M);
            Some((id.to_string(), scope.to_string()))
        })
        .collect();
    for t in tables.iter_mut().filter(|t| t.name == "Items") {
        for row in t.records.iter_mut() {
            let scope = row
                .get("FolderId")
                .and_then(|v| v.as_str())
                .and_then(|f| folder_scope.get(f).cloned())
                .unwrap_or_else(|| PERSONAL_M.to_string());
            row.insert("ManifestId".to_string(), json!(scope));
        }
    }

    tables
}

/// A representative owner vault: a personal folder+item, and a shared manifest ("m-f-shared") carrying
/// the "f-shared" subtree, two items (one in a subfolder), and their child rows.
fn owner_tables() -> Vec<CodecTableData> {
    stamp_subtree(owner_tables_unstamped(), "f-shared", "m-f-shared")
}

/// The same vault with no `ManifestId` stamps at all, as a pre-2.2.0 vault holds it.
fn owner_tables_unstamped() -> Vec<CodecTableData> {
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
    assert_eq!(out.rest().len(), 1);
    let shared = &out.rest()[0].manifest;

    assert_eq!(out.rest()[0].manifest.name.as_deref(), Some("Share f-shared"));
    assert_eq!(shared.manifest_id, "m-f-shared");
    assert_eq!(shared.name.as_deref(), Some("Share f-shared"), "the manifest carries its display name, not a folder anchor");
    assert_eq!(out.first().manifest.manifest_id, PERSONAL_M);
    assert_eq!(shared.manifest_salt, SALT_SHARED);

    // Folder subtree (anchor + subfolder) moved; personal folder stayed.
    assert_eq!(ids(rows(shared, "Folders")), vec!["f-shared", "f-sub"]);
    assert_eq!(ids(rows(&out.first().manifest, "Folders")), vec!["f-personal"]);

    // Items in the subtree moved (including nested subfolder items); others stayed.
    assert_eq!(ids(rows(shared, "Items")), vec!["i-shared", "i-sub"]);
    assert_eq!(ids(rows(&out.first().manifest, "Items")), vec!["i-nofolder", "i-personal"]);
}

#[test]
fn split_normalizes_shared_anchor_parent_to_null() {
    // Owner had nested the anchor folder under a personal folder: the shared manifest must not leak
    // (or depend on) that personal placement.
    let mut tables = owner_tables();
    tables[0].records[1].insert("ParentFolderId".to_string(), json!("f-personal"));
    // Moving an item across a folder boundary moves it across a manifest boundary: the client
    // re-stamps it on the move, so the fixture does too.
    let tables = stamp_subtree(tables, "f-shared", "m-f-shared");
    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();
    let shared_anchor = rows(&out.rest()[0].manifest, "Folders").iter().find(|r| r["Id"] == json!("f-shared")).unwrap().clone();
    assert_eq!(shared_anchor["ParentFolderId"], serde_json::Value::Null);
    // The subfolder keeps its parent (it points inside the shared manifest).
    let sub = rows(&out.rest()[0].manifest, "Folders").iter().find(|r| r["Id"] == json!("f-sub")).unwrap().clone();
    assert_eq!(sub["ParentFolderId"], json!("f-shared"));
}

#[test]
fn split_routes_item_scoped_tables_generically() {
    // FieldValues / TotpCodes / Attachments / ItemTags all follow their item with zero per-table wiring.
    let out = canonicalize_owner();
    let shared = &out.rest()[0].manifest;

    assert_eq!(values(rows(shared, "FieldValues")), vec!["family", "hunter2"]);
    assert_eq!(values(rows(&out.first().manifest, "FieldValues")), vec!["me"]);

    assert_eq!(ids(rows(shared, "TotpCodes")), vec!["totp-shared"]);
    assert!(rows(&out.first().manifest, "TotpCodes").is_empty());

    assert_eq!(ids(rows(shared, "Attachments")), vec!["att-shared"]);
    assert_eq!(ids(rows(&out.first().manifest, "Attachments")), vec!["att-personal"]);

    assert_eq!(tag_links(rows(shared, "ItemTags")), vec![("i-shared".into(), "tag-both".into()), ("i-sub".into(), "tag-shared-only".into())]);
    assert_eq!(tag_links(rows(&out.first().manifest, "ItemTags")), vec![("i-personal".into(), "tag-both".into())]);
}

#[test]
fn split_gives_each_manifest_its_own_copy_of_the_tags_it_uses() {
    let out = canonicalize_owner();
    let shared = &out.rest()[0].manifest;

    /*
     * A tag is manifest-scoped like everything else, so the shared manifest gets its own stamped copy
     * of the two its items carry — the composite `(ManifestId, TagId)` foreign key cannot reach into
     * another namespace. The copies are copies: the base keeps every tag it holds, including the one
     * only shared items use now and the one nothing uses at all. An unused tag is still the user's.
     */
    assert_eq!(ids(rows(shared, "Tags")), vec!["tag-both", "tag-shared-only"]);
    assert_eq!(ids(rows(&out.first().manifest, "Tags")), vec!["tag-both", "tag-shared-only", "tag-unused"]);
    for row in rows(shared, "Tags") {
        assert_eq!(row["ManifestId"], json!("m-f-shared"), "the copy claims the manifest it lives in");
    }

    // Field definitions follow the same rule (referenced via FieldValues.FieldDefinitionId).
    assert_eq!(ids(rows(shared, "FieldDefinitions")), vec!["fd-1"]);
    assert_eq!(ids(rows(&out.first().manifest, "FieldDefinitions")), vec!["fd-1", "fd-unused"]);
}

#[test]
fn split_clones_a_tag_into_the_manifest_an_item_moved_into() {
    /*
     * An item moves into the shared folder carrying a tag that only ever existed in the user's own
     * manifest. Its ItemTags row follows the item, and the tag it points at has to come with it: the
     * foreign key is `(ManifestId, TagId)`, so the copy sitting in another namespace cannot satisfy it.
     */
    let mut tables = owner_tables_unstamped();
    tables.iter_mut().find(|t| t.name == "Items").unwrap().records.iter_mut()
        .find(|r| r["Id"] == json!("i-personal")).unwrap()
        .insert("FolderId".to_string(), json!("f-shared"));
    let tables = stamp_subtree(tables, "f-shared", "m-f-shared");

    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();
    let shared = &out.rest()[0].manifest;

    // "tag-both" travelled with the item; the base manifest keeps its own copy regardless.
    assert!(ids(rows(shared, "Tags")).contains(&"tag-both"));
    assert!(ids(rows(&out.first().manifest, "Tags")).contains(&"tag-both"));
    let cloned = rows(shared, "Tags").iter().find(|r| r["Id"] == json!("tag-both")).unwrap();
    assert_eq!(cloned["ManifestId"], json!("m-f-shared"), "the copy claims the manifest it moved into");
    assert_eq!(cloned["Name"], json!("work"), "content copied verbatim, id kept");
}

#[test]
fn split_refuses_rows_that_name_no_manifest() {
    /*
     * Membership IS the stamp, so a row that names no manifest is a client that could not say where its
     * data belongs. There is no fallback scope to demote it into: the push is refused, naming the table
     * and row, rather than homing it somewhere plausible and hoping.
     */
    let mut tables = stamp_unstamped(owner_tables(), PERSONAL_M);
    for row in tables.iter_mut().find(|t| t.name == "Items").unwrap().records.iter_mut() {
        row.insert("ManifestId".to_string(), json!(""));
    }

    let err = canonicalize_from_sqlite(raw_input_with_shares(tables, vec![spec("f-shared")])).unwrap_err().to_string();
    assert!(err.contains("Items"), "the error names the offending table: {err}");
    assert!(err.contains("name no manifest"), "the error says what is wrong: {err}");
}

#[test]
fn split_reads_the_all_zero_guid_as_naming_no_manifest() {
    /*
     * The schema stamps `00000000-0000-0000-0000-000000000000` into rows whose manifest it could not
     * derive (SQLite will not add a NOT NULL column without a default). Read as a real id it would route
     * to a manifest nobody carries and be dropped as revoked; it has to mean "unstamped" instead.
     */
    let mut tables = stamp_unstamped(owner_tables(), PERSONAL_M);
    for row in tables.iter_mut().find(|t| t.name == "Tags").unwrap().records.iter_mut() {
        row.insert("ManifestId".to_string(), json!("00000000-0000-0000-0000-000000000000"));
    }

    let err = canonicalize_from_sqlite(raw_input_with_shares(tables.clone(), vec![spec("f-shared")])).unwrap_err().to_string();
    assert!(err.contains("Tags"), "the sentinel is refused like any other unstamped row: {err}");

    let mut input = raw_input_with_shares(tables, vec![spec("f-shared")]);
    input.adopt_unstamped_into = Some(PERSONAL_M.to_string());
    let out = canonicalize_from_sqlite(input).unwrap();
    assert_eq!(ids(rows(&out.first().manifest, "Tags")), vec!["tag-both", "tag-shared-only", "tag-unused"], "and adopted, never dropped");
}

#[test]
fn split_adopts_unstamped_rows_only_when_the_client_asks() {
    // The sqlite-blob conversion is the one caller allowed to hand over unstamped rows, and it has to
    // say so: `adoptUnstampedInto` names the manifest they join. Rows that already name one keep it.
    let tables = stamp_subtree(owner_tables_unstamped(), "f-shared", "m-f-shared");
    let mut input = raw_input_with_shares(tables, vec![spec("f-shared")]);
    input.adopt_unstamped_into = Some(PERSONAL_M.to_string());

    let out = canonicalize_from_sqlite(input).unwrap();
    let base = &out.first().manifest;
    assert_eq!(ids(rows(base, "Items")), vec!["i-nofolder", "i-personal"], "no row was dropped");
    assert_eq!(ids(rows(base, "Tags")), vec!["tag-both", "tag-shared-only", "tag-unused"]);
    for row in rows(base, "Tags") {
        assert_eq!(row["ManifestId"], json!(PERSONAL_M), "adopted rows carry a real manifest id on the way out");
    }
    assert_eq!(ids(rows(&out.rest()[0].manifest, "Items")), vec!["i-shared", "i-sub"], "explicit stamps still route");
}

#[test]
fn sqlite_blob_migration_stamps_every_row_of_a_vault_that_has_no_manifest_id_column() {
    /*
     * The sqlite-blob > manifest-v1 migration, end to end: a vault whose schema stops short of the
     * `ManifestId` column (so no row carries the key at all) is canonicalized and materialized straight
     * back out, with no share in sight. Nothing stamps those rows beforehand — the column they would be
     * stamped in does not exist yet — so canonicalize adopting them into the manifest being written from
     * IS the conversion. Every row must come out carrying a real manifest id: the materialized schema
     * declares the column NOT NULL, so a single unstamped row fails the whole migration.
     */
    let mut input = raw_input_with_shares(owner_tables_unstamped(), vec![]);
    input.adopt_unstamped_into = Some(PERSONAL_M.to_string());
    let out = canonicalize_from_sqlite(input).unwrap();
    assert_eq!(out.rest().len(), 0, "no shares in this push");

    let base = &out.first().manifest;
    assert_eq!(ids(rows(base, "Items")), vec!["i-nofolder", "i-personal", "i-shared", "i-sub"], "no row was dropped");
    for name in manifest_scoped_tables() {
        for record in rows(base, name) {
            assert_eq!(record["ManifestId"], json!(PERSONAL_M), "{name} row {:?} left canonicalize unstamped", record.get("Id"));
        }
    }

    // And the same holds of what actually gets written back into the SQLite database.
    let re = materialize_as_sqlite(materialize_input(base.clone(), vec![], out.data_buckets.clone())).unwrap();
    for table in re.tables.iter().filter(|t| manifest_scoped_tables().contains(&t.name.as_str())) {
        for record in &table.records {
            assert_eq!(record["ManifestId"], json!(PERSONAL_M), "{} row {:?} would violate the NOT NULL stamp", table.name, record.get("Id"));
        }
    }
}

#[test]
fn split_scopes_logos_per_manifest_instead_of_copying_them() {
    // Logos are NOT reference-copied: each manifest gets its own row per domain, identified by its
    // own scope. The owner's legacy rows carry no scope.
    let out = canonicalize_owner();
    let shared = &out.rest()[0].manifest;

    // The shared manifest holds exactly the domains its items use, under folder-scoped ids.
    assert_eq!(logo_sources(shared), vec!["github.com", "netflix.com"]);
    let mut expected_ids = vec![logo_id("m-f-shared", "github.com"), logo_id("m-f-shared", "netflix.com")];
    expected_ids.sort();
    assert_eq!(ids(rows(shared, "Logos")), expected_ids.iter().map(String::as_str).collect::<Vec<&str>>());
    for row in rows(shared, "Logos") {
        assert_eq!(row["ManifestId"], json!("m-f-shared"));
    }

    // The personal manifest keeps its own row under a personal-scoped id, but only for a domain it still uses:
    // netflix.com left with the item that referenced it, and a favicon is refetchable.
    assert_eq!(logo_sources(&out.first().manifest), vec!["github.com"]);
    assert_eq!(logo_row(&out.first().manifest, "github.com")["ManifestId"], json!(PERSONAL_M));

    // Same domain, two manifests, two distinct rows: nothing converged.
    assert_ne!(logo_row(&out.first().manifest, "github.com")["Id"], logo_row(shared, "github.com")["Id"]);

    // Items point at the row in their own manifest.
    let personal = rows(&out.first().manifest, "Items").iter().find(|r| r["Id"] == json!("i-personal")).unwrap();
    assert_eq!(personal["LogoId"], logo_row(&out.first().manifest, "github.com")["Id"]);
    let shared_item = rows(shared, "Items").iter().find(|r| r["Id"] == json!("i-shared")).unwrap();
    assert_eq!(shared_item["LogoId"], logo_row(shared, "github.com")["Id"]);
}

#[test]
fn manifests_drop_logos_no_item_references() {
    // An item leaves the shared manifest: its logo must not linger there (every member downloads it),
    // and the copy it now needs lands in the manifest it moved to.
    let mut tables = owner_tables();
    let items = tables.iter_mut().find(|t| t.name == "Items").unwrap();
    items.records.iter_mut().find(|r| r["Id"] == json!("i-sub")).unwrap().insert("FolderId".to_string(), json!("f-personal"));

    // Moving an item across a folder boundary moves it across a manifest boundary: the client
    // re-stamps it on the move, so the fixture does too.
    let tables = stamp_subtree(tables, "f-shared", "m-f-shared");
    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();
    assert_eq!(logo_sources(&out.rest()[0].manifest), vec!["github.com"], "netflix logo left with its item");
    assert_eq!(logo_sources(&out.first().manifest), vec!["github.com", "netflix.com"]);
}

#[test]
fn orphan_favicons_are_pruned_everywhere_and_uploads_survive_everywhere() {
    /*
     * A favicon nothing references is refetchable, so it goes, in every manifest alike. An image the
     * user uploaded is not reproducible, so it stays — also in every manifest alike: each one carries
     * its own library, and which of them a client offers to pick from is a runtime choice, not
     * something the format decides by anointing one manifest.
     */
    let mut tables = owner_tables();
    let logos = tables.iter_mut().find(|t| t.name == "Logos").unwrap();
    logos.records.push(row(&[
        ("Id", json!("upload-personal")), ("Kind", json!("custom")), ("Source", json!("aa11")),
        ("ManifestId", json!(PERSONAL_M)), ("FileData", json!({ "__b64": b64(&[0x55]) })),
    ]));
    logos.records.push(row(&[
        ("Id", json!("upload-shared")), ("Kind", json!("custom")), ("Source", json!("bb22")),
        ("ManifestId", json!("m-f-shared")), ("FileData", json!({ "__b64": b64(&[0x66]) })),
    ]));

    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();

    // netflix.com left with the item that used it; each manifest kept the upload stamped for it.
    assert_eq!(logo_sources(&out.first().manifest), vec!["aa11", "github.com"]);
    assert_eq!(logo_sources(&out.rest()[0].manifest), vec!["bb22", "github.com", "netflix.com"]);
}

#[test]
fn logo_ids_are_derived_from_scope_and_source() {
    // The identity contract every platform reproduces: same (scope, domain) -> same row, and the
    // derivation is case-insensitive on the domain.
    assert_eq!(logo_id(PERSONAL_M, "github.com"), logo_id(PERSONAL_M, "GitHub.com"));
    assert_ne!(logo_id(PERSONAL_M, "github.com"), logo_id("m-f-shared", "github.com"));
    assert_ne!(logo_id("m-f-a", "github.com"), logo_id("m-f-b", "github.com"));
    // UUID-shaped so it round-trips through Guid/UUID types on every platform.
    let id = logo_id(PERSONAL_M, "github.com");
    assert_eq!(id.len(), 36);
    assert_eq!(id.chars().filter(|c| *c == '-').count(), 4);
}

#[test]
fn split_hashes_blobs_with_per_manifest_salts() {
    let out = canonicalize_owner();
    let shared = &out.rest()[0];

    // Personal blob map: personal attachment + the one logo a personal item still references.
    let personal_hashes: Vec<&String> = out.first().blobs.keys().collect();
    assert_eq!(personal_hashes.len(), 2, "personal: att-personal + github logo, got {:?}", out.first().blobs.values().map(|b| &b.kind).collect::<Vec<_>>());

    // Shared blob map: shared attachment + both logo copies, hashed with the SHARED salt.
    assert_eq!(shared.blobs.len(), 3);
    let logo_bytes = [0xAAu8, 0xBB];
    let expected_personal_hash = hash::salted_blob_hash(&logo_bytes, SALT_PERSONAL);
    let expected_shared_hash = hash::salted_blob_hash(&logo_bytes, SALT_SHARED);
    assert!(out.first().blobs.contains_key(&expected_personal_hash), "github favicon hashed with the personal salt in personal manifest");
    assert!(shared.blobs.contains_key(&expected_shared_hash), "github favicon hashed with shared salt in shared manifest");
    assert_ne!(expected_personal_hash, expected_shared_hash);

    // The blob refs inside each manifest point at their own map's hashes.
    assert_eq!(logo_row(&out.first().manifest, "github.com")["FileData"]["__blobRef"], json!(expected_personal_hash));
    assert_eq!(logo_row(&shared.manifest, "github.com")["FileData"]["__blobRef"], json!(expected_shared_hash));
}

#[test]
fn split_keeps_bucketed_and_foreign_key_tables_out_of_shared_manifests() {
    let out = canonicalize_owner();
    let shared = &out.rest()[0].manifest;
    assert!(!shared.tables.contains_key("EncryptionKeys"), "personal (personal-stamped) key material must never enter a shared manifest");
    assert!(!shared.tables.contains_key("Settings"), "a bucketed table belongs in its manifest's data bucket, never in a manifest");
    assert!(!out.first().manifest.tables.contains_key("Settings"), "…and that holds for the personal manifest too");
    // The personal keypair set rides inside the personal manifest itself; Settings rides in its bucket.
    assert_eq!(ids(rows(&out.first().manifest, "EncryptionKeys")), vec!["ek-1"], "personal keys live in the personal manifest");
    assert!(!out.data_buckets.iter().any(|b| b.category == "EncryptionKeys"), "EncryptionKeys is no longer a bucket category");

    /*
     * Every manifest gets its own Settings bucket, holding exactly its own rows — the shared one empty
     * here, since the single Settings row belongs to the personal manifest. Leaving a manifest's bucket
     * out would read as "unchanged" rather than "emptied", so its last row could never be deleted.
     */
    let settings: Vec<&DataBucket> = out.data_buckets.iter().filter(|b| b.category == "Settings").collect();
    assert_eq!(settings.iter().map(|b| b.manifest_id.as_str()).collect::<Vec<&str>>(), vec!["m-f-shared", PERSONAL_M]);
    assert_eq!(settings[0].tables["Settings"].len(), 0, "the shared manifest holds no settings of its own, and says so");
    assert_eq!(settings[1].tables["Settings"].len(), 1);
}

#[test]
fn split_routes_bucket_rows_to_the_manifest_that_owns_them() {
    /*
     * The whole point of addressing a bucket by manifest: a settings row stamped for a shared manifest
     * lands in THAT manifest's bucket, not the writer's. Nothing in the vault does this yet (only the
     * personal manifest carries settings today), but the routing is the row's stamp, not a hardcoded
     * assumption about which manifest may own a bucket.
     */
    let mut tables = owner_tables();
    let settings = tables.iter_mut().find(|t| t.name == "Settings").expect("settings fixture");
    settings.records.push(row(&[("Key", json!("sort")), ("Value", json!("name")), ("ManifestId", json!("m-f-shared"))]));
    settings.records.push(row(&[("Key", json!("stale")), ("Value", json!("x")), ("ManifestId", json!("m-gone"))]));

    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();

    let bucket_of = |manifest_id: &str| -> Option<&DataBucket> {
        out.data_buckets.iter().find(|b| b.category == "Settings" && b.manifest_id == manifest_id)
    };
    let keys = |b: &DataBucket| -> Vec<String> {
        let mut out: Vec<String> = b.tables["Settings"].iter().filter_map(|r| r.get("Key").and_then(|v| v.as_str()).map(str::to_string)).collect();
        out.sort();
        out
    };

    assert_eq!(keys(bucket_of(PERSONAL_M).expect("personal bucket")), vec!["theme"]);
    assert_eq!(keys(bucket_of("m-f-shared").expect("shared bucket")), vec!["sort"]);
    assert!(bucket_of("m-gone").is_none(), "a row stamped for a manifest this vault no longer carries is dropped, like every other row");

    // Each bucket is self-consistent: its rows claim its own manifest, so validation passes.
    for bucket in out.data_buckets.iter() {
        let result = validate_data_bucket(bucket);
        assert!(result.ok, "bucket {} invalid: {:?}", bucket.manifest_id, result.failed_rules);
    }
}

#[test]
fn combine_stamps_bucket_rows_with_the_manifest_that_delivered_them() {
    /*
     * The mirror rule of "the shipping manifest IS the membership": a bucket arrives under one manifest,
     * so its rows claim that manifest. A bucket whose rows name someone else cannot move them there.
     */
    let out = canonicalize_owner();
    let mut evil = out.data_buckets.iter().find(|b| b.category == "Settings" && b.manifest_id == PERSONAL_M).expect("personal settings bucket").clone();
    evil.manifest_id = "m-f-shared".to_string();

    let re = materialize_as_sqlite(materialize_input(out.first().manifest.clone(), out.rest().iter().map(|s| s.manifest.clone()).collect(), vec![evil])).unwrap();
    let map = materialized_map(&re);
    assert_eq!(map["Settings"].len(), 1);
    assert_eq!(map["Settings"][0]["ManifestId"], json!("m-f-shared"), "the delivering manifest decides the scope, not the row's own claim");
}

#[test]
fn combine_keeps_two_manifests_settings_side_by_side() {
    // Two manifests holding the same setting key are two rows: (ManifestId, Key) keeps them apart.
    let out = canonicalize_owner();
    let personal_bucket = out.data_buckets.iter().find(|b| b.category == "Settings" && b.manifest_id == PERSONAL_M).expect("personal settings bucket").clone();
    let mut shared_bucket = personal_bucket.clone();
    shared_bucket.manifest_id = "m-f-shared".to_string();

    let re = materialize_as_sqlite(materialize_input(
        out.first().manifest.clone(),
        out.rest().iter().map(|s| s.manifest.clone()).collect(),
        vec![personal_bucket, shared_bucket],
    ))
    .unwrap();
    let map = materialized_map(&re);
    let mut scopes: Vec<&str> = map["Settings"].iter().filter_map(|r| r["ManifestId"].as_str()).collect();
    scopes.sort();
    assert_eq!(scopes, vec!["m-f-shared", PERSONAL_M], "one 'theme' row per manifest, neither shadowing the other");
    assert!(map["Settings"].iter().all(|r| r["Key"] == json!("theme")));
}

#[test]
fn extract_buckets_splits_a_category_the_way_canonicalize_does() {
    /*
     * The bucket-only push path routes rows by the manifest each one names, exactly like the full push:
     * the caller hands over the whole category and gets one bucket per manifest it can write. Every
     * manifest asked for gets a bucket even when it holds nothing (otherwise deleting its last row
     * would never reach the server), a row naming a manifest this vault does not carry is dropped with
     * that manifest, and a row that names no manifest has no scope the codec may invent — it refuses.
     */
    let settings = |rows: Vec<CodecRecord>| -> HashMap<String, Vec<CodecRecord>> { [("Settings".to_string(), rows)].into_iter().collect() };

    let buckets = extract_buckets(
        "Settings".to_string(),
        vec![PERSONAL_M.to_string(), "m-f-shared".to_string()],
        settings(vec![
            row(&[("Key", json!("sort")), ("Value", json!("name")), ("ManifestId", json!("M-F-SHARED"))]),
            row(&[("Key", json!("theme")), ("Value", json!("dark")), ("ManifestId", json!(PERSONAL_M))]),
            row(&[("Key", json!("locale")), ("Value", json!("nl")), ("ManifestId", json!("m-gone"))]),
        ]),
    )
    .unwrap();

    let ids: Vec<&str> = buckets.iter().map(|b| b.manifest_id.as_str()).collect();
    assert_eq!(ids, vec!["m-f-shared", PERSONAL_M], "one bucket per manifest asked for, in a stable order");
    assert!(buckets.iter().all(|b| validate_data_bucket(b).ok));

    let shared = buckets.iter().find(|b| b.manifest_id == "m-f-shared").unwrap();
    assert_eq!(shared.tables["Settings"].len(), 1, "the shared manifest gets exactly its own row");
    assert_eq!(shared.tables["Settings"][0]["Key"], json!("sort"));
    assert_eq!(shared.tables["Settings"][0]["ManifestId"], json!("m-f-shared"), "a casing difference is normalized to the declared id");

    let personal = buckets.iter().find(|b| b.manifest_id == PERSONAL_M).unwrap();
    assert_eq!(personal.tables["Settings"].len(), 1, "the row stamped for a manifest this vault no longer carries is dropped, not re-homed");
    assert_eq!(personal.tables["Settings"][0]["Key"], json!("theme"));

    // A manifest holding nothing still gets its bucket, with the category's tables declared empty.
    let empty = extract_buckets("Settings".to_string(), vec![PERSONAL_M.to_string()], settings(vec![])).unwrap();
    assert_eq!(empty.len(), 1);
    assert_eq!(empty[0].tables["Settings"].len(), 0, "an emptied table is declared, so the delete reaches the server");

    let unstamped = extract_buckets("Settings".to_string(), vec![PERSONAL_M.to_string()], settings(vec![row(&[("Key", json!("k")), ("Value", json!("v"))])]))
        .unwrap_err()
        .to_string();
    assert!(unstamped.contains("name no manifest"), "the error says what is wrong: {unstamped}");
}

#[test]
fn split_routes_unregistered_tables_by_their_own_stamps() {
    /*
     * A table this build's registry does not know — a newer writer's table carried through the codec
     * overflow — routes by its rows' own stamps like every registered table. The writing (personal)
     * manifest is not special: it gets exactly its own rows, a shared manifest gets exactly its own,
     * and a row stamped for a manifest this vault no longer carries is dropped with it.
     */
    let mut tables = owner_tables();
    tables.push(table("Widgets", vec![
        row(&[("Id", json!("w-personal")), ("ManifestId", json!(PERSONAL_M))]),
        row(&[("Id", json!("w-shared")), ("ManifestId", json!("m-f-shared"))]),
        row(&[("Id", json!("w-gone")), ("ManifestId", json!("m-revoked"))]),
    ]));

    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();
    assert_eq!(ids(rows(&out.first().manifest, "Widgets")), vec!["w-personal"], "the writing manifest keeps only rows stamped for it");
    assert_eq!(ids(rows(&out.rest()[0].manifest, "Widgets")), vec!["w-shared"], "a shared manifest's rows come home to it");
}

#[test]
fn split_refuses_unregistered_rows_that_name_no_manifest() {
    // The no-fallback-scope rule holds for tables the registry does not know too: an unstamped row of
    // one is refused, never demoted into the writing manifest.
    let mut tables = owner_tables();
    tables.push(table("Widgets", vec![row(&[("Id", json!("w-1"))])]));

    let err = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap_err().to_string();
    assert!(err.contains("Widgets"), "the error names the offending table: {err}");
    assert!(err.contains("name no manifest"), "the error says what is wrong: {err}");
}

#[test]
fn validate_rejects_an_unaddressed_or_cross_stamped_bucket() {
    let out = canonicalize_owner();
    let bucket = out.data_buckets.iter().find(|b| b.category == "Settings" && b.manifest_id == PERSONAL_M).expect("personal settings bucket");

    let mut unaddressed = bucket.clone();
    unaddressed.manifest_id = String::new();
    assert!(validate_data_bucket(&unaddressed).failed_rules.iter().any(|r| r == "dataBucket-manifestId-missing"));

    let mut cross_stamped = bucket.clone();
    cross_stamped.manifest_id = "m-f-shared".to_string();
    assert!(validate_data_bucket(&cross_stamped).failed_rules.iter().any(|r| r == "dataBucket-scope-mismatch"));
}

#[test]
fn split_supports_multiple_disjoint_shared_manifests() {
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
    spec_b.manifest_salt = SALT_PERSONAL.to_string();
    let tables = stamp_subtree(stamp_subtree(tables, "f-a", "m-f-a"), "f-b", "m-f-b");
    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-a"), spec_b])).unwrap();
    assert_eq!(out.rest().len(), 2);
    assert_eq!(out.rest()[0].manifest.manifest_id, "m-f-a");
    assert_eq!(out.rest()[1].manifest.manifest_id, "m-f-b");
    assert_eq!(ids(rows(&out.rest()[0].manifest, "Items")), vec!["i-a"]);
    assert_eq!(ids(rows(&out.rest()[1].manifest, "Items")), vec!["i-b"]);
    assert!(rows(&out.first().manifest, "Items").is_empty());
}

#[test]
fn nested_manifests_each_keep_their_own_subtree() {
    // Nesting is no longer a special case: a folder inside another manifest's folder simply carries a
    // different stamp, and each manifest gets exactly the rows stamped for it. The inner manifest's
    // folder loses its ParentFolderId, since that parent lives in a namespace it cannot see.
    let tables = vec![table("Folders", vec![
        row(&[("Id", json!("f-outer")), ("ParentFolderId", serde_json::Value::Null)]),
        row(&[("Id", json!("f-inner")), ("ParentFolderId", json!("f-outer"))]),
    ])];
    let tables = stamp_subtree(stamp_subtree(tables, "f-outer", "m-f-outer"), "f-inner", "m-f-inner");
    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-outer"), spec("f-inner")])).unwrap();
    assert_eq!(ids(rows(&out.rest()[0].manifest, "Folders")), vec!["f-outer"]);
    assert_eq!(ids(rows(&out.rest()[1].manifest, "Folders")), vec!["f-inner"]);
    assert_eq!(rows(&out.rest()[1].manifest, "Folders")[0]["ParentFolderId"], serde_json::Value::Null);
}

#[test]
fn split_rejects_duplicate_shared_manifest_specs() {
    let err = canonicalize_from_sqlite(input_with_shares(owner_tables(), vec![spec("f-shared"), spec("f-shared")])).unwrap_err();
    assert!(err.to_string().contains("duplicate"), "unexpected error: {err}");
}

#[test]
fn split_of_deleted_folder_yields_empty_shared_manifest() {
    // The anchor folder was deleted locally: its manifest empties out (and would be pushed as such).
    let tables = vec![
        table("Folders", vec![row(&[("Id", json!("f-personal")), ("ParentFolderId", serde_json::Value::Null)])]),
        table("Items", vec![row(&[("Id", json!("i-1")), ("FolderId", json!("f-personal"))])]),
    ];
    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-gone")])).unwrap();
    assert_eq!(out.rest().len(), 1);
    assert!(rows(&out.rest()[0].manifest, "Folders").is_empty());
    assert!(rows(&out.rest()[0].manifest, "Items").is_empty());
    assert_eq!(ids(rows(&out.first().manifest, "Items")), vec!["i-1"]);
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
    let out = canonicalize_from_sqlite(input_with_shares(stamp_subtree(tables, "f-shared", "m-f-shared"), vec![spec("f-shared")])).unwrap();
    let shared = &out.rest()[0].manifest;
    assert_eq!(ids(rows(shared, "Folders")), vec!["f-shared", "f-sub"]);
    assert_eq!(ids(rows(shared, "Items")), vec!["i-del"]);
}

#[test]
fn split_with_a_single_spec_drops_rows_of_manifests_it_does_not_carry() {
    /*
     * The vault still holds rows stamped for "m-f-shared", but this push declares only one manifest:
     * whoever wrote it no longer has that one. Those rows have no namespace to go to and are left out
     * rather than re-homed into the manifest that happens to be first.
     */
    let out = canonicalize_from_sqlite(input_with_shares(owner_tables(), vec![])).unwrap();
    assert!(out.rest().is_empty());
    assert_eq!(ids(rows(&out.first().manifest, "Items")), vec!["i-nofolder", "i-personal"]);
    assert_eq!(ids(rows(&out.first().manifest, "Folders")), vec!["f-personal"]);
    // The rows hanging off a dropped item go with it rather than dangling.
    assert_eq!(values(rows(&out.first().manifest, "FieldValues")), vec!["me"]);
    assert!(rows(&out.first().manifest, "TotpCodes").is_empty());

    // The serialized output carries the one manifest, with nothing flagging it and no folder anchor.
    let json = serde_json::to_value(&out).unwrap();
    assert_eq!(json["manifests"].as_array().unwrap().len(), 1);
    assert!(json["manifests"][0].get("isPersonal").is_none());
    assert!(json["manifests"][0]["manifest"].get("anchorFolderId").is_none());
    assert_eq!(json["manifests"][0]["manifest"]["manifestId"], json!(PERSONAL_M));
}

#[test]
fn shared_manifests_validate_clean_after_split() {
    let out = canonicalize_owner();
    let personal_result = validate_manifest(&out.first().manifest);
    assert!(personal_result.ok, "personal manifest invalid: {:?}", personal_result.failed_rules);
    let shared_result = validate_manifest(&out.rest()[0].manifest);
    assert!(shared_result.ok, "shared manifest invalid: {:?}", shared_result.failed_rules);
}

#[test]
fn validate_rejects_shared_manifest_carrying_out_of_manifest_tables() {
    // A NULL-scope (personal) key row in a shared manifest trips the key-scope rule…
    let mut manifest = canonicalize_owner().rest()[0].manifest.clone();
    manifest.tables.insert("EncryptionKeys".to_string(), vec![row(&[("Id", json!("ek-evil")), ("PrivateKey", json!("x"))])]);
    let result = validate_manifest(&manifest);
    assert!(!result.ok);
    assert!(result.failed_rules.iter().any(|r| r == "encryption-keys-scope-mismatch"));

    /*
     * …and a bucketed table (Settings) trips the bucketed-table rule, not the personal-table one: it is
     * rejected because it belongs in the manifest's own data bucket, not because settings could never
     * belong to a shared manifest at all.
     */
    let mut manifest = canonicalize_owner().rest()[0].manifest.clone();
    manifest.tables.insert("Settings".to_string(), vec![row(&[("Key", json!("theme")), ("Value", json!("evil"))])]);
    let result = validate_manifest(&manifest);
    assert!(!result.ok);
    assert!(result.failed_rules.iter().any(|r| r == "manifest-carries-bucketed-table"));
    assert!(!result.failed_rules.iter().any(|r| r == "manifest-carries-personal-table"));
}

#[test]
fn split_regrafts_overflow_columns_onto_shared_rows() {
    // A newer writer added a column to a shared item; this client's schema couldn't hold it, so it
    // rode in the overflow carrier. On push it must re-graft and travel with the row into the
    // shared manifest, not the personal one.
    // Recorded under the identity the row had when the overflow was written — before the folder was
    // shared, so under the personal scope. The re-graft has to survive the row changing manifest.
    let overflow = CodecOverflow {
        columns: [(
            "Items".to_string(),
            [(format!("{}\u{1f}i-shared", PERSONAL_M), row(&[("FutureCol", json!("keep-me"))]))].into_iter().collect(),
        )]
        .into_iter()
        .collect(),
        ..Default::default()
    };
    let mut tables = owner_tables();
    tables.push(table(OVERFLOW_TABLE, overflow.to_table_records()));
    // Moving an item across a folder boundary moves it across a manifest boundary: the client
    // re-stamps it on the move, so the fixture does too.
    let tables = stamp_subtree(tables, "f-shared", "m-f-shared");
    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();
    let shared_item = rows(&out.rest()[0].manifest, "Items").iter().find(|r| r["Id"] == json!("i-shared")).unwrap().clone();
    assert_eq!(shared_item["FutureCol"], json!("keep-me"));
    assert!(rows(&out.first().manifest, "Items").iter().all(|r| !r.contains_key("FutureCol")));
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
    // The core round-trip contract: canonicalize with shares, then materialize personal+shared
    // semantically identical to the original unified vault.
    let out = canonicalize_owner();
    let re = materialize_as_sqlite(materialize_input(out.first().manifest.clone(), out.rest().iter().map(|s| s.manifest.clone()).collect(), out.data_buckets.clone())).unwrap();
    let map = materialized_map(&re);

    assert_eq!(ids(&map["Items"]), vec!["i-nofolder", "i-personal", "i-shared", "i-sub"]);
    assert_eq!(ids(&map["Folders"]), vec!["f-personal", "f-shared", "f-sub"]);
    assert_eq!(values(&map["FieldValues"]), vec!["family", "hunter2", "me"]);
    assert_eq!(ids(&map["Attachments"]), vec!["att-personal", "att-shared"]);
    assert_eq!(ids(&map["TotpCodes"]), vec!["totp-shared"]);
    assert_eq!(tag_links(&map["ItemTags"]), vec![("i-personal".into(), "tag-both".into()), ("i-shared".into(), "tag-both".into()), ("i-sub".into(), "tag-shared-only".into())]);
    /*
     * Tags and field definitions are manifest-scoped like the rest: the two the shared items carry
     * exist once in each manifest that uses them, side by side under `(ManifestId, Id)`. The base keeps
     * its own copies, including "tag-unused", which nothing references at all.
     */
    assert_eq!(ids(&map["Tags"]), vec!["tag-both", "tag-both", "tag-shared-only", "tag-shared-only", "tag-unused"]);
    let tag_scopes: HashSet<(&str, &str)> = map["Tags"]
        .iter()
        .map(|r| (r["ManifestId"].as_str().unwrap(), r["Id"].as_str().unwrap()))
        .collect();
    assert_eq!(tag_scopes.len(), 5, "each (scope, id) appears once");
    assert_eq!(ids(&map["FieldDefinitions"]), vec!["fd-1", "fd-1", "fd-unused"]);
    /*
     * Logos do NOT collapse back to one row per domain: the personal manifest's github row and the shared
     * manifest's own github row are separate rows, which is the point of scoping them. They coexist
     * under UNIQUE(ManifestId, Kind, Source), and every scope is internally unique. Three rows, not
     * four: netflix.com exists only in the shared scope, since the personal manifest holds no item using it.
     */
    assert_eq!(map["Logos"].len(), 3);
    let scoped: HashSet<(Option<&str>, &str)> = map["Logos"]
        .iter()
        .map(|r| (r.get("ManifestId").and_then(|v| v.as_str()), r["Source"].as_str().unwrap()))
        .collect();
    assert_eq!(scoped.len(), 3, "each (scope, source) appears once");
    assert_eq!(map["EncryptionKeys"].len(), 1);
    assert_eq!(map["Settings"].len(), 1);
}

#[test]
fn owner_roundtrip_is_stable_across_a_second_split() {
    // Split -> combine -> split again must reproduce the same manifests (no oscillation).
    let first = canonicalize_owner();
    let re = materialize_as_sqlite(materialize_input(first.first().manifest.clone(), first.rest().iter().map(|s| s.manifest.clone()).collect(), first.data_buckets.clone())).unwrap();

    // Simulate the platform read-back: blob refs stay as-is (the platform rebinds bytes, and a
    // re-canonicalize would read real bytes; for stability we compare table row id sets).
    let second = canonicalize_from_sqlite(input_with_shares(
        re.tables.iter().map(|t| table(&t.name, t.records.clone())).collect(),
        vec![spec("f-shared")],
    ))
    .unwrap();

    for name in ["Folders", "Items", "FieldValues", "Attachments", "TotpCodes", "ItemTags", "Tags", "FieldDefinitions", "Logos"] {
        assert_eq!(ids(rows(&second.first().manifest, name)), ids(rows(&first.first().manifest, name)), "personal {name} drifted");
        assert_eq!(
            ids(rows(&second.rest()[0].manifest, name)),
            ids(rows(&first.rest()[0].manifest, name)),
            "shared {name} drifted"
        );
    }
}

/// A recipient's own vault (no knowledge of the share) canonicalized to a personal manifest.
fn recipient_personal_manifest() -> (Manifest, Vec<DataBucket>) {
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
    (out.first().manifest.clone(), out.data_buckets.clone())
}

#[test]
fn recipient_combine_materializes_shared_manifest_into_their_vault() {
    let owner = canonicalize_owner();
    let (recipient_manifest, buckets) = recipient_personal_manifest();
    let re = materialize_as_sqlite(materialize_input(recipient_manifest, vec![owner.rest()[0].manifest.clone()], buckets)).unwrap();
    let map = materialized_map(&re);

    // Recipient sees their own rows plus the shared subtree.
    assert_eq!(ids(&map["Folders"]), vec!["f-mine", "f-shared", "f-sub"]);
    assert_eq!(ids(&map["Items"]), vec!["i-mine", "i-shared", "i-sub"]);
    assert_eq!(values(&map["FieldValues"]), vec!["family", "hunter2"]);
    /*
     * The owner and the recipient both hold a netflix.com logo, legitimately different images (fetched
     * at different times, or one of them uploaded by hand). They must BOTH survive, in their own
     * scopes: the recipient keeps their personal logo and the shared manifest keeps the owner's. This is
     * the case the old cross-manifest Source dedup collapsed, silently repointing the recipient's own
     * item at a row authored inside someone else's manifest.
     */
    let netflix: Vec<Option<&str>> = map["Logos"]
        .iter()
        .filter(|r| r["Source"] == json!("netflix.com"))
        .map(|r| r.get("ManifestId").and_then(|v| v.as_str()))
        .collect();
    assert_eq!(netflix.len(), 2, "one netflix logo per scope");
    assert!(netflix.contains(&Some(PERSONAL_M)), "recipient's personal logo survives");
    assert!(netflix.contains(&Some("m-f-shared")), "shared manifest's logo survives");

    // The recipient's own item still points at their own row, untouched by the share.
    let mine = map["Items"].iter().find(|r| r["Id"] == json!("i-mine")).unwrap();
    assert_eq!(mine["LogoId"], json!(logo_id(PERSONAL_M, "netflix.com")));

    // ...and every reference resolves to a logo that is actually present.
    let logo_ids: HashSet<&str> = map["Logos"].iter().filter_map(|r| r.get("Id").and_then(|v| v.as_str())).collect();
    for item in &map["Items"] {
        if let Some(logo_id) = item.get("LogoId").and_then(|v| v.as_str()) {
            assert!(logo_ids.contains(logo_id), "Item {:?} points at missing logo {logo_id}", item.get("Id"));
        }
    }
    // Only the recipient's own key material is present.
    assert_eq!(ids(&map["EncryptionKeys"]), vec!["ek-r"]);
}

#[test]
fn recipient_roundtrip_reproduces_shared_manifest_without_leaking_into_personal() {
    // Recipient pulls (combine), then pushes (split): the shared manifest must contain exactly the
    // shared rows, and none of them may leak into the recipient's personal manifest.
    let owner = canonicalize_owner();
    let (recipient_manifest, buckets) = recipient_personal_manifest();
    let re = materialize_as_sqlite(materialize_input(recipient_manifest, vec![owner.rest()[0].manifest.clone()], buckets)).unwrap();

    let pushed = canonicalize_from_sqlite(input_with_shares(
        re.tables.iter().map(|t| table(&t.name, t.records.clone())).collect(),
        vec![spec("f-shared")],
    ))
    .unwrap();

    // Shared manifest reproduced.
    let shared = &pushed.rest()[0].manifest;
    assert_eq!(ids(rows(shared, "Items")), vec!["i-shared", "i-sub"]);
    assert_eq!(ids(rows(shared, "Folders")), vec!["f-shared", "f-sub"]);
    assert_eq!(values(rows(shared, "FieldValues")), vec!["family", "hunter2"]);
    assert_eq!(ids(rows(shared, "Tags")), vec!["tag-both", "tag-shared-only"]);

    // Recipient's personal manifest holds only their own rows, no shared items/folders leaked in.
    assert_eq!(ids(rows(&pushed.first().manifest, "Items")), vec!["i-mine"]);
    assert_eq!(ids(rows(&pushed.first().manifest, "Folders")), vec!["f-mine"]);
    assert!(rows(&pushed.first().manifest, "FieldValues").is_empty());
    // Owner's tags are referenced only by shared items, so they stay out of the recipient's personal manifest.
    assert!(rows(&pushed.first().manifest, "Tags").is_empty());

    /*
     * The shared manifest the recipient pushes back carries the same logo rows they pulled, their own
     * netflix.com logo never bleeds into it. This is the property that keeps a member's routine push
     * from rewriting a folder they merely participate in (burning a revision, and racing the owner's
     * concurrent write on the all-or-nothing gate). Ids and scopes only: this round trip never rebinds
     * blob bytes, so FileData reads as null on the way back out.
     */
    assert_eq!(ids(rows(shared, "Logos")), ids(rows(&owner.rest()[0].manifest, "Logos")));
    assert_eq!(logo_sources(shared), logo_sources(&owner.rest()[0].manifest));
    assert_eq!(logo_row(shared, "netflix.com")["ManifestId"], json!("m-f-shared"));

    // And the recipient's personal manifest keeps its own row for that same domain.
    assert_eq!(logo_row(&pushed.first().manifest, "netflix.com")["ManifestId"], json!(PERSONAL_M));
    assert_ne!(logo_row(&pushed.first().manifest, "netflix.com")["Id"], logo_row(shared, "netflix.com")["Id"]);
}

#[test]
fn item_moved_into_shared_manifest_brings_its_logo_along() {
    // A personal item is dragged into the shared manifest. Its logo lives in the personal scope, so the
    // partition must clone it under the folder's scope, otherwise the reference would dangle and the
    // logo would be nulled away on the way out.
    let mut tables = owner_tables();
    let items = tables.iter_mut().find(|t| t.name == "Items").unwrap();
    items.records.iter_mut().find(|r| r["Id"] == json!("i-personal")).unwrap().insert("FolderId".to_string(), json!("f-shared"));

    // Moving an item across a folder boundary moves it across a manifest boundary: the client
    // re-stamps it on the move, so the fixture does too.
    let tables = stamp_subtree(tables, "f-shared", "m-f-shared");
    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();
    let shared = &out.rest()[0].manifest;

    let moved = rows(shared, "Items").iter().find(|r| r["Id"] == json!("i-personal")).unwrap();
    assert_eq!(moved["LogoId"], json!(logo_id("m-f-shared", "github.com")), "logo followed the item into the folder");
    assert!(logo_row(shared, "github.com")["FileData"]["__blobRef"].is_string(), "and it carries real bytes");
}

#[test]
fn item_moved_into_shared_manifest_adopts_its_existing_logo() {
    // Same move, but the folder already shows a logo for that domain. The item adopts it rather than
    // dragging a second row onto the same (scope, domain), the folder's members keep seeing one logo.
    let mut tables = owner_tables();
    let items = tables.iter_mut().find(|t| t.name == "Items").unwrap();
    // i-personal (github.com) joins the shared manifest, where i-shared already uses github.com.
    items.records.iter_mut().find(|r| r["Id"] == json!("i-personal")).unwrap().insert("FolderId".to_string(), json!("f-shared"));

    // Moving an item across a folder boundary moves it across a manifest boundary: the client
    // re-stamps it on the move, so the fixture does too.
    let tables = stamp_subtree(tables, "f-shared", "m-f-shared");
    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();
    let shared = &out.rest()[0].manifest;

    assert_eq!(logo_sources(shared), vec!["github.com", "netflix.com"], "no duplicate github row");
    let shared_github = logo_row(shared, "github.com")["Id"].clone();
    for item_id in ["i-personal", "i-shared"] {
        let item = rows(shared, "Items").iter().find(|r| r["Id"] == json!(item_id)).unwrap();
        assert_eq!(item["LogoId"], shared_github);
    }
}

#[test]
fn combine_scopes_a_legacy_shared_manifest_before_it_can_collide() {
    // A shared manifest whose ROWS predate manifest-id scoping: its logos were minted at random and
    // carry no scope stamp. Materializing it next to the recipient's own rows must not collide on
    // UNIQUE(ManifestId, Kind, Source) — combine normalizes every row to the manifest's own id.
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

    let re = materialize_as_sqlite(materialize_input(recipient_manifest, vec![legacy_shared], buckets)).unwrap();
    let map = materialized_map(&re);

    let scoped: Vec<(Option<&str>, &str)> = map["Logos"]
        .iter()
        .map(|r| (r.get("ManifestId").and_then(|v| v.as_str()), r["Source"].as_str().unwrap()))
        .collect();
    assert_eq!(scoped.len(), 2);
    assert!(scoped.contains(&(Some(PERSONAL_M), "netflix.com")), "recipient's own row keeps the personal scope");
    assert!(scoped.contains(&(Some("m-legacy"), "netflix.com")), "legacy shared row was pulled into its manifest's scope");

    // The legacy manifest's item follows its row into the new scope.
    let legacy_item = map["Items"].iter().find(|r| r["Id"] == json!("i-legacy")).unwrap();
    assert_eq!(legacy_item["LogoId"], json!(logo_id("m-legacy", "netflix.com")));
}

#[test]
fn combine_keeps_both_rows_when_two_manifests_share_a_primary_key() {
    // Ids are client-minted, so a shared manifest may legitimately carry a row whose Id equals one of
    // the reader's own. Because rows are keyed by (ManifestId, Id) — the primary key the local schema
    // declares — both survive in their own namespace and neither shadows the other.
    let mut personal = canonicalize_from_sqlite(input_with_shares(
        vec![table("Items", vec![row(&[("Id", json!("i-dup")), ("Name", json!("personal-version")), ("FolderId", serde_json::Value::Null)])])],
        vec![],
    ))
    .unwrap()
    .first()
    .manifest
    .clone();
    personal.tables.insert("Folders".to_string(), vec![]);

    let mut shared = personal.clone();
    shared.manifest_id = "m-x".to_string();
    shared.name = Some("Renamed".to_string());
    shared.tables.insert("Items".to_string(), vec![row(&[("Id", json!("i-dup")), ("Name", json!("shared-version")), ("FolderId", serde_json::Value::Null)])]);

    let re = materialize_as_sqlite(materialize_input(personal, vec![shared], vec![])).unwrap();
    let map = materialized_map(&re);

    let by_scope: Vec<(&str, &str)> = map["Items"]
        .iter()
        .map(|r| (r["ManifestId"].as_str().unwrap(), r["Name"].as_str().unwrap()))
        .collect();
    assert_eq!(by_scope.len(), 2, "one row per manifest, not one row total");
    assert!(by_scope.contains(&(PERSONAL_M, "personal-version")));
    assert!(by_scope.contains(&("m-x", "shared-version")));
}

#[test]
fn combine_keeps_each_manifests_own_copy_of_a_shared_tag() {
    /*
     * Two manifests carrying the same tag id are two rows, not one: `Tags` is keyed by
     * `(ManifestId, Id)` like everything else, so neither copy can shadow the other and a member
     * renaming their copy never overwrites anyone else's. Presenting them as one tag (by name, say)
     * is the client's call.
     */
    let mut base = canonicalize_from_sqlite(input_with_shares(
        vec![table("Tags", vec![row(&[("Id", json!("t-1")), ("Name", json!("base-copy"))])])],
        vec![],
    ))
    .unwrap()
    .first()
    .manifest
    .clone();
    base.tables.insert("Folders".to_string(), vec![]);

    let mut shared = base.clone();
    shared.manifest_id = "m-x".to_string();
    shared.tables.insert("Tags".to_string(), vec![row(&[("Id", json!("t-1")), ("Name", json!("shared-copy"))])]);

    let re = materialize_as_sqlite(materialize_input(base, vec![shared], vec![])).unwrap();
    let map = materialized_map(&re);
    assert_eq!(map["Tags"].len(), 2, "one row per manifest");
    let by_scope: HashSet<(&str, &str)> = map["Tags"]
        .iter()
        .map(|r| (r["ManifestId"].as_str().unwrap(), r["Name"].as_str().unwrap()))
        .collect();
    assert!(by_scope.contains(&(PERSONAL_M, "base-copy")));
    assert!(by_scope.contains(&("m-x", "shared-copy")));
}

#[test]
fn split_stamps_item_scoped_rows_with_the_manifest_their_item_joined() {
    // A child row's foreign key is (ManifestId, ItemId), so it has to carry the same stamp as the item
    // it followed — otherwise it points at a row in a namespace it isn't in.
    let tables = stamp_subtree(owner_tables(), "f-shared", "m-f-shared");
    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();

    for name in ["FieldValues", "TotpCodes", "Attachments", "ItemTags"] {
        let shared_rows = rows(&out.rest()[0].manifest, name);
        assert!(!shared_rows.is_empty(), "{name} should have rows in the shared manifest");
        assert!(shared_rows.iter().all(|r| r["ManifestId"] == json!("m-f-shared")), "{name} rows carry the shared manifest's stamp");
        assert!(rows(&out.first().manifest, name).iter().all(|r| r["ManifestId"] == json!(PERSONAL_M)), "{name} rows left behind carry the personal manifest's");
    }
}

#[test]
fn combine_drops_child_rows_naming_an_item_the_manifest_does_not_hold() {
    // A manifest may only describe its own items. One carrying a FieldValue for an item in the
    // reader's personal scope is either stale or hand-crafted to graft a field onto it; the composite
    // foreign key rejects it either way, so combine drops it rather than failing the whole insert.
    let mut personal = canonicalize_from_sqlite(input_with_shares(
        vec![
            table("Items", vec![row(&[("Id", json!("i-mine")), ("Name", json!("mine")), ("FolderId", serde_json::Value::Null)])]),
            table("FieldValues", vec![row(&[("Id", json!("fv-mine")), ("ItemId", json!("i-mine")), ("FieldKey", json!("username")), ("Value", json!("me"))])]),
        ],
        vec![],
    ))
    .unwrap()
    .first()
    .manifest
    .clone();
    personal.tables.insert("Folders".to_string(), vec![]);

    let mut hostile = personal.clone();
    hostile.manifest_id = "m-x".to_string();
    hostile.tables.insert("Items".to_string(), vec![]);
    hostile.tables.insert(
        "FieldValues".to_string(),
        vec![row(&[("Id", json!("fv-injected")), ("ItemId", json!("i-mine")), ("FieldKey", json!("password")), ("Value", json!("stolen"))])],
    );

    let re = materialize_as_sqlite(materialize_input(personal, vec![hostile], vec![])).unwrap();
    let map = materialized_map(&re);
    assert_eq!(values(&map["FieldValues"]), vec!["me"], "the foreign row never reaches the reader's item");
}

#[test]
fn combine_nulls_an_item_folder_that_only_resolves_in_another_manifest() {
    // Folder ids are per-manifest now: a folder with the right Id in the wrong namespace is not this
    // item's folder, and leaving the reference would fail the platform's foreign_key_check.
    let mut personal = canonicalize_from_sqlite(input_with_shares(
        vec![
            table("Items", vec![row(&[("Id", json!("i-orphan")), ("Name", json!("mine")), ("FolderId", json!("f-elsewhere"))])]),
            table("Folders", vec![]),
        ],
        vec![],
    ))
    .unwrap()
    .first()
    .manifest
    .clone();
    personal.tables.insert("Folders".to_string(), vec![]);

    let mut shared = personal.clone();
    shared.manifest_id = "m-x".to_string();
    shared.tables.insert("Items".to_string(), vec![]);
    shared.tables.insert("Folders".to_string(), vec![row(&[("Id", json!("f-elsewhere")), ("Name", json!("Theirs")), ("ParentFolderId", serde_json::Value::Null)])]);

    let re = materialize_as_sqlite(materialize_input(personal, vec![shared], vec![])).unwrap();
    let map = materialized_map(&re);
    let item = map["Items"].iter().find(|r| r["Id"] == json!("i-orphan")).unwrap();
    assert_eq!(item["FolderId"], serde_json::Value::Null);
}

#[test]
fn combine_strips_personal_and_bookkeeping_tables_from_shared_manifests() {
    // A malicious/buggy shared manifest tries to inject key material, settings, and an overflow
    // carrier into the recipient's vault: all must be dropped.
    let owner = canonicalize_owner();
    let mut evil = owner.rest()[0].manifest.clone();
    evil.tables.insert("EncryptionKeys".to_string(), vec![row(&[("Id", json!("ek-evil")), ("PrivateKey", json!("stolen"))])]);
    evil.tables.insert("Settings".to_string(), vec![row(&[("Key", json!("theme")), ("Value", json!("evil"))])]);
    evil.tables.insert(OVERFLOW_TABLE.to_string(), vec![row(&[("Id", json!("x")), ("Data", json!("{}"))])]);

    let (recipient_manifest, buckets) = recipient_personal_manifest();
    let re = materialize_as_sqlite(materialize_input(recipient_manifest, vec![evil], buckets)).unwrap();
    let map = materialized_map(&re);
    assert_eq!(ids(&map["EncryptionKeys"]), vec!["ek-r"], "injected key row dropped");
    assert!(!map.contains_key("Settings"), "injected settings dropped");
    assert!(!map.contains_key(OVERFLOW_TABLE), "injected overflow carrier dropped");
}

#[test]
fn combine_nulls_dangling_parent_folder_references() {
    // A shared manifest written before parent normalization (or with a partial grant set) may carry
    // a ParentFolderId pointing outside every manifest this user holds: null it so FK checks pass.
    let mut shared = canonicalize_owner().rest()[0].manifest.clone();
    for folder in shared.tables.get_mut("Folders").unwrap() {
        if folder["Id"] == json!("f-shared") {
            folder.insert("ParentFolderId".to_string(), json!("f-owner-personal-folder"));
        }
    }
    let (recipient_manifest, buckets) = recipient_personal_manifest();
    let re = materialize_as_sqlite(materialize_input(recipient_manifest, vec![shared], buckets)).unwrap();
    let map = materialized_map(&re);
    let shared_anchor = map["Folders"].iter().find(|r| r["Id"] == json!("f-shared")).unwrap();
    assert_eq!(shared_anchor["ParentFolderId"], serde_json::Value::Null);
    // Intact parents are untouched.
    let sub = map["Folders"].iter().find(|r| r["Id"] == json!("f-sub")).unwrap();
    assert_eq!(sub["ParentFolderId"], json!("f-shared"));
}

#[test]
fn combine_applies_schema_overflow_to_shared_rows_too() {
    // An old client materializing a share written by a newer client: unknown columns on shared rows
    // must land in overflow, not crash the insert.
    let mut shared = canonicalize_owner().rest()[0].manifest.clone();
    shared.tables.get_mut("Items").unwrap()[0].insert("FutureCol".to_string(), json!("v"));

    let schema: HashMap<String, Vec<String>> = [
        ("Items".to_string(), vec!["Id".to_string(), "FolderId".to_string(), "LogoId".to_string()]),
        ("Folders".to_string(), vec!["Id".to_string(), "Name".to_string(), "ParentFolderId".to_string()]),
        (OVERFLOW_TABLE.to_string(), vec!["Id".to_string(), "Data".to_string()]),
    ]
    .into_iter()
    .collect();

    let (recipient_manifest, buckets) = recipient_personal_manifest();
    let re = materialize_as_sqlite(MaterializeInput::new(recipient_manifest, vec![shared], buckets, schema)).unwrap();
    let map = materialized_map(&re);
    assert!(map["Items"].iter().all(|r| !r.contains_key("FutureCol")));
    let overflowed: Vec<&String> = re.overflow.columns.get("Items").map(|m| m.keys().collect()).unwrap_or_default();
    assert!(!overflowed.is_empty(), "unknown shared column stashed in overflow");
}

#[test]
fn combine_of_a_single_manifest_carries_only_its_own_rows() {
    // Canonicalizing without listing the shared manifest leaves its rows out of the push entirely,
    // so the vault materialized back holds only what the one manifest carries.
    let out = canonicalize_from_sqlite(input_with_shares(owner_tables(), vec![])).unwrap();
    let re = materialize_as_sqlite(materialize_input(out.first().manifest.clone(), vec![], out.data_buckets.clone())).unwrap();
    let map = materialized_map(&re);
    assert_eq!(ids(&map["Items"]), vec!["i-nofolder", "i-personal"]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Primary encryption key extraction
// ─────────────────────────────────────────────────────────────────────────────

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
    let key = extract_encryption_key_for_public_key(&out.first().manifest, "pub-old").expect("old key present");
    assert_eq!(key["Id"], json!("ek-old"));
    assert_eq!(key["PrivateKey"], json!("priv-old"));

    let cur = extract_encryption_key_for_public_key(&out.first().manifest, "pub-cur").expect("current key present");
    assert_eq!(cur["Id"], json!("ek-cur"));

    // The manifest's active key is the primary row of its own scope.
    assert_eq!(active_encryption_key(&out.first().manifest).expect("primary key present")["Id"], json!("ek-cur"));
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
    assert!(extract_encryption_key_for_public_key(&out.first().manifest, "pub-del").is_none());
    // An unknown public key yields nothing.
    assert!(extract_encryption_key_for_public_key(&out.first().manifest, "pub-unknown").is_none());
}

#[test]
fn extract_encryption_key_for_public_key_json_sibling_roundtrips() {
    let out = canonicalize_from_sqlite(input_with_shares(owner_tables(), vec![])).unwrap();
    let manifest_json = serde_json::to_string(&out.first().manifest).unwrap();
    let key_json = extract_encryption_key_for_public_key_json(&manifest_json, "pub").unwrap();
    let key: serde_json::Value = serde_json::from_str(&key_json).unwrap();
    assert_eq!(key["PrivateKey"], json!("priv"));

    let miss = extract_encryption_key_for_public_key_json(&manifest_json, "nope").unwrap();
    assert_eq!(miss, "null");
}

// ─────────────────────────────────────────────────────────────────────────────
// Wire-format compatibility
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn manifest_specs_deserialize_from_camel_case_json() {
    // Every manifest is described the same way on the wire — id, salt, optional name — with nothing
    // marking one of them as special. A manifest carries a name, never a folder anchor.
    let input_json = json!({
        "tables": [{ "name": "Items", "records": [] }],
        "canonicalizedAt": "2026-01-01T00:00:00.000Z",
        "manifests": [
            { "manifestId": PERSONAL_M, "manifestSalt": SALT_PERSONAL },
            { "manifestId": "m-1", "manifestSalt": SALT_SHARED, "name": "Team", "anchorFolderId": "f-1" }
        ]
    })
    .to_string();
    let out_json = canonicalize_from_sqlite_json(&input_json).unwrap();
    let out: CanonicalizedVault = serde_json::from_str(&out_json).unwrap();
    assert_eq!(out.rest().len(), 1);
    assert_eq!(out.rest()[0].manifest.manifest_id, "m-1");
    assert_eq!(out.rest()[0].manifest.name.as_deref(), Some("Team"));

    // One entry per spec, in spec order, all shaped alike; the buckets sit beside them, not inside one.
    let value: serde_json::Value = serde_json::from_str(&out_json).unwrap();
    assert_eq!(value["manifests"][0]["manifest"]["manifestId"], json!(PERSONAL_M));
    assert_eq!(value["manifests"][1]["manifest"]["manifestId"], json!("m-1"));
    assert_eq!(value["manifests"][1]["manifest"]["name"], json!("Team"));
    assert!(value["manifests"].as_array().unwrap().iter().all(|m| m.get("isPersonal").is_none()), "no manifest is flagged");
    assert!(value["dataBuckets"].is_array(), "buckets belong to the vault");
    assert!(value["manifests"][0].get("dataBuckets").is_none());
    assert!(value["manifests"][1]["manifest"].get("anchorFolderId").is_none(), "folder anchoring is a client concern, never persisted");
}

#[test]
fn materialize_input_accepts_every_manifest_in_one_list_from_json() {
    let owner = canonicalize_owner();
    let schema = fitting_schema([&owner.first().manifest, &owner.rest()[0].manifest], &owner.data_buckets.clone());
    let input_json = json!({
        "manifests": [owner.first().manifest, owner.rest()[0].manifest],
        "dataBuckets": owner.data_buckets.clone(),
        "schemaColumns": schema,
    })
    .to_string();
    let out_json = materialize_as_sqlite_json(&input_json).unwrap();
    let out: MaterializedTables = serde_json::from_str(&out_json).unwrap();
    let items = out.tables.iter().find(|t| t.name == "Items").unwrap();
    assert_eq!(items.records.len(), 4);
}

/// A vault is made of manifests; with none there is nothing to combine into and no data-model version
/// to report, so materialize refuses rather than emitting an empty vault.
#[test]
fn materialize_rejects_an_empty_manifest_list() {
    let empty = materialize_as_sqlite(materialize_manifests(vec![], vec![]));
    assert!(empty.unwrap_err().to_string().contains("no manifests"));
}

/// Nothing marks a manifest as the caller's own: the list order says it. The first entry is the base
/// the others combine into, and the bookkeeping rows record every manifest alike — id and name, no
/// claim about which one is whose. Nothing about the base becomes a vault-wide fact either: the base
/// contributes no schema/version claim the other manifests are then held to.
#[test]
fn materialize_treats_the_first_manifest_as_the_base() {
    let owner = canonicalize_owner();
    let shared = owner.rest()[0].manifest.clone();
    let own = owner.first().manifest.clone();

    let re = materialize_as_sqlite(materialize_manifests(vec![own, shared], owner.data_buckets.clone())).unwrap();

    // Nothing version-shaped travels with the manifests; the platform's own schema decides that alone.
    let json = serde_json::to_string(&re).unwrap();
    assert!(!json.contains("migration"), "materialize reports no migration id: the schema the platform applies is the only one there is");

    let manifests = re.tables.iter().find(|t| t.name == "Manifests").unwrap();
    assert_eq!(manifests.records.len(), 2);
    assert_eq!(manifests.records[0]["Id"], json!(PERSONAL_M), "bookkeeping rows follow the input order");
    assert!(manifests.records.iter().all(|r| !r.contains_key("IsPersonal")), "no manifest is flagged as the vault's own");
}

/// Rebind every `{ "__blobRef": hash }` cell to the inline bytes the platform inserts into SQLite,
/// what a real pull does before the next read hands the rows back to canonicalize. Without this a
/// round-trip test never exercises the blob path (an unresolved ref canonicalizes to NULL).
fn rebind_blobs(tables: &mut [CodecTableData], blobs: &HashMap<String, BlobEntry>) {
    for table in tables.iter_mut() {
        for record in table.records.iter_mut() {
            let refs: Vec<(String, String)> = record
                .iter()
                .filter_map(|(col, value)| Some((col.clone(), value.get("__blobRef")?.as_str()?.to_string())))
                .collect();
            for (col, hash) in refs {
                let bytes = blobs.get(&hash).map(|b| b.bytes_base64.clone()).unwrap_or_default();
                record.insert(col, json!({ "__b64": bytes }));
            }
        }
    }
}

#[test]
fn member_push_preserves_the_shared_logo_bytes() {
    // Full member round trip WITH blob bytes bound, as a real pull does: owner shares a folder, the
    // member materializes it, then pushes back an unrelated change. The shared manifest they push must
    // still carry the logo, row, scope, and bytes.
    let owner = canonicalize_owner();
    let owner_shared = &owner.rest()[0];
    let (recipient_manifest, buckets) = recipient_personal_manifest();

    let re = materialize_as_sqlite(materialize_input(recipient_manifest, vec![owner_shared.manifest.clone()], buckets)).unwrap();

    // The member's SQLite: rows with real bytes in the blob columns.
    let mut member_tables: Vec<CodecTableData> = re.tables.iter().map(|t| table(&t.name, t.records.clone())).collect();
    let mut all_blobs = owner.first().blobs.clone();
    all_blobs.extend(owner_shared.blobs.clone());
    rebind_blobs(&mut member_tables, &all_blobs);

    let pushed = canonicalize_from_sqlite(input_with_shares(member_tables, vec![spec("f-shared")])).unwrap();
    let pushed_shared = &pushed.rest()[0];
    let logo = logo_row(&pushed_shared.manifest, "github.com");

    let blob_ref = logo["FileData"]["__blobRef"].as_str().expect("member's push keeps the logo's bytes as a blob ref");
    let entry = pushed_shared.blobs.get(blob_ref).expect("and registers those bytes in the shared manifest's blob map");
    assert_eq!(entry.bytes_base64, b64(&[0xAA, 0xBB]), "the bytes are the owner's original logo");

    // The item still points at that row, so the logo survives the member's next pull.
    let item = rows(&pushed_shared.manifest, "Items").iter().find(|r| r["Id"] == json!("i-shared")).unwrap();
    assert_eq!(item["LogoId"], logo["Id"]);
}

/// The member's SQLite after pulling the owner's share, with blob bytes bound as the platform binds them.
fn member_tables_after_pull(owner: &CanonicalizedVault) -> Vec<CodecTableData> {
    let (recipient_manifest, buckets) = recipient_personal_manifest();
    let re = materialize_as_sqlite(materialize_input(recipient_manifest, vec![owner.rest()[0].manifest.clone()], buckets)).unwrap();
    let mut tables: Vec<CodecTableData> = re.tables.iter().map(|t| table(&t.name, t.records.clone())).collect();
    let mut all_blobs = owner.first().blobs.clone();
    all_blobs.extend(owner.rest()[0].blobs.clone());
    rebind_blobs(&mut tables, &all_blobs);
    tables
}

#[test]
fn member_edit_repointing_the_item_at_a_personal_logo_keeps_the_shared_logo() {
    // What the client does when a member edits a shared item: FaviconService only ever looks up (and
    // creates) personal-scope rows, so the item ends up pointing at a fresh personal row. The push must
    // fold that back onto the folder's own row instead of losing the folder's logo.
    let owner = canonicalize_owner();
    let mut tables = member_tables_after_pull(&owner);

    let personal_id = logo_id(PERSONAL_M, "github.com");
    let logos = tables.iter_mut().find(|t| t.name == "Logos").unwrap();
    logos.records.push(row(&[
        ("Id", json!(personal_id)),
        ("Source", json!("github.com")),
        ("ManifestId", json!(PERSONAL_M)),
        ("FileData", json!({ "__b64": b64(&[0x77, 0x88]) })),
    ]));
    let items = tables.iter_mut().find(|t| t.name == "Items").unwrap();
    items.records.iter_mut().find(|r| r["Id"] == json!("i-shared")).unwrap().insert("LogoId".to_string(), json!(personal_id));

    let pushed = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();
    let shared = &pushed.rest()[0];
    let logo = logo_row(&shared.manifest, "github.com");
    let blob_ref = logo["FileData"]["__blobRef"].as_str().expect("shared logo still carries bytes");
    assert_eq!(shared.blobs[blob_ref].bytes_base64, b64(&[0xAA, 0xBB]), "the folder keeps the logo its members agreed on");

    let item = rows(&shared.manifest, "Items").iter().find(|r| r["Id"] == json!("i-shared")).unwrap();
    assert_eq!(item["LogoId"], logo["Id"], "the item was folded back onto the folder's row");
}

#[test]
fn member_whose_shared_logo_blob_never_arrived_does_not_wipe_the_folders_logo() {
    // The member's pull could not resolve the shared logo's bytes (blob missing/undecryptable), so their
    // local row sits there empty while their own personal row for that domain has real bytes. Their next
    // push must NOT publish the empty row as the folder's logo: that drops the last reference to the
    // owner's blob and every member loses the image.
    let owner = canonicalize_owner();
    let mut tables = member_tables_after_pull(&owner);

    let shared_logo_id = logo_id("m-f-shared", "github.com");
    let personal_id = logo_id(PERSONAL_M, "github.com");
    let logos = tables.iter_mut().find(|t| t.name == "Logos").unwrap();
    logos.records.iter_mut().find(|r| r["Id"] == json!(shared_logo_id)).unwrap().insert("FileData".to_string(), serde_json::Value::Null);
    logos.records.push(row(&[
        ("Id", json!(personal_id)),
        ("Source", json!("github.com")),
        ("ManifestId", json!(PERSONAL_M)),
        ("FileData", json!({ "__b64": b64(&[0x77, 0x88]) })),
    ]));
    let items = tables.iter_mut().find(|t| t.name == "Items").unwrap();
    items.records.iter_mut().find(|r| r["Id"] == json!("i-shared")).unwrap().insert("LogoId".to_string(), json!(personal_id));

    let pushed = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();
    let shared = &pushed.rest()[0];
    let logo = logo_row(&shared.manifest, "github.com");
    assert!(logo["FileData"]["__blobRef"].is_string(), "the pushed folder logo must still carry bytes, got {:?}", logo["FileData"]);
    assert!(!shared.blobs.is_empty(), "and register them so the write keeps a live blob reference");
}

// ─────────────────────────────────────────────────────────────────────────────
// Logo kinds: one row shape, one `Items.LogoId` pointer, three key spaces.
// ─────────────────────────────────────────────────────────────────────────────

/// The scoped logo id for any `(scope, kind, source)`.
fn logo_id_of_kind(scope: &str, kind: &str, source: &str) -> String {
    scoped_assets::logo_id_for(scope, kind, source)
}

#[test]
fn logo_kinds_key_independently_so_a_domain_and_a_catalog_key_never_collide() {
    // Kind is part of the natural key: the same Source string in two kinds is two different logos,
    // and neither may swallow the other when a scope is normalized.
    let tables = vec![
        table("Items", vec![
            row(&[("Id", json!("i-fav")), ("FolderId", serde_json::Value::Null), ("LogoId", json!("legacy-fav"))]),
            row(&[("Id", json!("i-builtin")), ("FolderId", serde_json::Value::Null), ("LogoId", json!("legacy-builtin"))]),
        ]),
        table("Logos", vec![
            row(&[("Id", json!("legacy-fav")), ("Kind", json!("favicon")), ("Source", json!("shopping")), ("FileData", json!({ "__b64": b64(&[1, 2]) }))]),
            row(&[("Id", json!("legacy-builtin")), ("Kind", json!("builtin")), ("Source", json!("shopping")), ("FileData", serde_json::Value::Null)]),
        ]),
    ];

    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![])).unwrap();
    let logos = rows(&out.first().manifest, "Logos");
    assert_eq!(logos.len(), 2, "both kinds survive: {:?}", logos);

    let fav_id = logo_id_of_kind(PERSONAL_M, "favicon", "shopping");
    let builtin_id = logo_id_of_kind(PERSONAL_M, "builtin", "shopping");
    assert_ne!(fav_id, builtin_id, "kinds must derive into different ids");
    assert_eq!(ids(logos), { let mut e = vec![fav_id.as_str(), builtin_id.as_str()]; e.sort(); e });

    let items = rows(&out.first().manifest, "Items");
    let item = |id: &str| items.iter().find(|r| r["Id"] == json!(id)).unwrap().clone();
    assert_eq!(item("i-fav")["LogoId"], json!(fav_id));
    assert_eq!(item("i-builtin")["LogoId"], json!(builtin_id));
}

#[test]
fn icon_row_without_a_kind_is_a_favicon_and_keeps_its_legacy_id() {
    // Rows written before the Kind column exists must not be re-minted: their id has to stay exactly
    // what `logo_id_for_source` produces, or every item in every older vault loses its logo once.
    let tables = vec![
        table("Items", vec![row(&[("Id", json!("i-1")), ("FolderId", serde_json::Value::Null), ("LogoId", json!("random-guid"))])]),
        table("Logos", vec![row(&[("Id", json!("random-guid")), ("Source", json!("github.com")), ("FileData", json!({ "__b64": b64(&[7]) }))])]),
    ];

    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![])).unwrap();
    let logo = &rows(&out.first().manifest, "Logos")[0];
    assert_eq!(logo["Id"], json!(logo_id(PERSONAL_M, "github.com")), "a kindless row derives as a favicon");
    assert_eq!(logo["Kind"], json!("favicon"), "and is stamped with the kind it implicitly had");
}

#[test]
fn a_custom_logo_follows_its_item_into_a_shared_manifest() {
    // An uploaded logo is scoped like a favicon: the item that uses it moves into the share, so the
    // image is cloned into that manifest under the folder-scoped id and the item repointed at it.
    let content_hash = "a".repeat(64);
    let mut tables = owner_tables();
    tables.iter_mut().find(|t| t.name == "Items").unwrap().records.iter_mut().find(|r| r["Id"] == json!("i-shared")).unwrap()
        .insert("LogoId".to_string(), json!("personal-custom"));
    tables.iter_mut().find(|t| t.name == "Logos").unwrap().records.push(row(&[
        ("Id", json!("personal-custom")),
        ("Kind", json!("custom")),
        ("Source", json!(content_hash.clone())),
        ("ManifestId", json!(PERSONAL_M)),
        ("FileData", json!({ "__b64": b64(&[0xaa, 0xbb, 0xcc]) })),
    ]));

    // Moving an item across a folder boundary moves it across a manifest boundary: the client
    // re-stamps it on the move, so the fixture does too.
    let tables = stamp_subtree(tables, "f-shared", "m-f-shared");
    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();
    let shared = &out.rest()[0];
    let scoped_id = logo_id_of_kind("m-f-shared", "custom", &content_hash);
    let cloned = rows(&shared.manifest, "Logos").iter().find(|r| r["Id"] == json!(scoped_id))
        .expect("the uploaded logo is cloned into the folder's manifest");
    assert_eq!(cloned["Kind"], json!("custom"));
    assert_eq!(cloned["ManifestId"], json!("m-f-shared"));
    assert!(cloned["FileData"]["__blobRef"].is_string(), "with its bytes, so members can render it");

    let shared_item = rows(&shared.manifest, "Items").iter().find(|r| r["Id"] == json!("i-shared")).unwrap().clone();
    assert_eq!(shared_item["LogoId"], json!(scoped_id), "and the item points at the folder-scoped row");
}

#[test]
fn a_builtin_logo_survives_without_any_image_bytes() {
    // Built-in logos carry no FileData at all: every platform draws them from the shared catalog. The
    // row must still round-trip (and travel into a share) rather than being dropped as "empty".
    let mut tables = owner_tables();
    tables.iter_mut().find(|t| t.name == "Items").unwrap().records.iter_mut().find(|r| r["Id"] == json!("i-shared")).unwrap()
        .insert("LogoId".to_string(), json!("builtin-row"));
    tables.iter_mut().find(|t| t.name == "Logos").unwrap().records.push(row(&[
        ("Id", json!("builtin-row")),
        ("Kind", json!("builtin")),
        ("Source", json!("shopping")),
        ("ManifestId", json!(PERSONAL_M)),
        ("FileData", serde_json::Value::Null),
    ]));

    // Moving an item across a folder boundary moves it across a manifest boundary: the client
    // re-stamps it on the move, so the fixture does too.
    let tables = stamp_subtree(tables, "f-shared", "m-f-shared");
    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();
    let shared = &out.rest()[0];
    let scoped_id = logo_id_of_kind("m-f-shared", "builtin", "shopping");
    let logo = rows(&shared.manifest, "Logos").iter().find(|r| r["Id"] == json!(scoped_id))
        .expect("a bytesless built-in logo still belongs in the manifest");
    assert_eq!(logo["Source"], json!("shopping"), "the catalog key is what identifies it");

    let shared_item = rows(&shared.manifest, "Items").iter().find(|r| r["Id"] == json!("i-shared")).unwrap().clone();
    assert_eq!(shared_item["LogoId"], json!(scoped_id));
}

// ─────────────────────────────────────────────────────────────────────────────
// Folder keypairs (manifest-stamped `EncryptionKeys` rows)
//
// One table serves every manifest: personal-stamped rows are the personal manifest's own delivery keys,
// shared-manifest-stamped rows are that folder's delivery keypair. The guards point both ways — a
// personal key must never travel INTO a shared manifest, and a folder key must never travel OUT of
// its own. Both directions are attacks a folder co-owner can attempt by writing rows into a manifest
// the victim materializes.
// ─────────────────────────────────────────────────────────────────────────────

/// A delivery keypair row stamped with `scope` (a manifest id, or a legacy folder-id stamp).
fn folder_key(id: &str, scope: &str, public_key: &str, is_primary: i32) -> CodecRecord {
    row(&[
        ("Id", json!(id)),
        ("ManifestId", json!(scope)),
        ("PublicKey", json!(public_key)),
        ("PrivateKey", json!(format!("priv-{}", public_key))),
        ("IsPrimary", json!(is_primary)),
    ])
}

/// Owner tables plus extra `EncryptionKeys` rows (canonicalize merges same-named table chunks), so the
/// keypair tests don't disturb the shared fixtures. The base fixture already carries the personal key "ek-1".
fn owner_tables_with_folder_keys(keys: Vec<CodecRecord>) -> Vec<CodecTableData> {
    let mut tables = owner_tables();
    tables.push(table("EncryptionKeys", keys));
    tables
}

#[test]
fn split_routes_folder_keypair_into_its_manifest_and_never_the_personal_one() {
    let out = canonicalize_from_sqlite(input_with_shares(
        owner_tables_with_folder_keys(vec![folder_key("sfk-1", "m-f-shared", "pub-folder", 1)]),
        vec![spec("f-shared")],
    ))
    .unwrap();

    assert_eq!(ids(rows(&out.rest()[0].manifest, "EncryptionKeys")), vec!["sfk-1"]);
    assert_eq!(ids(rows(&out.first().manifest, "EncryptionKeys")), vec!["ek-1"], "the personal manifest keeps exactly its personal keys");
    // The unstamped legacy personal row was adopted: stamped with the personal manifest's id.
    assert_eq!(rows(&out.first().manifest, "EncryptionKeys")[0]["ManifestId"], json!(PERSONAL_M));
}

#[test]
fn split_drops_a_keypair_stamped_for_a_manifest_that_is_not_in_this_push() {
    // A key row whose stamp names no manifest being written is dropped, never re-homed into the personal manifest:
    // a stale key falling back would resurrect the old keypair if that manifest is ever re-created.
    let out = canonicalize_from_sqlite(input_with_shares(
        owner_tables_with_folder_keys(vec![folder_key("sfk-gone", "m-deleted", "pub-folder", 1)]),
        vec![spec("f-shared")],
    ))
    .unwrap();
    assert!(rows(&out.rest()[0].manifest, "EncryptionKeys").is_empty());
    assert!(!ids(rows(&out.first().manifest, "EncryptionKeys")).contains(&"sfk-gone"));
}

#[test]
fn split_drops_folder_keypair_whose_scope_is_not_shared() {
    // A key row stamped for a manifest that is not part of this push (revoked, deleted, or fabricated
    // locally) has nowhere to go: it must be dropped, NOT fall back into the personal manifest — a stale
    // copy demoted into the personal manifest would resurrect the old keypair on a future re-share, and would
    // leave a private delivery key in a namespace revocation cannot reach.
    let out = canonicalize_from_sqlite(input_with_shares(
        owner_tables_with_folder_keys(vec![
            folder_key("sfk-live", "m-f-shared", "pub-folder", 1),
            folder_key("sfk-orphan", "m-dead-manifest", "pub-orphan", 1),
            folder_key("sfk-orphan-legacy", "f-personal", "pub-orphan2", 1),
        ]),
        vec![spec("f-shared")],
    ))
    .unwrap();

    assert_eq!(ids(rows(&out.rest()[0].manifest, "EncryptionKeys")), vec!["sfk-live"]);
    assert_eq!(ids(rows(&out.first().manifest, "EncryptionKeys")), vec!["ek-1"], "orphaned folder keypair dropped, never demoted to the personal manifest");
}

#[test]
fn split_drops_folder_keypair_even_when_nothing_is_shared() {
    // The unshare window: sharing was just turned off (no specs this push) but the local DB still
    // holds the folder's key rows. They must be dropped, not leak into the personal manifest.
    let out = canonicalize_from_sqlite(input_with_shares(
        owner_tables_with_folder_keys(vec![folder_key("sfk-stale", "m-f-shared", "pub-stale", 1)]),
        vec![],
    ))
    .unwrap();
    assert!(out.rest().is_empty());
    assert_eq!(ids(rows(&out.first().manifest, "EncryptionKeys")), vec!["ek-1"], "stale folder keypair dropped from the personal manifest");
}

#[test]
fn combine_accepts_folder_keypair_from_the_manifest_that_owns_it() {
    // The whole point of folder-scoped rows: a recipient materializes the folder's keypair so they can
    // decrypt mail sent to the folder's shared aliases.
    let owner = canonicalize_from_sqlite(input_with_shares(
        owner_tables_with_folder_keys(vec![folder_key("sfk-1", "m-f-shared", "pub-folder", 1)]),
        vec![spec("f-shared")],
    ))
    .unwrap();

    let (recipient_manifest, buckets) = recipient_personal_manifest();
    let re = materialize_as_sqlite(materialize_input(recipient_manifest, vec![owner.rest()[0].manifest.clone()], buckets)).unwrap();
    let map = materialized_map(&re);

    // The folder's keypair lands next to the recipient's own personal key, distinguished by scope.
    assert_eq!(ids(&map["EncryptionKeys"]), vec!["ek-r", "sfk-1"]);
    let folder_row = map["EncryptionKeys"].iter().find(|r| r["Id"] == json!("sfk-1")).unwrap();
    assert_eq!(folder_row["PrivateKey"], json!("priv-pub-folder"));
    assert_eq!(folder_row["ManifestId"], json!("m-f-shared"));
}

#[test]
fn combine_drops_folder_keypair_scoped_to_another_folder() {
    /*
     * The injection attack the scope filter exists to resist. Mallory co-owns folder A and writes into
     * A's manifest a keypair claiming to be folder B's delivery key. If the recipient accepted it,
     * their client would publish Mallory's public key for B and all of B's mail would be readable by her.
     *
     * The row is DROPPED rather than re-scoped to A: stamping it with A's id would merely turn the
     * attack into "displace A's real keypair", which is no better.
     */
    let owner = canonicalize_from_sqlite(input_with_shares(
        owner_tables_with_folder_keys(vec![folder_key("sfk-legit", "m-f-shared", "pub-folder", 1)]),
        vec![spec("f-shared")],
    ))
    .unwrap();

    let mut evil = owner.rest()[0].manifest.clone();
    evil.tables.get_mut("EncryptionKeys").unwrap().push(folder_key("sfk-evil", "m-other-manifest", "pub-mallory", 1));

    let (recipient_manifest, buckets) = recipient_personal_manifest();
    let re = materialize_as_sqlite(materialize_input(recipient_manifest, vec![evil], buckets)).unwrap();
    let map = materialized_map(&re);

    assert_eq!(ids(&map["EncryptionKeys"]), vec!["ek-r", "sfk-legit"], "cross-folder key row dropped");
    assert!(
        !map["EncryptionKeys"].iter().any(|r| r["PublicKey"] == json!("pub-mallory")),
        "the injected key must not survive under any scope, including a re-stamped one"
    );
}

#[test]
fn combine_drops_folder_keypair_carried_by_a_personal_manifest() {
    // Canonicalize never emits one, so a folder-scoped key row in a personal manifest means a tampered or
    // malformed manifest. Drop it rather than materialize key material with no owning folder.
    let (mut recipient_manifest, buckets) = recipient_personal_manifest();
    recipient_manifest.tables.get_mut("EncryptionKeys").unwrap().push(folder_key("sfk-orphan", "f-whatever", "pub-x", 1));

    let re = materialize_as_sqlite(materialize_input(recipient_manifest, vec![], buckets)).unwrap();
    let map = materialized_map(&re);
    assert_eq!(ids(&map["EncryptionKeys"]), vec!["ek-r"], "personal-manifest-carried folder keypair dropped");
}

#[test]
fn encryption_keys_is_scoped_rather_than_personal_or_bucketed() {
    /*
     * Pins the routing class itself: the keypair table travels inside the manifest its scope names, so
     * it must be neither personal-only (which would pin every row to the personal manifest) nor bucketed
     * (which would move it out of the manifest into a resource of its own).
     */
    assert!(!is_personal_table("EncryptionKeys"));
    assert!(!is_bucketed_table("EncryptionKeys"));

    /*
     * And pins the two axes apart. Bucketed says where a table syncs; personal says which manifests may
     * hold it. Settings is bucketed and NOT personal — its bucket belongs to a manifest, so a shared
     * manifest carrying its own settings is a routing question, never a rule violation.
     */
    assert!(is_bucketed_table("Settings"));
    assert!(!is_personal_table("Settings"));
}

#[test]
fn folder_keypair_survives_a_full_split_combine_roundtrip() {
    let out = canonicalize_from_sqlite(input_with_shares(
        owner_tables_with_folder_keys(vec![folder_key("sfk-1", "m-f-shared", "pub-folder", 1)]),
        vec![spec("f-shared")],
    ))
    .unwrap();
    let re = materialize_as_sqlite(materialize_input(out.first().manifest.clone(), out.rest().iter().map(|s| s.manifest.clone()).collect(), out.data_buckets.clone())).unwrap();
    let map = materialized_map(&re);
    assert_eq!(ids(&map["EncryptionKeys"]), vec!["ek-1", "sfk-1"]);
}

#[test]
fn active_folder_key_is_the_primary_row_and_rotated_keys_stay_resolvable() {
    // After a rotation the superseded row stays in the manifest so mail received before the rotation
    // remains decryptable, but only the live primary is offered as the folder's delivery key.
    let out = canonicalize_from_sqlite(input_with_shares(
        owner_tables_with_folder_keys(vec![
            folder_key("sfk-old", "m-f-shared", "pub-old", 0),
            folder_key("sfk-cur", "m-f-shared", "pub-cur", 1),
        ]),
        vec![spec("f-shared")],
    ))
    .unwrap();
    let shared = &out.rest()[0].manifest;

    assert_eq!(active_encryption_key(shared).expect("primary key present")["Id"], json!("sfk-cur"));
    assert_eq!(
        extract_encryption_key_for_public_key(shared, "pub-old").expect("rotated key still resolvable")["PrivateKey"],
        json!("priv-pub-old")
    );
    assert!(extract_encryption_key_for_public_key(shared, "pub-nonexistent").is_none());
}

#[test]
fn folder_key_lookup_ignores_deleted_and_out_of_scope_rows() {
    let mut manifest = canonicalize_from_sqlite(input_with_shares(
        owner_tables_with_folder_keys(vec![folder_key("sfk-cur", "m-f-shared", "pub-cur", 1)]),
        vec![spec("f-shared")],
    ))
    .unwrap()
    .rest()[0]
        .manifest
        .clone();

    // A caller that skips combine must still not be handed another folder's key material.
    manifest.tables.get_mut("EncryptionKeys").unwrap().push(folder_key("sfk-foreign", "m-other", "pub-foreign", 1));
    assert!(extract_encryption_key_for_public_key(&manifest, "pub-foreign").is_none(), "out-of-scope row ignored");

    let mut deleted = folder_key("sfk-dead", "m-f-shared", "pub-dead", 0);
    deleted.insert("IsDeleted".to_string(), json!(1));
    manifest.tables.get_mut("EncryptionKeys").unwrap().push(deleted);
    assert!(extract_encryption_key_for_public_key(&manifest, "pub-dead").is_none(), "deleted row ignored");
}

#[test]
fn validate_rejects_misplaced_folder_keypairs_before_upload() {
    // Catching this at validate time means a tampered vault fails loudly on push instead of quietly
    // losing rows at each recipient's combine step.
    let out = canonicalize_from_sqlite(input_with_shares(
        owner_tables_with_folder_keys(vec![folder_key("sfk-1", "m-f-shared", "pub-folder", 1)]),
        vec![spec("f-shared")],
    ))
    .unwrap();

    let mut personal = out.first().manifest.clone();
    personal.tables.get_mut("EncryptionKeys").unwrap().push(folder_key("sfk-orphan", "m-f-shared", "pub-x", 1));
    let result = validate_manifest(&personal);
    assert!(!result.ok);
    assert!(result.failed_rules.contains(&"encryption-keys-scope-mismatch".to_string()));

    let mut shared = out.rest()[0].manifest.clone();
    shared.tables.get_mut("EncryptionKeys").unwrap().push(folder_key("sfk-evil", "m-other", "pub-mallory", 1));
    let result = validate_manifest(&shared);
    assert!(!result.ok);
    assert!(result.failed_rules.contains(&"encryption-keys-scope-mismatch".to_string()));

    // The well-formed pair still validates.
    assert!(validate_manifest(&out.rest()[0].manifest).ok);
    assert!(validate_manifest(&out.first().manifest).ok);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-manifest routing: the same id in two manifests
// ─────────────────────────────────────────────────────────────────────────────
//
// A manifest is a namespace, so two of them may each hold a row with the same `Id` — and they do, for
// ordinary reasons: a member moves a shared item into their own vault (the client re-stamps the row and
// keeps its id), or an item that was moved out comes back through another member's push. Every rule
// that resolves a reference therefore has to resolve it by `(ManifestId, Id)`, both halves. Anything
// that keys on the bare id sends rows across a manifest boundary — which for a shared manifest means
// handing them to other people.

/// Two manifests each holding an item with the same id, each with its own child rows. `personal_secret`
/// / `shared_secret` are what the assertions look for: the personal one must never appear in the share.
fn tables_with_a_duplicated_item_id() -> Vec<CodecTableData> {
    vec![
        table("Folders", vec![
            row(&[("Id", json!("f-personal")), ("Name", json!("Personal")), ("ParentFolderId", serde_json::Value::Null), ("ManifestId", json!(PERSONAL_M))]),
            row(&[("Id", json!("f-shared")), ("Name", json!("Family")), ("ParentFolderId", serde_json::Value::Null), ("ManifestId", json!("m-f-shared"))]),
        ]),
        table("Items", vec![
            row(&[("Id", json!("i-dup")), ("Name", json!("mine")), ("FolderId", json!("f-personal")), ("ManifestId", json!(PERSONAL_M))]),
            row(&[("Id", json!("i-dup")), ("Name", json!("ours")), ("FolderId", json!("f-shared")), ("ManifestId", json!("m-f-shared"))]),
        ]),
        table("FieldValues", vec![
            row(&[("Id", json!("fv-personal")), ("ItemId", json!("i-dup")), ("FieldKey", json!("password")), ("Value", json!("personal_secret")), ("ManifestId", json!(PERSONAL_M))]),
            row(&[("Id", json!("fv-shared")), ("ItemId", json!("i-dup")), ("FieldKey", json!("password")), ("Value", json!("shared_secret")), ("ManifestId", json!("m-f-shared"))]),
        ]),
        table("TotpCodes", vec![
            row(&[("Id", json!("totp-personal")), ("ItemId", json!("i-dup")), ("SecretKey", json!({ "__b64": b64(b"personal_secret") })), ("ManifestId", json!(PERSONAL_M))]),
            row(&[("Id", json!("totp-shared")), ("ItemId", json!("i-dup")), ("SecretKey", json!({ "__b64": b64(b"shared_secret") })), ("ManifestId", json!("m-f-shared"))]),
        ]),
        table("Attachments", vec![
            row(&[("Id", json!("att-personal")), ("ItemId", json!("i-dup")), ("Blob", json!({ "__b64": b64(b"personal_secret") })), ("ManifestId", json!(PERSONAL_M))]),
        ]),
        table("Passkeys", vec![
            row(&[("Id", json!("pk-personal")), ("ItemId", json!("i-dup")), ("PrivateKey", json!("personal_secret")), ("ManifestId", json!(PERSONAL_M))]),
        ]),
        table("FieldHistories", vec![
            row(&[("Id", json!("fh-personal")), ("ItemId", json!("i-dup")), ("Value", json!("personal_secret")), ("ManifestId", json!(PERSONAL_M))]),
        ]),
        table("ItemTags", vec![
            row(&[("Id", json!("it-personal")), ("ItemId", json!("i-dup")), ("TagId", json!("tag-personal")), ("ManifestId", json!(PERSONAL_M))]),
        ]),
        table("Tags", vec![
            row(&[("Id", json!("tag-personal")), ("Name", json!("personal_secret")), ("ManifestId", json!(PERSONAL_M))]),
        ]),
    ]
}

/// Every string a manifest carries, at any depth, so a test can ask whether a secret leaked into it
/// without having to know which column of which table it would have arrived in.
fn all_strings(m: &Manifest) -> Vec<String> {
    fn walk(value: &serde_json::Value, out: &mut Vec<String>) {
        match value {
            serde_json::Value::String(s) => out.push(s.clone()),
            serde_json::Value::Array(items) => items.iter().for_each(|v| walk(v, out)),
            serde_json::Value::Object(map) => map.values().for_each(|v| walk(v, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    for rows in m.tables.values() {
        for row in rows {
            for value in row.values() {
                walk(value, &mut out);
            }
        }
    }
    out
}

/// True when `needle` appears anywhere in the manifest, base64-encoded blobs included.
fn manifest_mentions(m: &Manifest, needle: &str) -> bool {
    let encoded = b64(needle.as_bytes());
    all_strings(m).iter().any(|s| s == needle || s == &encoded)
}

#[test]
fn split_never_follows_a_bare_item_id_into_another_manifest() {
    /*
     * The leak this whole section exists for. Both manifests hold an item called `i-dup`; the personal
     * one's child rows carry a password, a TOTP secret, an attachment, a passkey and a field history.
     * Routing them by the bare `ItemId` would send every one of them into the manifest shared with
     * other people.
     */
    let out = canonicalize_from_sqlite(raw_input_with_shares(tables_with_a_duplicated_item_id(), vec![spec("f-shared")])).unwrap();
    let personal = &out.first().manifest;
    let shared = &out.rest()[0].manifest;

    assert!(!manifest_mentions(shared, "personal_secret"), "a personal item's child rows must never follow a same-id item into a shared manifest");
    assert!(manifest_mentions(personal, "personal_secret"), "and they must still be in the manifest they belong to");

    // Each manifest keeps exactly its own child rows, and the shared one keeps working.
    assert_eq!(values(rows(personal, "FieldValues")), vec!["personal_secret"]);
    assert_eq!(values(rows(shared, "FieldValues")), vec!["shared_secret"]);
    assert_eq!(ids(rows(personal, "TotpCodes")), vec!["totp-personal"]);
    assert_eq!(ids(rows(shared, "TotpCodes")), vec!["totp-shared"]);
    for name in ["Attachments", "Passkeys", "FieldHistories", "ItemTags"] {
        assert!(rows(shared, name).is_empty(), "{name} of the personal item stayed out of the share");
        assert_eq!(rows(personal, name).len(), 1, "{name} of the personal item stayed with it");
    }
}

#[test]
fn split_never_pulls_a_shared_items_child_into_the_personal_manifest() {
    // The same rule read the other way: the share's own rows must not be swept into the personal
    // manifest because a personal item happens to carry the same id.
    let out = canonicalize_from_sqlite(raw_input_with_shares(tables_with_a_duplicated_item_id(), vec![spec("f-shared")])).unwrap();
    assert!(!manifest_mentions(&out.first().manifest, "shared_secret"), "the share's rows stayed in the share");
    assert!(manifest_mentions(&out.rest()[0].manifest, "shared_secret"));
}

#[test]
fn split_keeps_child_rows_when_a_manifest_this_vault_lost_shares_their_item_id() {
    /*
     * A row stamped for a manifest this vault no longer carries is dropped — but only its own rows. An
     * item left behind by a revoked share must not take the child rows of a live item that happens to
     * carry the same id down with it.
     */
    let tables = vec![
        table("Folders", vec![row(&[("Id", json!("f-personal")), ("Name", json!("Personal")), ("ParentFolderId", serde_json::Value::Null), ("ManifestId", json!(PERSONAL_M))])]),
        table("Items", vec![
            row(&[("Id", json!("i-dup")), ("Name", json!("mine")), ("FolderId", json!("f-personal")), ("ManifestId", json!(PERSONAL_M))]),
            row(&[("Id", json!("i-dup")), ("Name", json!("revoked")), ("FolderId", serde_json::Value::Null), ("ManifestId", json!("m-revoked"))]),
        ]),
        table("FieldValues", vec![
            row(&[("Id", json!("fv-personal")), ("ItemId", json!("i-dup")), ("FieldKey", json!("password")), ("Value", json!("personal_secret")), ("ManifestId", json!(PERSONAL_M))]),
            row(&[("Id", json!("fv-revoked")), ("ItemId", json!("i-dup")), ("FieldKey", json!("password")), ("Value", json!("gone")), ("ManifestId", json!("m-revoked"))]),
        ]),
    ];

    let out = canonicalize_from_sqlite(raw_input_with_shares(tables, vec![])).unwrap();
    let personal = &out.first().manifest;
    assert_eq!(ids(rows(personal, "Items")), vec!["i-dup"], "the revoked manifest's item is dropped, the live one kept");
    assert_eq!(values(rows(personal, "FieldValues")), vec!["personal_secret"], "the live item keeps its own child rows");
    assert!(!manifest_mentions(personal, "gone"), "the revoked manifest's rows are not adopted into the personal one");
}

#[test]
fn split_still_follows_an_item_whose_children_were_left_unstamped() {
    /*
     * The safety net the item-follow rule exists for, which the scope-aware lookup must not cost us: a
     * client that moved an item between manifests without re-stamping its children (no trigger, an
     * older platform) leaves them naming the manifest the item left. While only one item carries that
     * id there is no ambiguity, so the child follows it and is re-stamped to agree.
     */
    let tables = stamp_subtree(owner_tables_unstamped(), "f-shared", "m-f-shared");
    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();

    // `input_with_shares` stamps everything the fixture left unstamped as personal, child rows included.
    let shared = &out.rest()[0].manifest;
    assert_eq!(values(rows(shared, "FieldValues")), vec!["family", "hunter2"], "children followed their item across the boundary");
    assert!(rows(shared, "FieldValues").iter().all(|r| r["ManifestId"] == json!("m-f-shared")), "and were re-stamped to agree with it");
}

#[test]
fn split_falls_back_to_a_rows_own_stamp_when_two_items_could_claim_it() {
    /*
     * The fallback above is only safe while it is unambiguous. With two same-id items in different
     * manifests, a child naming neither (its own manifest holds no such item) has no item to follow —
     * so it routes by its own stamp rather than being handed to whichever manifest happens to be found
     * first.
     */
    let mut tables = tables_with_a_duplicated_item_id();
    // A third manifest's orphan child: its stamp names a manifest that is not in this push.
    tables.push(table("FieldValues", vec![
        row(&[("Id", json!("fv-orphan")), ("ItemId", json!("i-dup")), ("FieldKey", json!("password")), ("Value", json!("orphan_secret")), ("ManifestId", json!("m-revoked"))]),
    ]));

    let out = canonicalize_from_sqlite(raw_input_with_shares(tables, vec![spec("f-shared")])).unwrap();
    assert!(!manifest_mentions(&out.rest()[0].manifest, "orphan_secret"), "an ambiguous child is never guessed into a shared manifest");
    assert!(!manifest_mentions(&out.first().manifest, "orphan_secret"), "its own stamp names a manifest this vault no longer carries, so it is dropped");
}

#[test]
fn split_keeps_a_parent_folder_link_that_resolves_in_the_folders_own_manifest() {
    /*
     * The same-id rule for folders. A personal folder carrying the id of the share's subfolder must not
     * make the share's own parent link look foreign — nulling it would silently flatten the shared tree.
     */
    let tables = vec![
        table("Folders", vec![
            row(&[("Id", json!("f-shared")), ("Name", json!("Family")), ("ParentFolderId", serde_json::Value::Null), ("ManifestId", json!("m-f-shared"))]),
            row(&[("Id", json!("f-sub")), ("Name", json!("Streaming")), ("ParentFolderId", json!("f-shared")), ("ManifestId", json!("m-f-shared"))]),
            // A personal folder that happens to carry the shared anchor's id.
            row(&[("Id", json!("f-shared")), ("Name", json!("Mine")), ("ParentFolderId", serde_json::Value::Null), ("ManifestId", json!(PERSONAL_M))]),
        ]),
    ];

    let out = canonicalize_from_sqlite(raw_input_with_shares(tables, vec![spec("f-shared")])).unwrap();
    let shared = &out.rest()[0].manifest;
    let sub = rows(shared, "Folders").iter().find(|r| r["Id"] == json!("f-sub")).unwrap();
    assert_eq!(sub["ParentFolderId"], json!("f-shared"), "the parent resolves inside this manifest, so the link stands");
}

#[test]
fn split_roundtrips_two_same_id_items_without_mixing_their_children() {
    // End to end: the duplicate survives a full split + combine as two independent items, each with
    // its own secrets, which is what `(ManifestId, Id)` promises everywhere else.
    let out = canonicalize_from_sqlite(raw_input_with_shares(tables_with_a_duplicated_item_id(), vec![spec("f-shared")])).unwrap();
    let re = materialize_as_sqlite(materialize_input(out.first().manifest.clone(), vec![out.rest()[0].manifest.clone()], out.data_buckets.clone())).unwrap();
    let map = materialized_map(&re);

    let field_values: Vec<(&str, &str)> = map["FieldValues"]
        .iter()
        .map(|r| (r["ManifestId"].as_str().unwrap(), r["Value"].as_str().unwrap()))
        .collect();
    assert!(field_values.contains(&(PERSONAL_M, "personal_secret")));
    assert!(field_values.contains(&("m-f-shared", "shared_secret")));
    assert_eq!(field_values.len(), 2, "neither row was dropped or duplicated into the other manifest");
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-manifest routing: the blanket invariant
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn every_row_of_a_canonicalized_manifest_carries_that_manifests_own_stamp() {
    /*
     * The invariant every routing rule has to preserve, asserted over a whole vault rather than
     * table by table: a manifest is a namespace, so a row inside one that names another is either a row
     * that leaked in or a reference that will resolve against the wrong namespace on the way back.
     * A new table added to the codec is covered by this the day it appears in a manifest.
     */
    let out = canonicalize_owner();
    for canonicalized in out.manifests.iter() {
        let manifest = &canonicalized.manifest;
        for (name, rows) in manifest.tables.iter() {
            for row in rows {
                assert_eq!(
                    row.get("ManifestId").and_then(|v| v.as_str()),
                    Some(manifest.manifest_id.as_str()),
                    "{name} row {:?} sits in manifest {} but names another",
                    row.get("Id"),
                    manifest.manifest_id
                );
            }
        }
    }
    for bucket in out.data_buckets.iter() {
        for (name, rows) in bucket.tables.iter() {
            for row in rows {
                assert_eq!(
                    row.get("ManifestId").and_then(|v| v.as_str()),
                    Some(bucket.manifest_id.as_str()),
                    "{name} row in the {} bucket of {} names another manifest",
                    bucket.category,
                    bucket.manifest_id
                );
            }
        }
    }
}

#[test]
fn no_key_material_crosses_a_manifest_boundary_in_a_full_roundtrip() {
    /*
     * The delivery keypair decides who can read a manifest's alias mail, so it is the one row whose
     * misrouting is unrecoverable: publishing the personal private key inside a shared manifest hands
     * every member the user's own mail. Split and combine are both checked here, on a vault where each
     * manifest holds a keypair whose private half names the manifest it belongs to.
     */
    let mut tables = owner_tables();
    tables.retain(|t| t.name != "EncryptionKeys");
    tables.push(table("EncryptionKeys", vec![
        row(&[("Id", json!("ek-personal")), ("PublicKey", json!("pub-personal")), ("PrivateKey", json!("priv_personal_only")), ("IsPrimary", json!(1)), ("IsDeleted", json!(0)), ("ManifestId", json!(PERSONAL_M))]),
        row(&[("Id", json!("ek-shared")), ("PublicKey", json!("pub-shared")), ("PrivateKey", json!("priv_shared_only")), ("IsPrimary", json!(1)), ("IsDeleted", json!(0)), ("ManifestId", json!("m-f-shared"))]),
    ]));

    let out = canonicalize_from_sqlite(input_with_shares(tables, vec![spec("f-shared")])).unwrap();
    let personal = out.first().manifest.clone();
    let shared = out.rest()[0].manifest.clone();

    assert!(!manifest_mentions(&shared, "priv_personal_only"), "the personal private key must never be inside a manifest other people hold");
    assert!(!manifest_mentions(&personal, "priv_shared_only"), "nor the share's key inside the personal manifest");
    assert!(validate_manifest(&shared).ok && validate_manifest(&personal).ok);

    // And the same after combine, where the rule is enforced against the manifest's own claim.
    let re = materialize_as_sqlite(materialize_input(personal, vec![shared], out.data_buckets.clone())).unwrap();
    let map = materialized_map(&re);
    for key_row in map["EncryptionKeys"].iter() {
        let expected = if key_row["PrivateKey"] == json!("priv_personal_only") { PERSONAL_M } else { "m-f-shared" };
        assert_eq!(key_row["ManifestId"], json!(expected), "a key row materialized into the wrong manifest");
    }
    assert_eq!(map["EncryptionKeys"].len(), 2);
}

