//! Unit tests for vault_codec, covering the round-trip contract.
use super::*;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::json;
use std::collections::{HashMap, HashSet};

fn b64(bytes: &[u8]) -> String {
    BASE64.encode(bytes)
}

fn row(pairs: &[(&str, serde_json::Value)]) -> CodecRecord {
    pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
}

/// The rows of `table` inside the data bucket for `category` (empty if absent).
fn bucket_rows<'a>(out: &'a CanonicalizedVault, category: &str, table: &str) -> &'a [CodecRecord] {
    out.data_buckets
        .iter()
        .find(|b| b.category == category)
        .and_then(|b| b.tables.get(table))
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

/// The root manifest id every basic-input test canonicalizes against.
const ROOT_MANIFEST: &str = "00000000-0000-0000-0000-00000000r00t";

fn basic_input(tables: Vec<CodecTableData>) -> CanonicalizeInput {
    CanonicalizeInput {
        tables,
        user_salt: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff".to_string(),
        migration_id: "20250101000000_Init".to_string(),
        canonicalized_at: "2026-01-01T00:00:00.000Z".to_string(),
        root_manifest_id: ROOT_MANIFEST.to_string(),
        shared_manifests: Vec::new(),
    }
}

#[test]
fn canonicalize_from_sqlite_splits_settings_into_data_bucket() {
    let input = basic_input(vec![
        CodecTableData { name: "Items".to_string(), records: vec![row(&[("Id", json!("i1"))])] },
        CodecTableData { name: "Settings".to_string(), records: vec![row(&[("Key", json!("k")), ("Value", json!("v"))])] },
    ]);
    let out = canonicalize_from_sqlite(input).unwrap();
    assert!(out.root().manifest.tables.contains_key("Items"));
    assert!(!out.root().manifest.tables.contains_key("Settings"));
    assert_eq!(bucket_rows(&out, "Settings", "Settings").len(), 1);
}

#[test]
fn bucket_layout_matches_bucket_tables_source_of_truth() {
    // The layout platforms consume must be derived purely from BUCKET_TABLES, one entry per distinct
    // category, each listing exactly that category's tables.
    let layout = bucket_layout();
    assert_eq!(layout.len(), bucket_categories().len());
    for entry in &layout {
        assert_eq!(entry.tables, tables_for_category(&entry.category));
        for table in &entry.tables {
            assert_eq!(bucket_category_for(table), Some(entry.category.as_str()));
        }
    }
    assert_eq!(layout.iter().map(|e| e.category.as_str()).collect::<Vec<_>>(), vec!["Settings"]);
    assert_eq!(bucket_layout_json().unwrap(), serde_json::to_string(&layout).unwrap());
}

#[test]
fn canonicalize_from_sqlite_skips_internal_tables() {
    // Skip-tables must never enter the manifest.
    let input = basic_input(vec![
        CodecTableData { name: "Items".to_string(), records: vec![] },
        CodecTableData { name: "__EFMigrationsHistory".to_string(), records: vec![row(&[("MigrationId", json!("x"))])] },
        CodecTableData { name: "android_metadata".to_string(), records: vec![row(&[("locale", json!("en_US"))])] },
        CodecTableData { name: "sqlite_sequence".to_string(), records: vec![] },
    ]);
    let out = canonicalize_from_sqlite(input).unwrap();
    assert!(out.root().manifest.tables.contains_key("Items"));
    assert!(!out.root().manifest.tables.contains_key("__EFMigrationsHistory"));
    assert!(!out.root().manifest.tables.contains_key("android_metadata"));
    assert!(!out.root().manifest.tables.contains_key("sqlite_sequence"));
}

#[test]
fn canonicalize_from_sqlite_extracts_blob_columns_and_hashes() {
    let favicon = vec![0xde, 0xad, 0xbe, 0xef];
    let input = basic_input(vec![CodecTableData {
        name: "Logos".to_string(),
        records: vec![row(&[("Id", json!("l1")), ("FileData", json!({ "__b64": b64(&favicon) }))])],
    }]);
    let out = canonicalize_from_sqlite(input).unwrap();
    assert_eq!(out.root().blobs.len(), 1);
    let (hash, entry) = out.root().blobs.iter().next().unwrap();
    assert_eq!(entry.kind, "favicon");
    assert_eq!(hash, &hash::salted_blob_hash(&favicon, "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"));

    let logos = &out.root().manifest.tables["Logos"][0];
    let cell = &logos["FileData"];
    assert_eq!(cell["__blobRef"], json!(hash));
    assert_eq!(cell["__blobKind"], json!("favicon"));
}

