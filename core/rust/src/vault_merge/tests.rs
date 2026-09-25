//! Tests for the canonical merge.

use super::*;
use serde_json::json;

const PERSONAL: &str = "m-personal";
const SHARED: &str = "m-shared";
const SALT: &str = "0123456789abcdef0123456789abcdef";

fn manifest(manifest_id: &str, tables: HashMap<String, Vec<CodecRecord>>) -> Manifest {
    Manifest {
        schema_version: 1,
        manifest_salt: SALT.to_string(),
        canonicalized_at: "2024-01-01T00:00:00Z".to_string(),
        manifest_id: manifest_id.to_string(),
        name: None,
        tables,
        extra: HashMap::new(),
    }
}

fn item(manifest_id: &str, id: &str, name: &str, updated_at: &str) -> CodecRecord {
    [
        ("ManifestId".to_string(), json!(manifest_id)),
        ("Id".to_string(), json!(id)),
        ("Name".to_string(), json!(name)),
        ("UpdatedAt".to_string(), json!(updated_at)),
    ]
    .into_iter()
    .collect()
}

fn items_manifest(manifest_id: &str, rows: Vec<CodecRecord>) -> Manifest {
    manifest(manifest_id, [("Items".to_string(), rows)].into_iter().collect())
}

fn schema() -> HashMap<String, Vec<String>> {
    [
        ("Items".to_string(), vec!["ManifestId".to_string(), "Id".to_string(), "Name".to_string(), "IsDeleted".to_string(), "UpdatedAt".to_string()]),
        ("Settings".to_string(), vec!["ManifestId".to_string(), "Key".to_string(), "Value".to_string(), "UpdatedAt".to_string()]),
        ("ItemStats".to_string(), vec!["ManifestId".to_string(), "Id".to_string(), "LastUsedAt".to_string(), "UpdatedAt".to_string()]),
        ("FieldValues".to_string(), vec!["ManifestId".to_string(), "Id".to_string(), "ItemId".to_string(), "FieldKey".to_string(), "FieldDefinitionId".to_string(), "ValueIndex".to_string(), "Value".to_string(), "IsDeleted".to_string(), "UpdatedAt".to_string()]),
        ("ItemTags".to_string(), vec!["ManifestId".to_string(), "ItemId".to_string(), "TagId".to_string(), "UpdatedAt".to_string()]),
        ("Attachments".to_string(), vec!["ManifestId".to_string(), "Id".to_string(), "Blob".to_string(), "UpdatedAt".to_string()]),
    ]
    .into_iter()
    .collect()
}

fn merge_single(server_rows: Vec<CodecRecord>, local_rows: Vec<CodecRecord>) -> CanonicalManifestMerge {
    let output = merge_canonical(CanonicalMergeInput {
        server_manifests: vec![items_manifest(PERSONAL, server_rows)],
        server_buckets: vec![],
        contentless_server_manifest_ids: vec![],
        local_manifests: vec![items_manifest(PERSONAL, local_rows)],
        local_buckets: vec![],
        schema_columns: schema(),
    })
    .unwrap();
    assert_eq!(output.manifests.len(), 1);
    output.manifests.into_iter().next().unwrap()
}

fn names_of(manifest: &Manifest) -> Vec<String> {
    manifest.tables.get("Items").map(|rows| rows.iter().map(|r| r["Name"].as_str().unwrap().to_string()).collect()).unwrap_or_default()
}

#[test]
fn local_newer_wins_server_newer_and_tie_keep_base() {
    let merged = merge_single(
        vec![
            item(PERSONAL, "local-wins", "server-old", "2024-01-01T00:00:00Z"),
            item(PERSONAL, "server-wins", "server-new", "2024-01-09T00:00:00Z"),
            item(PERSONAL, "tie", "server-tie", "2024-01-05T00:00:00Z"),
        ],
        vec![
            item(PERSONAL, "local-wins", "local-new", "2024-01-09T00:00:00Z"),
            item(PERSONAL, "server-wins", "local-old", "2024-01-01T00:00:00Z"),
            item(PERSONAL, "tie", "local-tie", "2024-01-05T00:00:00Z"),
        ],
    );

    assert_eq!(names_of(&merged.manifest), vec!["local-new", "server-new", "server-tie"], "ties and newer base rows keep the server version");
    assert_eq!(merged.stats.conflicts, 1);
    assert_eq!(merged.stats.records_from_server, 1);
    assert_eq!(merged.stats.records_from_local, 2);
}

#[test]
fn the_same_id_in_two_spellings_is_one_row() {
    // GUIDs are case-insensitive and should be stored/compared as such.
    let merged = merge_single(
        vec![item(PERSONAL, "9d3f7a2c-1b4e-4f80-8a11-2c3d4e5f6a7b", "server-old", "2024-01-01T00:00:00Z")],
        vec![item(PERSONAL, "9D3F7A2C-1B4E-4F80-8A11-2C3D4E5F6A7B", "local-new", "2024-01-09T00:00:00Z")],
    );

    assert_eq!(names_of(&merged.manifest), vec!["local-new"], "one row, the newer one");
}

