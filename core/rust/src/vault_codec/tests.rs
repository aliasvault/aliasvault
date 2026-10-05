//! The codec round trip for one manifest: canonicalize, pack, unpack, materialize, and the forward-compatibility
//! overflow. Multi-manifest routing lives in `sharing_tests`.

use super::*;
use super::test_support::{b64, materialize_input, materialized_map, row, stamp_unstamped, stamped, table, PERSONAL_MANIFEST_ID as PERSONAL, PERSONAL_SALT as SALT};
use super::types::{bucket_category_for, SCHEMA_VERSION};
use crate::vault_model::{MANIFESTS_TABLE, MANIFEST_ID_COL, OVERFLOW_ROW_ID, OVERFLOW_TABLE};
use serde_json::json;
use std::collections::HashMap;

/// Canonicalize `tables` as the personal manifest, every row stamped the way a client writes it.
fn canonicalize(tables: Vec<CodecTableData>) -> CanonicalizedVault {
    canonicalize_from_sqlite(CanonicalizeInput {
        tables: stamp_unstamped(tables, PERSONAL),
        canonicalized_at: "2026-01-01T00:00:00.000Z".to_string(),
        manifests: vec![ManifestSpec { manifest_id: PERSONAL.to_string(), manifest_salt: SALT.to_string(), name: None }],
        stamp_unstamped_into: None,
    })
    .unwrap()
}

/// The one manifest of a single-manifest canonicalize.
fn manifest_of(out: &CanonicalizedVault) -> &CanonicalizedManifest {
    &out.manifests[0]
}

/// Canonicalize then materialize with a schema that fits everything.
fn round_trip(tables: Vec<CodecTableData>) -> (CanonicalizedVault, MaterializedTables) {
    let out = canonicalize(tables);
    let re = materialize_as_sqlite(materialize_input(vec![manifest_of(&out).manifest.clone()], out.data_buckets.clone())).unwrap();
    (out, re)
}

/// The rows of `table` inside the data bucket for `category` (empty if absent).
fn bucket_rows<'a>(out: &'a CanonicalizedVault, category: &str, table: &str) -> &'a [CodecRecord] {
    out.data_buckets.iter().find(|b| b.category == category).and_then(|b| b.tables.get(table)).map(Vec::as_slice).unwrap_or(&[])
}

/// A client one release behind a writer: knows `Items` and `Settings` plus the overflow carrier, nothing else.
fn narrow_client_schema() -> HashMap<String, Vec<String>> {
    [
        ("Items".to_string(), vec![MANIFEST_ID_COL.to_string(), "Id".to_string(), "Name".to_string()]),
        ("Settings".to_string(), vec![MANIFEST_ID_COL.to_string(), "Key".to_string(), "Value".to_string()]),
        (OVERFLOW_TABLE.to_string(), vec!["Id".to_string(), "Data".to_string()]),
    ]
    .into_iter()
    .collect()
}

fn overflow_table_of(re: &MaterializedTables) -> Option<&CodecTableData> {
    re.tables.iter().find(|t| t.name == OVERFLOW_TABLE)
}

/*
 * The registry the codec runs on.
 */

#[test]
fn the_bucket_layout_follows_the_registry() {
    // A bucket is addressed by `(manifest_id, category)`, so every bucketed table must be registered, manifest-scoped
    // and identified by `(ManifestId, primary key)`; the layout the platforms consume derives purely from the registry.
    for (table, category) in crate::vault_model::BUCKET_TABLES {
        assert!(crate::vault_model::SYNCABLE_TABLES.iter().any(|t| t.name == *table), "bucketed table {table} ({category}) is not registered");
        assert!(super::types::is_manifest_scoped(table), "bucketed table {table} must be manifest scoped");
        let mut expected = vec![MANIFEST_ID_COL];
        expected.extend_from_slice(super::types::primary_key_columns_for(table));
        assert_eq!(super::types::identity_columns_for(table), expected, "{table} must be addressed by (ManifestId, primary key)");
    }
    let layout = bucket_layout();
    assert_eq!(layout.iter().map(|e| e.category.as_str()).collect::<Vec<_>>(), vec!["settings", "stats"]);
    for entry in &layout {
        assert_eq!(entry.tables, tables_for_category(&entry.category));
        assert!(entry.tables.iter().all(|t| bucket_category_for(t) == Some(entry.category.as_str())));
    }
}

