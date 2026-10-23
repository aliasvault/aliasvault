use std::collections::HashMap;

use serde_json::{json, Value};

use crate::vault_codec::integrity::*;
use crate::vault_codec::manifest::CodecRecord;
use crate::vault_codec::tests::support::{row, stamped, PERSONAL_MANIFEST_ID as M};

fn tables(entries: &[(&str, Vec<CodecRecord>)]) -> HashMap<String, Vec<CodecRecord>> {
    entries.iter().map(|(name, rows)| (name.to_string(), rows.clone())).collect()
}

#[test]
fn a_reference_that_resolves_only_in_another_manifest_dangles() {
    let mut set = tables(&[
        ("Folders", vec![row(&[("ManifestId", json!("m-other")), ("Id", json!("f-1"))])]),
        ("Items", vec![stamped(M, &[("Id", json!("i-1")), ("FolderId", json!("f-1"))])]),
    ]);
    assert_eq!(violations(&set).len(), 1);
    repair(&mut set);
    assert_eq!(set["Items"][0]["FolderId"], Value::Null);
    assert!(violations(&set).is_empty(), "validation cannot refuse what repair leaves behind");
}

#[test]
fn child_rows_are_dropped_and_nullable_references_nulled() {
    let mut set = tables(&[
        ("Folders", vec![stamped(M, &[("Id", json!("f-1")), ("ParentFolderId", json!("gone"))])]),
        ("Items", vec![stamped(M, &[("Id", json!("i-1")), ("FolderId", json!("gone")), ("IsDeleted", json!(0))]), stamped(M, &[("Id", json!("i-dead")), ("IsDeleted", json!(1))])]),
        ("Tags", vec![]),
        ("FieldDefinitions", vec![]),
        ("TotpCodes", vec![stamped(M, &[("Id", json!("t-1")), ("ItemId", json!("i-1"))]), stamped(M, &[("Id", json!("t-orphan")), ("ItemId", json!("nobody"))]), stamped(M, &[("Id", json!("t-dead")), ("ItemId", json!("i-dead"))])]),
        ("ItemTags", vec![stamped(M, &[("Id", json!("it-1")), ("ItemId", json!("i-1")), ("TagId", json!("no-tag"))])]),
        ("FieldValues", vec![stamped(M, &[("Id", json!("fv-1")), ("ItemId", json!("i-1")), ("FieldDefinitionId", json!("no-def")), ("Value", json!("kept"))])]),
    ]);
    let ids: Vec<String> = violations(&set).into_iter().map(|(id, _)| id).collect();
    assert_eq!(ids, vec!["folders-parentfolder-fk-broken", "items-folder-fk-broken", "totpcodes-item-fk-broken", "itemtags-tag-fk-broken", "fieldvalues-fielddefinition-fk-broken"]);

    repair(&mut set);

    assert_eq!(set["Folders"][0]["ParentFolderId"], Value::Null);
    assert_eq!(set["Items"][0]["FolderId"], Value::Null);
    assert_eq!(set["TotpCodes"].iter().map(|r| r["Id"].as_str().unwrap()).collect::<Vec<_>>(), vec!["t-1"], "the orphan and the tombstoned item's child are gone");
    assert!(set["ItemTags"].is_empty());
    assert_eq!(set["FieldValues"][0]["Value"], json!("kept"), "the value survives, only its definition link is cut");
    assert_eq!(set["FieldValues"][0]["FieldDefinitionId"], Value::Null);
    assert!(violations(&set).is_empty());
}

#[test]
fn a_rule_whose_target_table_is_absent_is_skipped() {
    let mut set = tables(&[("Items", vec![stamped(M, &[("Id", json!("i-1")), ("FolderId", json!("f-1"))])]), ("TotpCodes", vec![stamped(M, &[("Id", json!("t-1")), ("ItemId", json!("i-1"))])])]);
    let before = set.clone();
    repair(&mut set);
    assert_eq!(set, before, "a partial table set is not a vault with empty tables");
    assert!(violations(&set).is_empty());
}
