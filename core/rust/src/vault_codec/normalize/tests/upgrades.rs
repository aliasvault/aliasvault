use std::collections::HashMap;

use serde_json::{json, Value};

use crate::vault_codec::manifest::CodecRecord;
use crate::vault_codec::normalize::upgrade_legacy_rows;
use crate::vault_codec::tests::support::b64;
use crate::vault_model::names::{ID_COL, PASSKEYS_TABLE};
use crate::vault_model::MANIFEST_ID_COL;

const PASSKEY_ID: &str = "ABCDEF00-0000-4000-8000-000000000001";

fn passkey(id: &str, credential_id: Option<Value>) -> CodecRecord {
    let mut row: CodecRecord = [(MANIFEST_ID_COL.to_string(), json!("m-1")), (ID_COL.to_string(), json!(id))].into_iter().collect();
    if let Some(credential_id) = credential_id {
        row.insert("CredentialId".to_string(), credential_id);
    }
    row
}

fn filled(rows: Vec<CodecRecord>) -> Vec<CodecRecord> {
    let mut tables: HashMap<String, Vec<CodecRecord>> = [(PASSKEYS_TABLE.to_string(), rows)].into_iter().collect();
    upgrade_legacy_rows(&mut tables);
    tables.remove(PASSKEYS_TABLE).unwrap()
}

#[test]
fn a_passkey_without_a_credential_id_gets_the_guid_bytes_of_its_id() {
    // Known-answer vector: the bytes every platform handed the relying party (the GUID in text order), so it must never change.
    let expected = json!({ "__b64": "q83vAAAAQACAAAAAAAAAAQ==" });
    for missing in [None, Some(Value::Null), Some(json!({ "__b64": "" }))] {
        let rows = filled(vec![passkey(PASSKEY_ID, missing.clone())]);
        assert_eq!(rows[0]["CredentialId"], expected, "{missing:?}");
    }
}

#[test]
fn a_passkey_keeps_the_credential_id_it_has() {
    let imported = json!({ "__b64": b64(&[10, 11, 12, 13]) });
    assert_eq!(filled(vec![passkey(PASSKEY_ID, Some(imported.clone()))])[0]["CredentialId"], imported);
}

#[test]
fn a_passkey_whose_id_is_not_a_guid_is_left_alone() {
    assert!(!filled(vec![passkey("not-a-guid", None)])[0].contains_key("CredentialId"));
}
