/**
 * VaultSyncService.
 *
 * Handles syncing the vault with the server and interfaces with the Rust codec.
 */

import { storage } from 'wxt/utils/storage';

import { base64ToBytes } from '@/utils/Base64';
import { bucketRevisionKey, StorageKeys } from '@/utils/constants/storageKeys';
import { devError, devLog, devWarn } from '@/utils/devLogger/DevLogger';
import { ManifestKeyType, VaultKeyAlgorithm, type BucketRevision, type VaultResponse } from '@/utils/dist/core/models/webapi';
import { VaultSqlGenerator } from '@/utils/dist/core/vault';
import { buildEmailRouting } from '@/utils/EmailRouting';
import { EncryptionUtility } from '@/utils/EncryptionUtility';
import { completeLegacyAccountKeyMigration, isLegacySqliteBlobSnapshot, legacyUnstampedRowAdoption, openLegacySqliteBlobSnapshot, prepareLegacyAccountKeyMigration, withOutdatedServerGuard, type LegacyAccountKeyMigration, type LegacySqliteBlobSnapshot } from '@/utils/legacy/LegacyStorageModelMigration';
import { getManifestRevisions, getPersonalManifestId, recordManifestRevisions, replaceManifestRevisions, toManifestRevisionMap } from '@/utils/ManifestRevisions';
import { multiManifestRendering } from '@/utils/MultiManifestRendering';
import {vaultCodecComputeCiphertextHash, vaultCodecComputeContentFingerprint, vaultCodecCanonicalizeFromSqlite, vaultCodecExtractEncryptionKeyForPublicKey, vaultCodecGenerateManifestSalt, vaultCodecMergeCanonical, vaultCodecUnpackPayload, vaultCodecMaterializeAsSqlite, vaultCodecPackPayload, vaultCodecValidateManifest, vaultCodecValidateDataBucket, type CodecBlobEntry, type CodecCanonicalized, type CodecCanonicalManifestMerge, type CodecManifest, type CodecManifestSpec, vaultSharingPartitionManifestAccess, vaultSharingResolveManifestWriteSet, type SharingAccessPartition} from '@/utils/RustCore';
import { SharingService, type ManifestVekGrant, type SharedManifestRecord } from '@/utils/SharingService';
import { SqliteClient } from '@/utils/SqliteClient';
import { getStorageItem } from '@/utils/StorageUtility';
import { VaultProcessingError } from '@/utils/types/errors/VaultProcessingError';
import { type VaultManifest, type VaultDataBucket, VaultCodec, manifestIdKey } from '@/utils/VaultCodec';
import { VaultKeyService } from '@/utils/VaultKeyService';
import { WebApiService } from '@/utils/WebApiService';

const VAULT_ENDPOINT = 'Vault';
const BLOBS_VAULT_ENDPOINT = 'Vault/blobs';
const BLOBS_MISSING_ENDPOINT = 'Vault/blobs/missing';
const BLOBS_DOWNLOAD_ENDPOINT = 'Vault/blobs/download';

/**
 * Human-readable size for the push/pull size logs. Lengths are base64/JSON characters, which map ~1:1 to
 * bytes on the wire.
 * @param chars - length in characters (or bytes)
 */
function formatKb(chars: number): string {
  return chars < 1024 ? `${chars} B` : `${(chars / 1024).toFixed(1)} KB`;
}

/**
 * Pack-then-encrypt a JSON payload (manifest or data bucket). The Rust codec wraps the payload in the
 * integrity envelope (`{ contentHash, payload }`) and gzips it. The platform then AES-GCM encrypts
 * the packed bytes.
 * @param payloadJson - the plaintext payload JSON string (manifest or bucket)
 * @param vek - symmetric encryption key
 * @returns The base64 ciphertext plus the intermediate packed (gzip-compressed) size (for logging purposes)
 */
async function packEncrypt(payloadJson: string, vek: string): Promise<{ ciphertext: string; compressedBytes: number }> {
  const packed = await vaultCodecPackPayload(payloadJson);
  const ciphertext = await EncryptionUtility.symmetricEncryptBytes(packed, vek);
  return { ciphertext, compressedBytes: packed.length };
}

/**
 * Dev-only stage timer: used to surface the manifest-shuffling passes that are
 * otherwise invisible (canonicalize's Rust→JS conversion, validate's JS→Rust conversion, stringify).
 * @param stage - short label for the measured step
 * @param fn - the work to run and time
 */
async function timedStage<T>(stage: string, fn: () => Promise<T> | T): Promise<T> {
  if (!import.meta.env.DEV) {
    return fn();
  }
  const start = performance.now();
  const result = await fn();
  devLog(`[V2Push] stage "${stage}": ${(performance.now() - start).toFixed(2)}ms`);
  return result;
}

/**
 * Verify a ciphertext against the hash the server stored (storage-layer integrity, skipped when the server sent
 * no hash), then decrypt it and open it via the Rust codec: gunzip, verify the embedded content hash, and return
 * the inner payload JSON string. Throws on either hash mismatch (storage or application-layer corruption).
 * @param base64Ciphertext - base64(IV | ciphertext | tag) from the server
 * @param vek - symmetric encryption key
 * @param expectedCiphertextHash - the ciphertext hash the server stored, when available
 * @param label - what is being opened, for the mismatch error message (e.g. `manifest`, `"Settings" bucket`)
 */
async function verifyDecryptUnpack(base64Ciphertext: string, vek: string, expectedCiphertextHash: string | null | undefined, label: string): Promise<string> {
  if (expectedCiphertextHash && await vaultCodecComputeCiphertextHash(base64Ciphertext) !== expectedCiphertextHash) {
    throw new Error(`VaultSyncService: ${label} ciphertext hash mismatch, refusing to load. Possible storage corruption.`);
  }
  const encryptedBytes = base64ToBytes(base64Ciphertext);
  const plainBytes = await EncryptionUtility.symmetricDecryptBytes(encryptedBytes, vek);
  return vaultCodecUnpackPayload(plainBytes);
}

/**
 * The grant a shared manifest is remembered by. Null when the snapshot carries no grant.
 * @param dto - the snapshot manifest
 */
function grantOf(dto: ManifestDto): ManifestVekGrant | null {
  if (!dto.encryptedVek || !dto.encryptionPublicKey) {
    return null;
  }

  return { encryptedVek: dto.encryptedVek, encryptionPublicKey: dto.encryptionPublicKey, algorithm: dto.algorithm ?? VaultKeyAlgorithm.RsaOaepSha256 };
}

/**
 * Whether two manifest ids match.
 * @param a - first manifest id
 * @param b - second manifest id
 */
function manifestIdsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

/** Fingerprint record key for a manifest. */
const fingerprintManifestKey = (manifestId: string): string => `manifest:${manifestId}`;
/** Fingerprint record key for a data bucket, addressed by the manifest that owns it. */
const fingerprintBucketKey = (manifestId: string, category: string): string => `bucket:${manifestId}:${category}`;

/** Max amount of bytes that can be transferred in a single blob transfer request or response body. */
const BLOB_TRANSFER_BATCH_MAX_CHARS = 4 * 1024 * 1024;
/** Upper bound on the number of blobs in one transfer batch. */
const BLOB_TRANSFER_BATCH_MAX_COUNT = 100;

/** The number of base64 characters a payload of `sizeBytes` raw bytes occupies on the wire. */
function base64Chars(sizeBytes: number): number {
  return Math.ceil(sizeBytes / 3) * 4;
}

/**
 * Split items into request batches bounded by both {@link BLOB_TRANSFER_BATCH_MAX_CHARS} and
 * {@link BLOB_TRANSFER_BATCH_MAX_COUNT}. An item larger than the byte budget itself is transferred on its own as
 * we can't split it across requests.
 * @param items - the items to batch
 * @param costOf - the base64 character cost one item adds to the request or response body
 */
function batchByTransferCost<T>(items: T[], costOf: (item: T) => number): T[][] {
  const batches: T[][] = [];
  let batch: T[] = [];
  let chars = 0;
  for (const item of items) {
    const cost = costOf(item);
    if (batch.length > 0 && (chars + cost > BLOB_TRANSFER_BATCH_MAX_CHARS || batch.length >= BLOB_TRANSFER_BATCH_MAX_COUNT)) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }

    batch.push(item);
    chars += cost;
  }

  if (batch.length > 0) {
    batches.push(batch);
  }

  return batches;
}

/**
 * Result of a pull: the materialized SQLite plus its manifest revision.
 */
type PullResult = {
  sqliteBase64: string;
  manifestRevision: number;
};

/**
 * What {@link VaultSyncService.openManifestsAndAdoptSyncState} produces: every manifest of one snapshot,
 * decrypted and ready to materialize or merge, with the local sync state already adopted from it.
 */
type OpenedManifestSet = {
  resolved: ResolvedManifest[];
  dataBuckets: VaultDataBucket[];
  blobMap: Map<string, Uint8Array>;
  contentlessManifestIds: string[];
  personalRevision: number;
  commitManifestRevisions: () => Promise<void>;
};

/** Aggregate canonical-merge statistics across all manifests. */
export type MergeSummary = {
  tablesProcessed: number;
  recordsFromLocal: number;
  recordsFromServer: number;
  recordsCreatedLocally: number;
  conflicts: number;
  recordsInserted: number;
};

/**
 * Result of {@link VaultSyncService.pullAndMerge}: what the fetched snapshot turned out to be and, for the
 * manifest-v1 outcomes, the merged (or server-only) vault plus the deferred revision commit.
 */
export type PullAndMergeResult =
  | { kind: 'legacy-server'; response: VaultResponse }
  | {
      kind: 'merged';
      response: VaultResponse;
      stats: MergeSummary;
      fallbackManifestIds: string[];
      droppedLocalManifestIds: string[];
      commitRevisions: () => Promise<void>;
    }
  | { kind: 'server-only'; response: VaultResponse; commitRevisions: () => Promise<void> };

/**
 * Result of a push. The revisions of every manifest the write carried are recorded in the per-manifest revision
 * map ({@link recordManifestRevisions}) as part of the push itself; callers only act on the status.
 */
export type PushResult = {
  status: 'ok' | 'outdated' | 'missing-blobs' | 'rejected';
  reasons?: string[];
  /** The new encryption key (set by legacy migration). */
  newEncryptionKey?: string;
};

type BlobRefDto = { hash: string; category: string };
type StoredBlobRefDto = BlobRefDto & { sizeBytes: number };
type BlobDto = { hash: string; category: string; encryptedDataBase64: string };

/** A plaintext blob staged for upload: its bytes plus the key that encrypts it. */
type UploadBlobEntry = { bytes: Uint8Array; kind: 'favicon' | 'attachment'; vek: string; fromPersonal: boolean };

/**
 * One manifest of a pull.
 */
type ResolvedManifest = {
  manifestId: string;
  isPersonal: boolean;
  manifest: VaultManifest;
  /** The key that decrypts this manifest and every blob it references. */
  vek: string;
  revision: number;
  blobReferences: StoredBlobRefDto[];
  /** Fingerprint of the plaintext exactly as the server served it: the push-side change-detection baseline. */
  contentFingerprint: string;
};

/**
 * A single manifest as carried in the GET snapshot / single-manifest fetch.
 */
type ManifestDto = {
  manifestId: string;
  blob?: string | null;
  ciphertextHash?: string | null;
  revision: number;
  blobReferences?: StoredBlobRefDto[];
  /** Whether the caller may grant/revoke access to this manifest and publish its email delivery key. */
  canAdminister?: boolean;
  /** How the caller's access to this manifest's VEK is encrypted. */
  keyType?: string | null;
  /** The manifest VEK encrypted with the caller's public key; set only on manifests we open through a grant. */
  encryptedVek?: string | null;
  /** Algorithm of `encryptedVek`, one of the {@link VaultKeyAlgorithm} tokens. */
  algorithm?: string | null;
  /** The public key `encryptedVek` was encrypted with. Selects which of the caller's keypairs decrypts the grant. */
  encryptionPublicKey?: string | null;
};

