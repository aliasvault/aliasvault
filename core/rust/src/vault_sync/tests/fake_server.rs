//! An in-process model of the v2 vault API, so a test describes server state instead of scripting HTTP bodies.
//!
//! The rules are the controller's: `POST Vault` is all-or-nothing on revisions (a write names the revision it
//! builds on, the server accepts it only when that is the current one and advances by one), blobs are stored per
//! manifest and a write referencing a blob the server lacks is answered with `missingBlobHashes`, the account
//! key hierarchy is created at most once, and a blob hash request carries at most 1000 hashes.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;

use rusqlite::Connection;
use serde_json::{json, Value};

use super::test_host::{read_tables, TestHost};
use super::PERSONAL_MANIFEST_ID;
use crate::crypto;
use crate::vault_codec::{self, CanonicalizeInput, ManifestSpec};
use crate::vault_sync::blob_keys;

/// The server's `VaultWriteLimits.MaxHashesPerRequest`.
const MAX_HASHES_PER_REQUEST: usize = 1000;

/// A shared handle to the server, so the host's responder and the test both reach it.
pub type Server = Rc<RefCell<FakeServer>>;

/// One manifest as the server stores it.
#[derive(Debug, Clone, Default)]
pub struct ServerManifest {
    pub blob: Option<String>,
    pub ciphertext_hash: Option<String>,
    pub revision: i64,
    pub blob_references: Vec<Value>,
    /// Fields of the manifest dto beyond content and revision: key type, grant, administration flag.
    pub access: Value,
}

/// One data bucket as the server stores it.
#[derive(Debug, Clone)]
pub struct ServerBucket {
    pub blob: String,
    pub ciphertext_hash: String,
    pub revision: i64,
}

/// LEGACY: the account's vault while it is still a sqlite blob.
#[derive(Debug, Clone)]
pub struct LegacyVault {
    pub blob: String,
    pub revision: i64,
}

/// Ways the server misbehaves on purpose.
#[derive(Debug, Default)]
pub struct Faults {
    /// Every request fails at the transport level.
    pub unreachable: bool,
    /// `GET Status` answers with this HTTP status and an empty body.
    pub status_http: Option<u16>,
    /// Blob downloads return nothing, as if the blobs were never stored.
    pub withhold_blobs: bool,
    /// The next `n` vault writes are refused as outdated without being applied.
    pub refuse_writes: u32,
    /// Vault writes are not answered at all (the host sees a transport failure).
    pub drop_writes: bool,
}

pub struct FakeServer {
    pub version: String,
    pub srp_salt: String,
    pub personal_manifest_id: String,
    pub manifests: BTreeMap<String, ServerManifest>,
    pub buckets: BTreeMap<(String, String), ServerBucket>,
    /// Blob store: manifest id -> hash -> the blob dto as the download endpoint serves it.
    pub blobs: HashMap<String, HashMap<String, Value>>,
    /// The `vaultKey` of `GET VaultKey/Password`; `Null` for an account without a key hierarchy.
    pub vault_key: Value,
    pub legacy: Option<LegacyVault>,
    pub pending_actions: Vec<Value>,
    pub capabilities: Value,
    pub faults: Faults,
}

impl FakeServer {
    pub fn new() -> Server {
        Rc::new(RefCell::new(Self {
            version: "0.31.0".to_string(),
            srp_salt: "salt".to_string(),
            personal_manifest_id: PERSONAL_MANIFEST_ID.to_string(),
            manifests: BTreeMap::new(),
            buckets: BTreeMap::new(),
            blobs: HashMap::new(),
            vault_key: Value::Null,
            legacy: None,
            pending_actions: Vec::new(),
            capabilities: json!({ "sharing": "on" }),
            faults: Faults::default(),
        }))
    }

    /*
     * Seeding.
     */

    /// Store `db` as the personal manifest at `revision`, encrypted under `vek`, every bucket at the same revision.
    pub fn publish(&mut self, db: &Connection, vek: &str, salt: &str, revision: i64) {
        self.publish_with_blob_key(db, vek, salt, revision, vek);
    }

