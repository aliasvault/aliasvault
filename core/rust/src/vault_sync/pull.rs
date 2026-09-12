//! Pull: fetch the server snapshot, open every manifest and bucket this session holds a key for, download the
//! referenced blobs and materialize the whole into a fresh SQLite database.

use std::collections::HashMap;

use crate::vault_model::ids_equal;
use super::errors::{SyncError, SyncResult};
use super::state::{self, Ctx};
use super::types::{self, BlobDto, BlobHashesRequest, Db, EmailRoutingDto, GetResponse, ManifestDto, SharedManifestRecord, StoredBlobRef};
use super::{db, http, keys, legacy};
use crate::crypto;
use crate::vault_codec::{self, DataBucket, Manifest, MaterializeInput};

const BLOBS_DOWNLOAD_ENDPOINT: &str = "Vault/blobs/download";

/// One manifest of a pull, opened.
pub(crate) struct ResolvedManifest {
    pub manifest_id: String,
    pub is_personal: bool,
    pub manifest: Manifest,
    pub vek: String,
    pub revision: i64,
    pub blob_references: Vec<StoredBlobRef>,
    pub content_fingerprint: String,
}

/// Every manifest of one snapshot, decrypted, with the sync state learned from it.
pub(crate) struct OpenedManifestSet {
    pub resolved: Vec<ResolvedManifest>,
    pub data_buckets: Vec<DataBucket>,
    pub blob_map: HashMap<String, Vec<u8>>,
    pub contentless_manifest_ids: Vec<String>,
    pub personal_revision: i64,
    pub manifest_revisions: HashMap<String, i64>,
    pub bucket_revisions: HashMap<String, i64>,
}

impl OpenedManifestSet {
    pub fn manifests(&self) -> Vec<Manifest> {
        self.resolved.iter().map(|m| m.manifest.clone()).collect()
    }

    /// The opened set as a vault ready to become the local one.
    pub fn pulled_vault(&self, encrypted_vault: String, email_routing: EmailRoutingDto) -> PulledVault {
        PulledVault { encrypted_vault, revision: self.personal_revision, email_routing, manifest_revisions: self.manifest_revisions.clone(), bucket_revisions: self.bucket_revisions.clone() }
    }
}

/// A pulled vault, encrypted for local storage, with the revisions that become the local truth once it is stored.
pub(crate) struct PulledVault {
    pub encrypted_vault: String,
    pub revision: i64,
    pub email_routing: EmailRoutingDto,
    pub manifest_revisions: HashMap<String, i64>,
    pub bucket_revisions: HashMap<String, i64>,
}

/// `GET v2/Vault`.
pub(crate) async fn fetch_snapshot(ctx: &Ctx) -> SyncResult<GetResponse> {
    http::with_outdated_server_guard(http::get::<GetResponse>(&ctx.host, http::VAULT_ENDPOINT, true).await)
}

pub(crate) fn email_routing_of(snapshot: &GetResponse) -> EmailRoutingDto {
    snapshot.email_routing.clone().unwrap_or_default()
}

fn base64_chars(size_bytes: i64) -> usize {
    ((size_bytes.max(0) as usize).div_ceil(3)) * 4
}

/// Verify a ciphertext against the server's hash, decrypt it and open it via the codec.
fn verify_decrypt_unpack(base64_ciphertext: &str, vek: &str, expected_ciphertext_hash: Option<&str>, label: &str) -> SyncResult<String> {
    if let Some(expected) = expected_ciphertext_hash.filter(|hash| !hash.is_empty()) {
        if vault_codec::compute_ciphertext_hash(base64_ciphertext) != expected {
            return Err(SyncError::ServerVaultUnreadable(format!("{} ciphertext hash mismatch, refusing to load (possible storage corruption)", label)));
        }
    }
    let unreadable = |e: crate::error::VaultError| SyncError::ServerVaultUnreadable(format!("{}: {}", label, e));
    let encrypted = crate::encoding::base64_decode(base64_ciphertext).map_err(unreadable)?;
    let plain = crypto::symmetric_decrypt_bytes(&encrypted, vek).map_err(unreadable)?;
    vault_codec::unpack_payload(&plain).map_err(unreadable)
}

