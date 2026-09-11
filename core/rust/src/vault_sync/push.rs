//! Push: canonicalize the local vault, gate every manifest and bucket by its content fingerprint, encrypt what
//! changed under the key of the manifest that owns it, upload the blobs the server lacks, and `POST v2/Vault`.

use std::collections::{HashMap, HashSet};

use super::db::{id_key, ids_equal};
use super::email_routing::build_email_routing;
use super::errors::{SyncError, SyncResult};
use super::pull::{BLOB_TRANSFER_BATCH_MAX_CHARS, BLOB_TRANSFER_BATCH_MAX_COUNT};
use super::state::{self, Ctx};
use super::types::{BlobDto, BlobHashesRequest, BlobRef, BlobUploadRequest, BucketWrite, Db, ManifestWrite, MissingBlobsResponse, VaultWriteRequest, VaultWriteResponse};
use super::{db, http, keys};
use crate::crypto;
use crate::vault_codec::{self, BlobEntry, CanonicalizeInput, CanonicalizedVault, DataBucket, Manifest, ManifestSpec};
use crate::vault_sharing::{self, ManifestAccessRequest, ManifestWriteSetRequest, SharedManifestRecord as SharingRecord};

const VAULT_ENDPOINT: &str = "Vault";
const BLOBS_ENDPOINT: &str = "Vault/blobs";
const BLOBS_MISSING_ENDPOINT: &str = "Vault/blobs/missing";

/// Days an item stays in the trash before a push prunes it.
const TRASH_RETENTION_DAYS: u32 = 30;
/// The mutation scope that requires a full manifest push.
const MANIFEST_SCOPE: &str = "Main";

/// One manifest this vault can write, resolved from local state before canonicalizing.
#[derive(Debug, Clone)]
pub(crate) struct ManifestRecord {
    pub manifest_id: String,
    pub is_personal: bool,
    pub salt: String,
    /// The key this manifest encrypts with; None for the personal manifest, whose content key the push supplies.
    pub vek: Option<String>,
    pub name: Option<String>,
    pub can_administer: bool,
}

/// The canonicalized vault plus the records it was split against, personal manifest first.
#[derive(Clone)]
pub(crate) struct CanonicalizedSet {
    pub canonicalized: CanonicalizedVault,
    pub manifest_records: Vec<ManifestRecord>,
}

/// Outcome of a push that reached the server. Rejections travel as errors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PushStatus {
    Ok,
    /// The server holds a newer revision; the caller pulls, merges and retries.
    Outdated,
}

/// What a completed upload reports to the flow.
pub(crate) struct UploadOutcome {
    pub status: PushStatus,
    pub mutation_seq_at_start: u64,
    /// Whether the stored vault changed under the upload (pruned or re-keyed).
    pub vault_changed: bool,
}

/*
 * The local write set.
 */

/// Canonicalize the local vault against every manifest this vault writes.
pub(crate) async fn canonicalize_vault(ctx: &Ctx, adopt_unstamped_into: Option<String>) -> SyncResult<CanonicalizedSet> {
    let tables = db::read_tables(&ctx.host, Db::Local).await?;
    let manifest_records = resolve_manifest_records(ctx).await?;
    let manifests: Vec<ManifestSpec> = manifest_records.iter().map(|r| ManifestSpec { manifest_id: r.manifest_id.clone(), manifest_salt: r.salt.clone(), name: r.name.clone() }).collect();
    let canonicalized = vault_codec::canonicalize_from_sqlite(CanonicalizeInput { tables, canonicalized_at: db::now_iso(), manifests, adopt_unstamped_into })?;
    Ok(CanonicalizedSet { canonicalized, manifest_records })
}

/// Every manifest this vault can write, personal manifest first. The core decides which.
async fn resolve_manifest_records(ctx: &Ctx) -> SyncResult<Vec<ManifestRecord>> {
    let manifest_salt = match state::get::<String>(&ctx.host, state::VAULT_MANIFEST_SALT).await? {
        Some(salt) => salt,
        None => {
            let salt = vault_codec::generate_manifest_salt();
            state::set(&ctx.host, state::VAULT_MANIFEST_SALT, &salt).await?;
            salt
        }
    };
    let shared_veks = keys::open_shared_manifest_veks(ctx).await?;
    let held = keys::shared_manifest_records(ctx).await?;
    let write_set = vault_sharing::resolve_manifest_write_set(ManifestWriteSetRequest {
        personal_manifest_id: resolve_personal_manifest_id(ctx).await?,
        personal_manifest_salt: manifest_salt,
        stamped_manifest_ids: db::manifest_ids_in_vault(&ctx.host, Db::Local).await?,
        opened_manifest_ids: shared_veks.keys().cloned().collect(),
        held_records: held.values().map(|r| SharingRecord { manifest_id: r.manifest_id.clone(), salt: r.salt.clone(), name: r.name.clone(), can_administer: r.can_administer }).collect(),
        display_names: db::manifest_display_names(&ctx.host).await?,
    });
    for skipped in &write_set.skipped {
        let why = match skipped.reason {
            vault_sharing::WriteSkipReason::NoRowsInVault => "has no rows in this vault; leaving it out of the write rather than emptying it server-side",
            vault_sharing::WriteSkipReason::KeyDidNotOpen => "did not open; leaving it out of the write",
        };
        ctx.log(format!("[V2Push] Shared manifest {} {}.", skipped.manifest_id, why)).await;
    }

    let vek_by_id: HashMap<String, String> = shared_veks.iter().map(|(id, vek)| (id_key(id), vek.clone())).collect();
    let mut records = Vec::new();
    for record in write_set.records {
        let vek = if record.is_personal { None } else { vek_by_id.get(&id_key(&record.manifest_id)).cloned() };
        if !record.is_personal && vek.is_none() {
            return Err(SyncError::Other(format!("manifest {} is in the write set without a key, refusing to write it", record.manifest_id)));
        }
        records.push(ManifestRecord { manifest_id: record.manifest_id, is_personal: record.is_personal, salt: record.salt, vek, name: record.name, can_administer: record.can_administer });
    }
    Ok(records)
}