    /// [`publish`](Self::publish) with the blobs encrypted under another key, to serve blobs this device cannot open.
    pub fn publish_with_blob_key(&mut self, db: &Connection, vek: &str, salt: &str, revision: i64, blob_key: &str) {
        let personal = self.personal_manifest_id.clone();
        let canonicalized = vault_codec::canonicalize_from_sqlite(CanonicalizeInput {
            tables: read_tables(db),
            canonicalized_at: "2026-09-11T00:00:00.000Z".to_string(),
            manifests: vec![ManifestSpec { manifest_id: personal.clone(), manifest_salt: salt.to_string(), name: None }],
            stamp_unstamped_into: None,
        })
        .unwrap();
        let entry = &canonicalized.manifests[0];
        let (blob, hash) = encrypt_payload(&serde_json::to_string(&entry.manifest).unwrap(), vek, &crypto::aad::manifest(&personal));
        let store = self.blobs.entry(personal.clone()).or_default();
        let mut references = Vec::new();
        for (blob_hash, blob_entry) in &entry.blobs {
            let bytes = crate::common::encoding::base64_decode(&blob_entry.bytes_base64).unwrap();
            let encrypted = blob_keys::encrypt_blob(&bytes, blob_key, &personal, blob_hash).unwrap();
            store.insert(blob_hash.clone(), json!({ "hash": blob_hash, "category": blob_entry.kind, "encryptedDataBase64": crate::common::encoding::base64_encode(&encrypted.encrypted_data), "encryptedBlobKey": encrypted.encrypted_blob_key }));
            references.push(json!({ "hash": blob_hash, "category": blob_entry.kind, "sizeBytes": bytes.len() }));
        }
        let access = self.manifests.get(&personal).map(|m| m.access.clone()).unwrap_or_else(|| json!({ "canAdminister": true, "keyType": "account-key" }));
        self.manifests.insert(personal.clone(), ServerManifest { blob: Some(blob), ciphertext_hash: Some(hash), revision, blob_references: references, access });
        for bucket in &canonicalized.data_buckets {
            let (blob, hash) = encrypt_payload(&serde_json::to_string(bucket).unwrap(), vek, &crypto::aad::bucket(&bucket.manifest_id, &bucket.category));
            self.buckets.insert((bucket.manifest_id.clone(), bucket.category.clone()), ServerBucket { blob, ciphertext_hash: hash, revision });
        }
    }

    /// A personal manifest the server created without content (registration), at `revision`.
    pub fn publish_contentless_personal(&mut self, revision: i64) {
        let personal = self.personal_manifest_id.clone();
        self.manifests.insert(personal, ServerManifest { revision, access: json!({ "canAdminister": false, "keyType": "account-key" }), ..Default::default() });
    }

    /// LEGACY: hold the account as a sqlite blob under `unlock_key`.
    pub fn publish_legacy(&mut self, db: &Connection, unlock_key: &str, revision: i64) {
        let bytes = db.serialize(rusqlite::MAIN_DB).unwrap().to_vec();
        self.legacy = Some(LegacyVault { blob: crypto::symmetric_encrypt_bytes(&bytes, unlock_key).unwrap(), revision });
    }

    /// Serve a shared manifest exactly as given (a manifest dto), for the grant tests.
    pub fn add_manifest_dto(&mut self, dto: Value) {
        let id = dto["manifestId"].as_str().unwrap().to_string();
        let mut access = dto.clone();
        for key in ["manifestId", "blob", "ciphertextHash", "revision", "blobReferences"] {
            access.as_object_mut().unwrap().remove(key);
        }
        let blob = dto["blob"].as_str().filter(|b| !b.is_empty()).map(str::to_string);
        self.manifests.insert(id, ServerManifest { blob, ciphertext_hash: dto["ciphertextHash"].as_str().map(str::to_string), revision: dto["revision"].as_i64().unwrap_or(0), blob_references: Vec::new(), access });
    }

    /// Hold the account's key hierarchy, as `GET VaultKey/Password` serves it.
    pub fn set_vault_key(&mut self, hierarchy: &crypto::AccountKeyHierarchy) {
        let blobs = &hierarchy.account_keys;
        let account_keys = json!({ "encryptedAccountKey": blobs.encrypted_account_key, "encryptedVek": blobs.encrypted_vek, "accountPublicKey": blobs.account_public_key, "encryptedAccountPrivateKey": blobs.encrypted_account_private_key, "signingPublicKey": blobs.signing_public_key, "encryptedSigningPrivateKey": blobs.encrypted_signing_private_key });
        self.vault_key = vault_key_dto(account_keys.as_object().unwrap());
    }

    /*
     * Reading back.
     */

    pub fn personal(&self) -> &ServerManifest {
        &self.manifests[&self.personal_manifest_id]
    }

    /// The personal manifest decrypted with `vek`.
    pub fn open_personal(&self, vek: &str) -> Value {
        decrypt_manifest(self.personal().blob.as_deref().expect("the personal manifest has content"), vek, &self.personal_manifest_id)
    }