/** A data bucket as carried in the GET snapshot / bundled upload. `category` matches the server enum name (e.g. "Settings"). */
type BucketDto = { manifestId: string; category: string; blob?: string | null; ciphertextHash?: string | null; revision?: number };

/** Per-kind revision as carried in upload responses; the same shape the status response reports. */
type BucketRevisionDto = BucketRevision;

/**
 * Pick the user's personal manifest out of a snapshot. The server names it by id rather than flagging each entry, so
 * that one id is the only thing that decides which manifest is the caller's own. Strict on purpose: with no id, or an
 * id matching nothing, there is no safe fallback (grabbing an arbitrary manifest could assemble the wrong vault), so
 * callers that require a personal manifest must fail loudly on `undefined`.
 */
function selectPersonalManifest(snapshot: GetResponseDto | undefined | null): ManifestDto | undefined {
  const personalId = snapshot?.personalManifestId;
  return personalId ? (snapshot?.manifests ?? []).find(m => m.manifestId === personalId) : undefined;
}

/**
 * Raw snapshot returned by GET /v2/Vault. The `storageFormat` / `legacyVaultBlob` / `legacyRevision` / `version`
 * fields are only populated for a not-yet-migrated user and are declared by {@link LegacySqliteBlobSnapshot}.
 */
export type GetResponseDto = LegacySqliteBlobSnapshot & {
  status: number;
  /**
   * The caller's personal manifest id: the one manifest owned by their personal group, every other entry being a
   * shared one. Also set on the sqlite-blob path, where the manifests list is empty.
   */
  personalManifestId?: string | null;
  /** The manifests making up the logical vault. Each carries its own blob references. */
  manifests?: ManifestDto[];
  buckets?: BucketDto[];
  emailRouting?: {
    emailAddressList?: string[];
    privateEmailDomainList?: string[];
    hiddenPrivateEmailDomainList?: string[];
    publicEmailDomainList?: string[];
  };
};

/**
 * One manifest element in a POST /v2/Vault write. Every manifest is addressed by `manifestId`, the personal manifest
 * included, so the server never has to infer the target; it authorizes each id against what the caller may write.
 */
type ManifestWriteDto = {
  manifestId: string;
  manifestBlob: string;
  manifestCiphertextHash: string;
  currentRevision: number;
  credentialsCount: number;
  blobReferences: BlobRefDto[];
  /** The new VEK (set by legacy migration). */
  encryptedVek?: string;
};

/** Per-manifest result of a write: the new revision (Ok) or the current server revision (Outdated). */
type ManifestWriteResultDto = { manifestId: string; revision: number };

type VaultWriteResponseDto = {
  status: number;
  manifestRevisions: ManifestWriteResultDto[];
  bucketRevisions: BucketRevisionDto[];
  missingBlobHashes: string[];
};

type MissingBlobsResponseDto = { missing: string[] };

/**
 * One manifest canonicalize produced, staged as a write candidate.
 */
type PushManifest = {
  manifestId: string;
  isPersonal: boolean;
  manifest: CodecManifest;
  /** The key this manifest and its blobs encrypt with: the vault's content key for the personal manifest, the grant's VEK otherwise. */
  vek: string;
  blobs: Record<string, CodecBlobEntry>;
  /** The revision this write rebases on; the server rejects the whole batch when any is stale. */
  currentRevision: number;
};

/**
 * One manifest this vault can write, as resolved from local state before canonicalizing. The list is uniform on
 * purpose: the codec treats every manifest alike and the push drives one loop over all of them. `isPersonal` marks the
 * few places where the user's own manifest genuinely differs (see {@link resolveManifestRecords}).
 */
type ManifestRecord = {
  manifestId: string;
  isPersonal: boolean;
  /** Salt this manifest's blob hashes are derived with. */
  salt: string;
  /** The key this manifest encrypts with; null for the personal manifest, whose content key the push supplies (it can be freshly minted). */
  vek: string | null;
  /** Display name, as read from (and written back into) the encrypted manifest; null for the personal manifest. */
  name: string | null;
  /** Whether the caller may publish this manifest's email delivery key. */
  canAdminister: boolean;
};

/**
 * The canonicalized vault plus the manifest records it was split against, personal manifest first (the order canonicalize
 * requires: the first spec is the manifest being written from).
 */
type CanonicalizedVaultSet = {
  canonicalized: CodecCanonicalized;
  manifestRecords: ManifestRecord[];
};

let canonicalizeCache: ({ client: SqliteClient; mutationSequence: number } & CanonicalizedVaultSet) | null = null;

/**
 * Drop the cached canonicalize result so the next push re-canonicalizes from the live SQLite state.
 */
export function invalidateCanonicalizeCache(): void {
  canonicalizeCache = null;
}

/**
 * Service entry point.
 */
export class VaultSyncService {
  /** The manifest ids the last snapshot carried, recorded before any of them is opened. */
  private lastServedManifestIds: string[] = [];

  /**
   * Retrieve the latest vault from the server as a normalized {@link VaultResponse} (encrypted SQLite blob +
   * email routing + revision).
   *
   * Throws {@link ServerUpdateRequiredError} when the server predates the v2 API (outdated self-hosted install).
   * @param encryptionKey - the user's symmetric key (decrypts/materializes manifest-v1 and re-encrypts the
   *   materialized SQLite; unused for the already-encrypted legacy-blob pass-through).
   */
  public async pull(encryptionKey: string): Promise<VaultResponse> {
    /*
     * Step 1: network fetch. Failures here (server unreachable, HTTP error, or ServerUpdateRequiredError for an
     * outdated server) are "can't reach / must update the server" conditions, NOT vault-processing problems, so
     * they propagate unchanged and the caller maps them to the appropriate "server" message.
     */
    devLog('[V2Pull] Step 1/4: fetching vault snapshot (GET /v2/Vault)...');
    const snapshot = await this.fetchSnapshot();
    this.lastServedManifestIds = (snapshot.manifests ?? []).map(m => m.manifestId);
    const personalManifest = selectPersonalManifest(snapshot);
    devLog(`[V2Pull] Step 1/4 done: storageFormat=${snapshot.storageFormat}, manifests=${snapshot.manifests?.length ?? 0}, personalRevision=${personalManifest?.revision}, manifestBlob=${personalManifest?.blob?.length ?? 0} chars, buckets=${snapshot.buckets?.length ?? 0}, blobRefs=${personalManifest?.blobReferences?.length ?? 0}`);

    /*
     * Steps 2–4: decrypt, materialize, and re-encrypt. Any failure here is a client-side vault-processing error
     * (codec/format mismatch, integrity failure, corrupt blob, …). We wrap it in a VaultProcessingError so the UI
     * can surface the real technical detail in a copyable report instead of a misleading "server unreachable".
     */
    try {
      // LEGACY: a not-yet-migrated user's blob is passed through unchanged.
      if (isLegacySqliteBlobSnapshot(snapshot)) {
        const legacy = await openLegacySqliteBlobSnapshot(snapshot);
        return this.buildResponse(legacy.encryptedBlob, legacy.version, legacy.revision, snapshot);
      }

      // Manifest-v1 user: materialize the manifest + metadata + blobs into a SQLite blob, then encrypt it.
      devLog('[V2Pull] Step 2/4: manifest format: decrypting and reassembling local SQLite...');
      const pull = await this.materializeFromSnapshot(snapshot, encryptionKey);
      devLog(`[V2Pull] Step 3/4: materialized SQLite (${pull.sqliteBase64.length} base64 chars); re-encrypting for local storage...`);
      const encryptedVault = await EncryptionUtility.symmetricEncrypt(pull.sqliteBase64, encryptionKey);
      devLog('[V2Pull] Step 4/4: re-encryption done, returning VaultResponse.');
      return this.buildResponse(encryptedVault, '2.0.0', pull.manifestRevision, snapshot);
    } catch (error) {
      devError('[V2Pull] FAILED: the last logged step above is where it broke:', error);
      throw new VaultProcessingError('vault-pull', error);
    }
  }

  /**
   * Pull the latest snapshot and merge the local vault onto it at canonical level, one manifest at a time.
   * The server side is the base; the local side is canonicalized from `localClient`.
   * @param encryptionKey - the personal manifest's symmetric key
   * @param localClient - the local vault, freshly decrypted from storage
   */
  public async pullAndMerge(encryptionKey: string, localClient: SqliteClient): Promise<PullAndMergeResult> {
    devLog('[V2Merge] Fetching vault snapshot for canonical merge (GET /v2/Vault)...');
    const snapshot = await this.fetchSnapshot();
    this.lastServedManifestIds = (snapshot.manifests ?? []).map(m => m.manifestId);

    // LEGACY: a server still on the sqlite-blob format cannot merge with a manifest-v1 vault; the caller pushes over it.
    if (isLegacySqliteBlobSnapshot(snapshot)) {
      const legacy = await openLegacySqliteBlobSnapshot(snapshot);
      return { kind: 'legacy-server', response: this.buildResponse(legacy.encryptedBlob, legacy.version, legacy.revision, snapshot) };
    }

    try {
      const opened = await this.openManifestsAndAdoptSyncState(snapshot, encryptionKey, { deferRevisionCommit: true });

      try {
        return await this.mergeOntoOpenedManifests(opened, snapshot, encryptionKey, localClient);
      } catch (mergeError) {
        // Today's merge-failure fallback, from the same snapshot: the server vault stands, local changes are dropped.
        devError('[V2Merge] Canonical merge failed, falling back to the server vault:', mergeError);
        const sqliteBase64 = await this.materializeToSqlite(opened.resolved.map(m => m.manifest), opened.dataBuckets, opened.blobMap);
        const encryptedVault = await EncryptionUtility.symmetricEncrypt(sqliteBase64, encryptionKey);
        return { kind: 'server-only', response: this.buildResponse(encryptedVault, '2.0.0', opened.personalRevision, snapshot), commitRevisions: opened.commitManifestRevisions };
      }
    } catch (error) {
      devError('[V2Merge] FAILED: the last logged step above is where it broke:', error);
      throw new VaultProcessingError('vault-pull', error);
    }
  }