#[test]
fn canonicalize_from_sqlite_nulls_empty_blob_cells() {
    let input = basic_input(vec![CodecTableData {
        name: "Attachments".to_string(),
        records: vec![
            row(&[("Id", json!("a1")), ("Blob", serde_json::Value::Null)]),
            row(&[("Id", json!("a2")), ("Blob", json!({ "__b64": "" }))]),
        ],
    }]);
    let out = canonicalize_from_sqlite(input).unwrap();
    assert_eq!(out.root().blobs.len(), 0);
    assert_eq!(out.root().manifest.tables["Attachments"][0]["Blob"], serde_json::Value::Null);
    assert_eq!(out.root().manifest.tables["Attachments"][1]["Blob"], serde_json::Value::Null);
}

#[test]
fn inline_b64_columns_survive_roundtrip() {
    // Non-blob byte columns (e.g. a TOTP secret) keep their {__b64} marker verbatim.
    let secret = vec![1u8, 2, 3, 4, 5];
    let input = basic_input(vec![CodecTableData {
        name: "Items".to_string(),
        records: vec![row(&[("Id", json!("i1")), ("Secret", json!({ "__b64": b64(&secret) }))])],
    }]);
    let out = canonicalize_from_sqlite(input).unwrap();
    let cell = &out.root().manifest.tables["Items"][0]["Secret"];
    assert_eq!(cell["__b64"], json!(b64(&secret)));

    let re = materialize_as_sqlite(materialize_input(out.root().manifest.clone(), vec![], out.data_buckets)).unwrap();
    let items = re.tables.iter().find(|t| t.name == "Items").unwrap();
    assert_eq!(items.records[0]["Secret"]["__b64"], json!(b64(&secret)));
}

#[test]
fn materialize_as_sqlite_emits_settings_table_and_migration_id() {
    // Migration id is carried through; Settings reconstituted from the bucket.
    let input = basic_input(vec![
        CodecTableData { name: "Items".to_string(), records: vec![row(&[("Id", json!("i1"))])] },
        CodecTableData { name: "Settings".to_string(), records: vec![row(&[("Key", json!("k"))])] },
    ]);
    let out = canonicalize_from_sqlite(input).unwrap();
    let re = materialize_as_sqlite(materialize_input(out.root().manifest.clone(), vec![], out.data_buckets)).unwrap();
    assert_eq!(re.migration_id, "20250101000000_Init");
    assert!(re.tables.iter().any(|t| t.name == "Settings" && t.records.len() == 1));
    assert!(re.tables.iter().any(|t| t.name == "Items"));
}

#[test]
fn materialize_as_sqlite_drops_skip_tables() {
    // A manifest carrying a platform bookkeeping table (android_metadata) must not be re-emitted.
    let mut manifest = canonicalize_from_sqlite(basic_input(vec![CodecTableData { name: "Items".to_string(), records: vec![] }]))
        .unwrap()
        .root()
        .manifest
        .clone();
    manifest
        .tables
        .insert("android_metadata".to_string(), vec![row(&[("locale", json!("en_US"))])]);
    let re = materialize_as_sqlite(materialize_input(manifest, vec![], vec![])).unwrap();
    assert!(!re.tables.iter().any(|t| t.name == "android_metadata"));
}

#[test]
fn full_roundtrip_with_blobs_is_semantically_equal() {
    let favicon = vec![0x01, 0x02, 0x03];
    let attachment = vec![0xaa, 0xbb, 0xcc, 0xdd, 0xee];
    let tables = vec![
        CodecTableData { name: "Items".to_string(), records: vec![row(&[("Id", json!("i1")), ("FolderId", serde_json::Value::Null)])] },
        CodecTableData { name: "Logos".to_string(), records: vec![row(&[("Id", json!("l1")), ("FileData", json!({ "__b64": b64(&favicon) }))])] },
        CodecTableData { name: "Attachments".to_string(), records: vec![row(&[("Id", json!("a1")), ("ItemId", json!("i1")), ("Blob", json!({ "__b64": b64(&attachment) }))])] },
        CodecTableData { name: "Settings".to_string(), records: vec![row(&[("Key", json!("theme")), ("Value", json!("dark"))])] },
    ];
    let out = canonicalize_from_sqlite(basic_input(tables)).unwrap();
    assert_eq!(out.root().blobs.len(), 2);

    let re = materialize_as_sqlite(materialize_input(out.root().manifest.clone(), vec![], out.data_buckets.clone())).unwrap();
    // Items/Logos/Attachments/Settings all present (skip tables aside).
    for name in ["Items", "Logos", "Attachments", "Settings"] {
        assert!(re.tables.iter().any(|t| t.name == name), "missing table {name}");
    }
    // Blob cells are refs the platform will rebind from the blob map.
    let logos = re.tables.iter().find(|t| t.name == "Logos").unwrap();
    assert!(logos.records[0]["FileData"].get("__blobRef").is_some());
}