#[test]
fn one_sided_rows_are_kept_on_both_sides() {
    let merged = merge_single(
        vec![item(PERSONAL, "server-only", "on-server", "2024-01-01T00:00:00Z")],
        vec![item(PERSONAL, "local-only", "made-offline", "2024-01-02T00:00:00Z")],
    );

    assert_eq!(names_of(&merged.manifest), vec!["on-server", "made-offline"], "base rows first, then offline-created rows");
    assert_eq!(merged.stats.records_created_locally, 1);
    assert_eq!(merged.stats.records_inserted, 1);
}

#[test]
fn manifests_merge_independently_same_id_never_crosses() {
    // The structural guarantee of the canonical merge: manifests are the partition, so the
    // same row id in two manifests can never interact, whatever the timestamps say.
    let output = merge_canonical(CanonicalMergeInput {
        server_manifests: vec![
            items_manifest(PERSONAL, vec![item(PERSONAL, "same-id", "mine", "2024-01-01T00:00:00Z")]),
            items_manifest(SHARED, vec![item(SHARED, "same-id", "theirs-old", "2024-01-01T00:00:00Z")]),
        ],
        server_buckets: vec![],
        contentless_server_manifest_ids: vec![],
        local_manifests: vec![
            items_manifest(PERSONAL, vec![item(PERSONAL, "same-id", "mine", "2024-01-01T00:00:00Z")]),
            items_manifest(SHARED, vec![item(SHARED, "same-id", "theirs-new", "2024-01-09T00:00:00Z")]),
        ],
        local_buckets: vec![],
        schema_columns: schema(),
    })
    .unwrap();

    let by_id: HashMap<&str, &CanonicalManifestMerge> = output.manifests.iter().map(|m| (m.manifest_id.as_str(), m)).collect();
    assert_eq!(names_of(&by_id[PERSONAL].manifest), vec!["mine"], "the personal row is untouched by the shared manifest's newer row");
    assert_eq!(names_of(&by_id[SHARED].manifest), vec!["theirs-new"]);
    assert_eq!(by_id[PERSONAL].stats.conflicts, 0);
}

#[test]
fn field_values_match_semantically_and_carry_no_surrogate_id() {
    // A single-value FieldValue arrives in wire shape (no Id, position 0) and matches on its
    // natural key: both sides converge to one row holding the winning value, still id-less.
    let field_value = |value: &str, updated_at: &str| -> CodecRecord {
        [
            ("ManifestId".to_string(), json!(PERSONAL)),
            ("ItemId".to_string(), json!("item-1")),
            ("FieldKey".to_string(), json!("username")),
            ("ValueIndex".to_string(), json!(0)),
            ("Value".to_string(), json!(value)),
            ("UpdatedAt".to_string(), json!(updated_at)),
        ]
        .into_iter()
        .collect()
    };

    let rows = merge_field_values(vec![field_value("old", "2024-01-01T00:00:00Z")], vec![field_value("new", "2024-01-09T00:00:00Z")]);
    assert_eq!(rows.len(), 1);
    assert!(rows[0].get("Id").is_none(), "a single-value row's id is derived at materialize, never carried on the wire");
    assert_eq!(rows[0]["Value"], json!("new"), "and the row carries the winning value");
}

/// A `login.url` FieldValues row: multi-value, so it owns its id on the wire.
fn url_value(id: &str, index: i64, value: &str, updated_at: &str) -> CodecRecord {
    [
        ("ManifestId".to_string(), json!(PERSONAL)),
        ("Id".to_string(), json!(id)),
        ("ItemId".to_string(), json!("item-1")),
        ("FieldKey".to_string(), json!("login.url")),
        ("ValueIndex".to_string(), json!(index)),
        ("Value".to_string(), json!(value)),
        ("UpdatedAt".to_string(), json!(updated_at)),
    ]
    .into_iter()
    .collect()
}

fn merge_field_values(server: Vec<CodecRecord>, local: Vec<CodecRecord>) -> Vec<CodecRecord> {
    let output = merge_canonical(CanonicalMergeInput {
        server_manifests: vec![manifest(PERSONAL, [("FieldValues".to_string(), server)].into_iter().collect())],
        server_buckets: vec![],
        contentless_server_manifest_ids: vec![],
        local_manifests: vec![manifest(PERSONAL, [("FieldValues".to_string(), local)].into_iter().collect())],
        local_buckets: vec![],
        schema_columns: schema(),
    })
    .unwrap();
    output.manifests[0].manifest.tables["FieldValues"].clone()
}

#[test]
fn multi_value_edit_converges_on_the_owned_id() {
    // The same owned id on both sides is the same row edited: LWW, one row out.
    let rows = merge_field_values(
        vec![url_value("url-1", 0, "https://a.example", "2024-01-01T00:00:00Z")],
        vec![url_value("url-1", 0, "https://a-edited.example", "2024-01-09T00:00:00Z")],
    );
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["Id"], json!("url-1"), "the row keeps its owned id");
    assert_eq!(rows[0]["Value"], json!("https://a-edited.example"));
}