  /**
   * The merge core of {@link pullAndMerge}: canonicalize the local vault, run the Rust canonical merge
   * against the manifests just opened, validate the result per manifest, and materialize it.
   * @param opened - the opened server manifests (the merge base)
   * @param snapshot - the raw snapshot (for the email-routing block of the response)
   * @param encryptionKey - the personal manifest's symmetric key
   * @param localClient - the local vault, freshly decrypted from storage
   */
  private async mergeOntoOpenedManifests(opened: OpenedManifestSet, snapshot: GetResponseDto, encryptionKey: string, localClient: SqliteClient): Promise<PullAndMergeResult> {
    const { canonicalized } = await this.canonicalizeVault(localClient);

    const schemaColumns = await VaultCodec.getSchemaColumns(new VaultSqlGenerator().getCompleteSchemaSql());
    devLog(`[V2Merge] Merging ${canonicalized.manifests.length} local manifest(s) onto ${opened.resolved.length} server manifest(s)...`);
    const mergeOutput = await vaultCodecMergeCanonical({
      serverManifests: opened.resolved.map(m => m.manifest),
      serverBuckets: opened.dataBuckets,
      contentlessServerManifestIds: opened.contentlessManifestIds,
      localManifests: canonicalized.manifests.map(m => m.manifest),
      localBuckets: canonicalized.dataBuckets,
      schemaColumns,
    });

    // Validation gate, per manifest: the server's version of a failing manifest stands.
    const serverManifestById = new Map(opened.resolved.map(m => [m.manifestId.toLowerCase(), m.manifest]));
    const serverBucketsById = new Map<string, VaultDataBucket[]>();
    for (const bucket of opened.dataBuckets) {
      const key = bucket.manifestId.toLowerCase();
      serverBucketsById.set(key, [...(serverBucketsById.get(key) ?? []), bucket]);
    }
    const contentlessIds = new Set(opened.contentlessManifestIds.map(id => id.toLowerCase()));

    const manifests: VaultManifest[] = [];
    const dataBuckets: VaultDataBucket[] = [];
    const fallbackManifestIds: string[] = [];
    const stats: MergeSummary = { tablesProcessed: 0, recordsFromLocal: 0, recordsFromServer: 0, recordsCreatedLocally: 0, conflicts: 0, recordsInserted: 0 };
    for (const entry of mergeOutput.manifests) {
      const failure = await this.validateMergedManifest(entry);
      if (failure !== null && !contentlessIds.has(entry.manifestId.toLowerCase())) {
        devWarn(`[V2Merge] Merged manifest ${entry.manifestId} failed validation (${failure}); the server's version stands and local changes to it are dropped.`);
        fallbackManifestIds.push(entry.manifestId);
        const serverManifest = serverManifestById.get(entry.manifestId.toLowerCase());
        if (serverManifest) {
          manifests.push(serverManifest);
          dataBuckets.push(...(serverBucketsById.get(entry.manifestId.toLowerCase()) ?? []));
        }
        continue;
      }
      if (failure !== null) {
        // A contentless pass-through has no server base to fall back to; keep the local rows, the push gate decides.
        devWarn(`[V2Merge] Pass-through manifest ${entry.manifestId} failed validation (${failure}); keeping its local rows.`);
      }
      manifests.push(entry.manifest);
      dataBuckets.push(...entry.buckets);
      stats.tablesProcessed += entry.stats.tablesProcessed;
      stats.recordsFromLocal += entry.stats.recordsFromLocal;
      stats.recordsFromServer += entry.stats.recordsFromServer;
      stats.recordsCreatedLocally += entry.stats.recordsCreatedLocally;
      stats.conflicts += entry.stats.conflicts;
      stats.recordsInserted += entry.stats.recordsInserted;
    }
    for (const dropped of mergeOutput.droppedLocalManifestIds) {
      devWarn(`[V2Merge] Local manifest ${dropped} is no longer served; its rows are dropped from the merged vault.`);
    }

    // Blob bytes for materialize: the server download plus everything the local canonicalize extracted.
    const blobMap = opened.blobMap;
    for (const { blobs } of canonicalized.manifests) {
      for (const [hash, blob] of Object.entries(blobs)) {
        if (!blobMap.has(hash)) {
          blobMap.set(hash, VaultCodec.base64ToBytes(blob.bytesBase64));
        }
      }
    }
    this.assertMergedBlobRefsResolve(manifests, blobMap, opened.resolved[0]?.manifestId ?? '');

    const sqliteBase64 = await this.materializeToSqlite(manifests, dataBuckets, blobMap);
    const encryptedVault = await EncryptionUtility.symmetricEncrypt(sqliteBase64, encryptionKey);
    devLog(`[V2Merge] Canonical merge complete: ${stats.conflicts} conflict(s), ${stats.recordsInserted} offline row(s) kept, ${fallbackManifestIds.length} validation fallback(s), ${mergeOutput.droppedLocalManifestIds.length} dropped local manifest(s).`);

    return {
      kind: 'merged',
      response: this.buildResponse(encryptedVault, '2.0.0', opened.personalRevision, snapshot),
      stats,
      fallbackManifestIds,
      droppedLocalManifestIds: mergeOutput.droppedLocalManifestIds,
      commitRevisions: opened.commitManifestRevisions,
    };
  }

  /**
   * Validate one merged manifest and its buckets. Returns the failed rules, or null when valid.
   * @param entry - one manifest's merge result
   */
  private async validateMergedManifest(entry: CodecCanonicalManifestMerge): Promise<string | null> {
    const validation = await vaultCodecValidateManifest(entry.manifest);
    if (!validation.ok) {
      return validation.failedRules.join(', ');
    }
    for (const bucket of entry.buckets) {
      const bucketValidation = await vaultCodecValidateDataBucket(bucket);
      if (!bucketValidation.ok) {
        return `bucket "${bucket.category}": ${bucketValidation.failedRules.join(', ')}`;
      }
    }
    return null;
  }

  /**
   * Every blob marker in the merged manifests must resolve to bytes, or materialize would silently insert
   * NULL.
   * @param manifests - the manifests about to materialize
   * @param blobMap - the bytes available by hash
   * @param personalManifestId - the personal manifest's id
   */
  private assertMergedBlobRefsResolve(manifests: VaultManifest[], blobMap: Map<string, Uint8Array>, personalManifestId: string): void {
    for (const manifest of manifests) {
      const isPersonal = manifestIdsEqual(manifest.manifestId, personalManifestId);
      for (const rows of Object.values(manifest.tables)) {
        for (const row of rows) {
          for (const value of Object.values(row)) {
            if (typeof value !== 'object' || value === null || !('__blobRef' in value)) {
              continue;
            }
            const ref = value as { __blobRef: string; __blobKind?: string };
            if (blobMap.has(ref.__blobRef)) {
              continue;
            }
            if (ref.__blobKind === 'attachment' && isPersonal) {
              throw new Error(`VaultSyncService: merged vault references attachment blob ${ref.__blobRef} with no bytes available, refusing to materialize an incomplete vault.`);
            }
            devWarn(`[V2Merge] Merged ${ref.__blobKind ?? 'blob'} ${ref.__blobRef} has no bytes available; it will materialize as empty.`);
          }
        }
      }
    }
  }

  /**
   * Migrate the local vault onto the current full schema, entirely locally: canonicalize the database into
   * manifest-v1 form and materialize it straight back out again so it works offline too.
   *
   * This is the permanent delivery path for client schema changes (`SqliteClient.requiresSchemaMigration`).
   * It runs for a legacy `sqlite-blob` vault whose schema stops at the frozen sqlite-blob upgrade chain, and equally for a
   * manifest-v1 vault materialized by an older client whenever a newer COMPLETE_SCHEMA_SQL ships.
   * @param sqliteClient - the local vault to migrate
   * @returns Base64 of the migrated SQLite database (plaintext; the caller encrypts and stores it)
   */
  public async migrateVaultToCurrentSchema(sqliteClient: SqliteClient): Promise<string> {
    devLog('[ManifestMigration] Migrating local vault onto the current schema (local round-trip, no server involved)...');

    try {
      // LEGACY: a sqlite-blob vault's rows carry no ManifestId yet, so this one canonicalize adopts them.
      const { canonicalized } = await this.canonicalizeVault(sqliteClient, legacyUnstampedRowAdoption(await this.resolvePersonalManifestId()));

      /*
       * Canonicalize already handed us every extracted favicon/attachment as plaintext bytes, so materialize can
       * resolve its blob references without a single fetch.
       */
      const blobMap = new Map<string, Uint8Array>();
      for (const { blobs } of canonicalized.manifests) {
        for (const [hash, entry] of Object.entries(blobs)) {
          blobMap.set(hash, VaultCodec.base64ToBytes(entry.bytesBase64));
        }
      }

      const schemaSql = new VaultSqlGenerator().getCompleteSchemaSql();
      const schemaColumns = await VaultCodec.getSchemaColumns(schemaSql);
      const materialized = await vaultCodecMaterializeAsSqlite(canonicalized.manifests.map(m => m.manifest), canonicalized.dataBuckets, schemaColumns);

      const sqliteBase64 = await VaultCodec.insertTables(materialized, blobMap, schemaSql);

      devLog(`[ManifestMigration] Migration complete: ${blobMap.size} blobs re-embedded, ${sqliteBase64.length} base64 chars.`);
      return sqliteBase64;
    } catch (error) {
      devError('[ManifestMigration] FAILED to migrate the local vault:', error);
      throw new VaultProcessingError('vault-storage-migration', error);
    }
  }

  /**
   * Fetch the raw snapshot (GET /v2/Vault) without decrypting/reassembling. Throws error if the server predates the v2 API.
   */
  private async fetchSnapshot(): Promise<GetResponseDto> {
    return withOutdatedServerGuard(() => new WebApiService().get<GetResponseDto>(VAULT_ENDPOINT));
  }

  /**
   * Materialize a local SQLite database from an already-fetched manifest-v1 snapshot: verify ciphertext integrity,
   * decrypt every manifest and the data buckets, fetch any missing referenced blobs, then run the codec.
   * @param snapshot - the raw GET /v2/Vault response
   * @param vek - the personal manifest's symmetric key (from the unlock chain); decrypts the personal manifest and the data buckets
   */
  private async materializeFromSnapshot(snapshot: GetResponseDto, vek: string): Promise<PullResult> {
    const opened = await this.openManifestsAndAdoptSyncState(snapshot, vek);
    const sqliteBase64 = await this.materializeToSqlite(opened.resolved.map(m => m.manifest), opened.dataBuckets, opened.blobMap);
    return { sqliteBase64, manifestRevision: opened.personalRevision };
  }