/// The grant a shared manifest is remembered by, when the snapshot carries one.
fn grant_of(dto: &ManifestDto) -> Option<(String, String, String)> {
    match (&dto.encrypted_vek, &dto.encryption_public_key) {
        (Some(vek), Some(public)) if !vek.is_empty() && !public.is_empty() => Some((vek.clone(), public.clone(), dto.algorithm.clone().unwrap_or_else(|| types::ALGORITHM_RSA_OAEP_SHA256.to_string()))),
        _ => None,
    }
}

fn select_personal_manifest(snapshot: &GetResponse) -> Option<&ManifestDto> {
    let personal_id = snapshot.personal_manifest_id.as_deref()?;
    snapshot.manifests.iter().find(|m| m.manifest_id == personal_id)
}

/// Pull the latest vault: fetch, open, materialize and re-encrypt for local storage.
pub(crate) async fn pull(ctx: &mut Ctx) -> SyncResult<PulledVault> {
    let vek = ctx.encryption_key()?;
    ctx.log("[V2Pull] Step 1/4: fetching vault snapshot (GET /v2/Vault)...").await;
    let snapshot = fetch_snapshot(ctx).await?;
    if legacy::is_legacy_sqlite_blob_snapshot(&snapshot) {
        return legacy::open_legacy_snapshot(ctx, &snapshot).await;
    }

    ctx.log("[V2Pull] Step 2/4: manifest format: decrypting and reassembling local SQLite...").await;
    let opened = open_manifests_and_record_sync_state(ctx, &snapshot, &vek).await?;
    let sqlite_bytes = materialize_to_sqlite(ctx, &opened.manifests(), &opened.data_buckets, &opened.blob_map).await?;
    ctx.log(format!("[V2Pull] Step 3/4: materialized SQLite ({} bytes); re-encrypting for local storage...", sqlite_bytes.len())).await;
    Ok(opened.pulled_vault(state::encrypt_vault_blob(&sqlite_bytes, &vek)?, email_routing_of(&snapshot)))
}