#[test]
fn pack_unpack_roundtrip_verifies_content_hash() {
    let payload = json!({ "schemaVersion": 1, "tables": { "Items": [] }, "userSalt": "abcd" });
    let payload_json = serde_json::to_string(&payload).unwrap();
    let packed = pack_payload(&payload_json).unwrap();
    // Packed output is gzip (magic bytes present).
    assert_eq!(&packed[0..2], &[0x1f, 0x8b]);
    let unpacked = unpack_payload(&packed).unwrap();
    let unpacked_val: serde_json::Value = serde_json::from_str(&unpacked).unwrap();
    assert_eq!(unpacked_val, payload);
}

#[test]
fn unpack_payload_accepts_uncompressed_raw_json() {
    // Plain (uncompressed) value: the envelope is raw UTF-8 JSON with no gzip magic bytes.
    // unpack_payload supports both gzipped and plain values, so this must round-trip.
    let payload = json!({ "schemaVersion": 1, "tables": { "Items": [] }, "userSalt": "abcd" });
    let content_hash = hash::content_hash(&payload);
    let envelope = json!({ "schemaVersion": 1, "contentHash": content_hash, "payload": payload });
    let raw = serde_json::to_string(&envelope).unwrap().into_bytes();
    assert_ne!(&raw[0..2], &[0x1f, 0x8b]); // sanity: no gzip magic present
    let unpacked = unpack_payload(&raw).unwrap();
    let unpacked_val: serde_json::Value = serde_json::from_str(&unpacked).unwrap();
    assert_eq!(unpacked_val, payload);
}

#[test]
fn unpack_payload_rejects_tampered_payload() {
    let payload = json!({ "a": 1 });
    let content_hash = hash::content_hash(&payload);
    // Tamper: keep the original hash but change the payload, then pack it.
    let envelope = json!({ "schemaVersion": 1, "contentHash": content_hash, "payload": { "a": 2 } });
    let packed = super::compress::gzip(serde_json::to_string(&envelope).unwrap().as_bytes()).unwrap();
    assert!(unpack_payload(&packed).is_err());
}

#[test]
fn content_hash_is_key_order_independent() {
    let a = json!({ "x": 1, "y": 2 });
    let b = json!({ "y": 2, "x": 1 });
    assert_eq!(hash::content_hash(&a), hash::content_hash(&b));
}

#[test]
fn validate_manifest_catches_broken_fk() {
    let mut manifest = canonicalize_from_sqlite(basic_input(vec![
        CodecTableData { name: "Items".to_string(), records: vec![row(&[("Id", json!("i1")), ("FolderId", json!("missing"))])] },
        CodecTableData { name: "Folders".to_string(), records: vec![] },
    ]))
    .unwrap()
    .root()
    .manifest
    .clone();
    manifest.tables.entry("Folders".to_string()).or_default();
    let result = validate_manifest(&manifest);
    assert!(!result.ok);
    assert!(result.failed_rules.iter().any(|r| r == "item-folder-fk-broken"));
}

#[test]
fn validate_manifest_ok_for_clean_vault() {
    let manifest = canonicalize_from_sqlite(basic_input(vec![
        CodecTableData { name: "Items".to_string(), records: vec![row(&[("Id", json!("i1")), ("FolderId", json!("f1"))])] },
        CodecTableData { name: "Folders".to_string(), records: vec![row(&[("Id", json!("f1"))])] },
    ]))
    .unwrap()
    .root()
    .manifest
    .clone();
    assert!(validate_manifest(&manifest).ok);
}

#[test]
fn generate_user_salt_is_64_hex_chars() {
    let salt = generate_user_salt();
    assert_eq!(salt.len(), 64);
    assert!(salt.chars().all(|c| c.is_ascii_hexdigit()));
}

#[test]
fn forward_compat_unknown_manifest_fields_preserved() {
    let manifest_json = json!({
        "schemaVersion": 1,
        "migrationId": "m",
        "userSalt": "00112233445566778899aabbccddeeff",
        "canonicalizedAt": "2026-01-01T00:00:00.000Z",
        "manifestId": "m-1",
        "tables": { "Items": [] },
        "futureField": { "nested": true }
    })
    .to_string();
    let manifest: Manifest = serde_json::from_str(&manifest_json).unwrap();
    assert!(manifest.extra.contains_key("futureField"));
    let reser = serde_json::to_value(&manifest).unwrap();
    assert_eq!(reser["futureField"], json!({ "nested": true }));
}