#[test]
fn multi_value_concurrent_adds_both_survive() {
    // Two devices each add a 2nd url while offline: both additions land at position 1 under
    // different owned ids. Position is not identity, so the union keeps both, renumbered.
    let rows = merge_field_values(
        vec![url_value("url-a", 0, "https://a.example", "2024-01-01T00:00:00Z"), url_value("url-b", 1, "https://b.example", "2024-01-05T00:00:00Z")],
        vec![url_value("url-a", 0, "https://a.example", "2024-01-01T00:00:00Z"), url_value("url-c", 1, "https://c.example", "2024-01-06T00:00:00Z")],
    );
    let mut values: Vec<&str> = rows.iter().map(|r| r["Value"].as_str().unwrap()).collect();
    values.sort();
    assert_eq!(values, vec!["https://a.example", "https://b.example", "https://c.example"]);
    let mut indexes: Vec<i64> = rows.iter().map(|r| r["ValueIndex"].as_i64().unwrap()).collect();
    indexes.sort();
    assert_eq!(indexes, vec![0, 1, 2], "colliding positions are renumbered in the merged output");
}

#[test]
fn multi_value_reorder_does_not_duplicate() {
    // Reordering changes only ValueIndex; the owned id keeps the rows matched, so no row doubles.
    let rows = merge_field_values(
        vec![url_value("url-a", 0, "https://a.example", "2024-01-01T00:00:00Z"), url_value("url-b", 1, "https://b.example", "2024-01-01T00:00:00Z")],
        vec![url_value("url-b", 0, "https://b.example", "2024-01-09T00:00:00Z"), url_value("url-a", 1, "https://a.example", "2024-01-09T00:00:00Z")],
    );
    assert_eq!(rows.len(), 2);
    let by_id: HashMap<&str, i64> = rows.iter().map(|r| (r["Id"].as_str().unwrap(), r["ValueIndex"].as_i64().unwrap())).collect();
    assert_eq!(by_id["url-b"], 0, "the reorder won");
    assert_eq!(by_id["url-a"], 1);
}

#[test]
fn both_sides_holding_the_same_two_urls_stay_two_rows() {
    // The historic corruption case: before the id-based key, the 2nd url's value replaced the
    // 1st on an ordinary push. Identical sides must merge to exactly themselves.
    let two = vec![url_value("url-a", 0, "https://a.example", "2024-01-01T00:00:00Z"), url_value("url-b", 1, "https://b.example", "2024-01-02T00:00:00Z")];
    let rows = merge_field_values(two.clone(), two);
    assert_eq!(rows.len(), 2);
    let by_id: HashMap<&str, &str> = rows.iter().map(|r| (r["Id"].as_str().unwrap(), r["Value"].as_str().unwrap())).collect();
    assert_eq!(by_id["url-a"], "https://a.example");
    assert_eq!(by_id["url-b"], "https://b.example");
}

#[test]
fn custom_field_values_of_one_item_do_not_collapse() {
    // Custom fields carry no FieldKey (only a FieldDefinitionId); before FieldDefinitionId joined
    // the key they all collapsed onto one empty-string key.
    let custom = |def: &str, value: &str, updated_at: &str| -> CodecRecord {
        [
            ("ManifestId".to_string(), json!(PERSONAL)),
            ("Id".to_string(), json!(format!("cv-{}", def))),
            ("ItemId".to_string(), json!("item-1")),
            ("FieldKey".to_string(), serde_json::Value::Null),
            ("FieldDefinitionId".to_string(), json!(def)),
            ("Value".to_string(), json!(value)),
            ("UpdatedAt".to_string(), json!(updated_at)),
        ]
        .into_iter()
        .collect()
    };
    let rows = merge_field_values(
        vec![custom("fd-pin", "1234", "2024-01-01T00:00:00Z"), custom("fd-member", "M-77", "2024-01-01T00:00:00Z")],
        vec![custom("fd-pin", "9999", "2024-01-09T00:00:00Z"), custom("fd-member", "M-77", "2024-01-01T00:00:00Z")],
    );
    assert_eq!(rows.len(), 2, "each custom field keeps its own row");
    let mut values: Vec<&str> = rows.iter().map(|r| r["Value"].as_str().unwrap()).collect();
    values.sort();
    assert_eq!(values, vec!["9999", "M-77"]);
}