/*
 * Canonicalize and materialize.
 */

#[test]
fn a_vault_round_trips_through_manifest_buckets_and_blobs() {
    // Bucketed tables leave the manifest for their bucket, skip tables never enter it, blob columns become
    // content-addressed references, other byte columns keep their inline bytes, and materialize puts it all back.
    let favicon = vec![0xde, 0xad, 0xbe, 0xef];
    let attachment = vec![0xaa, 0xbb, 0xcc];
    let secret = vec![1u8, 2, 3];
    let (out, re) = round_trip(vec![
        table("Items", vec![row(&[("Id", json!("i1")), ("FolderId", serde_json::Value::Null), ("LogoId", json!("l1")), ("Secret", json!({ "__b64": b64(&secret) }))])]),
        table("Logos", vec![row(&[("Id", json!("l1")), ("Source", json!("github.com")), ("FileData", json!({ "__b64": b64(&favicon) }))])]),
        table("Attachments", vec![
            row(&[("Id", json!("a1")), ("ItemId", json!("i1")), ("Blob", json!({ "__b64": b64(&attachment) }))]),
            row(&[("Id", json!("a2")), ("ItemId", json!("i1")), ("Blob", serde_json::Value::Null)]),
            row(&[("Id", json!("a3")), ("ItemId", json!("i1")), ("Blob", json!({ "__b64": "" }))]),
        ]),
        table("Settings", vec![row(&[("Key", json!("theme")), ("Value", json!("dark"))])]),
        table("__EFMigrationsHistory", vec![row(&[("MigrationId", json!("x"))])]),
        table("android_metadata", vec![row(&[("locale", json!("en_US"))])]),
    ]);
    let manifest = &manifest_of(&out).manifest;

    assert!(!manifest.tables.contains_key("Settings") && !manifest.tables.contains_key("__EFMigrationsHistory") && !manifest.tables.contains_key("android_metadata"));
    assert_eq!(bucket_rows(&out, "settings", "Settings").len(), 1);
    assert_eq!(manifest.manifest_id, PERSONAL);
    assert_eq!(manifest.tables["Items"][0]["ManifestId"], json!(PERSONAL), "the stamp every row arrives with travels through");
    assert_eq!(manifest.tables["Items"][0]["Secret"]["__b64"], json!(b64(&secret)), "a non-blob byte column keeps its inline bytes");

    let blobs = &manifest_of(&out).blobs;
    assert_eq!(blobs.len(), 2);
    let logo_hash = hash::salted_blob_hash(&favicon, SALT).unwrap();
    assert_eq!(blobs[&logo_hash].kind, "favicon");
    assert_eq!(manifest.tables["Logos"][0]["FileData"], json!({ "__blobRef": logo_hash, "__blobKind": "favicon" }));
    let attachments: HashMap<&str, &CodecRecord> = manifest.tables["Attachments"].iter().map(|r| (r["Id"].as_str().unwrap(), r)).collect();
    assert!(attachments["a1"]["Blob"]["__blobRef"].is_string());
    assert!(attachments["a2"]["Blob"].is_null() && attachments["a3"]["Blob"].is_null(), "an empty or absent blob cell is null");

    let tables = materialized_map(&re);
    for name in ["Items", "Logos", "Attachments", "Settings"] {
        assert!(tables.contains_key(name), "missing table {name}");
    }
    assert!(!tables.contains_key("android_metadata"), "a bookkeeping table smuggled into a manifest is not re-emitted");
    assert_eq!(tables["Items"][0]["Secret"]["__b64"], json!(b64(&secret)));
    assert!(tables["Logos"][0]["FileData"].get("__blobRef").is_some(), "blob cells are refs the platform rebinds from the blob map");
    assert!(re.overflow.is_empty() && overflow_table_of(&re).is_none(), "a fitting schema splits nothing off");

    // The vault DB carries one Manifests row per materialized manifest, which canonicalize consumes as bookkeeping.
    assert_eq!(tables[MANIFESTS_TABLE], vec![row(&[("Id", json!(PERSONAL)), ("Name", serde_json::Value::Null)])]);
    assert!(!canonicalize(re.tables.clone()).manifests[0].manifest.tables.contains_key(MANIFESTS_TABLE));
}

