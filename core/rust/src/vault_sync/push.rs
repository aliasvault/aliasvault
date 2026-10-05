//! Push: canonicalize the local vault, gate every manifest and bucket by its content fingerprint, encrypt what
//! changed under the key of the manifest that owns it, upload the blobs the server lacks, and `POST v2/Vault`.

use std::collections::{HashMap, HashSet};

use crate::vault_model::names::ITEMS_TABLE;
use crate::vault_model::{id_key, OVERFLOW_TABLE, TRASH_RETENTION_DEFAULT_DAYS};
use super::email_routing::build_email_routing;
use super::errors::{SyncError, SyncResult};
use super::state::{self, Ctx};
use super::types::{BlobDto, BlobHashesRequest, BlobRef, BlobUploadRequest, BucketRevision, BucketWrite, Db, ManifestRevision, ManifestWrite, MissingBlobsResponse, VaultWriteMigration, VaultWriteRequest, VaultWriteResponse, VaultWriteStatus, ALGORITHM_RSA_OAEP_SHA256};
use super::blob_keys::{self, EncryptedBlob};
use super::write_set::{self, ManifestRecord, SkipReason};
use super::{db, http, keys};
use crate::crypto;
use crate::vault_codec::{self, BlobEntry, CanonicalizeInput, CanonicalizedVault, DataBucket, Manifest, ManifestSpec};

const BLOBS_ENDPOINT: &str = "Vault/blobs";
const BLOBS_MISSING_ENDPOINT: &str = "Vault/blobs/missing";

/// The mutation scope that requires a full manifest push.
const MANIFEST_SCOPE: &str = "Main";

/// What a push writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WriteKind {
    /// What changed against the last known server state. With `buckets_only`, a host that recorded only
    /// bucket-scoped mutations gets away with writing those buckets, never canonicalizing the manifests.
    Changes { buckets_only: bool },
    /// Every manifest and bucket, whatever the fingerprints say: the server never saw this vault.
    Everything,
    /// The one-time account upgrade: creates the key hierarchy and encrypts every personal blob again under the
    /// new key, so the whole vault is written.
    AccountKeyMigration,
}

impl WriteKind {
    /// Whether elements whose fingerprint matches the server baseline are written anyway.
    fn writes_unchanged(self) -> bool {
        !matches!(self, WriteKind::Changes { .. })
    }
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
    /// Whether the stored vault was rewritten under the upload (pruned or keypair added).
    pub vault_changed: bool,
}

/*
 * The local write set.
 */

/// Canonicalize the local vault against every manifest this vault writes.
pub(crate) async fn canonicalize_vault(ctx: &Ctx, stamp_unstamped_into: Option<String>) -> SyncResult<CanonicalizedSet> {
    let tables = db::read_tables(&ctx.host, Db::Local).await?;
    let manifest_records = resolve_manifest_records(ctx).await?;
    let manifests: Vec<ManifestSpec> = manifest_records.iter().map(|r| ManifestSpec { manifest_id: r.manifest_id.clone(), manifest_salt: r.salt.clone(), name: None }).collect();
    let canonicalized = vault_codec::canonicalize_from_sqlite(CanonicalizeInput { tables, canonicalized_at: crate::common::timestamp::now_iso_utc(), manifests, stamp_unstamped_into })?;
    Ok(CanonicalizedSet { canonicalized, manifest_records })
}

/// Every manifest this vault can write, personal manifest first.
async fn resolve_manifest_records(ctx: &Ctx) -> SyncResult<Vec<ManifestRecord>> {
    let personal_salt = match state::get::<String>(&ctx.host, state::VAULT_MANIFEST_SALT).await? {
        Some(salt) => salt,
        None => {
            let salt = vault_codec::generate_manifest_salt();
            state::set(&ctx.host, state::VAULT_MANIFEST_SALT, &salt).await?;
            salt
        }
    };
    let personal_id = resolve_personal_manifest_id(ctx).await?;
    let stamped = db::manifest_ids_in_vault(&ctx.host, Db::Local).await?;
    let opened = keys::open_shared_manifest_veks(ctx).await?;
    let held = keys::shared_manifest_records(ctx).await?;
    let (records, skipped) = write_set::resolve_write_set(&personal_id, &personal_salt, &stamped, &opened, &held);
    for (manifest_id, reason) in skipped {
        let why = match reason {
            SkipReason::NoRowsInVault => "has no rows in this vault; leaving it out of the write rather than emptying it server-side",
            SkipReason::KeyDidNotOpen => "did not open; leaving it out of the write",
        };
        ctx.log(format!("[Push] Shared manifest {} {}.", manifest_id, why)).await;
    }
    Ok(records)
}

/// The personal manifest id as the last pull recorded it. Pushing without one is impossible.
pub(crate) async fn resolve_personal_manifest_id(ctx: &Ctx) -> SyncResult<String> {
    state::get::<String>(&ctx.host, state::VAULT_PERSONAL_MANIFEST_ID).await?.ok_or_else(|| SyncError::Other("no personal manifest id available (no snapshot baseline recorded); pull once before pushing".to_string()))
}