#[test]
fn field_histories_union_by_changed_at_and_converge_on_the_same_snapshot() {
    // History rows derive their id from (item, field, ChangedAt): concurrent changes on two
    // devices carry different timestamps and union; the same snapshot on both sides is one row.
    let history = |changed_at: &str, snapshot: &str| -> CodecRecord {
        [
            ("ManifestId".to_string(), json!(PERSONAL)),
            ("ItemId".to_string(), json!("item-1")),
            ("FieldKey".to_string(), json!("login.password")),
            ("ChangedAt".to_string(), json!(changed_at)),
            ("ValueSnapshot".to_string(), json!(snapshot)),
            ("UpdatedAt".to_string(), json!(changed_at)),
        ]
        .into_iter()
        .collect()
    };
    let shared = history("2024-01-01 10:00:00.000", "both-know-this");
    let output = merge_canonical(CanonicalMergeInput {
        server_manifests: vec![manifest(PERSONAL, [("FieldHistories".to_string(), vec![shared.clone(), history("2024-02-01 10:00:00.000", "server-only")])].into_iter().collect())],
        server_buckets: vec![],
        contentless_server_manifest_ids: vec![],
        local_manifests: vec![manifest(PERSONAL, [("FieldHistories".to_string(), vec![shared, history("2024-02-01 11:30:00.000", "local-only")])].into_iter().collect())],
        local_buckets: vec![],
        schema_columns: schema(),
    })
    .unwrap();
    let rows = &output.manifests[0].manifest.tables["FieldHistories"];
    let mut snapshots: Vec<&str> = rows.iter().map(|r| r["ValueSnapshot"].as_str().unwrap()).collect();
    snapshots.sort();
    assert_eq!(snapshots, vec!["both-know-this", "local-only", "server-only"]);
    assert!(rows.iter().all(|r| r.get("Id").is_none()), "merged history rows stay id-less on the wire");
}

#[test]
fn item_tags_converge_on_their_natural_key() {
    // Two devices tag the same item with the same tag: the id-less join rows are one row.
    let tag_row = |updated_at: &str| -> CodecRecord {
        [
            ("ManifestId".to_string(), json!(PERSONAL)),
            ("ItemId".to_string(), json!("item-1")),
            ("TagId".to_string(), json!("tag-1")),
            ("UpdatedAt".to_string(), json!(updated_at)),
        ]
        .into_iter()
        .collect()
    };
    let output = merge_canonical(CanonicalMergeInput {
        server_manifests: vec![manifest(PERSONAL, [("ItemTags".to_string(), vec![tag_row("2024-01-01T00:00:00Z")])].into_iter().collect())],
        server_buckets: vec![],
        contentless_server_manifest_ids: vec![],
        local_manifests: vec![manifest(PERSONAL, [("ItemTags".to_string(), vec![tag_row("2024-01-09T00:00:00Z")])].into_iter().collect())],
        local_buckets: vec![],
        schema_columns: schema(),
    })
    .unwrap();
    let rows = &output.manifests[0].manifest.tables["ItemTags"];
    assert_eq!(rows.len(), 1, "the same (item, tag) link is one row on both sides");
    assert!(rows[0].get("Id").is_none());
}

#[test]
fn bucketed_tables_merge_and_come_back_as_buckets() {
    let setting = |value: &str, updated_at: &str| -> CodecRecord {
        [
            ("ManifestId".to_string(), json!(PERSONAL)),
            ("Key".to_string(), json!("theme")),
            ("Value".to_string(), json!(value)),
            ("UpdatedAt".to_string(), json!(updated_at)),
        ]
        .into_iter()
        .collect()
    };

    let output = merge_canonical(CanonicalMergeInput {
        server_manifests: vec![items_manifest(PERSONAL, vec![])],
        server_buckets: vec![DataBucket::new(PERSONAL, "Settings", [("Settings".to_string(), vec![setting("light", "2024-01-01T00:00:00Z")])].into_iter().collect())],
        contentless_server_manifest_ids: vec![],
        local_manifests: vec![items_manifest(PERSONAL, vec![])],
        local_buckets: vec![DataBucket::new(PERSONAL, "Settings", [("Settings".to_string(), vec![setting("dark", "2024-01-09T00:00:00Z")])].into_iter().collect())],
        schema_columns: schema(),
    })
    .unwrap();

    let merged = &output.manifests[0];
    assert!(!merged.manifest.tables.contains_key("Settings"), "bucketed tables never surface in manifest.tables");
    assert_eq!(merged.buckets.len(), 1);
    assert_eq!(merged.buckets[0].category, "Settings");
    assert_eq!(merged.buckets[0].tables["Settings"][0]["Value"], json!("dark"), "the newer local setting wins inside the bucket");
    assert!(crate::vault_codec::validate_data_bucket(&merged.buckets[0]).ok);
}

#[test]
fn an_empty_table_the_server_carried_stays_in_the_merged_manifest() {
    /*
     * The merged manifest is pushed as-is and compared against a baseline canonicalize produced, and
     * canonicalize keeps an empty table. Dropping it here rewrites the whole manifest on every merge.
     */
    let merged = merge_single(vec![], vec![]);
    assert_eq!(merged.manifest.tables.get("Items").map(Vec::len), Some(0), "the server's empty table keeps its place in the merged manifest");

    // The empty tables of a bucket the server served come back as that bucket, not as a missing one.
    let output = merge_canonical(CanonicalMergeInput {
        server_manifests: vec![items_manifest(PERSONAL, vec![])],
        server_buckets: vec![DataBucket::new(PERSONAL, "Settings", [("Settings".to_string(), vec![])].into_iter().collect())],
        contentless_server_manifest_ids: vec![],
        local_manifests: vec![items_manifest(PERSONAL, vec![])],
        local_buckets: vec![],
        schema_columns: schema(),
    })
    .unwrap();
    let buckets = &output.manifests[0].buckets;
    assert_eq!(buckets.len(), 1, "the served bucket is still emitted when it holds no rows");
    assert_eq!(buckets[0].tables.get("Settings").map(Vec::len), Some(0));
}

