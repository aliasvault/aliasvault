//! A shared manifest granted in a format this build does not know ends the session with "update the app", like a
//! newer vault format. A grant-format change ships with a minimum client version bump, so this only catches a missed bump.

use serde_json::{json, Value};

use super::test_host::TestHost;
use super::{server_with_item, SHARED_MANIFEST_ID};
use crate::crypto;

/// Sync a fresh device against a personal vault plus the given shared manifest dto.
fn sync_with_shared_manifest(shared: Value) -> (TestHost, Value) {
    let vek = crypto::generate_key_base64();
    let server = server_with_item(&vek);
    server.borrow_mut().add_manifest_dto(shared);
    let mut host = TestHost::logged_in(&vek, &server);
    let result = host.sync();
    (host, result)
}

fn grant(algorithm: &str, key_type: &str, blob: &str) -> Value {
    json!({ "manifestId": SHARED_MANIFEST_ID, "blob": blob, "revision": 3, "blobReferences": [], "canAdminister": false, "keyType": key_type, "algorithm": algorithm, "encryptedVek": "future-grant", "accountPublicKey": "future-key" })
}

#[test]
fn an_unknown_grant_algorithm_or_key_type_asks_for_an_app_update() {
    for (what, shared) in [
        ("unknown algorithm", grant("future-x", "grant-key", "bm90LXJlYWRhYmxl")),
        ("unknown key type", grant("rsa-oaep-sha256", "future-key-type", "bm90LXJlYWRhYmxl")),
        ("unknown algorithm on a contentless manifest", grant("future-x", "grant-key", "")),
    ] {
        let (host, result) = sync_with_shared_manifest(shared);
        assert_eq!(result["success"], false, "{}: {}", what, result);
        assert_eq!(result["logoutReason"], "vaultVersionIncompatible", "{}: an app too old for the grant format is told to update: {}", what, result);
        assert!(host.item_names().is_empty(), "{}: nothing is materialized, not even the personal vault", what);
        assert!(host.store_calls.is_empty());
    }
}

#[test]
fn a_shared_manifest_without_key_type_or_algorithm_is_refused_never_guessed() {
    for missing in ["keyType", "algorithm"] {
        let mut shared = grant("rsa-oaep-sha256", "grant-key", "bm90LXJlYWRhYmxl");
        shared.as_object_mut().unwrap().remove(missing);
        let (host, result) = sync_with_shared_manifest(shared);
        assert_eq!(result["success"], false, "missing {}: {}", missing, result);
        assert!(host.item_names().is_empty(), "missing {}: nothing is materialized", missing);
    }
}