    /// The personal manifest's `category` bucket decrypted with `vek`.
    pub fn open_bucket(&self, category: &str, vek: &str) -> Value {
        let bucket = &self.buckets[&(self.personal_manifest_id.clone(), category.to_string())];
        decrypt_payload(&bucket.blob, vek, &crypto::aad::bucket(&self.personal_manifest_id, category))
    }

    /// The hashes the personal manifest's blob store holds, sorted.
    pub fn stored_blob_hashes(&self) -> Vec<String> {
        let mut hashes: Vec<String> = self.blobs.get(&self.personal_manifest_id).map(|store| store.keys().cloned().collect()).unwrap_or_default();
        hashes.sort();
        hashes
    }

    /// Assert that the host's local vault canonicalizes to exactly what the server holds for the personal
    /// manifest and its buckets: the convergence check every multi-device scenario ends with.
    pub fn assert_converged(&self, host: &TestHost) {
        let server_manifest = self.open_personal(&host.vault_key);
        let salt = server_manifest["manifestSalt"].as_str().unwrap();
        let local = vault_codec::canonicalize_from_sqlite(CanonicalizeInput {
            tables: read_tables(&host.local),
            canonicalized_at: String::new(),
            manifests: vec![ManifestSpec { manifest_id: self.personal_manifest_id.clone(), manifest_salt: salt.to_string(), name: None }],
            stamp_unstamped_into: None,
        })
        .unwrap();
        let fingerprint = |value: &Value| vault_codec::compute_content_fingerprint(&value.to_string());
        assert_eq!(fingerprint(&serde_json::to_value(&local.manifests[0].manifest).unwrap()), fingerprint(&server_manifest), "the local vault and the server's personal manifest differ:\nlocal {}\nserver {}", serde_json::to_value(&local.manifests[0].manifest).unwrap(), server_manifest);
        for bucket in &local.data_buckets {
            assert_eq!(fingerprint(&serde_json::to_value(bucket).unwrap()), fingerprint(&self.open_bucket(&bucket.category, &host.vault_key)), "bucket {} differs", bucket.category);
        }
    }

    /*
     * The API.
     */

    /// Answer one request, `None` for a transport failure.
    pub fn respond(&mut self, method: &str, path: &str, body: Option<&Value>) -> Option<(u16, Value)> {
        if self.faults.unreachable {
            return None;
        }
        match (method, path) {
            ("GET", "Status") => Some(match self.faults.status_http {
                Some(status) => (status, json!({})),
                None => (200, self.status()),
            }),
            ("GET", "Vault") => Some((200, self.vault())),
            ("POST", "Vault") => self.write_vault(body?),
            ("POST", "Vault/blobs") => Some((200, self.upload_blobs(body?))),
            ("POST", "Vault/blobs/missing" | "Vault/blobs/download") if body?["hashes"].as_array().is_some_and(|h| h.len() > MAX_HASHES_PER_REQUEST) => Some((400, json!({ "code": "INVALID_REQUEST", "statusCode": 400 }))),
            ("POST", "Vault/blobs/missing") => Some((200, self.missing_blobs(body?))),
            ("POST", "Vault/blobs/download") => Some((200, self.download_blobs(body?))),
            ("GET", "VaultKey/Password") => Some((200, json!({ "vaultKey": self.vault_key }))),
            ("DELETE", path) if path.starts_with("ClientActions/") => {
                let id = &path["ClientActions/".len()..];
                self.pending_actions.retain(|action| action["id"] != id);
                Some((200, json!({})))
            }
            _ => None,
        }
    }

    /// The `GET Status` body.
    pub fn status(&self) -> Value {
        let (mut manifest_revisions, bucket_revisions) = self.current_revisions();
        for (entry, m) in manifest_revisions.iter_mut().zip(self.manifests.values()) {
            if let Some(name) = m.access.get("encryptedName").filter(|n| !n.is_null()) {
                entry["encryptedName"] = name.clone();
            }
        }
        let legacy_revisions = self.legacy.as_ref().map(|l| vec![json!({ "manifestId": self.personal_manifest_id, "revision": l.revision })]);
        json!({
            "clientVersionSupported": true,
            "serverVersion": self.version,
            "manifestRevisions": legacy_revisions.unwrap_or(manifest_revisions),
            "bucketRevisions": bucket_revisions,
            "personalManifestId": self.personal_manifest_id,
            "srpSalt": self.srp_salt,
            "capabilities": self.capabilities,
            "pendingActions": self.pending_actions,
        })
    }