/// The personal manifest id as the last pull recorded it. Pushing without one is impossible.
pub(crate) async fn resolve_personal_manifest_id(ctx: &Ctx) -> SyncResult<String> {
    state::get::<String>(&ctx.host, state::VAULT_PERSONAL_MANIFEST_ID).await?.ok_or_else(|| SyncError::Other("no personal manifest id available (no snapshot baseline recorded); pull once before pushing".to_string()))
}

/// Whether the local vault is canonically identical to the last-known server state. Returns the canonicalize
/// result too, so a push right after does not canonicalize a second time.
pub(crate) async fn detect_no_op_mutation(ctx: &Ctx) -> SyncResult<(bool, CanonicalizedSet)> {
    let set = canonicalize_vault(ctx, None).await?;
    let fingerprints: HashMap<String, String> = state::get(&ctx.host, state::VAULT_CONTENT_FINGERPRINTS).await?.unwrap_or_default();
    let writable: HashSet<String> = set.manifest_records.iter().map(|r| id_key(&r.manifest_id)).collect();
    for entry in set.canonicalized.manifests.iter().filter(|m| writable.contains(&id_key(&m.manifest.manifest_id))) {
        let fingerprint = vault_codec::compute_content_fingerprint(&serde_json::to_string(&entry.manifest)?);
        if fingerprints.get(&state::fingerprint_manifest_key(&entry.manifest.manifest_id)) != Some(&fingerprint) {
            return Ok((false, set));
        }
    }
    for bucket in &set.canonicalized.data_buckets {
        let fingerprint = vault_codec::compute_content_fingerprint(&serde_json::to_string(bucket)?);
        if fingerprints.get(&state::fingerprint_bucket_key(&bucket.manifest_id, &bucket.category)) != Some(&fingerprint) {
            return Ok((false, set));
        }
    }
    Ok((true, set))
}

/// The manifests the local vault holds rows for that this session cannot write.
pub(crate) async fn find_unwritable_manifests(ctx: &Ctx) -> SyncResult<Vec<String>> {
    let mut writable: Vec<String> = keys::open_shared_manifest_veks(ctx).await?.keys().cloned().collect();
    if let Some(personal) = state::get::<String>(&ctx.host, state::VAULT_PERSONAL_MANIFEST_ID).await? {
        writable.push(personal);
    }
    let partition = vault_sharing::partition_manifest_access(ManifestAccessRequest { manifest_ids_in_vault: db::manifest_ids_in_vault(&ctx.host, Db::Local).await?, writable_manifest_ids: writable, granted_manifest_ids: Vec::new() });
    Ok(partition.unwritable)
}

/// Whether the vault holds rows this session cannot write, logging why; a failed check reads as "no".
pub(crate) async fn vault_holds_unwritable_manifests(ctx: &Ctx) -> bool {
    match find_unwritable_manifests(ctx).await {
        Ok(unwritable) if unwritable.is_empty() => false,
        Ok(unwritable) => {
            ctx.warn(format!("[VaultSync] Vault holds rows for manifest(s) this session cannot write ({}); pulling before the push.", unwritable.join(", "))).await;
            true
        }
        Err(error) => {
            ctx.warn(format!("[VaultSync] Could not check which manifests this session can write; leaving the pull decision to the revisions. {}", error)).await;
            false
        }
    }
}

/// The key each manifest's data buckets are encrypted with.
async fn resolve_bucket_write_keys(ctx: &Ctx, personal_vek: &str) -> SyncResult<HashMap<String, String>> {
    let mut keys_by_manifest = HashMap::new();
    keys_by_manifest.insert(resolve_personal_manifest_id(ctx).await?, personal_vek.to_string());
    keys_by_manifest.extend(keys::open_shared_manifest_veks(ctx).await?);
    Ok(keys_by_manifest)
}

/*
 * The upload as the flow drives it.
 */

/// Upload the stored vault: bucket-only when every pending mutation is bucket-scoped, full otherwise. Fails
/// with `KeyOutOfSync` when the session key matches neither the server's KEK nor its VEK.
pub(crate) async fn upload_vault(ctx: &mut Ctx, cache: Option<(u64, CanonicalizedSet)>, force_full_write: bool, create_vault_key: bool) -> SyncResult<UploadOutcome> {
    let mutation_seq_at_start = ctx.mutation_sequence;
    if !keys::adopt_remote_vault_key_if_needed(ctx).await? {
        return Err(SyncError::KeyOutOfSync);
    }

    let create_vault_key = create_vault_key || !keys::has_local_vault_key(&ctx.host).await?;
    let scopes = ctx.request.dirty_scopes.clone();
    let bucket_only = !force_full_write && !create_vault_key && !scopes.is_empty() && !scopes.iter().any(|s| s == MANIFEST_SCOPE);

    let (status, vault_changed) = if bucket_only {
        (upload_dirty_buckets_only(ctx, &scopes).await?, false)
    } else {
        let cached = cache.filter(|(seq, _)| *seq == ctx.mutation_sequence).map(|(_, set)| set);
        upload_new_vault_to_server(ctx, cached, force_full_write, create_vault_key).await?
    };
    Ok(UploadOutcome { status, mutation_seq_at_start, vault_changed })
}