/// Open every manifest a snapshot carries, personal first, and record the snapshot as this device's sync state.
/// The revision maps travel on the result for the caller to commit once the pulled vault is stored.
pub(crate) async fn open_manifests_and_record_sync_state(ctx: &mut Ctx, snapshot: &GetResponse, vek: &str) -> SyncResult<OpenedManifestSet> {
    let personal_dto = select_personal_manifest(snapshot).ok_or_else(|| SyncError::Snapshot("server returned no personal manifest, refusing to assemble".to_string()))?;
    if personal_dto.blob.as_deref().unwrap_or("").is_empty() {
        return Err(SyncError::Snapshot("server returned no manifest blob, nothing to assemble".to_string()));
    }

    let mut pulled_fingerprints: HashMap<String, String> = HashMap::new();
    let mut resolved: Vec<ResolvedManifest> = Vec::new();
    let mut shared_records: HashMap<String, SharedManifestRecord> = HashMap::new();
    let mut contentless_revisions: HashMap<String, i64> = HashMap::new();

    let ordered: Vec<&ManifestDto> = std::iter::once(personal_dto).chain(snapshot.manifests.iter().filter(|m| m.manifest_id != personal_dto.manifest_id)).collect();
    for dto in ordered {
        let is_personal = dto.manifest_id == personal_dto.manifest_id;
        let manifest_key = resolve_manifest_vek(ctx, dto, &personal_dto.manifest_id, vek, is_personal, resolved.first().map(|m| &m.manifest)).await?;
        if dto.blob.as_deref().unwrap_or("").is_empty() {
            // A shared manifest served without content yet (created but never written); its grant and revision are still tracked.
            let (encrypted_vek, encryption_public_key, algorithm) = grant_of(dto).ok_or_else(|| SyncError::Snapshot(format!("shared manifest {} was served without content and without a grant, refusing to assemble", dto.manifest_id)))?;
            shared_records.insert(dto.manifest_id.clone(), SharedManifestRecord { manifest_id: dto.manifest_id.clone(), encrypted_vek, encryption_public_key, algorithm, salt: vault_codec::generate_manifest_salt(), name: None, can_administer: dto.can_administer });
            contentless_revisions.insert(dto.manifest_id.clone(), dto.revision);
            continue;
        }

        ctx.log(format!("[V2Pull] Verifying ciphertext hash; decrypting + opening {}...", if is_personal { "personal manifest".to_string() } else { format!("shared manifest {}", dto.manifest_id) })).await;
        let entry = open_manifest(dto, &manifest_key, is_personal)?;
        let table_summary: Vec<String> = entry.manifest.tables.iter().map(|(t, rows)| format!("{}={}", t, rows.len())).collect();
        ctx.log(format!("[V2Pull] Manifest {} opened (content hash verified): tables: {}", entry.manifest_id, table_summary.join(", "))).await;

        if is_personal {
            state::set(&ctx.host, state::VAULT_MANIFEST_SALT, &entry.manifest.manifest_salt).await?;
            state::set(&ctx.host, state::VAULT_PERSONAL_MANIFEST_ID, &entry.manifest_id).await?;
            resolved.push(entry);
            continue;
        }

        let (encrypted_vek, encryption_public_key, algorithm) = grant_of(dto).ok_or_else(|| SyncError::Snapshot(format!("shared manifest {} carries no grant this account can re-open, refusing to assemble", entry.manifest_id)))?;
        shared_records.insert(entry.manifest_id.clone(), SharedManifestRecord { manifest_id: entry.manifest_id.clone(), encrypted_vek, encryption_public_key, algorithm, salt: entry.manifest.manifest_salt.clone(), name: entry.manifest.name.clone(), can_administer: dto.can_administer });
        resolved.push(entry);
    }
    keys::set_shared_manifest_records(&ctx.host, &shared_records, vek).await?;

    let personal_revision = resolved[0].revision;

    let (data_buckets, bucket_fingerprints, bucket_revisions) = open_data_buckets(ctx, snapshot, &resolved).await?;
    pulled_fingerprints.extend(bucket_fingerprints);

    let mut manifest_revisions: HashMap<String, i64> = resolved.iter().map(|m| (m.manifest_id.clone(), m.revision)).collect();
    manifest_revisions.extend(contentless_revisions.iter().map(|(id, rev)| (id.clone(), *rev)));

    let blob_map = download_referenced_blobs(ctx, &resolved, vek).await?;

    for entry in &resolved {
        pulled_fingerprints.insert(state::fingerprint_manifest_key(&entry.manifest_id), entry.content_fingerprint.clone());
    }
    state::set(&ctx.host, state::VAULT_CONTENT_FINGERPRINTS, &pulled_fingerprints).await?;
    ctx.log(format!("[V2Pull] Stored {} content fingerprint baseline(s) for push-side change detection.", pulled_fingerprints.len())).await;

    Ok(OpenedManifestSet {
        resolved,
        data_buckets,
        blob_map,
        contentless_manifest_ids: contentless_revisions.keys().cloned().collect(),
        personal_revision,
        manifest_revisions,
        bucket_revisions,
    })
}

/// Commit a snapshot's revision maps as the local believed-current revisions, manifests and buckets together.
pub(crate) async fn commit_revisions(ctx: &Ctx, manifest_revisions: &HashMap<String, i64>, bucket_revisions: &HashMap<String, i64>) -> SyncResult<()> {
    state::set(&ctx.host, state::SERVER_MANIFEST_REVISIONS, manifest_revisions).await?;
    state::set(&ctx.host, state::VAULT_BUCKET_REVISIONS, bucket_revisions).await?;
    ctx.log(format!("[V2Pull] Stored local manifest revisions from snapshot: {:?}; bucket revisions: {:?}.", manifest_revisions, bucket_revisions)).await;
    Ok(())
}