  /**
   * Open every manifest a snapshot carries (the personal one plus each shared one) and adopt the snapshot as
   * this device's sync state.
   * @param snapshot - the raw GET /v2/Vault response
   * @param vek - the personal manifest's symmetric key (from the unlock chain); every other manifest key resolves from it
   * @param options - set deferRevisionCommit to hand the revision write back to the caller as `commitManifestRevisions`,
   *   for when the pulled revisions may only become local truth once a later step has succeeded
   */
  private async openManifestsAndAdoptSyncState(snapshot: GetResponseDto, vek: string, options?: { deferRevisionCommit?: boolean }): Promise<OpenedManifestSet> {
    const personalDto = selectPersonalManifest(snapshot);
    if (!personalDto) {
      throw new Error('VaultSyncService: server returned no personal manifest, refusing to assemble.');
    }

    if (!personalDto.blob) {
      throw new Error('VaultSyncService: server returned no manifest blob, nothing to assemble.');
    }

    // Content baselines for the push-side change detection: fingerprint every target as served by the server.
    const pulledFingerprints: Record<string, string> = {};

    /*
     * 1) Open every manifest in the snapshot through one path, personal manifest first. Every failure to resolve
     *    a key or open a blob throws on purpose.
     */
    const accountKeyVeks = new Map<string, string>([[personalDto.manifestId, vek]]);
    const resolved: ResolvedManifest[] = [];
    const sharedManifestRecords: Record<string, SharedManifestRecord> = {};
    const contentlessRevisions: Record<string, number> = {};
    for (const dto of [personalDto, ...(snapshot.manifests ?? []).filter(m => m.manifestId !== personalDto.manifestId)]) {
      const isPersonal = dto.manifestId === personalDto.manifestId;
      const manifestKey = await this.resolveManifestVek(dto, accountKeyVeks, isPersonal, resolved[0]?.manifest ?? null);
      if (!dto.blob) {
        // A shared manifest served without content yet (created but never written); its grant and revision are still tracked.
        const contentlessGrant = grantOf(dto);
        if (!contentlessGrant) {
          throw new Error(`VaultSyncService: shared manifest ${dto.manifestId} was served without content and without a grant, refusing to assemble.`);
        }
        sharedManifestRecords[dto.manifestId] = {
          manifestId: dto.manifestId,
          ...contentlessGrant,
          salt: await vaultCodecGenerateManifestSalt(),
          name: null,
          canAdminister: dto.canAdminister ?? false,
        };
        contentlessRevisions[dto.manifestId] = dto.revision;
        continue;
      }

      devLog(`[V2Pull] Verifying ciphertext hash; decrypting + opening ${isPersonal ? 'personal manifest' : `shared manifest ${dto.manifestId}`}...`);
      const entry = await this.openManifest(dto, manifestKey, isPersonal);
      resolved.push(entry);

      devLog(`[V2Pull] Manifest ${entry.manifestId} opened (content hash verified, ${isPersonal ? 'personal' : `shared "${entry.manifest.name ?? 'unnamed'}"`}): tables: ${Object.entries(entry.manifest.tables).map(([t, rows]) => `${t}=${rows.length}`).join(', ')}`);

      if (isPersonal) {
        await storage.setItem(StorageKeys.VAULT_MANIFEST_SALT, entry.manifest.manifestSalt);
        await storage.setItem(StorageKeys.VAULT_PERSONAL_MANIFEST_ID, entry.manifestId);
        continue;
      }

      const grant = grantOf(dto);
      if (!grant) {
        throw new Error(`VaultSyncService: shared manifest ${entry.manifestId} carries no grant this account can re-open, refusing to assemble.`);
      }

      sharedManifestRecords[entry.manifestId] = {
        manifestId: entry.manifestId,
        ...grant,
        salt: entry.manifest.manifestSalt,
        name: entry.manifest.name ?? null,
        canAdminister: dto.canAdminister ?? false,
      };
    }
    await SharingService.setSharedManifestRecords(sharedManifestRecords, vek);

    const personal = resolved[0];

    // 2) Open the data buckets belonging to those manifests.
    const { dataBuckets, bucketFingerprints } = await this.openDataBuckets(snapshot, resolved);
    Object.assign(pulledFingerprints, bucketFingerprints);

    // 3) Revision baselines: what the next status check compares this device against.
    const manifestRevisions = { ...Object.fromEntries(resolved.map(m => [m.manifestId, m.revision])), ...contentlessRevisions };
    /**
     * Commit the snapshot's revision map as the local believed-current revisions.
     */
    const commitManifestRevisions = async (): Promise<void> => {
      await replaceManifestRevisions(manifestRevisions);
      devLog(`[V2Pull] Stored local manifest revisions from snapshot: ${Object.entries(manifestRevisions).map(([id, rev]) => `${id}=${rev}`).join(', ')}. Next status check compares against these.`);
    };
    if (options?.deferRevisionCommit !== true) {
      await commitManifestRevisions();
    }

    // 4) Fetch and decrypt every blob the opened manifests reference.
    const blobMap = await this.downloadReferencedBlobs(resolved, vek);

    /*
     * 5) Fingerprint baselines: what the next push diffs against. Replace rather than merge, the record must
     *    mirror exactly the manifests and buckets the server holds right now, so entries of revoked/removed
     *    manifests drop out. One entry per opened manifest, the personal one included.
     */
    for (const entry of resolved) {
      pulledFingerprints[fingerprintManifestKey(entry.manifestId)] = entry.contentFingerprint;
    }
    await storage.setItem(StorageKeys.VAULT_CONTENT_FINGERPRINTS, pulledFingerprints);
    devLog(`[V2Pull] Stored ${Object.keys(pulledFingerprints).length} content fingerprint baseline(s) for push-side change detection.`);

    return {
      resolved,
      dataBuckets,
      blobMap,
      contentlessManifestIds: Object.keys(contentlessRevisions),
      personalRevision: personal.revision,
      commitManifestRevisions,
    };
  }

  /**
   * Open the data buckets a snapshot carries and record their revisions as the local baseline.
   * @param snapshot - the raw GET /v2/Vault response
   * @param resolved - the manifests already opened; a bucket addressed to any other manifest is refused
   * @returns The decrypted buckets plus one content fingerprint per bucket, for the push-side change detection
   */
  private async openDataBuckets(snapshot: GetResponseDto, resolved: ResolvedManifest[]): Promise<{ dataBuckets: VaultDataBucket[]; bucketFingerprints: Record<string, string> }> {
    const bucketFingerprints: Record<string, string> = {};
    const keyByManifestId = new Map(resolved.map(entry => [entry.manifestId, entry.vek]));
    const dataBuckets: VaultDataBucket[] = [];
    const pulledBucketRevisions: Record<string, number> = {};
    for (const bucketDto of (snapshot.buckets ?? [])) {
      if (!bucketDto.blob) {
        continue;
      }
      const bucketKey = keyByManifestId.get(bucketDto.manifestId);
      if (!bucketKey) {
        throw new Error(`VaultSyncService: data bucket "${bucketDto.category}" belongs to manifest ${bucketDto.manifestId}, which this vault did not open, refusing to assemble.`);
      }
      const label = `"${bucketDto.category}" bucket of manifest ${bucketDto.manifestId}`;
      const bucketJson = await verifyDecryptUnpack(bucketDto.blob, bucketKey, bucketDto.ciphertextHash, label);
      const bucket = JSON.parse(bucketJson) as VaultDataBucket;

      // Bind the payload to the address the server delivered it under
      if (!manifestIdsEqual(bucket.manifestId, bucketDto.manifestId) || bucket.category !== bucketDto.category) {
        throw new Error(`VaultSyncService: ${label} declares a different address (manifest ${bucket.manifestId}, category "${bucket.category}") inside its encrypted payload, refusing to assemble.`);
      }

      dataBuckets.push(bucket);
      bucketFingerprints[fingerprintBucketKey(bucketDto.manifestId, bucketDto.category)] = await vaultCodecComputeContentFingerprint(bucketJson);
      const rowCount = Object.values(bucket.tables ?? {}).reduce((n, rows) => n + rows.length, 0);
      devLog(`[V2Pull] Data bucket ${label} opened: ${rowCount} rows (revision ${bucketDto.revision}).`);
      if (typeof bucketDto.revision === 'number') {
        pulledBucketRevisions[bucketRevisionKey(bucketDto.manifestId, bucketDto.category)] = bucketDto.revision;
      }
    }
    // Replace rather than merge, so the buckets of a manifest that is gone drop out with it.
    await storage.setItem(StorageKeys.VAULT_BUCKET_REVISIONS, pulledBucketRevisions);
    if (dataBuckets.length === 0) {
      devLog('[V2Pull] No data buckets in snapshot.');
    }

    return { dataBuckets, bucketFingerprints };
  }

  /**
   * Fetch every blob the opened manifests reference that is not already cached locally, decrypt it, and prune
   * the persisted cache to exactly that referenced set, so the cache stays bounded by the current vault size.
   * @param resolved - the opened manifests, whose references decide what is downloaded and which key opens it
   * @param vek - fallback key for a reference whose owning manifest cannot be determined
   * @returns Plaintext bytes per blob hash, for the codec to re-embed
   */
  private async downloadReferencedBlobs(resolved: ResolvedManifest[], vek: string): Promise<Map<string, Uint8Array>> {
    const webApi = new WebApiService();
    const refOwners = new Map<string, ResolvedManifest>();
    const refs: StoredBlobRefDto[] = [];
    for (const entry of resolved) {
      for (const r of entry.blobReferences) {
        if (refOwners.has(r.hash)) {
          continue;
        }
        refs.push(r);
        refOwners.set(r.hash, entry);
      }
    }
    const cache = await this.loadBlobCache();
    const missingRefs = refs.filter(r => !(r.hash in cache));
    devLog(`[V2Pull] Blob refs: ${refs.length} referenced, ${refs.length - missingRefs.length} cached locally, ${missingRefs.length} to download.`);

    // Batch downloads by the bytes each blob adds to the response, not by hash count.
    const downloadBatches = batchByTransferCost(missingRefs, r => base64Chars(r.sizeBytes));
    for (const [index, chunk] of downloadBatches.entries()) {
      const chunkChars = chunk.reduce((sum, r) => sum + base64Chars(r.sizeBytes), 0);
      const blobs = await webApi.post<{ hashes: string[] }, BlobDto[]>(BLOBS_DOWNLOAD_ENDPOINT, { hashes: chunk.map(r => r.hash) });
      devLog(`[V2Pull] Downloaded blob batch ${index + 1}/${downloadBatches.length}: requested ${chunk.length} (${formatKb(chunkChars)}), received ${blobs.length}.`);
      for (const dto of blobs) {
        cache[dto.hash] = dto.encryptedDataBase64;
      }
    }

    // Decrypt the referenced blobs and prune the cache to exactly the referenced set, so the cache stays bounded by the current vault size.
    const prunedCache: Record<string, string> = {};
    const blobMap = new Map<string, Uint8Array>();
    for (const r of refs) {
      const ciphertext = cache[r.hash];
      const owner = refOwners.get(r.hash);
      const blobKey = owner?.vek ?? vek;
      if (!ciphertext) {
        devWarn(`[V2Sync] Referenced ${r.category} blob ${r.hash} missing on server, continuing without it.`);
        continue;
      }
      try {
        blobMap.set(r.hash, await this.decryptBlobToBytes(ciphertext, blobKey));
        prunedCache[r.hash] = ciphertext;
      } catch (e) {
        devWarn(`[V2Sync] Referenced ${r.category} blob ${r.hash} failed to decrypt with the current key, continuing without it.`);
      }
    }
    await this.saveBlobCache(prunedCache);

    // The server demonstrably has every blob it just served or referenced, seed the upload diff with them.
    await storage.setItem(StorageKeys.VAULT_SERVER_BLOB_HASHES, refs.map(r => r.hash));

    return blobMap;
  }

  /**
   * Materialize manifests + data buckets into a fresh SQLite database via the codec.
   * @param manifests - the manifests to combine, the caller's own first
   * @param dataBuckets - the data buckets belonging to those manifests
   * @param blobMap - plaintext bytes for every blob hash the manifests reference
   * @returns Base64 of the materialized SQLite database (plaintext)
   */
  private async materializeToSqlite(manifests: VaultManifest[], dataBuckets: VaultDataBucket[], blobMap: Map<string, Uint8Array>): Promise<string> {
    devLog(`[V2Pull] ${blobMap.size} blobs decrypted; running codec reassembly into a fresh SQLite (${manifests.length} manifest(s) combined)...`);
    const sqlGen = new VaultSqlGenerator();
    const schemaSql = sqlGen.getCompleteSchemaSql();
    const schemaColumns = await VaultCodec.getSchemaColumns(schemaSql);
    const materialized = await vaultCodecMaterializeAsSqlite(manifests, dataBuckets, schemaColumns);

    const overflowTableCount = Object.keys(materialized.overflow.tables).length + Object.values(materialized.overflow.bucketTables).reduce((n, t) => n + Object.keys(t).length, 0);
    const overflowColumnTables = Object.keys(materialized.overflow.columns);
    if (overflowTableCount > 0 || overflowColumnTables.length > 0) {
      devWarn(`[V2Pull] Newer-schema data preserved as overflow: ${overflowTableCount} unknown table(s), unknown columns on [${overflowColumnTables.join(', ')}]. It will round-trip on push but is not usable locally until the app is updated.`);
    }

    const sqliteBase64 = await VaultCodec.insertTables(materialized, blobMap, schemaSql);
    devLog('[V2Pull] Codec reassembly complete.');

    return sqliteBase64;
  }