/// Push only the data buckets named by the dirty scopes, no manifest upload.
async fn upload_dirty_buckets_only(ctx: &mut Ctx, scopes: &[String]) -> SyncResult<PushStatus> {
    let key = ctx.encryption_key()?;
    if state::get::<String>(&ctx.host, state::VAULT_PERSONAL_MANIFEST_ID).await?.is_none() {
        ctx.warn("[V2Push] No manifest to address the bucket write to, falling back to a full vault upload.").await;
        return Ok(upload_new_vault_to_server(ctx, None, false, false).await?.0);
    }
    if vault_holds_unwritable_manifests(ctx).await {
        return Ok(PushStatus::Outdated);
    }

    let layout = vault_codec::bucket_layout();
    let write_keys = resolve_bucket_write_keys(ctx, &key).await?;
    let mut seen = HashSet::new();
    for category in scopes.iter().filter(|s| seen.insert((*s).clone())) {
        let Some(spec) = layout.iter().find(|entry| &entry.category == category) else {
            ctx.warn(format!("[V2Push] Unknown bucket scope \"{}\", falling back to full vault upload.", category)).await;
            return Ok(upload_new_vault_to_server(ctx, None, false, false).await?.0);
        };
        let tables = read_bucket_tables(ctx, &spec.tables).await?;
        let buckets = vault_codec::extract_buckets(category.clone(), write_keys.keys().cloned().collect(), tables)?;
        for bucket in buckets {
            let Some(vek) = write_keys.get(&bucket.manifest_id) else { continue };
            let (status, revision) = push_data_bucket_only(ctx, &bucket, vek).await?;
            if status != PushStatus::Ok {
                return Ok(PushStatus::Outdated);
            }
            ctx.log(format!("[V2Push] Bucket-only push for \"{}\" of manifest {} done (bucket revision {}).", category, bucket.manifest_id, revision)).await;
        }
    }
    Ok(PushStatus::Ok)
}

/// Upload a new version of the vault, pruning expired trash items first. Returns the status and whether the
/// stored vault changed (pruned or re-keyed).
async fn upload_new_vault_to_server(ctx: &mut Ctx, cached: Option<CanonicalizedSet>, force_full_write: bool, create_vault_key: bool) -> SyncResult<(PushStatus, bool)> {
    let key_before = ctx.encryption_key()?;
    let mut cached = cached;
    let mut vault_pruned = false;
    match db::prune_in_place(&ctx.host, TRASH_RETENTION_DAYS).await {
        Ok(0) => {}
        Ok(count) => {
            ctx.log(format!("[VaultMerge] Pruned expired items from trash ({} SQL statements executed)", count)).await;
            vault_pruned = true;
            cached = None;
        }
        Err(error) => ctx.warn(format!("[VaultSync] Failed to prune vault, continuing with upload: {}", error)).await,
    }

    let (status, new_key) = push(ctx, cached, create_vault_key, force_full_write).await?;
    if let Some(new_key) = new_key {
        // Migration succeeded: from now on the session key is the VEK, not the password-derived key.
        keys::re_encrypt_shared_manifest_records(ctx, &new_key).await?;
        ctx.set_encryption_key(new_key);
    }

    // Re-encrypt and persist locally only when the stored blob went stale or the encryption key changed.
    let key_after = ctx.encryption_key()?;
    if vault_pruned || key_after != key_before {
        let bytes = db::export(&ctx.host, Db::Local).await?;
        let new_key = if key_after != key_before { Some(key_after.clone()) } else { None };
        state::store_vault_with_key(&ctx.host, &state::encrypt_vault_blob(&bytes, &key_after)?, false, None, None, new_key).await?;
        ctx.vault_changed = true;
    }
    Ok((status, vault_pruned))
}

/// The tables of one bucket category read from the local vault, as extract_buckets takes them.
async fn read_bucket_tables(ctx: &Ctx, category_tables: &[String]) -> SyncResult<HashMap<String, Vec<vault_codec::CodecRecord>>> {
    let mut names: Vec<String> = category_tables.to_vec();
    names.push(vault_codec::OVERFLOW_TABLE.to_string());
    db::read_named_tables(&ctx.host, Db::Local, &names).await
}

/*
 * The full write.
 */

/// The local baselines a write gates against and, on success, advances.
struct PushBaselines {
    fingerprints: HashMap<String, String>,
    manifest_revisions: HashMap<String, i64>,
    bucket_revisions: HashMap<String, i64>,
    known_server_hashes: HashSet<String>,
}

impl PushBaselines {
    async fn load(ctx: &Ctx) -> SyncResult<Self> {
        Ok(Self {
            fingerprints: state::get(&ctx.host, state::VAULT_CONTENT_FINGERPRINTS).await?.unwrap_or_default(),
            manifest_revisions: state::get(&ctx.host, state::SERVER_MANIFEST_REVISIONS).await?.unwrap_or_default(),
            bucket_revisions: state::get(&ctx.host, state::VAULT_BUCKET_REVISIONS).await?.unwrap_or_default(),
            known_server_hashes: state::get::<Vec<String>>(&ctx.host, state::VAULT_SERVER_BLOB_HASHES).await?.unwrap_or_default().into_iter().collect(),
        })
    }
}