/// Open every data bucket a snapshot carries, record the snapshot's bucket revisions.
async fn open_data_buckets(ctx: &Ctx, snapshot: &GetResponse, resolved: &[ResolvedManifest]) -> SyncResult<(Vec<DataBucket>, HashMap<String, String>, HashMap<String, i64>)> {
    let key_by_manifest: HashMap<&str, &str> = resolved.iter().map(|m| (m.manifest_id.as_str(), m.vek.as_str())).collect();
    let mut buckets = Vec::new();
    let mut fingerprints = HashMap::new();
    let mut revisions = HashMap::new();
    for dto in &snapshot.buckets {
        let Some(blob) = dto.blob.as_deref().filter(|b| !b.is_empty()) else { continue };
        let key = key_by_manifest.get(dto.manifest_id.as_str()).ok_or_else(|| SyncError::Snapshot(format!("data bucket \"{}\" belongs to manifest {}, which this vault did not open, refusing to assemble", dto.category, dto.manifest_id)))?;
        let label = format!("\"{}\" bucket of manifest {}", dto.category, dto.manifest_id);
        let bucket_json = verify_decrypt_unpack(blob, key, dto.ciphertext_hash.as_deref(), &label)?;
        let bucket: DataBucket = serde_json::from_str(&bucket_json)?;
        if !ids_equal(&bucket.manifest_id, &dto.manifest_id) || bucket.category != dto.category {
            return Err(SyncError::Snapshot(format!("{} declares a different address (manifest {}, category \"{}\") inside its encrypted payload, refusing to assemble", label, bucket.manifest_id, bucket.category)));
        }
        let rows: usize = bucket.tables.values().map(Vec::len).sum();
        ctx.log(format!("[V2Pull] Data bucket {} opened: {} rows (revision {:?}).", label, rows, dto.revision)).await;
        fingerprints.insert(state::fingerprint_bucket_key(&dto.manifest_id, &dto.category), vault_codec::compute_content_fingerprint(&bucket_json));
        if let Some(revision) = dto.revision {
            revisions.insert(state::bucket_revision_key(&dto.manifest_id, &dto.category), revision);
        }
        buckets.push(bucket);
    }
    Ok((buckets, fingerprints, revisions))
}