#[test]
fn unknown_columns_keep_the_server_value_when_local_wins() {
    // A newer client added Items.NewColumn; this client's schema does not know it. The local
    // row winning the LWW must not regress that column.
    let mut base = item(PERSONAL, "row", "server-old", "2024-01-01T00:00:00Z");
    base.insert("NewColumn".to_string(), json!("newer-client-value"));
    let mut incoming = item(PERSONAL, "row", "local-new", "2024-01-09T00:00:00Z");
    incoming.insert("NewColumn".to_string(), json!("stale-carried-value"));

    let merged = merge_single(vec![base], vec![incoming]);

    let row = &merged.manifest.tables["Items"][0];
    assert_eq!(row["Name"], json!("local-new"), "known columns follow the winner");
    assert_eq!(row["NewColumn"], json!("newer-client-value"), "unknown columns keep the base value");
}

#[test]
fn unknown_tables_are_taken_from_the_server_wholesale() {
    let future_row = |payload: &str| -> CodecRecord {
        [("ManifestId".to_string(), json!(PERSONAL)), ("Id".to_string(), json!("f-1")), ("Payload".to_string(), json!(payload))].into_iter().collect()
    };
    let with_future = |payload: Option<&str>| -> Manifest {
        let mut tables: HashMap<String, Vec<CodecRecord>> = [("Items".to_string(), vec![])].into_iter().collect();
        if let Some(p) = payload {
            tables.insert("FutureTable".to_string(), vec![future_row(p)]);
        }
        manifest(PERSONAL, tables)
    };

    let output = merge_canonical(CanonicalMergeInput {
        server_manifests: vec![with_future(Some("server-version"))],
        server_buckets: vec![],
        contentless_server_manifest_ids: vec![],
        local_manifests: vec![with_future(Some("local-carried-version"))],
        local_buckets: vec![],
        schema_columns: schema(),
    })
    .unwrap();
    assert_eq!(output.manifests[0].manifest.tables["FutureTable"][0]["Payload"], json!("server-version"));

    // And a local-only unknown table is dropped, matching the discarded local carrier of today.
    let output = merge_canonical(CanonicalMergeInput {
        server_manifests: vec![with_future(None)],
        server_buckets: vec![],
        contentless_server_manifest_ids: vec![],
        local_manifests: vec![with_future(Some("local-only"))],
        local_buckets: vec![],
        schema_columns: schema(),
    })
    .unwrap();
    assert!(!output.manifests[0].manifest.tables.contains_key("FutureTable"));
}

#[test]
fn local_manifest_no_longer_served_is_dropped_and_reported() {
    let output = merge_canonical(CanonicalMergeInput {
        server_manifests: vec![items_manifest(PERSONAL, vec![])],
        server_buckets: vec![],
        contentless_server_manifest_ids: vec![],
        local_manifests: vec![items_manifest(PERSONAL, vec![]), items_manifest(SHARED, vec![item(SHARED, "x", "gone", "2024-01-01T00:00:00Z")])],
        local_buckets: vec![],
        schema_columns: schema(),
    })
    .unwrap();

    assert_eq!(output.manifests.len(), 1);
    assert_eq!(output.dropped_local_manifest_ids, vec![SHARED.to_string()]);
}

#[test]
fn contentless_server_manifest_passes_the_local_one_through() {
    let output = merge_canonical(CanonicalMergeInput {
        server_manifests: vec![items_manifest(PERSONAL, vec![])],
        server_buckets: vec![],
        contentless_server_manifest_ids: vec![SHARED.to_string()],
        local_manifests: vec![items_manifest(PERSONAL, vec![]), items_manifest(SHARED, vec![item(SHARED, "x", "kept-offline", "2024-01-01T00:00:00Z")])],
        local_buckets: vec![],
        schema_columns: schema(),
    })
    .unwrap();

    assert!(output.dropped_local_manifest_ids.is_empty());
    let shared = output.manifests.iter().find(|m| m.manifest_id == SHARED).unwrap();
    assert_eq!(names_of(&shared.manifest), vec!["kept-offline"]);
    assert_eq!(shared.stats.records_inserted, 1);
}