#[test]
fn canonicalize_remints_legacy_logo_ids_and_collapses_duplicate_sources() {
    // Two clients minted distinct random Ids for the same domain; Items point at each. Canonicalize
    // re-mints the row against its scope's derived id, which is what stops the two from ever being
    // minted apart again and repoints both Items at it.
    let favicon = vec![0x01, 0x02, 0x03];
    let out = canonicalize_from_sqlite(basic_input(vec![
        CodecTableData {
            name: "Logos".to_string(),
            records: vec![
                row(&[("Id", json!("logo-a")), ("Source", json!("github.com")), ("FileData", json!({ "__b64": b64(&favicon) }))]),
                row(&[("Id", json!("logo-b")), ("Source", json!("github.com")), ("FileData", serde_json::Value::Null)]),
            ],
        },
        CodecTableData {
            name: "Items".to_string(),
            records: vec![
                row(&[("Id", json!("i1")), ("LogoId", json!("logo-a"))]),
                row(&[("Id", json!("i2")), ("LogoId", json!("logo-b"))]),
            ],
        },
    ]))
    .unwrap();

    let expected_id = json!(scoped_assets::logo_id_for(ROOT_MANIFEST, scoped_assets::KIND_FAVICON, "github.com"));
    let logos = &out.root().manifest.tables["Logos"];
    assert_eq!(logos.len(), 1, "duplicate Source collapsed to one row");
    assert_eq!(logos[0]["Id"], expected_id, "id derived from (root manifest id, source)");
    assert_eq!(logos[0]["ManifestId"], json!(ROOT_MANIFEST), "root rows are stamped with the root manifest's own id");
    // The row carrying favicon bytes is the one that survived, not the empty one.
    assert!(logos[0]["FileData"].get("__blobRef").is_some());

    let items = &out.root().manifest.tables["Items"];
    for item in items {
        assert_eq!(item["LogoId"], expected_id, "every Item repointed at the derived row");
    }

    // No orphan blob: exactly the survivor's favicon is registered.
    assert_eq!(out.root().blobs.len(), 1);
}

#[test]
fn canonicalize_dedup_tiebreak_prefers_the_row_with_favicon_bytes() {
    // The derived id is the same either way, so the tiebreak decides which row's *content* survives:
    // the one that actually carries bytes wins regardless of row order.
    let favicon = vec![0x07];
    let out = canonicalize_from_sqlite(basic_input(vec![
        CodecTableData {
            name: "Logos".to_string(),
            records: vec![
                row(&[("Id", json!("logo-z")), ("Source", json!("github.com")), ("MimeType", json!("empty"))]),
                row(&[("Id", json!("logo-a")), ("Source", json!("github.com")), ("MimeType", json!("image/png")), ("FileData", json!({ "__b64": b64(&favicon) }))]),
            ],
        },
        CodecTableData {
            name: "Items".to_string(),
            records: vec![row(&[("Id", json!("i1")), ("LogoId", json!("logo-z"))])],
        },
    ]))
    .unwrap();

    let logos = &out.root().manifest.tables["Logos"];
    assert_eq!(logos.len(), 1, "duplicate Source collapsed to one row");
    assert_eq!(logos[0]["MimeType"], json!("image/png"), "the row with bytes supplies the surviving content");
    assert_eq!(out.root().manifest.tables["Items"][0]["LogoId"], json!(scoped_assets::logo_id_for(ROOT_MANIFEST, scoped_assets::KIND_FAVICON, "github.com")));
}

#[test]
fn canonicalize_nulls_dangling_logo_reference() {
    // An Item pointing at a logo Id that doesn't exist anywhere in the vault is nulled, matching
    // FK_Items_Logos_LogoId ON DELETE SET NULL, so materialize's foreign_key_check passes.
    let out = canonicalize_from_sqlite(basic_input(vec![
        CodecTableData {
            name: "Logos".to_string(),
            records: vec![row(&[("Id", json!("logo-a")), ("Source", json!("github.com"))])],
        },
        CodecTableData {
            name: "Items".to_string(),
            records: vec![
                row(&[("Id", json!("i1")), ("LogoId", json!("logo-a"))]),
                row(&[("Id", json!("i2")), ("LogoId", json!("ghost"))]),
            ],
        },
    ]))
    .unwrap();

    let items = &out.root().manifest.tables["Items"];
    let i1 = items.iter().find(|r| r["Id"] == json!("i1")).unwrap();
    let i2 = items.iter().find(|r| r["Id"] == json!("i2")).unwrap();
    assert_eq!(i1["LogoId"], json!(scoped_assets::logo_id_for(ROOT_MANIFEST, scoped_assets::KIND_FAVICON, "github.com")), "valid reference follows the re-mint");
    assert_eq!(i2["LogoId"], serde_json::Value::Null, "dangling reference nulled");
}