/// What decides whether an unchanged element still goes into the write.
#[derive(Clone, Copy)]
struct WriteGate {
    force_full_write: bool,
    /// A KEK/VEK migration push: the personal manifest and its blobs are re-encrypted whatever their content.
    migrating: bool,
}

/// One manifest of the write: its record, canonical content and the key it encrypts under.
struct Candidate<'a> {
    record: &'a ManifestRecord,
    manifest: &'a Manifest,
    vek: String,
    blobs: &'a HashMap<String, BlobEntry>,
    current_revision: i64,
}

impl Candidate<'_> {
    fn label(&self) -> String {
        if self.record.is_personal {
            "Personal manifest".to_string()
        } else {
            format!("Shared manifest \"{}\"", self.manifest.name.clone().unwrap_or_else(|| self.record.manifest_id.clone()))
        }
    }
}

/// A plaintext blob staged for upload.
struct UploadBlobEntry {
    bytes: Vec<u8>,
    kind: String,
    vek: String,
    from_personal: bool,
}

/// The plaintext blobs the candidates carry, in first-seen order.
struct UploadBlobs {
    entries: HashMap<String, UploadBlobEntry>,
    order: Vec<String>,
}

impl UploadBlobs {
    fn hashes(&self, from_personal: bool) -> Vec<String> {
        self.order.iter().filter(|h| self.entries[*h].from_personal == from_personal).cloned().collect()
    }
}

/// The freshly generated key hierarchy for one migration push.
#[derive(zeroize::Zeroize, zeroize::ZeroizeOnDrop)]
struct LegacyAccountKeyMigration {
    content_key: String,

    /// Ciphertext only, so there is nothing here to wipe.
    #[zeroize(skip)]
    account_keys: crypto::AccountKeyBlobs,
    account_private_key: String,
}

/// The change fingerprints of everything one write carried, to become the new baselines on success.
#[derive(Default)]
struct WrittenFingerprints {
    manifests: HashMap<String, String>,
    buckets: HashMap<String, String>,
}

/// A byte or character count for log lines.
fn format_kb(chars: usize) -> String {
    if chars < 1024 {
        format!("{} B", chars)
    } else {
        format!("{:.1} KB", chars as f64 / 1024.0)
    }
}

/// Pack-then-encrypt a JSON payload. Returns the base64 ciphertext plus the packed size, for logging.
fn pack_encrypt(payload_json: &str, vek: &str) -> SyncResult<(String, usize)> {
    let packed = vault_codec::pack_payload(payload_json)?;
    Ok((crypto::symmetric_encrypt_bytes(&packed, vek)?, packed.len()))
}

/// Canonicalize, gate by content fingerprint, encrypt and `POST v2/Vault`. Returns the outcome and, on a KEK/VEK
/// migration push, the new content key the session adopts.
pub(crate) async fn push(ctx: &mut Ctx, cached: Option<CanonicalizedSet>, create_vault_key: bool, force_full_write: bool) -> SyncResult<(PushStatus, Option<String>)> {
    http::with_outdated_server_guard(push_internal(ctx, cached, create_vault_key, force_full_write).await)
}

async fn push_internal(ctx: &mut Ctx, cached: Option<CanonicalizedSet>, create_vault_key: bool, force_full_write: bool) -> SyncResult<(PushStatus, Option<String>)> {
    let vek = ctx.encryption_key()?;

    let unwritable = find_unwritable_manifests(ctx).await?;
    if !unwritable.is_empty() {
        ctx.warn(format!("[V2Push] Vault holds rows for manifest(s) this session cannot write ({}); refusing the write until a pull restores them.", unwritable.join(", "))).await;
        return Ok((PushStatus::Outdated, None));
    }

    let migration = start_account_key_migration(ctx, &vek, create_vault_key).await?;
    let content_key = migration.as_ref().map(|m| m.content_key.clone()).unwrap_or_else(|| vek.clone());
    let gate = WriteGate { force_full_write, migrating: migration.is_some() };

    let set = match cached {
        Some(set) => {
            ctx.log("[V2Push] Reusing the canonicalize result already produced for this vault.").await;
            set
        }
        None => canonicalize_vault(ctx, None).await?,
    };
    let CanonicalizedSet { canonicalized, manifest_records } = set;
    if manifest_records.is_empty() {
        return Err(SyncError::Other("no manifest records to push".to_string()));
    }
    ctx.log(format!("[V2Push] Canonicalize produced {} manifest(s) + {} data bucket(s).", canonicalized.manifests.len(), canonicalized.data_buckets.len())).await;

    let baselines = PushBaselines::load(ctx).await?;
    let candidates = collect_candidates(&canonicalized, &manifest_records, &content_key, &baselines);
    let blobs = collect_upload_blobs(&candidates)?;
    let mut written = WrittenFingerprints::default();
    let bucket_writes = encrypt_changed_buckets(ctx, &canonicalized.data_buckets, &candidates, &baselines, gate, &mut written).await?;
    let manifest_writes = encrypt_changed_manifests(ctx, &candidates, &baselines, gate, &mut written).await?;

    if manifest_writes.is_empty() && bucket_writes.is_empty() {
        ctx.log("[V2Push] No content changes detected (every manifest and data bucket matches the server baselines); skipping upload.").await;
        return Ok((PushStatus::Ok, None));
    }

    let mut uploaded = upload_missing_blobs(ctx, &blobs, &baselines, gate).await?;
    let email_routing = build_email_routing(&canonicalized.manifests.iter().map(|m| m.manifest.clone()).collect::<Vec<_>>(), &ctx.request.private_email_domains);
    let payload = VaultWriteRequest { username: ctx.request.username.clone(), manifests: manifest_writes, buckets: bucket_writes, new_blobs: Vec::new(), email_routing: Some(email_routing), account_keys: migration.as_ref().map(|m| m.account_keys.clone()) };
    let response = write_vault(ctx, &payload, &blobs, gate, &mut uploaded).await?;

    if response.status != 0 {
        // All-or-nothing: a single stale manifest or bucket rejected the whole write; the caller pulls, merges and retries.
        return Ok((PushStatus::Outdated, None));
    }

    commit_push_baselines(ctx, baselines, &response, written, &blobs, &uploaded).await?;
    if let Some(migration) = &migration {
        complete_account_key_migration(ctx, migration).await?;
        ctx.log("[V2Push] Account-key migration complete: hierarchy created server-side, blob chain cached locally.").await;
    }
    Ok((PushStatus::Ok, migration.map(|m| m.content_key.clone())))
}