/// Fetch every referenced blob not cached locally, decrypt it, and prune the cache to the referenced set.
async fn download_referenced_blobs(ctx: &Ctx, resolved: &[ResolvedManifest], fallback_vek: &str) -> SyncResult<HashMap<String, Vec<u8>>> {
    let mut owners: HashMap<String, &ResolvedManifest> = HashMap::new();
    let mut refs: Vec<StoredBlobRef> = Vec::new();
    for entry in resolved {
        for reference in &entry.blob_references {
            if owners.contains_key(&reference.hash) {
                continue;
            }
            owners.insert(reference.hash.clone(), entry);
            refs.push(reference.clone());
        }
    }

    let mut cache: HashMap<String, String> = state::get(&ctx.host, state::VAULT_BLOB_CIPHER_CACHE).await?.unwrap_or_default();
    let missing: Vec<StoredBlobRef> = refs.iter().filter(|r| !cache.contains_key(&r.hash)).cloned().collect();
    ctx.log(format!("[V2Pull] Blob refs: {} referenced, {} cached locally, {} to download.", refs.len(), refs.len() - missing.len(), missing.len())).await;

    let batches = http::batch_by_transfer_cost(missing, |r| base64_chars(r.size_bytes));
    let batch_count = batches.len();
    for (index, chunk) in batches.into_iter().enumerate() {
        let blobs: Vec<BlobDto> = http::post(&ctx.host, BLOBS_DOWNLOAD_ENDPOINT, &BlobHashesRequest { hashes: chunk.iter().map(|r| r.hash.clone()).collect() }, true).await?;
        ctx.log(format!("[V2Pull] Downloaded blob batch {}/{}: requested {}, received {}.", index + 1, batch_count, chunk.len(), blobs.len())).await;
        for dto in blobs {
            cache.insert(dto.hash, dto.encrypted_data_base64);
        }
    }

    let mut pruned_cache: HashMap<String, String> = HashMap::new();
    let mut blob_map = HashMap::new();
    for reference in &refs {
        let Some(ciphertext) = cache.get(&reference.hash) else {
            ctx.warn(format!("[V2Sync] Referenced {} blob {} missing on server, continuing without it.", reference.category, reference.hash)).await;
            continue;
        };
        let key = owners.get(&reference.hash).map(|o| o.vek.as_str()).unwrap_or(fallback_vek);
        match crate::encoding::base64_decode(ciphertext).and_then(|bytes| crypto::symmetric_decrypt_bytes(&bytes, key)) {
            Ok(bytes) => {
                blob_map.insert(reference.hash.clone(), bytes);
                pruned_cache.insert(reference.hash.clone(), ciphertext.clone());
            }
            Err(_) => ctx.warn(format!("[V2Sync] Referenced {} blob {} failed to decrypt with the current key, continuing without it.", reference.category, reference.hash)).await,
        }
    }
    state::set(&ctx.host, state::VAULT_BLOB_CIPHER_CACHE, &pruned_cache).await?;
    state::set(&ctx.host, state::VAULT_SERVER_BLOB_HASHES, &refs.iter().map(|r| r.hash.clone()).collect::<Vec<_>>()).await?;
    Ok(blob_map)
}

/// Materialize manifests and buckets into a fresh database and return its bytes.
pub(crate) async fn materialize_to_sqlite(ctx: &mut Ctx, manifests: &[Manifest], data_buckets: &[DataBucket], blob_map: &HashMap<String, Vec<u8>>) -> SyncResult<Vec<u8>> {
    ctx.log(format!("[V2Pull] {} blobs decrypted; running codec reassembly into a fresh SQLite ({} manifest(s) combined)...", blob_map.len(), manifests.len())).await;
    let schema = ctx.schema().await?;
    let materialized = vault_codec::materialize_as_sqlite(MaterializeInput { manifests: manifests.to_vec(), data_buckets: data_buckets.to_vec(), schema_columns: schema.columns })?;

    let overflow_tables = materialized.overflow.tables.len() + materialized.overflow.bucket_tables.values().map(HashMap::len).sum::<usize>();
    if overflow_tables > 0 || !materialized.overflow.columns.is_empty() {
        ctx.warn(format!("[V2Pull] Newer-schema data preserved as overflow: {} unknown table(s), unknown columns on [{}].", overflow_tables, materialized.overflow.columns.keys().cloned().collect::<Vec<_>>().join(", "))).await;
    }

    // Use a fresh staging database for every materialize.
    db::open_staging(&ctx.host, None).await?;
    db::insert_materialized(&ctx.host, &materialized, blob_map).await?;
    let bytes = db::export(&ctx.host, Db::Staging).await?;
    ctx.log(format!("[V2Pull] Codec reassembly complete: {} bytes.", bytes.len())).await;
    Ok(bytes)
}