#[test]
fn canonicalize_logo_normalization_is_idempotent() {
    // Push stability: canonicalizing already-normalized rows must not change them, or every push would
    // rewrite the manifest and burn a revision for nothing.
    let favicon = vec![0x01, 0x02];
    let first = canonicalize_from_sqlite(basic_input(vec![
        CodecTableData {
            name: "Logos".to_string(),
            records: vec![row(&[("Id", json!("legacy-id")), ("Source", json!("github.com")), ("FileData", json!({ "__b64": b64(&favicon) }))])],
        },
        CodecTableData { name: "Items".to_string(), records: vec![row(&[("Id", json!("i1")), ("LogoId", json!("legacy-id"))])] },
    ]))
    .unwrap();

    // Feed the normalized rows back in (bytes restored, as the platform read would).
    let mut logo_row = first.root().manifest.tables["Logos"][0].clone();
    logo_row.insert("FileData".to_string(), json!({ "__b64": b64(&favicon) }));
    let second = canonicalize_from_sqlite(basic_input(vec![
        CodecTableData { name: "Logos".to_string(), records: vec![logo_row] },
        CodecTableData { name: "Items".to_string(), records: first.root().manifest.tables["Items"].clone() },
    ]))
    .unwrap();

    assert_eq!(second.root().manifest.tables["Logos"], first.root().manifest.tables["Logos"]);
    assert_eq!(second.root().manifest.tables["Items"], first.root().manifest.tables["Items"]);
}

#[test]
fn validate_manifest_rejects_duplicate_logo_sources() {
    // Guard: if a duplicate-Source manifest ever reaches validation (dedup bypassed), reject it.
    let mut manifest = canonicalize_from_sqlite(basic_input(vec![
        CodecTableData { name: "Items".to_string(), records: vec![] },
    ]))
    .unwrap()
    .root()
    .manifest
    .clone();
    manifest.tables.insert(
        "Logos".to_string(),
        vec![
            row(&[("Id", json!("logo-a")), ("Source", json!("github.com"))]),
            row(&[("Id", json!("logo-b")), ("Source", json!("github.com"))]),
        ],
    );
    let result = validate_manifest(&manifest);
    assert!(!result.ok);
    assert!(result.failed_rules.iter().any(|r| r == "logo-sources-not-unique"));
}

/// A minimal local schema map for overflow tests: Items(Id, Name), Settings(Key, Value), and the
/// CodecOverflows carrier table every client schema owns since migration 2.1.0.
fn old_client_schema() -> std::collections::HashMap<String, Vec<String>> {
    [
        ("Items".to_string(), vec!["Id".to_string(), "Name".to_string()]),
        ("Settings".to_string(), vec!["Key".to_string(), "Value".to_string()]),
        (OVERFLOW_TABLE.to_string(), vec!["Id".to_string(), "Data".to_string()]),
    ]
    .into_iter()
    .collect()
}

/// The OVERFLOW_TABLE entry from a materialize result (what the platform inserts into the vault DB).
fn overflow_table_of(re: &MaterializedTables) -> Option<&CodecTableData> {
    re.tables.iter().find(|t| t.name == OVERFLOW_TABLE)
}