/// Generate the account key hierarchy for a migration push, when one is due.
async fn start_account_key_migration(ctx: &Ctx, kek: &str, create_vault_key: bool) -> SyncResult<Option<LegacyAccountKeyMigration>> {
    if !create_vault_key {
        return Ok(None);
    }
    let hierarchy = crypto::create_account_key_hierarchy(kek)?;
    ctx.log("[V2Push] Account-key migration: generated new VEK, AK and account keypair; vault content and all blobs will be re-encrypted and re-uploaded.").await;
    Ok(Some(LegacyAccountKeyMigration {
        content_key: hierarchy.vault_encryption_key.clone(),
        account_keys: hierarchy.account_keys.clone(),
        account_private_key: hierarchy.account_private_key.clone(),
    }))
}

/// Every canonicalized manifest a record exists for, with the key it encrypts under.
fn collect_candidates<'a>(canonicalized: &'a CanonicalizedVault, records: &'a [ManifestRecord], content_key: &str, baselines: &PushBaselines) -> Vec<Candidate<'a>> {
    let record_by_id: HashMap<&str, &ManifestRecord> = records.iter().map(|r| (r.manifest_id.as_str(), r)).collect();
    canonicalized
        .manifests
        .iter()
        .filter_map(|entry| {
            let record = record_by_id.get(entry.manifest.manifest_id.as_str())?;
            Some(Candidate { record, manifest: &entry.manifest, vek: record.vek.clone().unwrap_or_else(|| content_key.to_string()), blobs: &entry.blobs, current_revision: baselines.manifest_revisions.get(&record.manifest_id).copied().unwrap_or(0) })
        })
        .collect()
}

/// The plaintext blobs the candidates carry; a blob two manifests share is staged once, under the first owner's key.
fn collect_upload_blobs(candidates: &[Candidate]) -> SyncResult<UploadBlobs> {
    let mut blobs = UploadBlobs { entries: HashMap::new(), order: Vec::new() };
    for candidate in candidates {
        for (hash, blob) in candidate.blobs {
            if blobs.entries.contains_key(hash) {
                continue;
            }
            blobs.order.push(hash.clone());
            blobs.entries.insert(hash.clone(), UploadBlobEntry { bytes: crypto::aes_gcm::decode_base64(&blob.bytes_base64)?, kind: blob.kind.clone(), vek: candidate.vek.clone(), from_personal: candidate.record.is_personal });
        }
    }
    Ok(blobs)
}