#[test]
fn blob_refs_ride_through_as_opaque_values() {
    let attachment = |blob_ref: &str, updated_at: &str| -> CodecRecord {
        [
            ("ManifestId".to_string(), json!(PERSONAL)),
            ("Id".to_string(), json!("att-1")),
            ("Blob".to_string(), json!({ "__blobRef": blob_ref, "__blobKind": "attachment" })),
            ("UpdatedAt".to_string(), json!(updated_at)),
        ]
        .into_iter()
        .collect()
    };

    let output = merge_canonical(CanonicalMergeInput {
        server_manifests: vec![manifest(PERSONAL, [("Attachments".to_string(), vec![attachment("hash-old", "2024-01-01T00:00:00Z")])].into_iter().collect())],
        server_buckets: vec![],
        contentless_server_manifest_ids: vec![],
        local_manifests: vec![manifest(PERSONAL, [("Attachments".to_string(), vec![attachment("hash-new", "2024-01-09T00:00:00Z")])].into_iter().collect())],
        local_buckets: vec![],
        schema_columns: schema(),
    })
    .unwrap();

    assert_eq!(output.manifests[0].manifest.tables["Attachments"][0]["Blob"], json!({ "__blobRef": "hash-new", "__blobKind": "attachment" }));
}

#[test]
fn merged_manifest_keeps_server_metadata_and_validates() {
    let mut server = items_manifest(PERSONAL, vec![item(PERSONAL, "a", "server", "2024-01-01T00:00:00Z")]);
    server.name = Some("Family".to_string());
    let local = items_manifest(PERSONAL, vec![item(PERSONAL, "b", "local", "2024-01-02T00:00:00Z")]);

    let output = merge_canonical(CanonicalMergeInput {
        server_manifests: vec![server],
        server_buckets: vec![],
        contentless_server_manifest_ids: vec![],
        local_manifests: vec![local],
        local_buckets: vec![],
        schema_columns: schema(),
    })
    .unwrap();

    let merged = &output.manifests[0].manifest;
    assert_eq!(merged.manifest_salt, SALT, "salt comes from the server manifest");
    assert_eq!(merged.name.as_deref(), Some("Family"), "name comes from the server manifest");
    let validation = crate::vault_codec::validate_manifest(merged);
    assert!(validation.ok, "merged manifest must validate: {:?}", validation.failed_rules);
}

#[test]
fn manifest_pairing_is_case_insensitive() {
    let output = merge_canonical(CanonicalMergeInput {
        server_manifests: vec![items_manifest("M-PERSONAL", vec![item("M-PERSONAL", "a", "server", "2024-01-01T00:00:00Z")])],
        server_buckets: vec![],
        contentless_server_manifest_ids: vec![],
        local_manifests: vec![items_manifest("m-personal", vec![item("m-personal", "b", "local", "2024-01-02T00:00:00Z")])],
        local_buckets: vec![],
        schema_columns: schema(),
    })
    .unwrap();

    assert!(output.dropped_local_manifest_ids.is_empty(), "differently-cased ids are the same manifest");
    assert_eq!(output.manifests[0].manifest.tables["Items"].len(), 2);
}

#[test]
fn unknown_category_bucket_tables_ride_through_from_the_server() {
    // A newer writer added a table inside the Settings bucket and a whole new category. The
    // known Settings rows still merge; the unknown tables ride through from the server only.
    let unknown_row: CodecRecord = [("ManifestId".to_string(), json!(PERSONAL)), ("Id".to_string(), json!("u-1"))].into_iter().collect();
    let server_settings = DataBucket::new(
        PERSONAL,
        "Settings",
        [
            ("Settings".to_string(), vec![[("ManifestId".to_string(), json!(PERSONAL)), ("Key".to_string(), json!("theme")), ("Value".to_string(), json!("light")), ("UpdatedAt".to_string(), json!("2024-01-01T00:00:00Z"))].into_iter().collect()]),
            ("SettingsExtras".to_string(), vec![unknown_row.clone()]),
        ]
        .into_iter()
        .collect(),
    );
    let local_future = DataBucket::new(PERSONAL, "FutureCategory", [("FutureRows".to_string(), vec![unknown_row])].into_iter().collect());

    let output = merge_canonical(CanonicalMergeInput {
        server_manifests: vec![items_manifest(PERSONAL, vec![])],
        server_buckets: vec![server_settings],
        contentless_server_manifest_ids: vec![],
        local_manifests: vec![items_manifest(PERSONAL, vec![])],
        local_buckets: vec![local_future],
        schema_columns: schema(),
    })
    .unwrap();

    let buckets = &output.manifests[0].buckets;
    let categories: Vec<&str> = buckets.iter().map(|b| b.category.as_str()).collect();
    assert!(categories.contains(&"Settings"), "the known Settings rows still come back as a bucket");
    assert!(buckets.iter().any(|b| b.category == "Settings" && b.tables.contains_key("SettingsExtras")), "the server's unknown bucket table rides through under its category");
    assert!(!categories.contains(&"FutureCategory"), "a local-only unknown bucket is dropped with the rest of the local carrier");
}