#[test]
fn materialize_splits_unknown_columns_into_overflow_table_and_canonicalize_remerges() {
    // A newer client wrote Items.AliasEnabled; this client's schema doesn't know it. The column must
    // not reach the Items insert (it would crash), must land in the emitted OVERFLOW_TABLE row, and
    // must reappear on the next canonicalize (which reads that row back like any table) so the push
    // doesn't drop it.
    let out = canonicalize_from_sqlite(basic_input(vec![CodecTableData {
        name: "Items".to_string(),
        records: vec![row(&[("Id", json!("i1")), ("Name", json!("GitHub")), ("AliasEnabled", json!(true))])],
    }]))
    .unwrap();

    let re = materialize_as_sqlite(MaterializeInput::new(out.root().manifest.clone(), vec![], out.data_buckets, old_client_schema())).unwrap();
    let items = re.tables.iter().find(|t| t.name == "Items").unwrap();
    assert!(!items.records[0].contains_key("AliasEnabled"), "unknown column filtered out of the insert set");
    assert_eq!(items.records[0]["Name"], json!("GitHub"));
    assert_eq!(re.overflow.columns["Items"]["i1"]["AliasEnabled"], json!(true), "diagnostics copy populated");

    let overflow_table = overflow_table_of(&re).expect("overflow emitted as a regular table row");
    assert_eq!(overflow_table.records.len(), 1);
    assert_eq!(overflow_table.records[0]["Id"], json!(OVERFLOW_ROW_ID));

    // The old client edits Name locally, then pushes: canonicalize reads the overflow row back from
    // the DB (plain SELECT *) and re-attaches the column; the carrier table itself never reaches the manifest.
    let pushed = canonicalize_from_sqlite(basic_input(vec![
        CodecTableData { name: "Items".to_string(), records: vec![row(&[("Id", json!("i1")), ("Name", json!("GitHub (renamed)"))])] },
        overflow_table.clone(),
    ]))
    .unwrap();
    let item = &pushed.root().manifest.tables["Items"][0];
    assert_eq!(item["Name"], json!("GitHub (renamed)"));
    assert_eq!(item["AliasEnabled"], json!(true), "newer writer's column survives the old client's push");
    assert!(!pushed.root().manifest.tables.contains_key(OVERFLOW_TABLE), "carrier table consumed, never emitted into the manifest");
}

#[test]
fn overflow_of_locally_deleted_row_is_dropped_on_canonicalize() {
    // The row carrying the unknown column was deleted locally: its overflow must vanish with it.
    let overflow = CodecOverflow {
        columns: [("Items".to_string(), [("gone".to_string(), row(&[("AliasEnabled", json!(true))]))].into_iter().collect())].into_iter().collect(),
        ..Default::default()
    };
    let out = canonicalize_from_sqlite(basic_input(vec![
        CodecTableData { name: "Items".to_string(), records: vec![row(&[("Id", json!("kept"))])] },
        CodecTableData { name: OVERFLOW_TABLE.to_string(), records: overflow.to_table_records() },
    ]))
    .unwrap();
    assert!(!out.root().manifest.tables["Items"][0].contains_key("AliasEnabled"));
}

#[test]
fn materialize_splits_unknown_tables_into_overflow_and_canonicalize_reemits() {
    // A newer client added a whole table (manifest-level) and a whole bucket table. Neither exists
    // in this client's schema; both must round-trip through the overflow row back to their original place.
    let mut out = canonicalize_from_sqlite(basic_input(vec![CodecTableData { name: "Items".to_string(), records: vec![row(&[("Id", json!("i1"))])] }])).unwrap();
    out.manifests[0].manifest.tables.insert("NewTable".to_string(), vec![row(&[("Id", json!("n1")), ("Data", json!("x"))])]);
    let settings_bucket = out.data_buckets.iter_mut().find(|b| b.category == "Settings").expect("Settings bucket");
    settings_bucket.tables.insert("Preferences".to_string(), vec![row(&[("Key", json!("p1"))])]);

    let re = materialize_as_sqlite(MaterializeInput::new(out.root().manifest.clone(), vec![], out.data_buckets, old_client_schema())).unwrap();
    assert!(!re.tables.iter().any(|t| t.name == "NewTable" || t.name == "Preferences"), "unknown tables never reach the insert set");
    assert_eq!(re.overflow.tables["NewTable"].len(), 1);
    assert_eq!(re.overflow.bucket_tables["Settings"]["Preferences"].len(), 1);
    let overflow_table = overflow_table_of(&re).expect("overflow emitted as a regular table row").clone();

    let pushed = canonicalize_from_sqlite(basic_input(vec![
        CodecTableData { name: "Items".to_string(), records: vec![row(&[("Id", json!("i1"))])] },
        overflow_table.clone(),
    ]))
    .unwrap();
    assert_eq!(pushed.root().manifest.tables["NewTable"].len(), 1, "unknown manifest table re-emitted");
    assert_eq!(bucket_rows(&pushed, "Settings", "Preferences").len(), 1, "unknown bucket table re-emitted into its category");

    // Bucket-only push path: extract_bucket consumes the overflow row read alongside the bucket's tables.
    let bucket = extract_bucket(
        "Settings".to_string(),
        [
            ("Settings".to_string(), vec![row(&[("Key", json!("k")), ("Value", json!("v"))])]),
            (OVERFLOW_TABLE.to_string(), overflow_table.records),
        ]
        .into_iter()
        .collect(),
    );
    assert_eq!(bucket.tables["Preferences"].len(), 1);
    assert_eq!(bucket.tables["Settings"].len(), 1);
    assert!(!bucket.tables.contains_key(OVERFLOW_TABLE), "carrier table consumed, never emitted into the bucket");
}

