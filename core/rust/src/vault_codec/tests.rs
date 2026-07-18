//! Unit tests for vault_codec, covering the round-trip contract.
use super::*;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::json;

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

fn basic_input(tables: Vec<CodecTableData>) -> CanonicalizeInput {
    CanonicalizeInput {
        tables,
        user_salt: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff".to_string(),
        migration_id: "20250101000000_Init".to_string(),
        version: "2.0.0".to_string(),
        canonicalized_at: "2026-01-01T00:00:00.000Z".to_string(),
    }
}

#[test]
fn canonicalize_from_sqlite_splits_settings_into_data_bucket() {
    let input = basic_input(vec![
        CodecTableData { name: "Items".to_string(), records: vec![row(&[("Id", json!("i1"))])] },
        CodecTableData { name: "Settings".to_string(), records: vec![row(&[("Key", json!("k")), ("Value", json!("v"))])] },
    ]);
    let out = canonicalize_from_sqlite(input).unwrap();
    assert!(out.manifest.tables.contains_key("Items"));
    assert!(!out.manifest.tables.contains_key("Settings"));
    assert_eq!(bucket_rows(&out, "Settings", "Settings").len(), 1);
}

#[test]
fn canonicalize_from_sqlite_skips_internal_tables() {
    // Gotcha #4: skip-tables must never enter the manifest.
    let input = basic_input(vec![
        CodecTableData { name: "Items".to_string(), records: vec![] },
        CodecTableData { name: "__EFMigrationsHistory".to_string(), records: vec![row(&[("MigrationId", json!("x"))])] },
        CodecTableData { name: "android_metadata".to_string(), records: vec![row(&[("locale", json!("en_US"))])] },
        CodecTableData { name: "sqlite_sequence".to_string(), records: vec![] },
    ]);
    let out = canonicalize_from_sqlite(input).unwrap();
    assert!(out.manifest.tables.contains_key("Items"));
    assert!(!out.manifest.tables.contains_key("__EFMigrationsHistory"));
    assert!(!out.manifest.tables.contains_key("android_metadata"));
    assert!(!out.manifest.tables.contains_key("sqlite_sequence"));
}

#[test]
fn canonicalize_from_sqlite_extracts_blob_columns_and_hashes() {
    let favicon = vec![0xde, 0xad, 0xbe, 0xef];
    let input = basic_input(vec![CodecTableData {
        name: "Logos".to_string(),
        records: vec![row(&[("Id", json!("l1")), ("FileData", json!({ "__b64": b64(&favicon) }))])],
    }]);
    let out = canonicalize_from_sqlite(input).unwrap();
    assert_eq!(out.blobs.len(), 1);
    let (hash, entry) = out.blobs.iter().next().unwrap();
    assert_eq!(entry.kind, "favicon");
    assert_eq!(hash, &hash::salted_blob_hash(&favicon, "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"));

    let logos = &out.manifest.tables["Logos"][0];
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
    assert_eq!(out.blobs.len(), 0);
    assert_eq!(out.manifest.tables["Attachments"][0]["Blob"], serde_json::Value::Null);
    assert_eq!(out.manifest.tables["Attachments"][1]["Blob"], serde_json::Value::Null);
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
    let cell = &out.manifest.tables["Items"][0]["Secret"];
    assert_eq!(cell["__b64"], json!(b64(&secret)));

    let re = materialize_as_sqlite(MaterializeInput { manifest: out.manifest, data_buckets: out.data_buckets }).unwrap();
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
    let re = materialize_as_sqlite(MaterializeInput { manifest: out.manifest, data_buckets: out.data_buckets }).unwrap();
    assert_eq!(re.migration_id, "20250101000000_Init");
    assert!(re.tables.iter().any(|t| t.name == "Settings" && t.records.len() == 1));
    assert!(re.tables.iter().any(|t| t.name == "Items"));
}

#[test]
fn materialize_as_sqlite_drops_skip_tables() {
    // A manifest carrying a platform bookkeeping table (android_metadata) must not be re-emitted.
    let mut manifest = canonicalize_from_sqlite(basic_input(vec![CodecTableData { name: "Items".to_string(), records: vec![] }]))
        .unwrap()
        .manifest;
    manifest
        .tables
        .insert("android_metadata".to_string(), vec![row(&[("locale", json!("en_US"))])]);
    let re = materialize_as_sqlite(MaterializeInput { manifest, data_buckets: vec![] }).unwrap();
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
    assert_eq!(out.blobs.len(), 2);

    let re = materialize_as_sqlite(MaterializeInput { manifest: out.manifest.clone(), data_buckets: out.data_buckets.clone() }).unwrap();
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
    .manifest;
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
    .manifest;
    assert!(validate_manifest(&manifest).ok);
}

#[test]
fn which_blobs_to_upload_excludes_known() {
    let favicon = vec![0x09, 0x08, 0x07];
    let out = canonicalize_from_sqlite(basic_input(vec![CodecTableData {
        name: "Logos".to_string(),
        records: vec![row(&[("Id", json!("l1")), ("FileData", json!({ "__b64": b64(&favicon) }))])],
    }]))
    .unwrap();
    let hash = out.blobs.keys().next().unwrap().clone();

    assert_eq!(which_blobs_to_upload(&out.manifest, vec![]), vec![hash.clone()]);
    assert!(which_blobs_to_upload(&out.manifest, vec![hash]).is_empty());
}

#[test]
fn generate_user_salt_is_64_hex_chars() {
    let salt = generate_user_salt();
    assert_eq!(salt.len(), 64);
    assert!(salt.chars().all(|c| c.is_ascii_hexdigit()));
}

#[test]
fn forward_compat_unknown_manifest_fields_preserved() {
    // The plan's document-store rule: unknown top-level keys round-trip verbatim.
    let manifest_json = json!({
        "schemaVersion": 1,
        "migrationId": "m",
        "version": "2.0.0",
        "userSalt": "00112233445566778899aabbccddeeff",
        "canonicalizedAt": "2026-01-01T00:00:00.000Z",
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
fn json_siblings_roundtrip() {
    let input = basic_input(vec![CodecTableData { name: "Items".to_string(), records: vec![row(&[("Id", json!("i1"))])] }]);
    let input_json = serde_json::to_string(&input).unwrap();
    let canonicalized_json = canonicalize_from_sqlite_json(&input_json).unwrap();
    let canonicalized: CanonicalizedVault = serde_json::from_str(&canonicalized_json).unwrap();
    assert!(canonicalized.manifest.tables.contains_key("Items"));

    let materialize_input = json!({ "manifest": canonicalized.manifest, "dataBuckets": canonicalized.data_buckets }).to_string();
    let materialized_json = materialize_as_sqlite_json(&materialize_input).unwrap();
    let materialized: MaterializedTables = serde_json::from_str(&materialized_json).unwrap();
    assert!(materialized.tables.iter().any(|t| t.name == "Items"));
}