#[test]
fn keys_compare_guids_case_insensitively_and_survive_a_missing_column() {
    const MANIFEST: &str = "1dd1a3fd-8e0e-4b3f-9a3a-0f1a2b3c4d5e";
    const OTHER_MANIFEST: &str = "2ee2b4fe-9f1f-4c40-8b4b-1a2b3c4d5e6f";
    const ROW: &str = "3ff3c50f-a020-4d51-9c5c-2b3c4d5e6f70";
    let row = |manifest: &str, id: &str| -> CodecRecord {
        HashMap::from([("ManifestId".to_string(), json!(manifest)), ("Id".to_string(), json!(id))])
    };
    let columns = ["ManifestId", "Id"];

    // Two writers spelling the same ids in different cases address one row (see `identity_part`).
    assert_eq!(get_key(&row(MANIFEST, ROW), &columns), get_key(&row(&MANIFEST.to_uppercase(), &ROW.to_uppercase()), &columns));
    assert_ne!(get_key(&row(MANIFEST, ROW), &columns), get_key(&row(OTHER_MANIFEST, ROW), &columns));
    assert_eq!(get_key(&HashMap::from([("Id".to_string(), json!(ROW))]), &columns), format!(":{}", ROW));
}

/// An `Items` row, live or tombstoned.
fn item_row(manifest_id: &str, id: &str, deleted: bool, updated_at: &str) -> CodecRecord {
    let mut row = item(manifest_id, id, "item", updated_at);
    row.insert("IsDeleted".to_string(), json!(if deleted { 1 } else { 0 }));
    row
}

/// A single-value `FieldValues` row of `item-1` in wire shape, live or tombstoned.
fn field_of_item(manifest_id: &str, field_key: &str, value: &str, deleted: bool, updated_at: &str) -> CodecRecord {
    [
        ("ManifestId".to_string(), json!(manifest_id)),
        ("ItemId".to_string(), json!("item-1")),
        ("FieldKey".to_string(), json!(field_key)),
        ("ValueIndex".to_string(), json!(0)),
        ("Value".to_string(), json!(value)),
        ("IsDeleted".to_string(), json!(if deleted { 1 } else { 0 })),
        ("UpdatedAt".to_string(), json!(updated_at)),
    ]
    .into_iter()
    .collect()
}

fn item_manifest(manifest_id: &str, items: Vec<CodecRecord>, field_values: Vec<CodecRecord>) -> Manifest {
    manifest(manifest_id, [("Items".to_string(), items), ("FieldValues".to_string(), field_values)].into_iter().collect())
}

fn merge_manifests(server: Vec<Manifest>, local: Vec<Manifest>) -> Vec<CanonicalManifestMerge> {
    merge_canonical(CanonicalMergeInput { server_manifests: server, server_buckets: vec![], contentless_server_manifest_ids: vec![], local_manifests: local, local_buckets: vec![], schema_columns: schema() }).unwrap().manifests
}

fn live_values(merged: &CanonicalManifestMerge) -> Vec<String> {
    let mut values: Vec<String> = merged.manifest.tables["FieldValues"].iter().filter(|r| r["IsDeleted"] == json!(0)).map(|r| r["Value"].as_str().unwrap().to_string()).collect();
    values.sort();
    values
}

const T_OLD: &str = "2024-01-01T00:00:00Z";
const T_DELETE: &str = "2024-01-05T05:00:00Z";
const T_EDIT: &str = "2024-01-05T05:05:00Z";

#[test]
fn a_permanent_delete_does_not_get_its_children_back_from_the_other_side() {
    // The deleting side removed the item's rows; the server still holds them and must not resurrect them.
    let server = item_manifest(PERSONAL, vec![item_row(PERSONAL, "item-1", false, T_OLD)], vec![field_of_item(PERSONAL, "login.password", "secret", false, T_OLD)]);
    let local = item_manifest(PERSONAL, vec![item_row(PERSONAL, "item-1", true, T_DELETE)], vec![]);
    for (base, incoming) in [(server.clone(), local.clone()), (local, server)] {
        let merged = &merge_manifests(vec![base], vec![incoming])[0];
        assert_eq!(merged.manifest.tables["Items"][0]["IsDeleted"], json!(1), "the delete stands");
        assert!(merged.manifest.tables["FieldValues"].is_empty(), "and the deleted item keeps no rows");
    }
}

#[test]
fn an_item_edited_after_the_other_side_deleted_it_survives_whole() {
    // One side deleted the item at 05:00, tombstoning its rows as the pruner does. The other edited one
    // field at 05:05, which never touches the item row. The edit is the last write, so the item survives,
    // and with every field: the delete's child tombstones must not wipe the fields the edit left alone.
    let deleting = item_manifest(PERSONAL, vec![item_row(PERSONAL, "item-1", true, T_DELETE)], vec![
        field_of_item(PERSONAL, "login.username", "user", true, T_DELETE),
        field_of_item(PERSONAL, "login.password", "old-secret", true, T_DELETE),
    ]);
    let editing = item_manifest(PERSONAL, vec![item_row(PERSONAL, "item-1", false, T_OLD)], vec![
        field_of_item(PERSONAL, "login.username", "user", false, T_OLD),
        field_of_item(PERSONAL, "login.password", "new-secret", false, T_EDIT),
    ]);
    for (base, incoming) in [(deleting.clone(), editing.clone()), (editing, deleting)] {
        let merged = &merge_manifests(vec![base], vec![incoming])[0];
        assert_eq!(merged.manifest.tables["Items"].len(), 1);
        assert_eq!(merged.manifest.tables["Items"][0]["IsDeleted"], json!(0), "the later edit outlives the delete");
        assert_eq!(live_values(merged), vec!["new-secret", "user"], "with the untouched field intact");
    }
}