#[test]
fn extract_bucket_remerges_overflow_columns() {
    // A newer client added a column to Settings; a bucket-only push from this client must keep it.
    let overflow = CodecOverflow {
        columns: [("Settings".to_string(), [("theme".to_string(), row(&[("SyncScope", json!("device"))]))].into_iter().collect())].into_iter().collect(),
        ..Default::default()
    };
    let bucket = extract_bucket(
        "Settings".to_string(),
        [
            ("Settings".to_string(), vec![row(&[("Key", json!("theme")), ("Value", json!("dark"))])]),
            (OVERFLOW_TABLE.to_string(), overflow.to_table_records()),
        ]
        .into_iter()
        .collect(),
    );
    assert_eq!(bucket.tables["Settings"][0]["SyncScope"], json!("device"));
    assert_eq!(bucket.tables["Settings"][0]["Value"], json!("dark"));
}

#[test]
fn materialize_with_a_fitting_schema_splits_nothing_off() {
    // A schema that knows every column the manifest carries: rows pass through untouched and no
    // overflow row is emitted. This is the normal case, and the guard on the `fitting_schema` helper
    // the rest of these tests lean on.
    let out = canonicalize_from_sqlite(basic_input(vec![CodecTableData {
        name: "Items".to_string(),
        records: vec![row(&[("Id", json!("i1")), ("AliasEnabled", json!(true))])],
    }]))
    .unwrap();
    let re = materialize_as_sqlite(materialize_input(out.root().manifest.clone(), vec![], out.data_buckets)).unwrap();
    let items = re.tables.iter().find(|t| t.name == "Items").unwrap();
    assert_eq!(items.records[0]["AliasEnabled"], json!(true));
    assert!(re.overflow.is_empty());
    assert!(overflow_table_of(&re).is_none(), "no overflow row emitted when there is nothing to carry");
}

#[test]
fn materialize_drops_overflow_table_smuggled_into_a_manifest() {
    // Defense: OVERFLOW_TABLE is local-only bookkeeping. A manifest that somehow carries one (corrupt
    // or malicious) must not pass through, it would collide with the row materialize emits itself.
    let mut out = canonicalize_from_sqlite(basic_input(vec![CodecTableData { name: "Items".to_string(), records: vec![row(&[("Id", json!("i1")), ("AliasEnabled", json!(true))])] }])).unwrap();
    out.manifests[0].manifest.tables.insert(OVERFLOW_TABLE.to_string(), vec![row(&[("Id", json!("smuggled")), ("Data", json!("{}"))])]);

    let re = materialize_as_sqlite(MaterializeInput::new(out.root().manifest.clone(), vec![], out.data_buckets, old_client_schema())).unwrap();
    let overflow_table = overflow_table_of(&re).expect("legitimate overflow row still emitted");
    assert_eq!(overflow_table.records.len(), 1);
    assert_eq!(overflow_table.records[0]["Id"], json!(OVERFLOW_ROW_ID), "smuggled row dropped, only the codec's own row remains");
}

#[test]
fn json_siblings_roundtrip() {
    let input = basic_input(vec![CodecTableData { name: "Items".to_string(), records: vec![row(&[("Id", json!("i1"))])] }]);
    let input_json = serde_json::to_string(&input).unwrap();
    let canonicalized_json = canonicalize_from_sqlite_json(&input_json).unwrap();
    let canonicalized: CanonicalizedVault = serde_json::from_str(&canonicalized_json).unwrap();
    assert!(canonicalized.root().manifest.tables.contains_key("Items"));

    let schema = fitting_schema(std::iter::once(&canonicalized.root().manifest), &canonicalized.data_buckets);
    let input_value = json!({ "manifests": [{ "manifest": canonicalized.root().manifest, "isRoot": true }], "dataBuckets": canonicalized.data_buckets, "schemaColumns": schema });
    let materialized_json = materialize_as_sqlite_json(&input_value.to_string()).unwrap();
    let materialized: MaterializedTables = serde_json::from_str(&materialized_json).unwrap();
    assert!(materialized.tables.iter().any(|t| t.name == "Items"));
}