/// The key each writable manifest encrypts with, the personal one under the session key.
async fn resolve_write_keys(ctx: &Ctx) -> SyncResult<HashMap<String, String>> {
    let mut keys_by_manifest = keys::open_shared_manifest_veks(ctx).await?;
    keys_by_manifest.insert(resolve_personal_manifest_id(ctx).await?, ctx.encryption_key()?);
    Ok(keys_by_manifest)
}

/// Whether the local vault is canonically identical to the last-known server state. Returns the canonicalize
/// result too, so a push right after does not canonicalize a second time.
pub(crate) async fn detect_no_op_mutation(ctx: &Ctx) -> SyncResult<(bool, CanonicalizedSet)> {
    let set = canonicalize_vault(ctx, None).await?;
    let baselines = PushBaselines::load(ctx).await?;
    let writable: HashSet<String> = set.manifest_records.iter().map(|r| id_key(&r.manifest_id)).collect();
    for entry in set.canonicalized.manifests.iter().filter(|m| writable.contains(&id_key(&m.manifest.manifest_id))) {
        let (_, fingerprint) = fingerprinted(&entry.manifest)?;
        if !baselines.unchanged(&state::fingerprint_manifest_key(&entry.manifest.manifest_id), &fingerprint) {
            return Ok((false, set));
        }
    }
    for bucket in &set.canonicalized.data_buckets {
        let (_, fingerprint) = fingerprinted(bucket)?;
        if !baselines.unchanged(&state::fingerprint_bucket_key(&bucket.manifest_id, &bucket.category), &fingerprint) {
            return Ok((false, set));
        }
    }
    Ok((true, set))
}

/// The manifests the local vault holds rows for that this session cannot write.
async fn find_unwritable_manifests(ctx: &Ctx) -> SyncResult<Vec<String>> {
    let mut writable: Vec<String> = keys::open_shared_manifest_veks(ctx).await?.into_keys().collect();
    writable.extend(state::get::<String>(&ctx.host, state::VAULT_PERSONAL_MANIFEST_ID).await?);
    Ok(write_set::unwritable_manifests(&db::manifest_ids_in_vault(&ctx.host, Db::Local).await?, &writable))
}

/// Whether the vault holds rows this session cannot write, logging why; a failed check reads as "no".
pub(crate) async fn vault_holds_unwritable_manifests(ctx: &Ctx) -> bool {
    match find_unwritable_manifests(ctx).await {
        Ok(unwritable) if unwritable.is_empty() => false,
        Ok(unwritable) => {
            ctx.warn(format!("[Push] Vault holds rows for manifest(s) this session cannot write ({}); pulling before the push.", unwritable.join(", "))).await;
            true
        }
        Err(error) => {
            ctx.warn(format!("[Push] Could not check which manifests this session can write; leaving the pull decision to the revisions. {}", error)).await;
            false
        }
    }
}

/*
 * The upload as the flow drives it.
 */

/// Upload the stored vault. Fails with `KeyOutOfSync` when the session key does not open a hierarchy another
/// device created meanwhile; an account without a hierarchy gets the migration write whatever `kind` asked for.
pub(crate) async fn upload_vault(ctx: &mut Ctx, cache: Option<(u64, CanonicalizedSet)>, kind: WriteKind) -> SyncResult<UploadOutcome> {
    let mutation_seq_at_start = ctx.mutation_sequence;
    let kind = if keys::ensure_key_chain_accepted(ctx).await? { kind } else { WriteKind::AccountKeyMigration };

    if kind == (WriteKind::Changes { buckets_only: true }) {
        if let Some(categories) = bucket_only_categories(ctx).await? {
            let status = write_dirty_buckets(ctx, &categories).await?;
            return Ok(UploadOutcome { status, mutation_seq_at_start, vault_changed: false });
        }
    }
    let cached = cache.filter(|(seq, _)| *seq == ctx.mutation_sequence).map(|(_, set)| set);
    let (status, vault_changed) = write_whole_vault(ctx, cached, kind).await?;
    Ok(UploadOutcome { status, mutation_seq_at_start, vault_changed })
}

/// The bucket categories a bucket-only write covers, or `None` when the write has to go through the manifests: no
/// scopes recorded, a manifest scope among them, an unknown scope, or a personal delivery key still to be published.
async fn bucket_only_categories(ctx: &Ctx) -> SyncResult<Option<Vec<String>>> {
    let scopes = &ctx.request.dirty_scopes;
    if scopes.is_empty() || scopes.iter().any(|s| s == MANIFEST_SCOPE) {
        return Ok(None);
    }
    let layout = vault_codec::bucket_layout();
    let mut categories: Vec<String> = Vec::new();
    for scope in scopes {
        if !layout.iter().any(|entry| &entry.category == scope) {
            ctx.warn(format!("[Push] Unknown bucket scope \"{}\", writing the whole vault instead.", scope)).await;
            return Ok(None);
        }
        if !categories.contains(scope) {
            categories.push(scope.clone());
        }
    }
    // A missing delivery keypair is created on the full path only, as publishing it takes a manifest write.
    Ok(if personal_delivery_key_missing(ctx).await? { None } else { Some(categories) })
}