#[test]
fn packing_wraps_a_payload_in_a_verified_envelope() {
    let payload = json!({ "schemaVersion": 1, "tables": { "Items": [] }, "manifestSalt": "abcd" });
    let packed = pack_payload(&payload.to_string()).unwrap();
    assert_eq!(&packed[0..2], &[0x1f, 0x8b], "packed output is gzip");
    assert_eq!(serde_json::from_str::<serde_json::Value>(&unpack_payload(&packed).unwrap()).unwrap(), payload);

    // Tampered: the original hash over a changed payload.
    let envelope = json!({ "schemaVersion": 1, "contentHash": hash::content_hash(&json!({ "a": 1 })), "payload": { "a": 2 } });
    assert!(unpack_payload(&super::compress::gzip(envelope.to_string().as_bytes()).unwrap()).is_err());

    // A format version this build cannot read is reported as such, before the hash is checked.
    let newer = json!({ "schemaVersion": SCHEMA_VERSION + 1, "contentHash": "x", "payload": {} });
    assert!(matches!(unpack_versioned_payload(&super::compress::gzip(newer.to_string().as_bytes()).unwrap()).unwrap(), UnpackedPayload::NewerFormat(v) if v == SCHEMA_VERSION + 1));
}

#[test]
fn salts_and_fingerprints() {
    let salt = generate_manifest_salt();
    assert_eq!(salt.len(), 64);
    assert!(salt.chars().all(|c| c.is_ascii_hexdigit()));
    for bad in ["", "not-hex", "abc"] {
        assert!(hash::salted_blob_hash(&[1, 2, 3], bad).is_err(), "a blob hash without a usable salt would break the per-manifest separation");
    }

    // A content fingerprint ignores key order, whitespace and the volatile `canonicalizedAt`, and nothing else.
    let a = compute_content_fingerprint(r#"{"canonicalizedAt":"2026-01-01T00:00:00.000Z","schemaVersion":1,"tables":{"Items":[{"Id":"x","Name":"n"}]}}"#);
    let b = compute_content_fingerprint(r#"{ "tables": { "Items": [ { "Name": "n", "Id": "x" } ] }, "schemaVersion": 1, "canonicalizedAt": "2026-07-25T12:34:56.789Z" }"#);
    assert_eq!(a, b);
    assert_eq!(a.len(), 64);
    assert_ne!(a, compute_content_fingerprint(r#"{"schemaVersion":1,"tables":{"Items":[{"Id":"y","Name":"n"}]}}"#));
}

#[test]
fn unknown_top_level_manifest_fields_round_trip() {
    let manifest_json = json!({ "schemaVersion": 1, "manifestSalt": SALT, "canonicalizedAt": "2026-01-01T00:00:00.000Z", "manifestId": "m-1", "tables": { "Items": [] }, "futureField": { "nested": true } });
    let manifest: Manifest = serde_json::from_value(manifest_json).unwrap();
    assert!(manifest.extra.contains_key("futureField"));
    assert_eq!(serde_json::to_value(&manifest).unwrap()["futureField"], json!({ "nested": true }));
}

/*
 * Validation and repair.
 */

#[test]
fn canonicalize_repairs_what_validation_would_refuse() {
    // Dangling references are nulled or dropped on the way out, so a push is never refused for them; a manifest
    // handed to validation with them still in place is refused, with a stable rule id per reference.
    let out = canonicalize(vec![
        table("Items", vec![row(&[("Id", json!("i1")), ("FolderId", json!("missing"))]), row(&[("Id", json!("i2")), ("FolderId", json!(""))])]),
        table("Folders", vec![]),
        table("Tags", vec![]),
        table("ItemTags", vec![row(&[("ItemId", json!("i1")), ("TagId", json!("gone"))])]),
        table("TotpCodes", vec![row(&[("Id", json!("t1")), ("ItemId", json!("gone"))]), row(&[("Id", json!("t2")), ("ItemId", json!("i1"))])]),
    ]);
    let mut manifest = manifest_of(&out).manifest.clone();
    assert!(validate_manifest(&manifest).ok, "{:?}", validate_manifest(&manifest).failed_rules);
    assert!(manifest.tables["Items"].iter().all(|item| item["FolderId"].is_null()));
    assert!(manifest.tables["ItemTags"].is_empty());
    assert_eq!(manifest.tables["TotpCodes"].iter().map(|r| r["Id"].as_str().unwrap()).collect::<Vec<_>>(), vec!["t2"]);

    manifest.tables.get_mut("Items").unwrap()[0].insert("FolderId".to_string(), json!("missing"));
    let result = validate_manifest(&manifest);
    assert!(!result.ok);
    assert!(result.failed_rules.contains(&"items-folder-fk-broken".to_string()));
    assert!(result.message.contains("missing Folders missing"), "{}", result.message);
}

#[test]
fn validation_checks_the_header_and_uniqueness() {
    let mut manifest = canonicalize(vec![table("Items", vec![row(&[("Id", json!("i1"))])])]).manifests.remove(0).manifest;
    assert!(validate_manifest(&manifest).ok);

    manifest.tables.insert("Logos".to_string(), vec![row(&[("Id", json!("logo-a")), ("ManifestId", json!(PERSONAL)), ("Source", json!("github.com"))]), row(&[("Id", json!("logo-b")), ("ManifestId", json!(PERSONAL)), ("Source", json!("GitHub.com"))])]);
    manifest.tables.get_mut("Items").unwrap().push(row(&[("Id", json!("i1")), ("ManifestId", json!(PERSONAL))]));
    manifest.manifest_id = String::new();
    let result = validate_manifest(&manifest);
    for rule in ["manifestId-missing", "logo-sources-not-unique", "item-ids-not-unique"] {
        assert!(result.failed_rules.contains(&rule.to_string()), "{rule} missing from {:?}", result.failed_rules);
    }

    manifest.tables.clear();
    assert_eq!(validate_manifest(&manifest).failed_rules.last().map(String::as_str), Some("tables-missing"));
}

/*
 * Logos.
 */

#[test]
fn canonicalize_derives_logo_ids_collapses_duplicate_sources_and_nulls_dead_references() {
    // Two clients generated distinct random ids for the same domain; items point at each. Canonicalize re-derives the
    // row's id against its manifest, keeps the row that carries bytes, repoints both items, and nulls a reference no
    // logo satisfies (matching the FK's ON DELETE SET NULL).
    let favicon = vec![0x01, 0x02, 0x03];
    let out = canonicalize(vec![
        table("Logos", vec![
            row(&[("Id", json!("logo-z")), ("Source", json!("github.com")), ("MimeType", json!("empty")), ("FileData", serde_json::Value::Null)]),
            row(&[("Id", json!("logo-a")), ("Source", json!("github.com")), ("MimeType", json!("image/png")), ("FileData", json!({ "__b64": b64(&favicon) }))]),
        ]),
        table("Items", vec![row(&[("Id", json!("i1")), ("LogoId", json!("logo-z"))]), row(&[("Id", json!("i2")), ("LogoId", json!("logo-a"))]), row(&[("Id", json!("i3")), ("LogoId", json!("ghost"))])]),
    ]);
    let manifest = &manifest_of(&out).manifest;
    let expected_id = json!(logo_id_for(PERSONAL, "favicon", "github.com"));
    let logos = &manifest.tables["Logos"];
    assert_eq!(logos.len(), 1, "duplicate Source collapsed to one row");
    assert_eq!(logos[0]["Id"], expected_id);
    assert_eq!(logos[0]["ManifestId"], json!(PERSONAL));
    assert_eq!(logos[0]["MimeType"], json!("image/png"), "the row with bytes supplies the surviving content regardless of row order");
    assert_eq!(manifest_of(&out).blobs.len(), 1, "exactly the survivor's favicon is registered");
    let items: HashMap<&str, &CodecRecord> = manifest.tables["Items"].iter().map(|r| (r["Id"].as_str().unwrap(), r)).collect();
    assert_eq!(items["i1"]["LogoId"], expected_id);
    assert_eq!(items["i2"]["LogoId"], expected_id);
    assert_eq!(items["i3"]["LogoId"], serde_json::Value::Null);

    // Push stability: canonicalizing already-normalized rows must not change them, or every push would rewrite the manifest.
    let mut logo_row = logos[0].clone();
    logo_row.insert("FileData".to_string(), json!({ "__b64": b64(&favicon) }));
    let second = canonicalize(vec![table("Logos", vec![logo_row]), table("Items", manifest.tables["Items"].clone())]);
    assert_eq!(second.manifests[0].manifest.tables["Logos"], manifest.tables["Logos"]);
    assert_eq!(second.manifests[0].manifest.tables["Items"], manifest.tables["Items"]);
}

/*
 * Forward compatibility: the overflow a narrow schema carries between pull and push.
 */

#[test]
fn unknown_columns_and_tables_round_trip_through_the_overflow_row() {
    // A newer client wrote a column and two tables this client's schema does not know. None of it may reach the
    // insert set (it would crash), all of it lands in the emitted OVERFLOW_TABLE row, and all of it reappears on the
    // next canonicalize (which reads that row back like any table), on both push paths.
    let mut out = canonicalize(vec![table("Items", vec![row(&[("Id", json!("i1")), ("Name", json!("GitHub")), ("AliasEnabled", json!(true))])])]);
    out.manifests[0].manifest.tables.insert("NewTable".to_string(), vec![row(&[("Id", json!("n1")), ("Data", json!("x"))])]);
    out.data_buckets.iter_mut().find(|b| b.category == "settings").unwrap().tables.insert("Preferences".to_string(), vec![row(&[("Key", json!("p1"))])]);

    let re = materialize_as_sqlite(MaterializeInput { manifests: vec![out.manifests[0].manifest.clone()], data_buckets: out.data_buckets.clone(), schema_columns: narrow_client_schema() }).unwrap();
    let tables = materialized_map(&re);
    assert!(!tables["Items"][0].contains_key("AliasEnabled") && !tables.contains_key("NewTable") && !tables.contains_key("Preferences"), "unknown data never reaches the insert set");
    assert_eq!(tables["Items"][0]["Name"], json!("GitHub"));
    // Overflow columns are keyed by the row's full (ManifestId, Id) identity so two manifests holding the same Id keep their own.
    assert_eq!(re.overflow.columns["Items"][&format!("{}\u{1f}i1", PERSONAL)]["AliasEnabled"], json!(true));
    assert_eq!(re.overflow.tables["NewTable"][0]["ManifestId"], json!(PERSONAL), "unknown tables are stamped with the manifest they arrived in");
    assert_eq!(re.overflow.bucket_tables["settings"]["Preferences"].len(), 1);
    let overflow_table = overflow_table_of(&re).expect("overflow emitted as a regular table row").clone();
    assert_eq!(overflow_table.records[0]["Id"], json!(OVERFLOW_ROW_ID));

    // The old client renames the item and pushes.
    let pushed = canonicalize(vec![table("Items", vec![row(&[("Id", json!("i1")), ("Name", json!("GitHub (renamed)"))])]), overflow_table.clone()]);
    let item = &pushed.manifests[0].manifest.tables["Items"][0];
    assert_eq!((item["Name"].as_str(), item["AliasEnabled"].as_bool()), (Some("GitHub (renamed)"), Some(true)), "the newer writer's column survives the old client's push");
    assert_eq!(pushed.manifests[0].manifest.tables["NewTable"].len(), 1);
    assert_eq!(bucket_rows(&pushed, "settings", "Preferences").len(), 1);
    assert!(!pushed.manifests[0].manifest.tables.contains_key(OVERFLOW_TABLE), "carrier table consumed, never emitted into the manifest");

    // Bucket-only push: extract_buckets consumes the overflow row read alongside the category's tables.
    let buckets = extract_buckets("settings".to_string(), vec![PERSONAL.to_string()], [("Settings".to_string(), vec![row(&[("ManifestId", json!(PERSONAL)), ("Key", json!("k")), ("Value", json!("v"))])]), (OVERFLOW_TABLE.to_string(), overflow_table.records)].into_iter().collect()).unwrap();
    assert_eq!(buckets[0].tables["Preferences"].len(), 1);
    assert_eq!(buckets[0].tables["Settings"].len(), 1);
    assert!(!buckets[0].tables.contains_key(OVERFLOW_TABLE));
}

#[test]
fn overflow_columns_follow_their_row_and_die_with_it() {
    // A column stashed for a settings row re-attaches by the row's (ManifestId, Key) identity on a bucket-only push;
    // one stashed for a row that was deleted locally vanishes with the row.
    let settings_overflow = CodecOverflow { columns: [("Settings".to_string(), [(format!("{}\u{1f}theme", PERSONAL), row(&[("SyncScope", json!("device"))]))].into_iter().collect())].into_iter().collect(), ..Default::default() };
    let buckets = extract_buckets("settings".to_string(), vec![PERSONAL.to_string()], [("Settings".to_string(), vec![row(&[("ManifestId", json!(PERSONAL)), ("Key", json!("theme")), ("Value", json!("dark"))])]), (OVERFLOW_TABLE.to_string(), settings_overflow.to_table_records())].into_iter().collect()).unwrap();
    assert_eq!(buckets[0].tables["Settings"][0]["SyncScope"], json!("device"));

    let gone = CodecOverflow { columns: [("Items".to_string(), [("gone".to_string(), row(&[("AliasEnabled", json!(true))]))].into_iter().collect())].into_iter().collect(), ..Default::default() };
    let out = canonicalize(vec![table("Items", vec![row(&[("Id", json!("kept"))])]), table(OVERFLOW_TABLE, gone.to_table_records())]);
    assert!(!out.manifests[0].manifest.tables["Items"][0].contains_key("AliasEnabled"));
}

#[test]
fn an_overflow_row_smuggled_into_a_manifest_is_dropped() {
    // OVERFLOW_TABLE is local-only bookkeeping; a manifest carrying one would collide with the row materialize emits.
    let mut out = canonicalize(vec![table("Items", vec![row(&[("Id", json!("i1")), ("AliasEnabled", json!(true))])])]);
    out.manifests[0].manifest.tables.insert(OVERFLOW_TABLE.to_string(), vec![row(&[("Id", json!("smuggled")), ("Data", json!("{}"))])]);
    let re = materialize_as_sqlite(MaterializeInput { manifests: vec![out.manifests[0].manifest.clone()], data_buckets: out.data_buckets.clone(), schema_columns: narrow_client_schema() }).unwrap();
    let overflow_table = overflow_table_of(&re).expect("legitimate overflow row still emitted");
    assert_eq!(overflow_table.records.len(), 1);
    assert_eq!(overflow_table.records[0]["Id"], json!(OVERFLOW_ROW_ID), "only the codec's own row remains");
}

/*
 * Derived ids: single-value field values, histories and tag links travel without an id and get it back on materialize.
 */

#[test]
fn canonicalize_strips_derived_ids_and_renumbers_multi_value_rows() {
    let out = canonicalize(vec![
        table("Items", vec![row(&[("Id", json!("i-1"))])]),
        table("FieldDefinitions", vec![row(&[("Id", json!("fd-multi")), ("IsMultiValue", json!(1))]), row(&[("Id", json!("fd-single")), ("IsMultiValue", json!(0))])]),
        table("FieldValues", vec![
            row(&[("Id", json!("fv-old")), ("ItemId", json!("i-1")), ("FieldKey", json!("login.username")), ("Value", json!("stale")), ("UpdatedAt", json!("2024-01-01 00:00:00.000"))]),
            row(&[("Id", json!("fv-new")), ("ItemId", json!("i-1")), ("FieldKey", json!("login.username")), ("Value", json!("fresh")), ("UpdatedAt", json!("2024-06-01 00:00:00.000"))]),
            row(&[("Id", json!("u-1")), ("ItemId", json!("i-1")), ("FieldKey", json!("login.url")), ("Value", json!("https://a.example"))]),
            row(&[("Id", json!("u-2")), ("ItemId", json!("i-1")), ("FieldKey", json!("login.url")), ("Value", json!("https://b.example"))]),
            row(&[("Id", json!("c-1")), ("ItemId", json!("i-1")), ("FieldDefinitionId", json!("fd-multi")), ("Value", json!("multi-a"))]),
            row(&[("Id", json!("c-2")), ("ItemId", json!("i-1")), ("FieldDefinitionId", json!("fd-multi")), ("Value", json!("multi-b"))]),
            row(&[("Id", json!("c-3")), ("ItemId", json!("i-1")), ("FieldDefinitionId", json!("fd-single")), ("Value", json!("single-c"))]),
        ]),
        table("FieldHistories", vec![
            row(&[("Id", json!("fh-1")), ("ItemId", json!("i-1")), ("FieldKey", json!("login.password")), ("ChangedAt", json!("2026-01-01 10:00:00.000")), ("ValueSnapshot", json!("old-pass"))]),
            row(&[("Id", json!("fh-2")), ("ItemId", json!("i-1")), ("FieldKey", json!("login.password")), ("ChangedAt", json!("2026-02-01 10:00:00.000")), ("ValueSnapshot", json!("newer-pass"))]),
        ]),
        table("Tags", vec![row(&[("Id", json!("t-1"))])]),
        table("ItemTags", vec![row(&[("Id", json!("it-legacy")), ("ItemId", json!("i-1")), ("TagId", json!("t-1"))])]),
    ]);
    let manifest = &manifest_of(&out).manifest;
    let fv: HashMap<&str, &CodecRecord> = manifest.tables["FieldValues"].iter().map(|r| (r["Value"].as_str().unwrap(), r)).collect();
    assert!(!fv.contains_key("stale"), "two rows for one single-value field collapse to the newest");
    assert!(fv["fresh"].get("Id").is_none() && fv["single-c"].get("Id").is_none(), "a single-value field's id never reaches the wire");
    assert_eq!(fv["fresh"]["ValueIndex"], json!(0));
    assert_eq!((fv["https://a.example"]["Id"].as_str(), fv["https://b.example"]["Id"].as_str()), (Some("u-1"), Some("u-2")), "a multi-value field's values own their ids");
    assert_eq!((fv["https://a.example"]["ValueIndex"].as_i64(), fv["https://b.example"]["ValueIndex"].as_i64()), (Some(0), Some(1)), "renumbered in read order");
    assert_eq!((fv["multi-a"]["Id"].as_str(), fv["multi-b"]["Id"].as_str()), (Some("c-1"), Some("c-2")));
    assert_eq!(manifest.tables["FieldHistories"].len(), 2, "distinct ChangedAt values are distinct history rows");
    assert!(manifest.tables["FieldHistories"].iter().all(|r| r.get("Id").is_none()), "every history row derives its id");
    assert_eq!(manifest.tables["ItemTags"].len(), 1);
    assert!(!manifest.tables["ItemTags"][0].contains_key("Id"), "ItemTags carries no id at all");
}

#[test]
fn materialize_derives_the_missing_ids_back() {
    let manifest = Manifest {
        schema_version: SCHEMA_VERSION,
        manifest_salt: SALT.to_string(),
        canonicalized_at: "2026-01-01T00:00:00.000Z".to_string(),
        manifest_id: PERSONAL.to_string(),
        name: None,
        tables: [
            ("Items".to_string(), vec![stamped(PERSONAL, &[("Id", json!("i-1"))])]),
            ("FieldValues".to_string(), vec![
                stamped(PERSONAL, &[("ItemId", json!("i-1")), ("FieldKey", json!("login.username")), ("ValueIndex", json!(0)), ("Value", json!("me"))]),
                stamped(PERSONAL, &[("Id", json!("u-1")), ("ItemId", json!("i-1")), ("FieldKey", json!("login.url")), ("ValueIndex", json!(0)), ("Value", json!("https://a.example"))]),
            ]),
            ("Tags".to_string(), vec![stamped(PERSONAL, &[("Id", json!("t-1"))])]),
            ("ItemTags".to_string(), vec![stamped(PERSONAL, &[("ItemId", json!("i-1")), ("TagId", json!("t-1"))])]),
            ("FieldHistories".to_string(), vec![stamped(PERSONAL, &[("ItemId", json!("i-1")), ("FieldKey", json!("login.password")), ("ChangedAt", json!("2026-01-01 10:00:00.000")), ("ValueSnapshot", json!("old-pass"))])]),
        ]
        .into_iter()
        .collect(),
        extra: HashMap::new(),
    };
    // The schema knows the id columns the wire omits, so the derived ids fit instead of landing in the overflow.
    let mut schema = test_support::fitting_schema([&manifest], &[]);
    for table in ["FieldValues", "FieldHistories"] {
        schema.get_mut(table).unwrap().push("Id".to_string());
    }
    let out = materialize_as_sqlite(MaterializeInput { manifests: vec![manifest], data_buckets: vec![], schema_columns: schema }).unwrap();
    let tables = materialized_map(&out);
    let fv: HashMap<&str, &CodecRecord> = tables["FieldValues"].iter().map(|r| (r["Value"].as_str().unwrap(), r)).collect();
    assert_eq!(fv["me"]["Id"], json!(super::normalize::field_value_id_for(PERSONAL, "i-1", "login.username", "", 0)));
    assert_eq!(fv["https://a.example"]["Id"], json!("u-1"), "an owned multi-value id is kept as-is");
    assert_eq!(tables["ItemTags"].len(), 1, "the id-less join row inserts as-is");
    assert_eq!(tables["FieldHistories"][0]["Id"], json!(super::normalize::field_history_id_for(PERSONAL, "i-1", "login.password", "", "2026-01-01 10:00:00.000")));
    assert!(out.overflow.is_empty());
}