#[test]
fn content_fingerprint_ignores_key_order_and_whitespace() {
    let a = compute_content_fingerprint(r#"{"schemaVersion":1,"tables":{"Items":[{"Id":"x","Name":"n"}]}}"#);
    let b = compute_content_fingerprint(r#"{ "tables": { "Items": [ { "Name": "n", "Id": "x" } ] }, "schemaVersion": 1 }"#);
    assert_eq!(a, b);
    assert_eq!(a.len(), 64);
}

#[test]
fn content_fingerprint_excludes_canonicalized_at() {
    let a = compute_content_fingerprint(r#"{"canonicalizedAt":"2026-01-01T00:00:00.000Z","tables":{}}"#);
    let b = compute_content_fingerprint(r#"{"canonicalizedAt":"2026-07-25T12:34:56.789Z","tables":{}}"#);
    let c = compute_content_fingerprint(r#"{"tables":{}}"#);
    assert_eq!(a, b);
    assert_eq!(a, c);
}

#[test]
fn content_fingerprint_detects_content_change() {
    let a = compute_content_fingerprint(r#"{"tables":{"Items":[{"Id":"x"}]}}"#);
    let b = compute_content_fingerprint(r#"{"tables":{"Items":[{"Id":"y"}]}}"#);
    assert_ne!(a, b);
}

#[test]
fn content_fingerprint_matches_serialized_manifest_roundtrip() {
    // A manifest serialized by this codec and the same JSON re-parsed/re-serialized by another producer
    // (different key order) must fingerprint identically.
    let manifest = Manifest {
        schema_version: 1,
        migration_id: "20250101000000_Test".into(),
        user_salt: "00ff".into(),
        canonicalized_at: "2026-01-01T00:00:00.000Z".into(),
        manifest_id: "m-fp".into(),
        anchor_folder_id: None,
        tables: std::collections::HashMap::from([(String::from("Items"), vec![])]),
        extra: std::collections::HashMap::new(),
    };
    let serialized = serde_json::to_string(&manifest).unwrap();
    let reordered = r#"{"tables":{"Items":[]},"userSalt":"00ff","migrationId":"20250101000000_Test","schemaVersion":1,"manifestId":"m-fp","canonicalizedAt":"1999-12-31T23:59:59.000Z"}"#;
    assert_eq!(compute_content_fingerprint(&serialized), compute_content_fingerprint(reordered));
}

#[test]
fn canonicalize_requires_root_manifest_id() {
    let mut input = basic_input(vec![CodecTableData { name: "Items".to_string(), records: vec![] }]);
    input.root_manifest_id = String::new();
    assert!(canonicalize_from_sqlite(input).is_err());
}

#[test]
fn canonicalize_stamps_root_manifest_id_on_metadata_and_content_rows() {
    let out = canonicalize_from_sqlite(basic_input(vec![
        CodecTableData { name: "Items".to_string(), records: vec![row(&[("Id", json!("i1"))])] },
        CodecTableData { name: "Folders".to_string(), records: vec![row(&[("Id", json!("f1"))])] },
    ]))
    .unwrap();
    assert_eq!(out.root().manifest.manifest_id, ROOT_MANIFEST);
    assert_eq!(out.root().manifest.tables["Items"][0]["ManifestId"], json!(ROOT_MANIFEST));
    assert_eq!(out.root().manifest.tables["Folders"][0]["ManifestId"], json!(ROOT_MANIFEST));
}

#[test]
fn materialize_emits_manifests_bookkeeping_table() {
    // The vault DB carries one Manifests row per materialized manifest so app queries can resolve the
    // root manifest id; the table is local bookkeeping and must never round-trip into a manifest.
    let out = canonicalize_from_sqlite(basic_input(vec![CodecTableData { name: "Items".to_string(), records: vec![row(&[("Id", json!("i1"))])] }])).unwrap();
    let re = materialize_as_sqlite(materialize_input(out.root().manifest.clone(), vec![], out.data_buckets)).unwrap();
    let manifests = re.tables.iter().find(|t| t.name == "Manifests").expect("Manifests bookkeeping table emitted");
    assert_eq!(manifests.records.len(), 1);
    assert_eq!(manifests.records[0]["Id"], json!(ROOT_MANIFEST));
    assert_eq!(manifests.records[0]["IsRoot"], json!(1));
    assert_eq!(manifests.records[0]["AnchorFolderId"], serde_json::Value::Null);

    // Feeding the materialized tables back into canonicalize must consume the bookkeeping table (skip-table).
    let pushed = canonicalize_from_sqlite(basic_input(re.tables)).unwrap();
    assert!(!pushed.root().manifest.tables.contains_key("Manifests"));
}

#[test]
fn validate_manifest_requires_manifest_id() {
    let mut manifest = canonicalize_from_sqlite(basic_input(vec![CodecTableData { name: "Items".to_string(), records: vec![] }])).unwrap().root().manifest.clone();
    assert!(validate_manifest(&manifest).ok);
    manifest.manifest_id = String::new();
    let result = validate_manifest(&manifest);
    assert!(!result.ok);
    assert!(result.failed_rules.iter().any(|r| r == "manifestId-missing"));
}