/// Write the data buckets of `categories` and nothing else: no manifest is canonicalized.
async fn write_dirty_buckets(ctx: &Ctx, categories: &[String]) -> SyncResult<PushStatus> {
    if vault_holds_unwritable_manifests(ctx).await {
        return Ok(PushStatus::Outdated);
    }
    let write_keys = resolve_write_keys(ctx).await?;
    let mut buckets: Vec<DataBucket> = Vec::new();
    for category in categories {
        let mut names: Vec<String> = vault_codec::tables_for_category(category).into_iter().map(str::to_string).collect();
        names.push(OVERFLOW_TABLE.to_string());
        let tables = db::read_named_tables(&ctx.host, Db::Local, &names).await?;
        buckets.extend(vault_codec::extract_buckets(category.clone(), write_keys.keys().cloned().collect(), tables)?);
    }

    let baselines = PushBaselines::load(ctx).await?;
    let mut written = WrittenFingerprints::default();
    let writes = encrypt_changed_buckets(ctx, &buckets, &write_keys, &baselines, WriteKind::Changes { buckets_only: true }, &mut written).await?;
    if writes.is_empty() {
        ctx.log("[Push] No bucket changed versus the server baselines; skipping upload.").await;
        return Ok(PushStatus::Ok);
    }
    let payload = VaultWriteRequest { username: ctx.request.username.clone(), manifests: Vec::new(), buckets: writes, email_routing: None, migration: None };
    let response: VaultWriteResponse = http::with_outdated_server_guard(http::post(&ctx.host, http::VAULT_ENDPOINT, &payload, true).await)?;
    if response.status != VaultWriteStatus::Ok {
        ctx.warn("[Push] Bucket-only write outdated; pulling and merging before the next attempt.").await;
        return Ok(PushStatus::Outdated);
    }
    commit_push_baselines(ctx, baselines, &response.manifest_revisions, &response.bucket_revisions, written).await?;
    ctx.log(format!("[Push] Bucket-only write of {} bucket(s) done.", response.bucket_revisions.len())).await;
    Ok(PushStatus::Ok)
}

/// Write the whole vault: prune expired trash and create a missing personal delivery keypair first, then the gated
/// write. Returns the status and whether the stored vault was rewritten (pruned or keypair added).
async fn write_whole_vault(ctx: &mut Ctx, cached: Option<CanonicalizedSet>, kind: WriteKind) -> SyncResult<(PushStatus, bool)> {
    let key_before = ctx.encryption_key()?;
    let mut cached = cached;
    let mut vault_rewritten = false;
    match db::prune_in_place(&ctx.host, TRASH_RETENTION_DEFAULT_DAYS).await {
        Ok(0) => {}
        Ok(count) => {
            ctx.log(format!("[Push] Pruned expired items from trash ({} SQL statements executed).", count)).await;
            vault_rewritten = true;
            cached = None;
        }
        Err(error) => ctx.warn(format!("[Push] Failed to prune vault, continuing with upload: {}", error)).await,
    }
    if personal_delivery_key_missing(ctx).await? {
        let personal_manifest_id = resolve_personal_manifest_id(ctx).await?;
        let pair = crypto::generate_rsa_key_pair()?;
        db::set_active_key_for_manifest(&ctx.host, &personal_manifest_id, &pair.public_key, &pair.private_key).await?;
        ctx.log(format!("[Push] Personal manifest {} had no mail delivery keypair; created one.", personal_manifest_id)).await;
        vault_rewritten = true;
        cached = None;
    }

    let (status, new_key) = http::with_outdated_server_guard(write_manifests_and_buckets(ctx, cached, kind).await)?;
    if let Some(new_key) = new_key {
        // Migration succeeded: from now on the session key is the VEK, not the password-derived key.
        keys::re_encrypt_shared_manifest_records(ctx, &new_key).await?;
        ctx.set_encryption_key(new_key);
    }

    // Store the vault again only when it changed or its key did.
    if vault_rewritten || ctx.encryption_key()? != key_before {
        ctx.persist_local_vault(false).await?;
    }
    Ok((status, vault_rewritten))
}

/// Whether the personal manifest has no active mail delivery keypair. Without one the server has no public key to
/// encrypt incoming mail with, and rejects every email sent to the vault's aliases.
async fn personal_delivery_key_missing(ctx: &Ctx) -> SyncResult<bool> {
    let Some(personal_manifest_id) = state::get::<String>(&ctx.host, state::VAULT_PERSONAL_MANIFEST_ID).await? else {
        return Ok(false);
    };
    Ok(db::active_public_key_for_manifest(&ctx.host, &personal_manifest_id).await?.is_none())
}