fn open_manifest(dto: &ManifestDto, vek: &str, is_personal: bool) -> SyncResult<ResolvedManifest> {
    let label = if is_personal { "manifest".to_string() } else { format!("shared manifest {}", dto.manifest_id) };
    let manifest_json = verify_decrypt_unpack(dto.blob.as_deref().unwrap_or(""), vek, dto.ciphertext_hash.as_deref(), &label)?;
    let manifest: Manifest = serde_json::from_str(&manifest_json)?;
    if !ids_equal(&manifest.manifest_id, &dto.manifest_id) {
        return Err(SyncError::Snapshot(format!("manifest {} declares a different id ({}) inside its encrypted payload, refusing to open it", dto.manifest_id, manifest.manifest_id)));
    }
    Ok(ResolvedManifest {
        manifest_id: dto.manifest_id.clone(),
        is_personal,
        manifest,
        vek: vek.to_string(),
        revision: dto.revision,
        blob_references: dto.blob_references.clone(),
        content_fingerprint: vault_codec::compute_content_fingerprint(&manifest_json),
    })
}

/// The key that opens one snapshot manifest.
async fn resolve_manifest_vek(ctx: &Ctx, dto: &ManifestDto, personal_manifest_id: &str, personal_vek: &str, is_personal: bool, personal_manifest: Option<&Manifest>) -> SyncResult<String> {
    let key_type = dto.key_type.clone().unwrap_or_else(|| if is_personal { types::KEY_TYPE_ACCOUNT_KEY.to_string() } else { types::KEY_TYPE_GRANT_KEY.to_string() });
    if key_type == types::KEY_TYPE_ACCOUNT_KEY {
        if dto.manifest_id != personal_manifest_id {
            return Err(SyncError::Snapshot(format!("manifest {} is unlocked by the account key hierarchy, but this session holds no key for it, refusing to assemble", dto.manifest_id)));
        }
        return Ok(personal_vek.to_string());
    }
    if key_type != types::KEY_TYPE_GRANT_KEY {
        return Err(SyncError::Snapshot(format!("manifest {} states an unknown key type \"{}\" (newer server?), refusing to assemble", dto.manifest_id, key_type)));
    }
    let personal_manifest = personal_manifest.ok_or_else(|| SyncError::Snapshot(format!("manifest {} is opened through a grant, but no personal manifest is open to resolve the private key from, refusing to assemble", dto.manifest_id)))?;
    resolve_granted_vek(ctx, personal_manifest, dto).await
}

async fn resolve_granted_vek(ctx: &Ctx, personal_manifest: &Manifest, dto: &ManifestDto) -> SyncResult<String> {
    let (encrypted_vek, public_key, algorithm) = grant_of(dto).ok_or_else(|| SyncError::Snapshot(format!("shared manifest {} carries no grant to open it with, refusing to assemble", dto.manifest_id)))?;
    if algorithm != types::ALGORITHM_RSA_OAEP_SHA256 {
        return Err(SyncError::Snapshot(format!("shared manifest {} grants its VEK under an unsupported algorithm \"{}\" (newer server?), refusing to assemble", dto.manifest_id, algorithm)));
    }
    let private_key = resolve_private_key_jwk(ctx, personal_manifest, &public_key).await?.ok_or_else(|| SyncError::Snapshot(format!("no private key in this vault opens the grant on shared manifest {}, refusing to assemble", dto.manifest_id)))?;
    keys::decrypt_manifest_vek(&encrypted_vek, &private_key).map_err(|e| SyncError::ServerVaultUnreadable(format!("failed to decrypt the VEK of shared manifest {}, refusing to assemble: {}", dto.manifest_id, e)))
}

/// The private key (JWK) matching a grant's public key: the session's, else one the personal manifest keeps.
async fn resolve_private_key_jwk(ctx: &Ctx, personal_manifest: &Manifest, encryption_public_key: &str) -> SyncResult<Option<String>> {
    if ctx.account_public_key.as_deref() == Some(encryption_public_key) {
        if let Some(private) = &ctx.account_private_key {
            return Ok(Some(private.clone()));
        }
    }
    Ok(vault_codec::extract_encryption_key_for_public_key(personal_manifest, encryption_public_key).and_then(|row| row.get("PrivateKey").and_then(serde_json::Value::as_str).map(str::to_string)))
}