    /// The `GET Vault` body.
    pub fn vault(&self) -> Value {
        let email_routing = json!({ "privateEmailDomainList": ["private.io"], "publicEmailDomainList": [], "hiddenPrivateEmailDomainList": [], "emailAddressList": [] });
        if let Some(legacy) = &self.legacy {
            return json!({ "storageFormat": "sqlite-blob", "legacyVaultBlob": legacy.blob, "legacyRevision": legacy.revision, "personalManifestId": self.personal_manifest_id, "emailRouting": email_routing });
        }
        let manifests: Vec<Value> = self.manifests.iter().map(|(id, m)| {
            let mut dto = json!({ "manifestId": id, "blob": m.blob, "ciphertextHash": m.ciphertext_hash, "revision": m.revision, "blobReferences": m.blob_references });
            for (key, value) in m.access.as_object().unwrap() {
                dto[key] = value.clone();
            }
            dto
        }).collect();
        let buckets: Vec<Value> = self.buckets.iter().map(|((manifest_id, category), b)| json!({ "manifestId": manifest_id, "category": category, "blob": b.blob, "ciphertextHash": b.ciphertext_hash, "revision": b.revision })).collect();
        json!({ "storageFormat": "manifest", "personalManifestId": self.personal_manifest_id, "manifests": manifests, "buckets": buckets, "emailRouting": email_routing })
    }

    /// The manifest and bucket revisions the server currently holds.
    fn current_revisions(&self) -> (Vec<Value>, Vec<Value>) {
        let manifests = self.manifests.iter().map(|(id, m)| json!({ "manifestId": id, "revision": m.revision })).collect();
        let buckets = self.buckets.iter().map(|((manifest_id, category), b)| json!({ "manifestId": manifest_id, "category": category, "revision": b.revision })).collect();
        (manifests, buckets)
    }

    fn write_vault(&mut self, body: &Value) -> Option<(u16, Value)> {
        if self.faults.drop_writes {
            return None;
        }
        let manifests = body["manifests"].as_array().cloned().unwrap_or_default();
        let buckets = body["buckets"].as_array().cloned().unwrap_or_default();

        // Like the controller: a write naming a manifest the caller cannot reach is refused as a whole.
        if manifests.iter().chain(&buckets).any(|w| !self.manifests.contains_key(w["manifestId"].as_str().unwrap())) {
            return Some((404, json!({ "code": "SHARED_MANIFEST_NOT_FOUND", "statusCode": 404 })));
        }

        let stale_manifest = manifests.iter().any(|w| self.manifests.get(w["manifestId"].as_str().unwrap()).map(|m| m.revision) != w["currentRevision"].as_i64());
        let stale_bucket = buckets.iter().any(|w| self.buckets.get(&(w["manifestId"].as_str().unwrap().to_string(), w["category"].as_str().unwrap().to_string())).map(|b| b.revision).unwrap_or(0) != w["currentRevision"].as_i64().unwrap_or(-1));
        if stale_manifest || stale_bucket || self.faults.refuse_writes > 0 {
            self.faults.refuse_writes = self.faults.refuse_writes.saturating_sub(1);
            let (manifest_revisions, bucket_revisions) = self.current_revisions();
            return Some((200, json!({ "status": "outdated", "manifestRevisions": manifest_revisions, "bucketRevisions": bucket_revisions, "missingBlobHashes": [] })));
        }

        let missing: Vec<Value> = manifests
            .iter()
            .flat_map(|w| {
                let store = self.blobs.get(w["manifestId"].as_str().unwrap());
                w["blobReferences"].as_array().cloned().unwrap_or_default().into_iter().filter(move |r| !store.is_some_and(|s| s.contains_key(r["hash"].as_str().unwrap()))).map(|r| r["hash"].clone())
            })
            .collect();
        if !missing.is_empty() {
            return Some((200, json!({ "status": "ok", "manifestRevisions": [], "bucketRevisions": [], "missingBlobHashes": missing })));
        }

        if let Some(account_keys) = body["migration"]["accountKeys"].as_object() {
            if !self.vault_key.is_null() {
                return Some((400, json!({ "code": "VAULT_KEY_ALREADY_EXISTS", "statusCode": 400 })));
            }
            self.vault_key = vault_key_dto(account_keys);
            // The upgrade write moves the account onto the manifest format.
            self.legacy = None;
        }

        let mut manifest_revisions = Vec::new();
        for write in &manifests {
            let id = write["manifestId"].as_str().unwrap();
            let references = write["blobReferences"].as_array().cloned().unwrap_or_default().into_iter().map(|r| {
                let size = r.get("sizeBytes").cloned().unwrap_or_else(|| json!(self.stored_blob_size(id, r["hash"].as_str().unwrap())));
                json!({ "hash": r["hash"], "category": r["category"], "sizeBytes": size })
            });
            let references = references.collect();
            let entry = self.manifests.get_mut(id).unwrap();
            entry.blob = Some(write["manifestBlob"].as_str().unwrap().to_string());
            entry.ciphertext_hash = Some(write["manifestCiphertextHash"].as_str().unwrap().to_string());
            entry.blob_references = references;
            entry.revision += 1;
            manifest_revisions.push(json!({ "manifestId": id, "revision": entry.revision }));
        }
        let mut bucket_revisions = Vec::new();
        for write in &buckets {
            let key = (write["manifestId"].as_str().unwrap().to_string(), write["category"].as_str().unwrap().to_string());
            let revision = write["currentRevision"].as_i64().unwrap() + 1;
            self.buckets.insert(key.clone(), ServerBucket { blob: write["blob"].as_str().unwrap().to_string(), ciphertext_hash: write["ciphertextHash"].as_str().unwrap().to_string(), revision });
            bucket_revisions.push(json!({ "manifestId": key.0, "category": key.1, "revision": revision }));
        }
        Some((200, json!({ "status": "ok", "manifestRevisions": manifest_revisions, "bucketRevisions": bucket_revisions, "missingBlobHashes": [] })))
    }