#[test]
fn a_delete_newer_than_everything_the_other_side_did_stands() {
    let editing = item_manifest(PERSONAL, vec![item_row(PERSONAL, "item-1", false, T_OLD)], vec![field_of_item(PERSONAL, "login.password", "edited", false, T_DELETE)]);
    let deleting = item_manifest(PERSONAL, vec![item_row(PERSONAL, "item-1", true, T_EDIT)], vec![]);
    for (base, incoming) in [(deleting.clone(), editing.clone()), (editing, deleting)] {
        let merged = &merge_manifests(vec![base], vec![incoming])[0];
        assert_eq!(merged.manifest.tables["Items"][0]["IsDeleted"], json!(1));
        assert!(merged.manifest.tables["FieldValues"].is_empty());
    }
}

#[test]
fn a_delete_and_an_edit_at_the_same_instant_keep_the_server_side() {
    let deleting = item_manifest(PERSONAL, vec![item_row(PERSONAL, "item-1", true, T_EDIT)], vec![]);
    let editing = item_manifest(PERSONAL, vec![item_row(PERSONAL, "item-1", false, T_OLD)], vec![field_of_item(PERSONAL, "login.password", "edited", false, T_EDIT)]);

    let merged = &merge_manifests(vec![deleting.clone()], vec![editing.clone()])[0];
    assert_eq!(merged.manifest.tables["Items"][0]["IsDeleted"], json!(1), "the server's delete keeps the tie");

    let merged = &merge_manifests(vec![editing], vec![deleting])[0];
    assert_eq!(merged.manifest.tables["Items"][0]["IsDeleted"], json!(0), "the server's edit keeps the tie");
    assert_eq!(live_values(merged), vec!["edited"]);
}

#[test]
fn a_usage_counter_does_not_outlive_a_delete() {
    // ItemStats ticks on every autofill; that is not an edit and must not undo a delete.
    let stats = |updated_at: &str| -> CodecRecord {
        [("ManifestId".to_string(), json!(PERSONAL)), ("Id".to_string(), json!("item-1")), ("LastUsedAt".to_string(), json!(updated_at)), ("UpdatedAt".to_string(), json!(updated_at))].into_iter().collect()
    };
    let output = merge_canonical(CanonicalMergeInput {
        server_manifests: vec![item_manifest(PERSONAL, vec![item_row(PERSONAL, "item-1", true, T_DELETE)], vec![])],
        server_buckets: vec![],
        contentless_server_manifest_ids: vec![],
        local_manifests: vec![item_manifest(PERSONAL, vec![item_row(PERSONAL, "item-1", false, T_OLD)], vec![])],
        local_buckets: vec![DataBucket::new(PERSONAL, "Stats", [("ItemStats".to_string(), vec![stats(T_EDIT)])].into_iter().collect())],
        schema_columns: schema(),
    })
    .unwrap();
    let merged = &output.manifests[0];
    assert_eq!(merged.manifest.tables["Items"][0]["IsDeleted"], json!(1));
    assert!(merged.buckets.iter().all(|bucket| bucket.tables.get("ItemStats").is_none_or(Vec::is_empty)), "the deleted item's stats row goes with it");
}

#[test]
fn an_item_moved_to_another_manifest_does_not_stay_behind_in_the_one_it_left() {
    // The move leaves a tombstone in the source manifest, so the server's copy there loses instead of
    // surviving the union next to the moved one.
    let server = vec![
        item_manifest(PERSONAL, vec![item_row(PERSONAL, "item-1", false, T_OLD)], vec![field_of_item(PERSONAL, "login.password", "secret", false, T_OLD)]),
        item_manifest(SHARED, vec![], vec![]),
    ];
    let local = vec![
        item_manifest(PERSONAL, vec![item_row(PERSONAL, "item-1", true, T_EDIT)], vec![]),
        item_manifest(SHARED, vec![item_row(SHARED, "item-1", false, T_EDIT)], vec![field_of_item(SHARED, "login.password", "secret", false, T_OLD)]),
    ];
    let merged = merge_manifests(server, local);
    let by_id: HashMap<&str, &CanonicalManifestMerge> = merged.iter().map(|m| (m.manifest_id.as_str(), m)).collect();
    assert_eq!(by_id[PERSONAL].manifest.tables["Items"][0]["IsDeleted"], json!(1), "the source manifest keeps only the tombstone");
    assert!(by_id[PERSONAL].manifest.tables["FieldValues"].is_empty());
    assert_eq!(by_id[SHARED].manifest.tables["Items"][0]["IsDeleted"], json!(0));
    assert_eq!(live_values(by_id[SHARED]), vec!["secret"], "and the moved item arrives whole");
}