/// Gate, validate, pack and encrypt each changed bucket under the key of the manifest that owns it.
async fn encrypt_changed_buckets(ctx: &Ctx, buckets: &[DataBucket], candidates: &[Candidate<'_>], baselines: &PushBaselines, gate: WriteGate, written: &mut WrittenFingerprints) -> SyncResult<Vec<BucketWrite>> {
    let key_by_manifest: HashMap<&str, &str> = candidates.iter().map(|c| (c.record.manifest_id.as_str(), c.vek.as_str())).collect();
    let mut writes = Vec::new();
    for bucket in buckets {
        let label = format!("Data bucket \"{}\" of manifest {}", bucket.category, bucket.manifest_id);
        let fingerprint_key = state::fingerprint_bucket_key(&bucket.manifest_id, &bucket.category);
        let plaintext = serde_json::to_string(bucket)?;
        let fingerprint = vault_codec::compute_content_fingerprint(&plaintext);
        if !gate.force_full_write && !gate.migrating && baselines.fingerprints.get(&fingerprint_key) == Some(&fingerprint) {
            ctx.log(format!("[V2Push] {} unchanged versus server baseline, leaving it out of this write.", label)).await;
            continue;
        }
        let Some(bucket_key) = key_by_manifest.get(bucket.manifest_id.as_str()) else {
            ctx.warn(format!("[V2Push] {} names a manifest this vault cannot write; leaving it out of this write.", label)).await;
            continue;
        };
        let validation = vault_codec::validate_data_bucket(bucket);
        if !validation.ok {
            return Err(SyncError::UploadRejected(vec![format!("{} validation failed: {}. {}", label, validation.failed_rules.join(", "), validation.message).trim().to_string()]));
        }
        let (ciphertext, compressed) = pack_encrypt(&plaintext, bucket_key)?;
        let ciphertext_hash = vault_codec::compute_ciphertext_hash(&ciphertext);
        let current_revision = baselines.bucket_revisions.get(&state::bucket_revision_key(&bucket.manifest_id, &bucket.category)).copied().unwrap_or(0);
        ctx.log(format!("[V2Push] {}: raw {} > compressed {} > encrypted {}.", label, format_kb(plaintext.len()), format_kb(compressed), format_kb(ciphertext.len()))).await;
        writes.push(BucketWrite { manifest_id: bucket.manifest_id.clone(), category: bucket.category.clone(), blob: ciphertext, ciphertext_hash, current_revision });
        written.buckets.insert(fingerprint_key, fingerprint);
    }
    Ok(writes)
}

/// Gate, validate, pack and encrypt every changed candidate into the write batch, each with its own key.
async fn encrypt_changed_manifests(ctx: &Ctx, candidates: &[Candidate<'_>], baselines: &PushBaselines, gate: WriteGate, written: &mut WrittenFingerprints) -> SyncResult<Vec<ManifestWrite>> {
    let mut writes = Vec::new();
    for candidate in candidates {
        let label = candidate.label();
        let plaintext = serde_json::to_string(candidate.manifest)?;
        let fingerprint = vault_codec::compute_content_fingerprint(&plaintext);
        let rekeyed = gate.migrating && candidate.record.is_personal;
        if !gate.force_full_write && !rekeyed && baselines.fingerprints.get(&state::fingerprint_manifest_key(&candidate.record.manifest_id)) == Some(&fingerprint) {
            ctx.log(format!("[V2Push] {} unchanged versus server baseline, leaving it out of this write.", label)).await;
            continue;
        }
        let validation = vault_codec::validate_manifest(candidate.manifest);
        if !validation.ok {
            if candidate.record.is_personal {
                return Err(SyncError::UploadRejected(vec![format!("Manifest validation failed: {}. {}", validation.failed_rules.join(", "), validation.message).trim().to_string()]));
            }
            ctx.warn(format!("[V2Push] {} failed validation ({}), dropping it from this write.", label, validation.failed_rules.join(", "))).await;
            continue;
        }
        let (ciphertext, compressed) = pack_encrypt(&plaintext, &candidate.vek)?;
        let ciphertext_hash = vault_codec::compute_ciphertext_hash(&ciphertext);
        ctx.log(format!("[V2Push] {}: raw {} > compressed {} > encrypted {}.", label, format_kb(plaintext.len()), format_kb(compressed), format_kb(ciphertext.len()))).await;

        // Publish the public half of this manifest's mail delivery keypair; only admins may publish a shared one.
        let may_publish = candidate.record.is_personal || candidate.record.can_administer;
        let manifest_key = if may_publish { db::active_key_for_manifest(&ctx.host, &candidate.record.manifest_id).await? } else { None };
        if may_publish && manifest_key.is_none() && !candidate.record.is_personal {
            ctx.warn(format!("[V2Push] {} is missing its email keypair; its aliases stay personal until sharing is re-enabled.", label)).await;
        }

        let mut blob_refs: Vec<BlobRef> = candidate.blobs.iter().map(|(hash, blob)| BlobRef { hash: hash.clone(), category: blob.kind.clone() }).collect();
        blob_refs.sort_by(|a, b| a.hash.cmp(&b.hash));
        writes.push(ManifestWrite {
            manifest_id: candidate.record.manifest_id.clone(),
            manifest_blob: ciphertext,
            manifest_ciphertext_hash: ciphertext_hash,
            current_revision: candidate.current_revision,
            credentials_count: candidate.manifest.tables.get("Items").map(Vec::len).unwrap_or(0),
            blob_references: blob_refs,
            encryption_public_key: manifest_key.and_then(|row| row.get("PublicKey").and_then(serde_json::Value::as_str).map(str::to_string)),
        });
        written.manifests.insert(candidate.record.manifest_id.clone(), fingerprint);
    }
    Ok(writes)
}

/// Encrypt and upload only the blobs the server does not already have. On a migration push every personal
/// blob is re-encrypted under the new key and overwritten. Returns hash to ciphertext for the local cache.
async fn upload_missing_blobs(ctx: &Ctx, blobs: &UploadBlobs, baselines: &PushBaselines, gate: WriteGate) -> SyncResult<HashMap<String, String>> {
    let personal_hashes = blobs.hashes(true);
    let shared_hashes = blobs.hashes(false);
    let unknown_to_server = |hashes: &[String]| -> Vec<String> { hashes.iter().filter(|h| !baselines.known_server_hashes.contains(*h)).cloned().collect() };

    let (personal_to_upload, shared_to_upload) = if gate.migrating {
        (personal_hashes.clone(), missing_on_server(ctx, unknown_to_server(&shared_hashes)).await?)
    } else {
        let missing: HashSet<String> = missing_on_server(ctx, unknown_to_server(&blobs.order)).await?.into_iter().collect();
        (personal_hashes.iter().filter(|h| missing.contains(*h)).cloned().collect(), shared_hashes.iter().filter(|h| missing.contains(*h)).cloned().collect())
    };
    ctx.log(format!("[V2Push] Blob diff: {} blobs, uploading {} personal + {} shared{}.", blobs.order.len(), personal_to_upload.len(), shared_to_upload.len(), if gate.migrating { " (personal manifest re-encrypted, VEK migration)" } else { "" })).await;

    let mut uploaded = upload_blobs(ctx, &blobs.entries, &personal_to_upload, gate.migrating).await?;
    uploaded.extend(upload_blobs(ctx, &blobs.entries, &shared_to_upload, false).await?);
    Ok(uploaded)
}

/// Ask the server which of the given hashes it lacks.
async fn missing_on_server(ctx: &Ctx, hashes: Vec<String>) -> SyncResult<Vec<String>> {
    if hashes.is_empty() {
        return Ok(Vec::new());
    }
    Ok(http::post::<_, MissingBlobsResponse>(&ctx.host, BLOBS_MISSING_ENDPOINT, &BlobHashesRequest { hashes }, false).await?.missing)
}

/// `POST v2/Vault`. When the server reports blobs it lacks (stale local knowledge of its blob set), upload
/// them and retry the identical write once; blobs this client cannot supply fail the push.
async fn write_vault(ctx: &Ctx, payload: &VaultWriteRequest, blobs: &UploadBlobs, gate: WriteGate, uploaded: &mut HashMap<String, String>) -> SyncResult<VaultWriteResponse> {
    let response: VaultWriteResponse = http::post(&ctx.host, VAULT_ENDPOINT, payload, true).await?;
    if response.missing_blob_hashes.is_empty() {
        return Ok(response);
    }
    let unsatisfiable: Vec<String> = response.missing_blob_hashes.iter().filter(|h| !blobs.entries.contains_key(*h)).cloned().collect();
    if !unsatisfiable.is_empty() {
        return Err(SyncError::MissingBlobs(unsatisfiable));
    }
    ctx.warn(format!("[V2Sync] Server reported {} missing blob(s); uploading and retrying once.", response.missing_blob_hashes.len())).await;
    let (missing_personal, missing_shared): (Vec<String>, Vec<String>) = response.missing_blob_hashes.iter().cloned().partition(|h| blobs.entries[h].from_personal);
    uploaded.extend(upload_blobs(ctx, &blobs.entries, &missing_personal, gate.migrating).await?);
    uploaded.extend(upload_blobs(ctx, &blobs.entries, &missing_shared, false).await?);
    let response: VaultWriteResponse = http::post(&ctx.host, VAULT_ENDPOINT, payload, true).await?;
    if !response.missing_blob_hashes.is_empty() {
        return Err(SyncError::MissingBlobs(response.missing_blob_hashes));
    }
    Ok(response)
}

/// Advance the local baselines of everything a successful write carried, and refresh the encrypted blob cache.
async fn commit_push_baselines(ctx: &Ctx, baselines: PushBaselines, response: &VaultWriteResponse, written: WrittenFingerprints, blobs: &UploadBlobs, uploaded: &HashMap<String, String>) -> SyncResult<()> {
    let PushBaselines { mut fingerprints, mut manifest_revisions, mut bucket_revisions, .. } = baselines;
    if !response.bucket_revisions.is_empty() {
        for br in &response.bucket_revisions {
            bucket_revisions.insert(state::bucket_revision_key(&br.manifest_id, &br.category), br.revision);
        }
        state::set(&ctx.host, state::VAULT_BUCKET_REVISIONS, &bucket_revisions).await?;
    }
    for mr in &response.manifest_revisions {
        manifest_revisions.insert(mr.manifest_id.clone(), mr.revision);
    }
    state::set(&ctx.host, state::SERVER_MANIFEST_REVISIONS, &manifest_revisions).await?;

    fingerprints.extend(written.buckets);
    for (manifest_id, fingerprint) in written.manifests {
        fingerprints.insert(state::fingerprint_manifest_key(&manifest_id), fingerprint);
    }
    state::set(&ctx.host, state::VAULT_CONTENT_FINGERPRINTS, &fingerprints).await?;
    state::set(&ctx.host, state::VAULT_SERVER_BLOB_HASHES, &blobs.order).await?;

    // The encrypted blob cache: entries still referenced, plus the ciphertexts just uploaded.
    let cache: HashMap<String, String> = state::get(&ctx.host, state::VAULT_BLOB_CIPHER_CACHE).await?.unwrap_or_default();
    let mut new_cache: HashMap<String, String> = HashMap::new();
    for hash in &blobs.order {
        if let Some(ciphertext) = uploaded.get(hash).or_else(|| cache.get(hash)) {
            new_cache.insert(hash.clone(), ciphertext.clone());
        }
    }
    state::set(&ctx.host, state::VAULT_BLOB_CIPHER_CACHE, &new_cache).await
}

/// Adopt the hierarchy a migration push just committed: cache the encrypted chain and stage the private key.
async fn complete_account_key_migration(ctx: &mut Ctx, migration: &LegacyAccountKeyMigration) -> SyncResult<()> {
    let blobs = &migration.account_keys;
    state::set(&ctx.host, state::ENCRYPTED_ACCOUNT_KEY, &blobs.encrypted_account_key).await?;
    state::set(&ctx.host, state::ENCRYPTED_VEK, &blobs.encrypted_vek).await?;
    state::set(&ctx.host, state::ACCOUNT_PUBLIC_KEY, &blobs.account_public_key).await?;
    state::set(&ctx.host, state::ENCRYPTED_ACCOUNT_PRIVATE_KEY, &blobs.encrypted_account_private_key).await?;
    ctx.account_public_key = Some(blobs.account_public_key.clone());
    ctx.set_account_private_key(Some(migration.account_private_key.clone()));
    Ok(())
}

/// Encrypt the given blobs (each under its own key) and upload them in size-capped batches. Returns hash to
/// ciphertext for the local encrypted blob cache.
async fn upload_blobs(ctx: &Ctx, entries: &HashMap<String, UploadBlobEntry>, hashes: &[String], overwrite: bool) -> SyncResult<HashMap<String, String>> {
    let mut ciphertexts = HashMap::new();
    if hashes.is_empty() {
        return Ok(ciphertexts);
    }
    let mut batch: Vec<BlobDto> = Vec::new();
    let mut batch_chars = 0usize;
    for hash in hashes {
        let Some(entry) = entries.get(hash) else { continue };
        let ciphertext = crypto::symmetric_encrypt_bytes(&entry.bytes, &entry.vek)?;
        ciphertexts.insert(hash.clone(), ciphertext.clone());
        if !batch.is_empty() && (batch_chars + ciphertext.len() > BLOB_TRANSFER_BATCH_MAX_CHARS || batch.len() >= BLOB_TRANSFER_BATCH_MAX_COUNT) {
            ctx.log(format!("[V2Push] Uploading blob batch: {} blobs, {}.", batch.len(), format_kb(batch_chars))).await;
            http::post_no_content(&ctx.host, BLOBS_ENDPOINT, &BlobUploadRequest { blobs: std::mem::take(&mut batch), overwrite }).await?;
            batch_chars = 0;
        }
        batch_chars += ciphertext.len();
        batch.push(BlobDto { hash: hash.clone(), category: entry.kind.clone(), encrypted_data_base64: ciphertext });
    }
    if !batch.is_empty() {
        ctx.log(format!("[V2Push] Uploading blob batch: {} blobs, {}.", batch.len(), format_kb(batch_chars))).await;
        http::post_no_content(&ctx.host, BLOBS_ENDPOINT, &BlobUploadRequest { blobs: batch, overwrite }).await?;
    }
    Ok(ciphertexts)
}

/*
 * The bucket-only write.
 */

/// Single-data-bucket upload through the unified write, rebasing onto the server's revision and retrying once.
async fn push_data_bucket_only(ctx: &Ctx, bucket: &DataBucket, vek: &str) -> SyncResult<(PushStatus, i64)> {
    http::with_outdated_server_guard(push_data_bucket_only_internal(ctx, bucket, vek).await)
}

async fn push_data_bucket_only_internal(ctx: &Ctx, bucket: &DataBucket, vek: &str) -> SyncResult<(PushStatus, i64)> {
    let label = format!("Bucket \"{}\" of manifest {}", bucket.category, bucket.manifest_id);
    let revision_key = state::bucket_revision_key(&bucket.manifest_id, &bucket.category);
    let plaintext = serde_json::to_string(bucket)?;

    let mut fingerprints: HashMap<String, String> = state::get(&ctx.host, state::VAULT_CONTENT_FINGERPRINTS).await?.unwrap_or_default();
    let mut bucket_revisions: HashMap<String, i64> = state::get(&ctx.host, state::VAULT_BUCKET_REVISIONS).await?.unwrap_or_default();
    let fingerprint = vault_codec::compute_content_fingerprint(&plaintext);
    let fingerprint_key = state::fingerprint_bucket_key(&bucket.manifest_id, &bucket.category);
    if fingerprints.get(&fingerprint_key) == Some(&fingerprint) {
        ctx.log(format!("[V2Push] {} (bucket-only) unchanged versus server baseline, skipping upload.", label)).await;
        return Ok((PushStatus::Ok, bucket_revisions.get(&revision_key).copied().unwrap_or(0)));
    }

    let (ciphertext, compressed) = pack_encrypt(&plaintext, vek)?;
    let ciphertext_hash = vault_codec::compute_ciphertext_hash(&ciphertext);
    ctx.log(format!("[V2Push] {} (bucket-only): raw {} > compressed {} > encrypted {}.", label, format_kb(plaintext.len()), format_kb(compressed), format_kb(ciphertext.len()))).await;

    let post = |current_revision: i64| {
        let payload = VaultWriteRequest {
            username: ctx.request.username.clone(),
            manifests: Vec::new(),
            buckets: vec![BucketWrite { manifest_id: bucket.manifest_id.clone(), category: bucket.category.clone(), blob: ciphertext.clone(), ciphertext_hash: ciphertext_hash.clone(), current_revision }],
            new_blobs: Vec::new(),
            email_routing: None,
            account_keys: None,
        };
        async move { http::post::<_, VaultWriteResponse>(&ctx.host, VAULT_ENDPOINT, &payload, true).await }
    };
    let reported = |response: &VaultWriteResponse| response.bucket_revisions.iter().find(|b| ids_equal(&b.manifest_id, &bucket.manifest_id) && b.category == bucket.category).map(|b| b.revision);

    let mut current_revision = bucket_revisions.get(&revision_key).copied().unwrap_or(0);
    let mut response = post(current_revision).await?;
    if response.status != 0 {
        let server_revision = reported(&response).unwrap_or(current_revision);
        ctx.warn(format!("[V2Push] {} outdated (server at revision {}, we assumed {}); rebasing and retrying once.", label, server_revision, current_revision)).await;
        current_revision = server_revision;
        response = post(current_revision).await?;
    }
    if response.status != 0 {
        return Ok((PushStatus::Outdated, reported(&response).unwrap_or(current_revision)));
    }

    let new_revision = reported(&response).unwrap_or(current_revision + 1);
    bucket_revisions.insert(revision_key, new_revision);
    state::set(&ctx.host, state::VAULT_BUCKET_REVISIONS, &bucket_revisions).await?;
    fingerprints.insert(fingerprint_key, fingerprint);
    state::set(&ctx.host, state::VAULT_CONTENT_FINGERPRINTS, &fingerprints).await?;
    Ok((PushStatus::Ok, new_revision))
}