/*
 * The gated write.
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

    /// Whether the content behind a fingerprint key still matches the last-known server state.
    fn unchanged(&self, fingerprint_key: &str, fingerprint: &str) -> bool {
        self.fingerprints.get(fingerprint_key).map(String::as_str) == Some(fingerprint)
    }

    fn bucket_revision(&self, bucket: &DataBucket) -> i64 {
        self.bucket_revisions.get(&state::bucket_revision_key(&bucket.manifest_id, &bucket.category)).copied().unwrap_or(0)
    }
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
            format!("Shared manifest {}", self.record.manifest_id)
        }
    }
}

/// A plaintext blob staged for upload.
struct UploadBlobEntry {
    manifest_id: String,
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

    /// The given hashes grouped by the manifest that owns them, in first-seen order; the server stores blobs per manifest.
    fn by_manifest(&self, hashes: &[String]) -> Vec<(String, Vec<String>)> {
        let mut groups: Vec<(String, Vec<String>)> = Vec::new();
        for hash in hashes {
            let Some(entry) = self.entries.get(hash) else { continue };
            match groups.iter_mut().find(|(manifest_id, _)| *manifest_id == entry.manifest_id) {
                Some((_, group)) => group.push(hash.clone()),
                None => groups.push((entry.manifest_id.clone(), vec![hash.clone()])),
            }
        }
        groups
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
    signing_private_key: String,
}

/// The content fingerprints one write carried, keyed like the baselines, to become the new baselines on success.
type WrittenFingerprints = HashMap<String, String>;

/// A byte or character count for log lines.
fn format_kb(chars: usize) -> String {
    if chars < 1024 {
        format!("{} B", chars)
    } else {
        format!("{:.1} KB", chars as f64 / 1024.0)
    }
}

/// A payload as JSON text plus its content fingerprint.
fn fingerprinted<T: serde::Serialize>(payload: &T) -> SyncResult<(String, String)> {
    let plaintext = serde_json::to_string(payload)?;
    let fingerprint = vault_codec::compute_content_fingerprint(&plaintext);
    Ok((plaintext, fingerprint))
}

/// A payload packed and encrypted for the write, with the hash the server verifies it by.
struct EncryptedPayload {
    ciphertext: String,
    hash: String,
}

/// Pack and encrypt a JSON payload under `key` bound to `aad`, logging its size at every stage.
async fn encrypt_payload(ctx: &Ctx, label: &str, plaintext: &str, key: &str, aad: &[u8]) -> SyncResult<EncryptedPayload> {
    let packed = vault_codec::pack_payload(plaintext)?;
    let ciphertext = crypto::symmetric_encrypt_bytes_with_aad(&packed, key, aad)?;
    ctx.log(format!("[Push] {}: raw {} > compressed {} > encrypted {}.", label, format_kb(plaintext.len()), format_kb(packed.len()), format_kb(ciphertext.len()))).await;
    let hash = vault_codec::compute_ciphertext_hash(&ciphertext);
    Ok(EncryptedPayload { ciphertext, hash })
}

/// Canonicalize, gate by content fingerprint, encrypt and `POST v2/Vault`. Returns the outcome and, on a
/// migration push, the new content key the session switches to.
async fn write_manifests_and_buckets(ctx: &mut Ctx, cached: Option<CanonicalizedSet>, kind: WriteKind) -> SyncResult<(PushStatus, Option<String>)> {
    let vek = ctx.encryption_key()?;

    let unwritable = find_unwritable_manifests(ctx).await?;
    if !unwritable.is_empty() {
        ctx.warn(format!("[Push] Vault holds rows for manifest(s) this session cannot write ({}); refusing the write until a pull restores them.", unwritable.join(", "))).await;
        return Ok((PushStatus::Outdated, None));
    }

    let migration = start_account_key_migration(ctx, &vek, kind).await?;
    let content_key = migration.as_ref().map(|m| m.content_key.clone()).unwrap_or_else(|| vek.clone());

    let set = match cached {
        Some(set) => {
            ctx.log("[Push] Reusing the canonicalize result already produced for this vault.").await;
            set
        }
        None => canonicalize_vault(ctx, None).await?,
    };
    let CanonicalizedSet { canonicalized, manifest_records } = set;
    ctx.log(format!("[Push] Canonicalize produced {} manifest(s) + {} data bucket(s).", canonicalized.manifests.len(), canonicalized.data_buckets.len())).await;

    let baselines = PushBaselines::load(ctx).await?;
    let candidates = collect_candidates(&canonicalized, &manifest_records, &content_key, &baselines);
    let blobs = collect_upload_blobs(&candidates)?;
    if migration.is_some() {
        refuse_overwrite_without_bytes(&candidates, &blobs)?;
    }
    let keys_by_manifest: HashMap<String, String> = candidates.iter().map(|c| (c.record.manifest_id.clone(), c.vek.clone())).collect();
    let mut written = WrittenFingerprints::default();
    let bucket_writes = encrypt_changed_buckets(ctx, &canonicalized.data_buckets, &keys_by_manifest, &baselines, kind, &mut written).await?;
    // An upgrade push signs with the signing key it creates, which the server stores in the same write.
    let signing_key = match &migration {
        Some(migration) => Some(migration.signing_private_key.clone()),
        None => keys::signing_private_key(ctx).await?,
    };
    let manifest_writes = encrypt_changed_manifests(ctx, &candidates, &baselines, kind, signing_key.as_deref(), &mut written).await?;

    if manifest_writes.is_empty() && bucket_writes.is_empty() {
        ctx.log("[Push] No content changes detected (every manifest and data bucket matches the server baselines); skipping upload.").await;
        return Ok((PushStatus::Ok, None));
    }

    let overwrite_personal_blobs = migration.is_some();
    let mut uploaded = upload_missing_blobs(ctx, &blobs, &baselines, overwrite_personal_blobs).await?;
    let routed_manifests: Vec<_> = canonicalized.manifests.iter().map(|m| m.manifest.clone()).collect();
    let email_routing = build_email_routing(&routed_manifests, &ctx.request.private_email_domains, &baselines.manifest_revisions);
    let payload = VaultWriteRequest { username: ctx.request.username.clone(), manifests: manifest_writes, buckets: bucket_writes, email_routing: Some(email_routing), migration: migration.as_ref().map(|m| VaultWriteMigration { account_keys: Some(m.account_keys.clone()) }) };
    let response = write_vault(ctx, &payload, &blobs, overwrite_personal_blobs, &mut uploaded).await?;

    if response.status != VaultWriteStatus::Ok {
        // All-or-nothing: a single stale manifest or bucket rejected the whole write; the caller pulls, merges and retries.
        return Ok((PushStatus::Outdated, None));
    }

    commit_push_baselines(ctx, baselines, &response.manifest_revisions, &response.bucket_revisions, written).await?;
    commit_blob_baselines(ctx, &blobs, &uploaded).await?;
    if let Some(migration) = &migration {
        complete_account_key_migration(ctx, migration).await?;
        ctx.log("[Push] Account-key migration complete: hierarchy created server-side, blob chain cached locally.").await;
    }
    Ok((PushStatus::Ok, migration.map(|m| m.content_key.clone())))
}

/// Generate the account key hierarchy for a migration push. The session key of a legacy account is its unlock key,
/// which the hierarchy derives its KEK from.
async fn start_account_key_migration(ctx: &Ctx, unlock_key: &str, kind: WriteKind) -> SyncResult<Option<LegacyAccountKeyMigration>> {
    if kind != WriteKind::AccountKeyMigration {
        return Ok(None);
    }
    let hierarchy = crypto::create_account_key_hierarchy(unlock_key)?;
    ctx.log("[Push] Account-key migration: generated new VEK, AK, account keypair and signing keypair; vault content and all blobs will be re-encrypted and re-uploaded.").await;
    Ok(Some(LegacyAccountKeyMigration {
        content_key: hierarchy.vault_encryption_key.clone(),
        account_keys: hierarchy.account_keys.clone(),
        account_private_key: hierarchy.account_private_key.clone(),
        signing_private_key: hierarchy.signing_private_key.clone(),
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

/// The plaintext blobs the candidates carry, each owned by the manifest whose salt its hash was computed with.
fn collect_upload_blobs(candidates: &[Candidate]) -> SyncResult<UploadBlobs> {
    let mut blobs = UploadBlobs { entries: HashMap::new(), order: Vec::new() };
    for candidate in candidates {
        for (hash, blob) in candidate.blobs {
            if blobs.entries.contains_key(hash) {
                continue;
            }
            blobs.order.push(hash.clone());
            blobs.entries.insert(hash.clone(), UploadBlobEntry { manifest_id: candidate.record.manifest_id.clone(), bytes: crate::common::encoding::base64_decode(&blob.bytes_base64)?, kind: blob.kind.clone(), vek: candidate.vek.clone(), from_personal: candidate.record.is_personal });
        }
    }
    Ok(blobs)
}

/// A migration push uploads every personal blob again under the new key. A blob whose bytes are not loaded on this
/// device would keep its old server copy under the old key, never to open again, while its manifest moves on: refuse.
fn refuse_overwrite_without_bytes(candidates: &[Candidate], blobs: &UploadBlobs) -> SyncResult<()> {
    let not_loaded = candidates.iter().filter(|c| c.record.is_personal).flat_map(|c| c.manifest.referenced_blobs()).filter(|(hash, _)| !blobs.entries.contains_key(hash)).count();
    if not_loaded == 0 {
        return Ok(());
    }
    Err(SyncError::UploadRejected(vec![format!("{} blob(s) of the personal manifest are not loaded on this device, so they cannot be uploaded again; sync again when they load", not_loaded)]))
}

/// Gate, validate, pack and encrypt each changed bucket under the key of the manifest that owns it.
async fn encrypt_changed_buckets(ctx: &Ctx, buckets: &[DataBucket], keys_by_manifest: &HashMap<String, String>, baselines: &PushBaselines, kind: WriteKind, written: &mut WrittenFingerprints) -> SyncResult<Vec<BucketWrite>> {
    let mut writes = Vec::new();
    for bucket in buckets {
        let label = format!("Data bucket \"{}\" of manifest {}", bucket.category, bucket.manifest_id);
        let fingerprint_key = state::fingerprint_bucket_key(&bucket.manifest_id, &bucket.category);
        let (plaintext, fingerprint) = fingerprinted(bucket)?;
        if !kind.writes_unchanged() && baselines.unchanged(&fingerprint_key, &fingerprint) {
            ctx.log(format!("[Push] {} unchanged versus server baseline, leaving it out of this write.", label)).await;
            continue;
        }
        let Some(bucket_key) = keys_by_manifest.get(&bucket.manifest_id) else {
            ctx.warn(format!("[Push] {} names a manifest this vault cannot write; leaving it out of this write.", label)).await;
            continue;
        };
        let validation = vault_codec::validate_data_bucket(bucket);
        if !validation.ok {
            return Err(SyncError::UploadRejected(vec![format!("{} validation failed: {}. {}", label, validation.failed_rules.join(", "), validation.message).trim().to_string()]));
        }
        let encrypted = encrypt_payload(ctx, &label, &plaintext, bucket_key, &crypto::aad::bucket(&bucket.manifest_id, &bucket.category)).await?;
        writes.push(BucketWrite { manifest_id: bucket.manifest_id.clone(), category: bucket.category.clone(), blob: encrypted.ciphertext, ciphertext_hash: encrypted.hash, current_revision: baselines.bucket_revision(bucket) });
        written.insert(fingerprint_key, fingerprint);
    }
    Ok(writes)
}

/// Gate, validate, pack and encrypt every changed candidate into the write batch, each with its own key.
async fn encrypt_changed_manifests(ctx: &Ctx, candidates: &[Candidate<'_>], baselines: &PushBaselines, kind: WriteKind, signing_key: Option<&str>, written: &mut WrittenFingerprints) -> SyncResult<Vec<ManifestWrite>> {
    let mut writes = Vec::new();
    for candidate in candidates {
        let label = candidate.label();
        let fingerprint_key = state::fingerprint_manifest_key(&candidate.record.manifest_id);
        let (plaintext, fingerprint) = fingerprinted(candidate.manifest)?;
        if !kind.writes_unchanged() && baselines.unchanged(&fingerprint_key, &fingerprint) {
            ctx.log(format!("[Push] {} unchanged versus server baseline, leaving it out of this write.", label)).await;
            continue;
        }
        let validation = vault_codec::validate_manifest(candidate.manifest);
        if !validation.ok {
            if candidate.record.is_personal {
                return Err(SyncError::UploadRejected(vec![format!("Manifest validation failed: {}. {}", validation.failed_rules.join(", "), validation.message).trim().to_string()]));
            }
            ctx.warn(format!("[Push] {} failed validation ({}), dropping it from this write.", label, validation.failed_rules.join(", "))).await;
            continue;
        }
        let encrypted = encrypt_payload(ctx, &label, &plaintext, &candidate.vek, &crypto::aad::manifest(&candidate.record.manifest_id)).await?;

        // Publish the public half of this manifest's mail delivery keypair; only admins may publish a shared one.
        let may_publish = candidate.record.is_personal || candidate.record.can_administer;
        let manifest_key = if may_publish { db::active_public_key_for_manifest(&ctx.host, &candidate.record.manifest_id).await? } else { None };
        if may_publish && manifest_key.is_none() && !candidate.record.is_personal {
            ctx.warn(format!("[Push] {} is missing its email keypair; its aliases stay personal until sharing is re-enabled.", label)).await;
        }

        // The server only accepts a new delivery key signed by the caller; a key that is already published needs none.
        let manifest_key_signature = match (&manifest_key, signing_key) {
            (Some(public_key), Some(signing_key)) => Some(crypto::signing::sign(signing_key, &crypto::signing::delivery_key_message(&candidate.record.manifest_id, public_key, candidate.current_revision))?),
            (Some(_), None) => {
                ctx.warn(format!("[Push] {} publishes its email key without a signing key; the server refuses it if the key is new.", label)).await;
                None
            }
            _ => None,
        };

        let blob_refs: Vec<BlobRef> = candidate.manifest.referenced_blobs().into_iter().map(|(hash, category)| BlobRef { hash, category }).collect();
        writes.push(ManifestWrite {
            manifest_id: candidate.record.manifest_id.clone(),
            manifest_blob: encrypted.ciphertext,
            manifest_ciphertext_hash: encrypted.hash,
            current_revision: candidate.current_revision,
            credentials_count: candidate.manifest.tables.get(ITEMS_TABLE).map(Vec::len).unwrap_or(0),
            blob_references: blob_refs,
            delivery_public_key_algorithm: manifest_key.as_ref().map(|_| ALGORITHM_RSA_OAEP_SHA256.to_string()),
            delivery_public_key: manifest_key,
            delivery_public_key_signature: manifest_key_signature,
        });
        written.insert(fingerprint_key, fingerprint);
    }
    Ok(writes)
}

/// Encrypt and upload only the blobs the server does not already have. On a migration push every personal
/// blob is re-encrypted under the new key and overwritten. Returns hash to ciphertext for the local cache.
async fn upload_missing_blobs(ctx: &Ctx, blobs: &UploadBlobs, baselines: &PushBaselines, overwrite_personal_blobs: bool) -> SyncResult<HashMap<String, EncryptedBlob>> {
    let personal_hashes = blobs.hashes(true);
    let shared_hashes = blobs.hashes(false);
    let unknown_to_server = |hashes: &[String]| -> Vec<String> { hashes.iter().filter(|h| !baselines.known_server_hashes.contains(*h)).cloned().collect() };

    let (personal_to_upload, shared_to_upload) = if overwrite_personal_blobs {
        (personal_hashes.clone(), missing_on_server(ctx, blobs, &unknown_to_server(&shared_hashes)).await?)
    } else {
        let missing: HashSet<String> = missing_on_server(ctx, blobs, &unknown_to_server(&blobs.order)).await?.into_iter().collect();
        (personal_hashes.iter().filter(|h| missing.contains(*h)).cloned().collect(), shared_hashes.iter().filter(|h| missing.contains(*h)).cloned().collect())
    };
    ctx.log(format!("[Push] Blob diff: {} blobs, uploading {} personal + {} shared{}.", blobs.order.len(), personal_to_upload.len(), shared_to_upload.len(), if overwrite_personal_blobs { " (every personal blob overwritten)" } else { "" })).await;

    let mut uploaded = upload_blobs(ctx, blobs, &personal_to_upload, overwrite_personal_blobs).await?;
    uploaded.extend(upload_blobs(ctx, blobs, &shared_to_upload, false).await?);
    Ok(uploaded)
}

/// Ask the server which of the given hashes it lacks, per manifest that owns them and within the server's per-request cap.
async fn missing_on_server(ctx: &Ctx, blobs: &UploadBlobs, hashes: &[String]) -> SyncResult<Vec<String>> {
    let mut missing = Vec::new();
    for (manifest_id, hashes) in blobs.by_manifest(hashes) {
        for chunk in hashes.chunks(http::BLOB_HASH_REQUEST_MAX_COUNT) {
            let request = BlobHashesRequest { manifest_id: manifest_id.clone(), hashes: chunk.to_vec() };
            missing.extend(http::post::<_, MissingBlobsResponse>(&ctx.host, BLOBS_MISSING_ENDPOINT, &request, false).await?.missing);
        }
    }
    Ok(missing)
}

/// `POST v2/Vault`. When the server reports blobs it lacks (stale local knowledge of its blob set), upload
/// them and retry the identical write once; blobs this client cannot supply fail the push.
async fn write_vault(ctx: &Ctx, payload: &VaultWriteRequest, blobs: &UploadBlobs, overwrite_personal_blobs: bool, uploaded: &mut HashMap<String, EncryptedBlob>) -> SyncResult<VaultWriteResponse> {
    let response: VaultWriteResponse = http::post(&ctx.host, http::VAULT_ENDPOINT, payload, true).await?;
    if response.missing_blob_hashes.is_empty() {
        return Ok(response);
    }
    let unsatisfiable: Vec<String> = response.missing_blob_hashes.iter().filter(|h| !blobs.entries.contains_key(*h)).cloned().collect();
    if !unsatisfiable.is_empty() {
        return Err(SyncError::MissingBlobs(unsatisfiable));
    }
    ctx.warn(format!("[Push] Server reported {} missing blob(s); uploading and retrying once.", response.missing_blob_hashes.len())).await;
    let (missing_personal, missing_shared): (Vec<String>, Vec<String>) = response.missing_blob_hashes.iter().cloned().partition(|h| blobs.entries[h].from_personal);
    uploaded.extend(upload_blobs(ctx, blobs, &missing_personal, overwrite_personal_blobs).await?);
    uploaded.extend(upload_blobs(ctx, blobs, &missing_shared, false).await?);
    let response: VaultWriteResponse = http::post(&ctx.host, http::VAULT_ENDPOINT, payload, true).await?;
    if !response.missing_blob_hashes.is_empty() {
        return Err(SyncError::MissingBlobs(response.missing_blob_hashes));
    }
    Ok(response)
}

/// Advance the revision and fingerprint baselines of everything a successful write carried.
async fn commit_push_baselines(ctx: &Ctx, baselines: PushBaselines, manifest_revisions: &[ManifestRevision], bucket_revisions: &[BucketRevision], written: WrittenFingerprints) -> SyncResult<()> {
    let PushBaselines { mut fingerprints, manifest_revisions: mut known_manifests, bucket_revisions: mut known_buckets, .. } = baselines;
    if !bucket_revisions.is_empty() {
        for br in bucket_revisions {
            known_buckets.insert(state::bucket_revision_key(&br.manifest_id, &br.category), br.revision);
        }
        state::set(&ctx.host, state::VAULT_BUCKET_REVISIONS, &known_buckets).await?;
    }
    if !manifest_revisions.is_empty() {
        for mr in manifest_revisions {
            known_manifests.insert(mr.manifest_id.clone(), mr.revision);
        }
        state::set(&ctx.host, state::SERVER_MANIFEST_REVISIONS, &known_manifests).await?;
    }
    fingerprints.extend(written);
    state::set(&ctx.host, state::VAULT_CONTENT_FINGERPRINTS, &fingerprints).await
}

/// Record the server's blob set as this write left it, and keep the encrypted blob cache to what is still referenced.
async fn commit_blob_baselines(ctx: &Ctx, blobs: &UploadBlobs, uploaded: &HashMap<String, EncryptedBlob>) -> SyncResult<()> {
    state::set(&ctx.host, state::VAULT_SERVER_BLOB_HASHES, &blobs.order).await?;
    let cache: HashMap<String, EncryptedBlob> = state::get(&ctx.host, state::VAULT_BLOB_CIPHER_CACHE).await?.unwrap_or_default();
    let mut new_cache: HashMap<String, EncryptedBlob> = HashMap::new();
    for hash in &blobs.order {
        if let Some(encrypted) = uploaded.get(hash).or_else(|| cache.get(hash)) {
            new_cache.insert(hash.clone(), encrypted.clone());
        }
    }
    state::set(&ctx.host, state::VAULT_BLOB_CIPHER_CACHE, &new_cache).await
}

/// Store the hierarchy a migration push just committed: cache the encrypted chain and stage the private keys.
async fn complete_account_key_migration(ctx: &mut Ctx, migration: &LegacyAccountKeyMigration) -> SyncResult<()> {
    let blobs = &migration.account_keys;
    state::set(&ctx.host, state::ENCRYPTED_ACCOUNT_KEY, &blobs.encrypted_account_key).await?;
    state::set(&ctx.host, state::ENCRYPTED_VEK, &blobs.encrypted_vek).await?;
    state::set(&ctx.host, state::ACCOUNT_PUBLIC_KEY, &blobs.account_public_key).await?;
    state::set(&ctx.host, state::ENCRYPTED_ACCOUNT_PRIVATE_KEY, &blobs.encrypted_account_private_key).await?;
    state::set(&ctx.host, state::SIGNING_PUBLIC_KEY, &blobs.signing_public_key).await?;
    state::set(&ctx.host, state::ENCRYPTED_SIGNING_PRIVATE_KEY, &blobs.encrypted_signing_private_key).await?;
    ctx.account_public_key = Some(blobs.account_public_key.clone());
    ctx.account_private_key = Some(migration.account_private_key.clone());
    ctx.signing_private_key = Some(migration.signing_private_key.clone());
    Ok(())
}

/// Encrypt the given blobs (each under its own key) and upload them in size-capped batches per owning manifest.
/// Returns hash to ciphertext for the local encrypted blob cache.
async fn upload_blobs(ctx: &Ctx, blobs: &UploadBlobs, hashes: &[String], overwrite: bool) -> SyncResult<HashMap<String, EncryptedBlob>> {
    let mut encrypted_blobs = HashMap::new();
    for (manifest_id, hashes) in blobs.by_manifest(hashes) {
        let mut dtos = Vec::new();
        for hash in hashes {
            let entry = &blobs.entries[&hash];
            let encrypted = blob_keys::encrypt_blob(&entry.bytes, &entry.vek, &manifest_id, &hash)?;
            encrypted_blobs.insert(hash.clone(), encrypted.clone());
            dtos.push(BlobDto { hash, category: entry.kind.clone(), encrypted_data_base64: encrypted.encrypted_data_base64, encrypted_blob_key: encrypted.encrypted_blob_key });
        }
        for batch in http::batch_by_transfer_cost(dtos, |dto| dto.encrypted_data_base64.len()) {
            let chars: usize = batch.iter().map(|dto| dto.encrypted_data_base64.len()).sum();
            ctx.log(format!("[Push] Uploading blob batch: {} blobs, {}.", batch.len(), format_kb(chars))).await;
            http::post_no_content(&ctx.host, BLOBS_ENDPOINT, &BlobUploadRequest { manifest_id: manifest_id.clone(), blobs: batch, overwrite }).await?;
        }
    }
    Ok(encrypted_blobs)
}