  /**
   * Verify one snapshot manifest's ciphertext, decrypt and open it into a {@link ResolvedManifest}.
   * @param dto - the snapshot manifest (must carry a blob)
   * @param vek - the key that decrypts it
   * @param isPersonal - whether this is the manifest the snapshot named as the caller's own
   */
  private async openManifest(dto: ManifestDto, vek: string, isPersonal: boolean): Promise<ResolvedManifest> {
    const manifestJson = await verifyDecryptUnpack(dto.blob!, vek, dto.ciphertextHash, isPersonal ? 'manifest' : `shared manifest ${dto.manifestId}`);
    const manifest = JSON.parse(manifestJson) as VaultManifest;

    if (!manifestIdsEqual(manifest.manifestId, dto.manifestId)) {
      throw new Error(`VaultSyncService: manifest ${dto.manifestId} declares a different id (${manifest.manifestId}) inside its encrypted payload, refusing to open it.`);
    }

    return {
      manifestId: dto.manifestId,
      isPersonal,
      manifest,
      vek,
      revision: typeof dto.revision === 'number' ? dto.revision : 0,
      blobReferences: dto.blobReferences ?? [],
      contentFingerprint: await vaultCodecComputeContentFingerprint(manifestJson),
    };
  }

  /**
   * The key that opens one snapshot manifest.
   * @param dto - the snapshot manifest
   * @param accountKeyVeks - the VEKs already held per manifest id, keyed by the account key hierarchy
   * @param isPersonal - whether this is the manifest the snapshot named as the caller's own
   * @param personalManifest - the already-decrypted personal manifest (the durable home of rotated private keys), or null when none is open yet
   * @returns The manifest's VEK. Throws when this client holds no key for it.
   */
  private async resolveManifestVek(dto: ManifestDto, accountKeyVeks: Map<string, string>, isPersonal: boolean, personalManifest: CodecManifest | null): Promise<string> {
    // A server that predates the field says nothing, and there the home manifest is the account-key one by definition.
    const keyType = dto.keyType ?? (isPersonal ? ManifestKeyType.AccountKey : ManifestKeyType.GrantKey);

    if (keyType === ManifestKeyType.AccountKey) {
      const accountKeyVek = accountKeyVeks.get(dto.manifestId);
      if (!accountKeyVek) {
        // Our unlock chain produced a VEK for a different manifest than the one this key is filed under.
        throw new Error(`VaultSyncService: manifest ${dto.manifestId} is unlocked by the account key hierarchy, but this session holds no key for it, refusing to assemble.`);
      }
      return accountKeyVek;
    }

    if (keyType !== ManifestKeyType.GrantKey) {
      throw new Error(`VaultSyncService: manifest ${dto.manifestId} states an unknown key type "${keyType}" (newer server?), refusing to assemble.`);
    }

    if (!personalManifest) {
      throw new Error(`VaultSyncService: manifest ${dto.manifestId} is opened through a grant, but no personal manifest is open to resolve the private key from, refusing to assemble.`);
    }

    return this.resolveGrantedVek(personalManifest, dto);
  }