    /// The decoded size of a stored blob's encrypted data, 0 when unknown.
    fn stored_blob_size(&self, manifest_id: &str, hash: &str) -> usize {
        let data = self.blobs.get(manifest_id).and_then(|store| store.get(hash)).and_then(|blob| blob["encryptedDataBase64"].as_str());
        data.and_then(|data| crate::common::encoding::base64_decode(data).ok()).map_or(0, |bytes| bytes.len())
    }

    fn upload_blobs(&mut self, body: &Value) -> Value {
        let store = self.blobs.entry(body["manifestId"].as_str().unwrap().to_string()).or_default();
        let overwrite = body["overwrite"].as_bool().unwrap_or(false);
        let mut accepted = 0;
        for blob in body["blobs"].as_array().cloned().unwrap_or_default() {
            let hash = blob["hash"].as_str().unwrap().to_string();
            if overwrite || !store.contains_key(&hash) {
                store.insert(hash, blob);
                accepted += 1;
            }
        }
        json!({ "acceptedCount": accepted })
    }

    fn missing_blobs(&self, body: &Value) -> Value {
        let store = self.blobs.get(body["manifestId"].as_str().unwrap());
        let missing: Vec<Value> = body["hashes"].as_array().cloned().unwrap_or_default().into_iter().filter(|h| !store.is_some_and(|s| s.contains_key(h.as_str().unwrap()))).collect();
        json!({ "missing": missing })
    }

    fn download_blobs(&self, body: &Value) -> Value {
        if self.faults.withhold_blobs {
            return json!({ "blobs": [] });
        }
        let store = self.blobs.get(body["manifestId"].as_str().unwrap());
        let blobs: Vec<Value> = body["hashes"].as_array().cloned().unwrap_or_default().into_iter().filter_map(|h| store.and_then(|s| s.get(h.as_str().unwrap())).cloned()).collect();
        json!({ "blobs": blobs })
    }
}

/*
 * Payload crypto, as the engine does it.
 */

/// A manifest or bucket payload packed and encrypted under `vek`, with its ciphertext hash.
fn encrypt_payload(json: &str, vek: &str, aad: &[u8]) -> (String, String) {
    let packed = vault_codec::pack_payload(json).unwrap();
    let blob = crypto::symmetric_encrypt_bytes_with_aad(&packed, vek, aad).unwrap();
    let hash = vault_codec::compute_ciphertext_hash(&blob);
    (blob, hash)
}

/// The `vaultKey` dto of `GET VaultKey/Password` around the account key fields.
fn vault_key_dto(account_keys: &serde_json::Map<String, Value>) -> Value {
    let mut dto = json!({ "type": "password", "algorithm": "aes256-gcm", "salt": "salt", "encryptionType": "Argon2Id", "encryptionSettings": "{}" });
    for (key, value) in account_keys {
        dto[key] = value.clone();
    }
    dto
}

/// A manifest blob (as written or as stored) decrypted and unpacked.
pub fn decrypt_manifest(blob: &str, vek: &str, manifest_id: &str) -> Value {
    decrypt_payload(blob, vek, &crypto::aad::manifest(manifest_id))
}

fn decrypt_payload(blob: &str, vek: &str, aad: &[u8]) -> Value {
    let plain = crypto::symmetric_decrypt_bytes_with_aad(&crate::common::encoding::base64_decode(blob).unwrap(), vek, aad).unwrap();
    serde_json::from_str(&vault_codec::unpack_payload(&plain).unwrap()).unwrap()
}