  /**
   * Decrypt the VEK the server granted the caller on a manifest.
   * @param personalManifest - the already-decrypted personal manifest, the durable home of rotated private keys
   * @param dto - the snapshot manifest carrying the grant
   */
  private async resolveGrantedVek(personalManifest: CodecManifest, dto: ManifestDto): Promise<string> {
    if (!dto.encryptedVek || !dto.encryptionPublicKey) {
      throw new Error(`VaultSyncService: shared manifest ${dto.manifestId} carries no grant to open it with, refusing to assemble.`);
    }

    /*
     * The algorithm, not the key type, decides how the ciphertext opens: a grant encrypted under an algorithm we
     * do not implement would otherwise be handed to an RSA-OAEP decrypt that cannot possibly be right. A server
     * predating the field says nothing, and back then every grant was RSA-OAEP.
     */
    const algorithm = dto.algorithm ?? VaultKeyAlgorithm.RsaOaepSha256;
    if (algorithm !== VaultKeyAlgorithm.RsaOaepSha256) {
      throw new Error(`VaultSyncService: shared manifest ${dto.manifestId} grants its VEK under an unsupported algorithm "${algorithm}" (newer server?), refusing to assemble.`);
    }

    const privateKeyJwk = await this.resolvePrivateKeyJwk(personalManifest, dto.encryptionPublicKey);
    if (!privateKeyJwk) {
      throw new Error(`VaultSyncService: no private key in this vault opens the grant on shared manifest ${dto.manifestId}, refusing to assemble.`);
    }

    try {
      return await SharingService.decryptManifestVek(dto.encryptedVek, privateKeyJwk);
    } catch (e) {
      throw new Error(`VaultSyncService: failed to decrypt the VEK of shared manifest ${dto.manifestId}, refusing to assemble. Underlying: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Resolve the user's asymmetric private key (JWK string) for decrypting a shared manifest's VEK.
   * @param personalManifest - the decrypted personal manifest
   * @param encryptionPublicKey - the public key the grant's VEK was encrypted with
   */
  private async resolvePrivateKeyJwk(personalManifest: CodecManifest, encryptionPublicKey: string): Promise<string | null> {
    const accountPublicKey = await VaultKeyService.getAccountPublicKey();
    if (accountPublicKey === encryptionPublicKey) {
      const sessionPrivateKey = await VaultKeyService.getSessionAccountPrivateKey();
      if (sessionPrivateKey) {
        return sessionPrivateKey;
      }
    }

    const keyRow = await vaultCodecExtractEncryptionKeyForPublicKey(personalManifest, encryptionPublicKey);
    return typeof keyRow?.PrivateKey === 'string' ? keyRow.PrivateKey : null;
  }

  /**
   * Build a VaultResponse from a (already-encrypted) SQLite blob + the snapshot's email-routing block.
   * @param encryptedBlob - encrypted SQLite blob to store under local:encryptedVault
   * @param version - data-model version string
   * @param revision - unified content revision number
   * @param snapshot - the source snapshot (for the email-routing lists)
   */
  private buildResponse(encryptedBlob: string, version: string, revision: number, snapshot: GetResponseDto): VaultResponse {
    const er = snapshot.emailRouting ?? {};
    return {
      status: 0,
      vault: {
        blob: encryptedBlob,
        version,
        currentRevisionNumber: revision,
        encryptionPublicKey: '',
        credentialsCount: 0,
        publicEmailDomainList: er.publicEmailDomainList ?? [],
        privateEmailDomainList: er.privateEmailDomainList ?? [],
        hiddenPrivateEmailDomainList: er.hiddenPrivateEmailDomainList ?? [],
        emailAddressList: er.emailAddressList ?? [],
        createdAt: '',
        updatedAt: '',
        username: '',
      },
    } as unknown as VaultResponse;
  }

  /**
   * Canonicalize the current SQLite vault, validate, encrypt, and POST /v2/Vault. The write is as narrow as
   * possible: content-fingerprint gating keeps every manifest and bucket whose canonical content still matches
   * its last-known server state OUT of the write, so a credential edit uploads the personal manifest alone and a
   * shared-manifest edit uploads that manifest alone. Only blobs the server doesn't
   * already have are encrypted and pre-uploaded (in size-capped batches) before the manifest POST, so a routine
   * save of a vault with hundreds of attachments uploads kilobytes, not the whole blob set. If the manifest POST
   * reports missing blobs still missing (stale local knowledge, e.g. server-side GC), the missing bytes are uploaded
   * and the POST retried once.
   * @param sqliteClient - the in-memory SQLite the user has been editing
   * @param vek - the symmetric encryption key (on a KEK/VEK migration push this is the password-derived key,
   *   which becomes the KEK; on a normal push it is the VEK itself)
   * @param username - the user's username (sent in the upload payload for cross-check)
   * @param options - set createVaultKey to perform the KEK/VEK migration as part of this push (decided once, in
   *   handleUploadVault); set forceFullWrite to bypass the content-fingerprint gating and rewrite every manifest
   *   and bucket, for when the fingerprints cannot be trusted to describe the server's state
   * @returns Push outcome.
   */
  public async push(
    sqliteClient: SqliteClient,
    vek: string,
    username: string,
    options?: { createVaultKey?: boolean; forceFullWrite?: boolean }
  ): Promise<PushResult> {
    return withOutdatedServerGuard(() => this.pushInternal(sqliteClient, vek, username, options));
  }

  /**
   * The push implementation; {@link push} wraps it with the outdated-server guard.
   * @param sqliteClient - the in-memory SQLite the user has been editing
   * @param vek - the symmetric encryption key
   * @param username - the user's username
   * @param options - see {@link push}
   */
  private async pushInternal(
    sqliteClient: SqliteClient,
    vek: string,
    username: string,
    options?: { createVaultKey?: boolean; forceFullWrite?: boolean }
  ): Promise<PushResult> {
    /*
     * Nothing is written while the vault holds manifests this session cannot write: those rows would be dropped
     * from the write rather than fail it. Reported as outdated, which is the status that sends the caller back
     * through a sync — and the sync pulls, which is what puts the grants and the vault back in step.
     */
    const unwritable = await this.findUnwritableManifests(sqliteClient);
    if (unwritable.length > 0) {
      devWarn(`[V2Push] Vault holds rows for manifest(s) this session cannot write (${unwritable.join(', ')}); refusing the write until a pull restores them.`);
      return { status: 'outdated', reasons: [`Manifest(s) ${unwritable.join(', ')} are not open to this session`] };
    }

    const migration: LegacyAccountKeyMigration | null = options?.createVaultKey === true ? await prepareLegacyAccountKeyMigration(vek) : null;
    const contentKey = migration?.contentKey ?? vek;
    if (migration) {
      devLog('[V2Push] Account-key migration: generated new VEK, AK and account keypair; vault content and all blobs will be re-encrypted and re-uploaded.');
    }

    // 1) Canonicalize, reusing the pre-push no-op check's result when it is still current (same client instance, no mutations since).
    const currentMutationSequence = ((await storage.getItem(StorageKeys.MUTATION_SEQUENCE)) as number | null) ?? 0;
    const cachedSet = (canonicalizeCache && canonicalizeCache.client === sqliteClient && canonicalizeCache.mutationSequence === currentMutationSequence) ? canonicalizeCache : null;
    if (cachedSet) {
      devLog('[V2Push] Reusing the canonicalize result from the pre-push no-op check.');
    }
    const { canonicalized, manifestRecords } = cachedSet ?? await this.canonicalizeVault(sqliteClient);
    // Personal manifest first by construction (see `resolveManifestRecords`), which is also the order canonicalize requires.
    const [personalRecord, ...sharedRecords] = manifestRecords;
    const privateEmailDomains = (await getStorageItem<string[]>(StorageKeys.PRIVATE_EMAIL_DOMAINS)) ?? [];
    const emailRouting = buildEmailRouting(canonicalized.manifests.map(m => m.manifest), privateEmailDomains);

    /*
     * Debug: manifest-set summary + full unencrypted manifests + data buckets, inspectable in the console.
     * TODO: delete the unencrypted-content logs below before release: they print plaintext vault data.
     */
    const canonicalizedBuckets = canonicalized.dataBuckets;
    devLog(`[V2Push] Canonicalize produced ${canonicalized.manifests.length} manifest(s) + ${canonicalizedBuckets.length} data bucket(s).`);
    devLog(`[V2Push] Unencrypted data buckets (${canonicalizedBuckets.length}):`, canonicalizedBuckets);
    for (const { manifest } of canonicalized.manifests) {
      const isPersonal = manifest.manifestId === personalRecord.manifestId;
      devLog(`[V2Push] Unencrypted ${isPersonal ? 'personal manifest' : `manifest "${manifest.name ?? manifest.manifestId}"`}: tables: ${Object.entries(manifest.tables).map(([t, rows]) => `${t}=${rows.length}`).join(', ')}`, manifest);
    }

    /*
     * 2) Content-fingerprint gating: compare every canonicalized target (each manifest below, each data bucket)
     * against the fingerprint of its last-known server state and only write the targets that actually changed. A
     * missing baseline means "server state unknown" and always writes. Two cases force a blanket write: a KEK/VEK
     * migration re-keys the personal manifest and all buckets (their ciphertext must be re-encrypted with the new VEK
     * even when the content is unchanged), and forceFullWrite rewrites everything for a caller that knows the
     * fingerprints no longer describe what the server holds.
     */
    const forceFullWrite = options?.forceFullWrite === true;
    const fingerprints = await this.loadContentFingerprints();

    const storedRevisions = await getManifestRevisions();
    const recordByManifestId = new Map(manifestRecords.map(r => [r.manifestId, r]));
    const candidates: PushManifest[] = canonicalized.manifests.flatMap(({ manifest, blobs }): PushManifest[] => {
      const record = recordByManifestId.get(manifest.manifestId);
      if (!record) {
        return [];
      }
      return [{
        manifestId: record.manifestId,
        isPersonal: record.isPersonal,
        manifest,
        vek: record.vek ?? contentKey,
        blobs,
        currentRevision: storedRevisions[record.manifestId] ?? 0,
      }];
    });

    // Set up the blob entries for the write.
    const blobEntries = new Map<string, UploadBlobEntry>();
    for (const candidate of candidates) {
      for (const [hash, blob] of Object.entries(candidate.blobs)) {
        if (blobEntries.has(hash)) {
          continue;
        }
        blobEntries.set(hash, { kind: blob.kind as 'favicon' | 'attachment', bytes: VaultCodec.base64ToBytes(blob.bytesBase64), vek: candidate.vek, fromPersonal: candidate.isPersonal });
      }
    }

    /*
     * Pack + encrypt each changed data bucket, carrying the client's believed-current revision so each bucket
     * participates in the same all-or-nothing revision gate as the manifests. Unchanged buckets are skipped
     * (unless the write is forced, see the gating comment above).
     */
    const bucketDtos: Array<{ manifestId: string; category: string; blob: string; ciphertextHash: string; currentRevision: number }> = [];
    const writtenBucketFingerprints: Record<string, string> = {};
    const storedBucketRevisions = await this.loadBucketRevisions();
    const keyByManifestId = new Map(candidates.map(candidate => [candidate.manifestId, candidate.vek]));
    for (const bucket of canonicalizedBuckets) {
      const label = `Data bucket "${bucket.category}" of manifest ${bucket.manifestId}`;
      const fingerprintKey = fingerprintBucketKey(bucket.manifestId, bucket.category);
      const bucketPlaintext = JSON.stringify(bucket);
      const bucketFingerprint = await vaultCodecComputeContentFingerprint(bucketPlaintext);
      if (!forceFullWrite && !migration && fingerprints[fingerprintKey] === bucketFingerprint) {
        devLog(`[V2Push] ${label} unchanged versus server baseline, leaving it out of this write.`);
        continue;
      }

      // A bucket is encrypted with the key of the manifest that owns it.
      const bucketKey = keyByManifestId.get(bucket.manifestId);
      if (!bucketKey) {
        devWarn(`[V2Push] ${label} names a manifest this vault cannot write; leaving it out of this write.`);
        continue;
      }

      const bucketValidation = await vaultCodecValidateDataBucket(bucket);
      if (!bucketValidation.ok) {
        return {
          status: 'rejected',
          reasons: [`${label} validation failed: ${bucketValidation.failedRules.join(', ')}. ${bucketValidation.message}`.trim()],
        };
      }

      const { ciphertext, compressedBytes } = await packEncrypt(bucketPlaintext, bucketKey);
      const ciphertextHash = await vaultCodecComputeCiphertextHash(ciphertext);
      const currentRevision = storedBucketRevisions[bucketRevisionKey(bucket.manifestId, bucket.category)] ?? 0;
      bucketDtos.push({ manifestId: bucket.manifestId, category: bucket.category, blob: ciphertext, ciphertextHash, currentRevision });
      writtenBucketFingerprints[fingerprintKey] = bucketFingerprint;
      devLog(`[V2Push] ${label}: raw ${formatKb(bucketPlaintext.length)} → compressed ${formatKb(compressedBytes)} → encrypted ${formatKb(ciphertext.length)}.`);
    }

    /*
     * Gate, validate, pack and encrypt every candidate manifest into the write batch, each with its own VEK. An
     * unchanged manifest is skipped entirely: that avoids re-uploading it and keeps its (possibly stale) revision
     * out of the all-or-nothing gate, so another member's update to a shared folder can't fail an unrelated write.
     */
    const manifestWrites: ManifestWriteDto[] = [];
    const writtenManifestFingerprints: Record<string, string> = {};
    for (const candidate of candidates) {
      const label = candidate.isPersonal ? 'Personal manifest' : `Shared manifest "${candidate.manifest.name ?? candidate.manifestId}"`;
      const plaintext = await timedStage(`stringify-manifest ${candidate.manifestId}`, () => JSON.stringify(candidate.manifest));
      const fingerprint = await vaultCodecComputeContentFingerprint(plaintext);

      /*
       * A KEK/VEK migration re-keys the personal manifest and all buckets (their ciphertext must be re-encrypted with
       * the new VEK even when the content is unchanged) but not the shared manifests, which keep their own VEK.
       */
      if (!forceFullWrite && !(migration && candidate.isPersonal) && fingerprints[fingerprintManifestKey(candidate.manifestId)] === fingerprint) {
        devLog(`[V2Push] ${label} unchanged versus server baseline, leaving it out of this write.`);
        continue;
      }

      const validation = await timedStage(`validate-manifest ${candidate.manifestId} (incl. JS→Rust conversion)`, () => vaultCodecValidateManifest(candidate.manifest));
      if (!validation.ok) {
        if (candidate.isPersonal) {
          return {
            status: 'rejected',
            reasons: [`Manifest validation failed: ${validation.failedRules.join(', ')}. ${validation.message}`.trim()],
          };
        }
        devWarn(`[V2Push] ${label} failed validation (${validation.failedRules.join(', ')}), dropping it from this write.`);
        continue;
      }

      const { ciphertext, compressedBytes } = await packEncrypt(plaintext, candidate.vek);
      const ciphertextHash = await vaultCodecComputeCiphertextHash(ciphertext);
      devLog(`[V2Push] ${label}: raw ${formatKb(plaintext.length)} → compressed ${formatKb(compressedBytes)} → encrypted ${formatKb(ciphertext.length)}.`);

      manifestWrites.push({
        manifestId: candidate.manifestId,
        manifestBlob: ciphertext,
        manifestCiphertextHash: ciphertextHash,
        currentRevision: candidate.currentRevision,
        credentialsCount: (candidate.manifest.tables.Items ?? []).length,
        blobReferences: Object.entries(candidate.blobs).map(([hash, blob]) => ({ hash, category: blob.kind })),
        /*
         * Set only on the KEK/VEK migration push, where the server creates the vault key alongside this personal-manifest revision.
         * A migration always forces a personal-manifest write (see the gate above), so the key can never be stranded without one.
         */
        ...(candidate.isPersonal && migration ? { encryptedVek: migration.encryptedVek } : {}),
      });
      writtenManifestFingerprints[candidate.manifestId] = fingerprint;
    }

    /*
     * Nothing changed versus the server baselines: skip the write (and the blob diff) entirely. Reachable when a
     * mutation was recorded but produced no canonical content change (e.g. an edit reverted to the original value).
     */
    if (manifestWrites.length === 0 && bucketDtos.length === 0) {
      devLog('[V2Push] No content changes detected (every manifest and data bucket matches the server baselines); skipping upload.');
      return { status: 'ok' };
    }

    /*
     * 4) Blob diff across the personal manifest and every shared manifest in this write: only encrypt + upload blobs the
     * server doesn't already have. On a KEK/VEK migration all personal-manifest blobs are re-encrypted with the new VEK and
     * overwritten in place; shared-manifest blobs keep their own (unchanged) VEK and only fill genuine gaps.
     */
    const webApi = new WebApiService();
    const personalHashes = Array.from(blobEntries).filter(([, entry]) => entry.fromPersonal).map(([hash]) => hash);
    const sharedHashes = Array.from(blobEntries).filter(([, entry]) => !entry.fromPersonal).map(([hash]) => hash);
    const allBlobHashes = Array.from(blobEntries.keys());
    const knownServerHashes = new Set(((await storage.getItem(StorageKeys.VAULT_SERVER_BLOB_HASHES)) as string[] | null) ?? []);

    let personalToUpload: string[] = [];
    let sharedToUpload: string[] = [];
    if (migration) {
      personalToUpload = personalHashes;
      const sharedCandidates = sharedHashes.filter(h => !knownServerHashes.has(h));
      if (sharedCandidates.length > 0) {
        const missingResp = await webApi.post<{ hashes: string[] }, MissingBlobsResponseDto>(BLOBS_MISSING_ENDPOINT, { hashes: sharedCandidates });
        sharedToUpload = missingResp.missing ?? [];
      }
    } else {
      const uploadCandidates = allBlobHashes.filter(h => !knownServerHashes.has(h));
      let toUpload: string[] = [];
      if (uploadCandidates.length > 0) {
        const missingResp = await webApi.post<{ hashes: string[] }, MissingBlobsResponseDto>(BLOBS_MISSING_ENDPOINT, { hashes: uploadCandidates });
        toUpload = missingResp.missing ?? [];
      }
      const toUploadSet = new Set(toUpload);
      personalToUpload = personalHashes.filter(h => toUploadSet.has(h));
      sharedToUpload = sharedHashes.filter(h => toUploadSet.has(h));
    }

    devLog(`[V2Push] Blob diff: ${allBlobHashes.length} blobs across ${candidates.length} manifest(s), uploading ${personalToUpload.length} personal + ${sharedToUpload.length} shared${migration ? ' (personal manifest re-encrypted, VEK migration)' : ''}.`);

    // Pre-upload the missing bytes so the write below carries references only; each staged entry carries its own key.
    const uploadedCiphertexts = await this.uploadBlobs(webApi, blobEntries, personalToUpload, migration !== null);
    for (const [hash, ciphertext] of await this.uploadBlobs(webApi, blobEntries, sharedToUpload)) {
      uploadedCiphertexts.set(hash, ciphertext);
    }

    /*
     * Publish the public half of the vault's active personal keypair, which is e.g. used by SMTP services to encrypt mail for personal aliases.
     */
    const primaryKey = sqliteClient.encryptionKeys.getPrimary();

    /*
     * Publish the public half of each shared manifest's email keypair that this user administers, which is e.g. used by SMTP services to encrypt
     * mail for the manifest's aliases. Only an admin of the owning group publishes: the server records the delivery key per manifest, so a plain
     * member publishing too would leave it ambiguous which row is the manifest's active key. Members still *claim* shared aliases (below). They
     * just resolve the key the admin published.
     */
    const sharedManifestEncryptionPublicKeys: Array<{ manifestId: string; publicKey: string }> = [];
    for (const record of sharedRecords) {
      if (!record.canAdminister) {
        continue;
      }
      const manifestKey = sqliteClient.encryptionKeys.getActiveForManifest(record.manifestId);
      if (manifestKey) {
        sharedManifestEncryptionPublicKeys.push({ manifestId: record.manifestId, publicKey: manifestKey.PublicKey });
      } else {
        /*
         * Sharing a folder mints its keypair in the same vault mutation, so an owned shared manifest without one
         * means that mutation was interrupted after the manifest was created server-side. Aliases in its subtree
         * stay personal (readable by the owner only) until sharing is toggled again.
         */
        devWarn(`[V2Push] Shared manifest ${record.manifestId} is missing its email keypair; its aliases stay personal until sharing is re-enabled.`);
      }
    }

    const payload = {
      username,
      manifests: manifestWrites,
      buckets: bucketDtos,
      newBlobs: [] as BlobDto[],
      emailRouting,
      userEncryptionPublicKey: primaryKey?.PublicKey ?? '',
      sharedManifestEncryptionPublicKeys,
      // LEGACY: only the one-time KEK/VEK migration push carries a key hierarchy for the server to store.
      accountKeys: migration?.accountKeys ?? null,
    };

    let resp = await webApi.post<typeof payload, VaultWriteResponseDto>(VAULT_ENDPOINT, payload);

    if (resp.missingBlobHashes && resp.missingBlobHashes.length > 0) {
      /*
       * Our local knowledge of the server's blob set was stale (e.g. the server GC'd a blob between syncs).
       * Upload the bytes it asked for (each with its correct key) and retry the write once. Nothing was committed
       * (all-or-nothing), so the retry sends the identical payload.
       */
      const unsatisfiable = resp.missingBlobHashes.filter(h => !blobEntries.has(h));
      if (unsatisfiable.length > 0) {
        return { status: 'missing-blobs', reasons: unsatisfiable };
      }

      devWarn(`[V2Sync] Server reported ${resp.missingBlobHashes.length} missing blob(s); uploading and retrying once.`);
      const retriedPersonal = await this.uploadBlobs(webApi, blobEntries, resp.missingBlobHashes.filter(h => blobEntries.get(h)?.fromPersonal === true), migration !== null);
      const retriedShared = await this.uploadBlobs(webApi, blobEntries, resp.missingBlobHashes.filter(h => blobEntries.get(h)?.fromPersonal === false));
      for (const [hash, ciphertext] of [...retriedPersonal, ...retriedShared]) {
        uploadedCiphertexts.set(hash, ciphertext);
      }

      resp = await webApi.post<typeof payload, VaultWriteResponseDto>(VAULT_ENDPOINT, payload);
      if (resp.missingBlobHashes && resp.missingBlobHashes.length > 0) {
        return { status: 'missing-blobs', reasons: resp.missingBlobHashes };
      }
    }

    if (resp.status !== 0) {
      // All-or-nothing: a single stale manifest or bucket rejected the whole write; the orchestrator pulls/merges/retries.
      return { status: 'outdated' };
    }

    // 5) Update local persisted state on success.
    if ((resp.bucketRevisions ?? []).length > 0) {
      const bucketRevisions = await this.loadBucketRevisions();
      for (const br of resp.bucketRevisions) {
        bucketRevisions[bucketRevisionKey(br.manifestId, br.category)] = br.revision;
      }
      await storage.setItem(StorageKeys.VAULT_BUCKET_REVISIONS, bucketRevisions);
    }

    // Advance the baseline of the manifests this write included.
    await recordManifestRevisions(toManifestRevisionMap(resp.manifestRevisions));

    /*
     * Record the new content baselines for every target this write actually carried, so the next push can skip
     * them again when unchanged. Targets left out of the write keep their existing baselines.
     */
    for (const [key, fingerprint] of Object.entries(writtenBucketFingerprints)) {
      fingerprints[key] = fingerprint;
    }
    for (const [manifestId, fingerprint] of Object.entries(writtenManifestFingerprints)) {
      fingerprints[fingerprintManifestKey(manifestId)] = fingerprint;
    }
    await this.saveContentFingerprints(fingerprints);

    // Every referenced hash is now known to be on the server, refresh the diff baseline.
    await storage.setItem(StorageKeys.VAULT_SERVER_BLOB_HASHES, allBlobHashes);

    /*
     * Refresh the encrypted blob cache: keep entries still referenced by the new manifests, add the ciphertexts we just uploaded.
     */
    const cache = await this.loadBlobCache();
    const newCache: Record<string, string> = {};
    for (const hash of allBlobHashes) {
      const ciphertext = uploadedCiphertexts.get(hash) ?? cache[hash];
      if (ciphertext) {
        newCache[hash] = ciphertext;
      }
    }
    await this.saveBlobCache(newCache);

    if (migration) {
      await completeLegacyAccountKeyMigration(migration);
      devLog('[V2Push] Account-key migration complete: hierarchy created server-side, blob chain cached locally.');
    }

    const uploadedBlobChars = Array.from(uploadedCiphertexts.values()).reduce((sum, c) => sum + c.length, 0);
    const bucketChars = bucketDtos.reduce((sum, b) => sum + b.blob.length, 0);
    const manifestChars = manifestWrites.reduce((sum, m) => sum + m.manifestBlob.length, 0);
    const totalChars = manifestChars + bucketChars + uploadedBlobChars;
    devLog(`[V2Push] Total pushed (encrypted): ${manifestWrites.length} manifest(s) ${formatKb(manifestChars)} + ${bucketDtos.length} buckets ${formatKb(bucketChars)} + ${uploadedCiphertexts.size} blobs ${formatKb(uploadedBlobChars)} = ${formatKb(totalChars)}.`);

    return { status: 'ok', newEncryptionKey: migration ? contentKey : undefined };
  }

  /**
   * Canonicalize the local vault into the manifest-v1 format against every manifest this vault writes, routing each
   * row into its own manifest by the ManifestId it carries.
   * @param sqliteClient - the in-memory SQLite database to canonicalize
   * @returns The canonicalized set plus the manifest records it was split against
   */
  private async canonicalizeVault(sqliteClient: SqliteClient, options?: { adoptUnstampedInto?: string | null }): Promise<CanonicalizedVaultSet> {
    // Read tables from the SQLite database and apply the manifest-v1 format rules.
    const tables = VaultCodec.readTables(sqliteClient);

    const manifestRecords = await this.resolveManifestRecords(sqliteClient);
    /*
     * Membership is the ManifestId stamp on each row (written by the repositories at insert, move and share time),
     * so a spec only has to name the manifest and supply its blob salt. The personal manifest goes first: the codec reads the
     * first spec as the manifest being written from, which is the routing key every row is matched against and
     * which keeps any table the registry does not scope per manifest.
     */
    const manifests: CodecManifestSpec[] = manifestRecords.map(r => ({ manifestId: r.manifestId, manifestSalt: r.salt, name: r.name }));

    const canonicalized = await timedStage('canonicalize (incl. Rust→JS conversion)', () => vaultCodecCanonicalizeFromSqlite({
      tables,
      canonicalizedAt: new Date().toISOString(),
      manifests,
      adoptUnstampedInto: options?.adoptUnstampedInto ?? null,
    }));

    return { canonicalized, manifestRecords };
  }

  /**
   * Whether the local vault is canonically identical to the last-known server state, meaning a push would be
   * skipped in its entirety by the content-fingerprint gating (a "no-op mutation", e.g. an entry opened for edit
   * and saved without changes). Runs the same canonicalize + fingerprint comparison the push runs and caches the
   * canonicalize result, so a push right after (the vault DID change) does not canonicalize a second time.
   * Returns false whenever the state cannot be proven unchanged: any changed or missing baseline, or a pending
   * KEK/VEK migration (which forces a blanket push regardless of content).
   * @param sqliteClient - the local vault
   * @param mutationSequence - the current mutation sequence; the cached canonicalize result is handed to the push only while this sequence is unchanged
   */
  public async detectNoOpMutation(sqliteClient: SqliteClient, mutationSequence: number): Promise<boolean> {
    const canonicalizedSet = await this.canonicalizeVault(sqliteClient);
    canonicalizeCache = { client: sqliteClient, mutationSequence, ...canonicalizedSet };

    const { canonicalized, manifestRecords } = canonicalizedSet;
    const fingerprints = await this.loadContentFingerprints();

    /*
     * Same join the push does (see the candidate list there): a manifest with no record is not pushed, so it
     * cannot make this push non-empty either.
     */
    const writableManifestIds = new Set(manifestRecords.map(r => r.manifestId));
    const manifests: CodecManifest[] = canonicalized.manifests.map(m => m.manifest).filter(m => writableManifestIds.has(m.manifestId));
    for (const manifest of manifests) {
      if (fingerprints[fingerprintManifestKey(manifest.manifestId)] !== await vaultCodecComputeContentFingerprint(JSON.stringify(manifest))) {
        return false;
      }
    }
    for (const bucket of canonicalized.dataBuckets) {
      if (fingerprints[fingerprintBucketKey(bucket.manifestId, bucket.category)] !== await vaultCodecComputeContentFingerprint(JSON.stringify(bucket))) {
        return false;
      }
    }

    return true;
  }

  /**
   * Single-data-bucket upload, for changes scoped to a separate data bucket and not touching any manifest. Goes
   * through the unified POST /v2/Vault write with an empty manifest list and one bucket; the server's all-or-nothing
   * revision gate reports the current bucket revision on conflict, which we rebase onto and retry once.
   * @param bucket - the new data bucket contents (its `manifestId` and `category` select the server bucket)
   * @param vek - the key of the manifest that owns the bucket
   * @param username - the user's username (the unified write cross-checks it against the auth session)
   */
  public async pushDataBucketOnly(bucket: VaultDataBucket, vek: string, username: string): Promise<{ status: 'ok' | 'outdated'; revision: number }> {
    return withOutdatedServerGuard(() => this.pushDataBucketOnlyInternal(bucket, vek, username));
  }

  /**
   * The bucket-only push implementation; {@link pushDataBucketOnly} wraps it with the outdated-server guard.
   * @param bucket - the new data bucket contents
   * @param vek - the key of the manifest that owns the bucket
   * @param username - the user's username
   */
  private async pushDataBucketOnlyInternal(bucket: VaultDataBucket, vek: string, username: string): Promise<{ status: 'ok' | 'outdated'; revision: number }> {
    const { manifestId, category } = bucket;
    const label = `Bucket "${category}" of manifest ${manifestId}`;
    const revisionKey = bucketRevisionKey(manifestId, category);

    const plaintext = JSON.stringify(bucket);

    // Same content-fingerprint gate as the full push: a mutation that ended up changing nothing skips the write.
    const fingerprints = await this.loadContentFingerprints();
    const bucketRevisions = await this.loadBucketRevisions();
    const bucketFingerprint = await vaultCodecComputeContentFingerprint(plaintext);
    if (fingerprints[fingerprintBucketKey(manifestId, category)] === bucketFingerprint) {
      devLog(`[V2Push] ${label} (bucket-only) unchanged versus server baseline, skipping upload.`);
      return { status: 'ok', revision: bucketRevisions[revisionKey] ?? 0 };
    }

    const { ciphertext, compressedBytes } = await packEncrypt(plaintext, vek);
    const ciphertextHash = await vaultCodecComputeCiphertextHash(ciphertext);
    devLog(`[V2Push] ${label} (bucket-only): raw ${formatKb(plaintext.length)} → compressed ${formatKb(compressedBytes)} → encrypted ${formatKb(ciphertext.length)}.`);

    const webApi = new WebApiService();
    /** POST the single-bucket write with the given believed-current revision (called again on the rebase retry). */
    const postBucket = (currentRevision: number): Promise<VaultWriteResponseDto> => webApi.post<Record<string, unknown>, VaultWriteResponseDto>(VAULT_ENDPOINT, {
      username, manifests: [], buckets: [{ manifestId, category, blob: ciphertext, ciphertextHash, currentRevision }], newBlobs: [], emailRouting: null, userEncryptionPublicKey: '',
    });

    /** This bucket's revision as the server reported it, matched on both halves of its address. */
    const reportedRevision = (resp: VaultWriteResponseDto): number | undefined =>
      (resp.bucketRevisions ?? []).find(b => manifestIdsEqual(b.manifestId, manifestId) && b.category === category)?.revision;

    let currentRevision = bucketRevisions[revisionKey] ?? 0;
    let resp = await postBucket(currentRevision);

    if (resp.status !== 0) {
      const serverRevision = reportedRevision(resp) ?? currentRevision;
      devWarn(`[V2Push] ${label} outdated (server at revision ${serverRevision}, we assumed ${currentRevision}); rebasing and retrying once.`);
      currentRevision = serverRevision;
      resp = await postBucket(currentRevision);
    }

    if (resp.status !== 0) {
      return { status: 'outdated', revision: reportedRevision(resp) ?? currentRevision };
    }

    const newRevision = reportedRevision(resp) ?? currentRevision + 1;
    bucketRevisions[revisionKey] = newRevision;
    await storage.setItem(StorageKeys.VAULT_BUCKET_REVISIONS, bucketRevisions);

    // New server baseline for this bucket, so an unchanged follow-up push (bucket-only or full) can skip it.
    fingerprints[fingerprintBucketKey(manifestId, category)] = bucketFingerprint;
    await this.saveContentFingerprints(fingerprints);

    return { status: 'ok', revision: newRevision };
  }

  /**
   * The key each manifest's data buckets are encrypted with: the personal VEK for the personal manifest,
   * and its own VEK for every shared manifest whose grant this session can unwrap.
   * @param sqliteClient - the open local vault, which holds the private keys the grants are unwrapped with
   * @param personalVek - the personal manifest's symmetric key
   * @returns manifest id → the key its buckets are written under
   */
  public async resolveBucketWriteKeys(sqliteClient: SqliteClient, personalVek: string): Promise<Map<string, string>> {
    const keys = new Map<string, string>([[await this.resolvePersonalManifestId(), personalVek]]);
    for (const [manifestId, vek] of await SharingService.openSharedManifestVeks(sqliteClient)) {
      keys.set(manifestId, vek);
    }
    return keys;
  }

  /**
   * The manifests the local vault holds rows for that this session cannot write: no grant recorded for them, or
   * one that will not unwrap.
   * @param sqliteClient - the open local vault
   * @returns The manifest ids the vault holds but this session cannot write, empty when the two agree
   */
  public async findUnwritableManifests(sqliteClient: SqliteClient): Promise<string[]> {
    return (await this.partitionManifestAccess(sqliteClient, [])).unwritable;
  }

  /**
   * Split what the vault holds against what this account may still open.
   * @param sqliteClient - the open local vault
   * @param grantedManifestIds - the manifests the last snapshot served, empty when that is not being asked
   */
  private async partitionManifestAccess(sqliteClient: SqliteClient, grantedManifestIds: Iterable<string>): Promise<SharingAccessPartition> {
    const writable = [...(await SharingService.openSharedManifestVeks(sqliteClient)).keys()];

    const personalManifestId = await getPersonalManifestId();
    if (personalManifestId) {
      writable.push(personalManifestId);
    }

    return vaultSharingPartitionManifestAccess({
      manifestIdsInVault: [...VaultCodec.manifestIdsInVault(sqliteClient)],
      writableManifestIds: writable,
      grantedManifestIds: [...grantedManifestIds],
    });
  }

  /**
   * The manifests the last snapshot served this account. This is what the account may still open.
   * @returns The served manifest ids, empty when nothing has been pulled in this session
   */
  public manifestIdsServedByLastSnapshot(): string[] {
    return [...this.lastServedManifestIds];
  }

  /**
   * Drop the rows of every manifest the server no longer serves this account.
   * @param sqliteClient - the open local vault, mutated in place
   * @param grantedManifestIds - the manifests the snapshot last served
   * @returns The manifest ids whose rows were dropped, empty when there was nothing to drop
   */
  public async dropRowsOfManifestsNoLongerServed(sqliteClient: SqliteClient, grantedManifestIds: Iterable<string>): Promise<string[]> {
    const { lost } = await this.partitionManifestAccess(sqliteClient, grantedManifestIds);
    if (lost.length === 0) {
      return [];
    }

    for (const table of VaultCodec.stampedTables(sqliteClient)) {
      for (const manifestId of lost) {
        sqliteClient.executeUpdate(`DELETE FROM "${table}" WHERE lower(ManifestId) = ?`, [manifestIdKey(manifestId)]);
      }
    }

    devWarn(`[VaultSync] Dropped the rows of manifest(s) this account no longer holds (${lost.join(', ')}); they are gone from the server for this account.`);
    return lost;
  }

  /**
   * Resolve every manifest this vault can write, personal manifest first, as one uniform list.
   *
   * The core decides which, so a second client cannot arrive at a different write set. It is told which
   * manifests opened, never what they opened with.
   * @param sqliteClient - the open local vault
   */
  private async resolveManifestRecords(sqliteClient: SqliteClient): Promise<ManifestRecord[]> {
    let manifestSalt = (await storage.getItem(StorageKeys.VAULT_MANIFEST_SALT)) as string | null;
    if (!manifestSalt) {
      manifestSalt = await vaultCodecGenerateManifestSalt();
      await storage.setItem(StorageKeys.VAULT_MANIFEST_SALT, manifestSalt);
    }

    const sharedVeks = await SharingService.openSharedManifestVeks(sqliteClient);
    const writeSet = await vaultSharingResolveManifestWriteSet({
      personalManifestId: await this.resolvePersonalManifestId(),
      personalManifestSalt: manifestSalt,
      stampedManifestIds: [...VaultCodec.manifestIdsInVault(sqliteClient)],
      openedManifestIds: [...sharedVeks.keys()],
      heldRecords: Object.values(await SharingService.getSharedManifestRecords()),
      displayNames: multiManifestRendering.displayNames(sqliteClient),
    });

    for (const skipped of writeSet.skipped) {
      const why = skipped.reason === 'NO_ROWS_IN_VAULT'
        ? 'has no rows in this vault; leaving it out of the write rather than emptying it server-side'
        : 'did not open; leaving it out of the write';
      devLog(`[V2Push] Shared manifest ${skipped.manifestId} ${why}.`);
    }

    // Re-attach the keys. Without one a shared manifest falls back to the personal key downstream, so assert it.
    const vekByManifestId = new Map([...sharedVeks].map(([manifestId, vek]) => [manifestIdKey(manifestId), vek]));
    return writeSet.records.map(record => {
      const vek = record.isPersonal ? null : vekByManifestId.get(manifestIdKey(record.manifestId)) ?? null;
      if (!record.isPersonal && !vek) {
        throw new Error(`VaultSyncService: manifest ${record.manifestId} is in the write set without a key, refusing to write it.`);
      }
      return { ...record, vek };
    });
  }

  /**
   * The id of this vault's own (personal) manifest, as reported by the server on the last pull. Pushing without it
   * is impossible: it addresses the write and keys the revision the write rebases on.
   */
  private async resolvePersonalManifestId(): Promise<string> {
    const personalManifestId = await getPersonalManifestId();
    if (!personalManifestId) {
      throw new Error('VaultSyncService: no personal manifest id available (no snapshot baseline recorded); pull once before pushing.');
    }
    return personalManifestId;
  }

  /**
   * Encrypt the given blobs (each staged with its own VEK: the personal VEK or a folder VEK) and upload them via
   * POST /v2/Vault/blobs in size-capped batches. `overwrite` is set only for personal-manifest blobs on a KEK/VEK migration;
   * shared-manifest blobs keep their own VEK across a migration, so their ciphertext is never re-keyed.
   * @param webApi - API client to reuse
   * @param entries - hash → staged blob for every candidate (hashes without an entry are skipped)
   * @param hashes - the subset of hashes to upload
   * @param overwrite - ask the server to replace the ciphertext of blobs it already has (KEK/VEK migration)
   * @returns Map of hash → uploaded ciphertext (base64), for the local encrypted blob cache.
   */
  private async uploadBlobs(webApi: WebApiService, entries: Map<string, UploadBlobEntry>, hashes: string[], overwrite: boolean = false): Promise<Map<string, string>> {
    const ciphertexts = new Map<string, string>();
    if (hashes.length === 0) {
      return ciphertexts;
    }

    let batch: BlobDto[] = [];
    let batchChars = 0;
    for (const hash of hashes) {
      const entry = entries.get(hash);
      if (!entry) {
        continue;
      }

      const ciphertext = await this.encryptBlobBytes(entry.bytes, entry.vek);
      ciphertexts.set(hash, ciphertext);
      devLog(`[V2Push] Blob ${hash.substring(0, 12)}… (${entry.kind}): raw ${formatKb(entry.bytes.length)} → encrypted ${formatKb(ciphertext.length)}.`);

      // Flush before adding when this blob would take the request past either bound.
      if (batch.length > 0 && (batchChars + ciphertext.length > BLOB_TRANSFER_BATCH_MAX_CHARS || batch.length >= BLOB_TRANSFER_BATCH_MAX_COUNT)) {
        devLog(`[V2Push] Uploading blob batch: ${batch.length} blobs, ${formatKb(batchChars)}.`);
        await webApi.post(BLOBS_VAULT_ENDPOINT, { blobs: batch, overwrite });
        batch = [];
        batchChars = 0;
      }

      batch.push({ hash, category: entry.kind, encryptedDataBase64: ciphertext });
      batchChars += ciphertext.length;
    }

    if (batch.length > 0) {
      devLog(`[V2Push] Uploading blob batch: ${batch.length} blobs, ${formatKb(batchChars)}.`);
      await webApi.post(BLOBS_VAULT_ENDPOINT, { blobs: batch, overwrite });
    }

    return ciphertexts;
  }

  /**
   * Encrypt raw blob bytes with the VEK. Result is base64-of-(IV | ciphertext | tag).
   * @param bytes - plaintext bytes
   * @param vek - symmetric encryption key
   */
  private async encryptBlobBytes(bytes: Uint8Array, vek: string): Promise<string> {
    return EncryptionUtility.symmetricEncryptBytes(bytes, vek);
  }

  /**
   * Decrypt a blob ciphertext (base64) and return raw plaintext bytes. Counterpart of {@link encryptBlobBytes}.
   * @param encryptedDataBase64 - base64 IV | ciphertext | tag from the server
   * @param vek - symmetric encryption key
   */
  private async decryptBlobToBytes(encryptedDataBase64: string, vek: string): Promise<Uint8Array> {
    return EncryptionUtility.symmetricDecryptBytes(base64ToBytes(encryptedDataBase64), vek);
  }

  /**
   * Load the per-target content-fingerprint baselines (see {@link StorageKeys.VAULT_CONTENT_FINGERPRINTS}).
   */
  private async loadContentFingerprints(): Promise<Record<string, string>> {
    return ((await storage.getItem(StorageKeys.VAULT_CONTENT_FINGERPRINTS)) as Record<string, string> | null) ?? {};
  }

  /**
   * Persist the per-target content-fingerprint baselines.
   * @param fingerprints - fingerprint record to persist
   */
  private async saveContentFingerprints(fingerprints: Record<string, string>): Promise<void> {
    await storage.setItem(StorageKeys.VAULT_CONTENT_FINGERPRINTS, fingerprints);
  }

  /**
   * Load the known server revision of every data bucket, keyed by {@link bucketRevisionKey}. An absent entry
   * reads as revision 0, which the server answers with its current one so the next attempt rebases.
   */
  private async loadBucketRevisions(): Promise<Record<string, number>> {
    return ((await storage.getItem(StorageKeys.VAULT_BUCKET_REVISIONS)) as Record<string, number> | null) ?? {};
  }

  /**
   * Load the local encrypted blob cache (hash → base64 ciphertext) used to skip re-downloading known blobs.
   * Entries are stored as served to/from the server, so nothing in the cache is plaintext at rest.
   */
  private async loadBlobCache(): Promise<Record<string, string>> {
    return ((await storage.getItem(StorageKeys.VAULT_BLOB_CIPHER_CACHE)) as Record<string, string> | null) ?? {};
  }

  /**
   * Persist the local encrypted blob cache (hash → base64 ciphertext).
   * @param cache - cache to persist
   */
  private async saveBlobCache(cache: Record<string, string>): Promise<void> {
    await storage.setItem(StorageKeys.VAULT_BLOB_CIPHER_CACHE, cache);
  }

}

export const vaultSyncService = new VaultSyncService();
