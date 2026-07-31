/**
 * VaultSyncService.
 *
 * Handles syncing the vault with the server and interfaces with the Rust codec.
 */

import { storage } from 'wxt/utils/storage';

import { bucketRevisionStorageKey, StorageKeys } from '@/utils/constants/storageKeys';
import { devError, devLog, devWarn } from '@/utils/devLogger/DevLogger';
import { VaultDataBucketCategory } from '@/utils/dist/core/models/vault';
import type { VaultResponse } from '@/utils/dist/core/models/webapi';
import { VaultSqlGenerator } from '@/utils/dist/core/vault';
import { EncryptionUtility } from '@/utils/EncryptionUtility';
import {vaultCodecComputeCiphertextHash, vaultCodecComputeContentFingerprint, vaultCodecCanonicalizeFromSqlite, vaultCodecExtractEncryptionKeyForPublicKeyFromBucket, vaultCodecGenerateUserSalt, vaultCodecUnpackPayload, vaultCodecMaterializeAsSqlite, vaultCodecPackPayload, vaultCodecValidateManifest, vaultCodecValidateDataBucket, type CodecCanonicalized, type CodecSharedFolderSpec} from '@/utils/RustCore';
import { SharingService, type SessionSharedFolder } from '@/utils/SharingService';
import { SqliteClient } from '@/utils/SqliteClient';
import { ServerUpdateRequiredError } from '@/utils/types/errors/ServerUpdateRequiredError';
import { VaultProcessingError } from '@/utils/types/errors/VaultProcessingError';
import { type VaultManifest, type VaultDataBucket, VaultCodec } from '@/utils/VaultCodec';
import { WebApiService } from '@/utils/WebApiService';

const VAULT_ENDPOINT = 'Vault';
const BLOBS_VAULT_ENDPOINT = 'Vault/blobs';
const BLOBS_MISSING_ENDPOINT = 'Vault/blobs/missing';
const BLOBS_DOWNLOAD_ENDPOINT = 'Vault/blobs/download';

/**
 * True when an error from WebApiService is an HTTP 404. WebApiService surfaces non-2xx responses as a generic
 * Error whose message carries the status code (`HTTP error! status: 404`). A 404 on a v2 endpoint means the
 * server does not support the v2 API (outdated self-hosted install), surfaced as {@link ServerUpdateRequiredError}.
 * @param e - the caught error
 */
function isNotFoundError(e: unknown): boolean {
  return e instanceof Error && e.message.includes('status: 404');
}

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
  const encryptedBytes = Uint8Array.from(atob(base64Ciphertext), c => c.charCodeAt(0));
  const plainBytes = await EncryptionUtility.symmetricDecryptBytes(encryptedBytes, vek);
  return vaultCodecUnpackPayload(plainBytes);
}

const FINGERPRINT_ROOT_KEY = 'root';
/** Fingerprint record key for a non-root (shared-folder) manifest. */
const fingerprintManifestKey = (manifestId: string): string => `manifest:${manifestId}`;
/** Fingerprint record key for a data bucket. */
const fingerprintBucketKey = (category: string): string => `bucket:${category}`;

/** Max accumulated base64 ciphertext characters per POST /v2/Vault/blobs call (~4 MB request body). */
const BLOB_UPLOAD_BATCH_MAX_CHARS = 4 * 1024 * 1024;
/** Hashes per POST /v2/Vault/blobs/download call. */
const BLOB_DOWNLOAD_BATCH_SIZE = 100;

/**
 * Result of a pull: the materialized SQLite plus its manifest revision.
 */
type PullResult = {
  sqliteBase64: string;
  manifestRevision: number;
};

/**
 * Result of a push.
 */
export type PushResult = {
  status: 'ok' | 'outdated' | 'missing-blobs' | 'rejected';
  newManifestRevision: number | null;
  reasons?: string[];
  /**
   * Set when this push performed the KEK/VEK migration: the freshly generated VEK the caller must adopt as the
   * session encryption key (the old password-derived key is now only the KEK).
   */
  newEncryptionKey?: string;
};

type BlobRefDto = { hash: string; category: string };
type BlobDto = { hash: string; category: string; encryptedDataBase64: string };

/** A plaintext blob staged for upload: its bytes plus the key that encrypts it (root VEK or the folder's own VEK). */
type UploadBlobEntry = { bytes: Uint8Array; kind: 'favicon' | 'attachment'; vek: string };

/**
 * A single manifest as carried in the GET snapshot / single-manifest fetch.
 */
type ManifestDto = {
  manifestId: string;
  isRoot: boolean;
  blob?: string | null;
  ciphertextHash?: string | null;
  revision: number;
  blobReferences?: BlobRefDto[];
  /** Plaintext display name of a shared-folder manifest (null for the root manifest). */
  name?: string | null;
  /** Username of the manifest owner; set only on manifests granted to the caller by another user. */
  ownerUsername?: string | null;
  /** The manifest VEK encrypted with the caller's public key; set only on manifests granted by another user. */
  encryptedVek?: string | null;
  /** Algorithm of `encryptedVek` (e.g. "rsa-oaep-sha256"). */
  algorithm?: string | null;
  /** The public key `encryptedVek` was encrypted with. Selects which of the caller's keypairs decrypts the grant. */
  encryptionPublicKey?: string | null;
};

/** A data bucket as carried in the GET snapshot / bundled upload. `category` matches the server enum name (e.g. "Settings"). */
type BucketDto = { category: string; blob?: string | null; ciphertextHash?: string | null; revision?: number };

/** Per-kind revision as carried in upload responses. */
type BucketRevisionDto = { category: string; revision: number };

/**
 * Pick the user's root manifest from a snapshot's manifest list. Strict on purpose: when no manifest is flagged as
 * root there is no safe fallback (grabbing an arbitrary manifest could assemble the wrong vault), so callers that
 * require a root manifest must fail loudly on `undefined`.
 */
function selectRootManifest(manifests: ManifestDto[] | undefined | null): ManifestDto | undefined {
  return (manifests ?? []).find(m => m.isRoot);
}

/**
 * Numeric value of the server StorageFormat enum for the manifest-v1 format (SqliteBlob = 0, Manifest = 1).
 */
export const STORAGE_FORMAT_MANIFEST = 1;

/**
 * Raw snapshot returned by GET /v2/Vault.
 */
export type GetResponseDto = {
  status: number;
  /** The server's storage format (0 = sqlite-blob, 1 = manifest-v1). */
  storageFormat?: number;
  /** The legacy encrypted SQLite blob (for not-yet-migrated users). */
  legacyVaultBlob?: string | null;
  version?: string | null;
  /** The legacy sqlite-blob revision (set only on the sqlite-blob path). */
  legacyRevision?: number | null;
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
 * One manifest element in a POST /v2/Vault write. Root targeting is explicit: set `isRoot: true` (and no `manifestId`) to write
 * the caller's root manifest or set `manifestId` (with `isRoot` false/omitted) to write a shared-folder manifest.
 */
type ManifestWriteDto = {
  isRoot?: boolean;
  manifestId?: string;
  manifestBlob: string;
  manifestCiphertextHash: string;
  currentRevision: number;
  credentialsCount: number;
  blobReferences: BlobRefDto[];
  /** 
   * The newly generated VEK encrypted with the password-derived KEK. Set on the root write of a legacy user's first manifest-v1 push.
   * TODO: can be deleted once all users have migrated to manifest-v1.
   */
  encryptedVek?: string;
};

/** Per-manifest result of a write: the new revision (Ok) or the current server revision (Outdated). */
type ManifestWriteResultDto = { isRoot: boolean; manifestId: string | null; revision: number };

type VaultWriteResponseDto = {
  status: number;
  manifestRevisions: ManifestWriteResultDto[];
  bucketRevisions: BucketRevisionDto[];
  missingBlobHashes: string[];
};

type MissingBlobsResponseDto = { missing: string[] };

/** The canonicalized vault plus the resolved shared-folder session records it was split against. */
type CanonicalizedVaultSet = { canonicalized: CodecCanonicalized; sharedFolderRecords: Record<string, SessionSharedFolder> };

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
    const rootManifest = selectRootManifest(snapshot.manifests);
    devLog(`[V2Pull] Step 1/4 done: storageFormat=${snapshot.storageFormat}, manifests=${snapshot.manifests?.length ?? 0}, rootRevision=${rootManifest?.revision}, manifestBlob=${rootManifest?.blob?.length ?? 0} chars, buckets=${snapshot.buckets?.length ?? 0}, blobRefs=${rootManifest?.blobReferences?.length ?? 0}`);

    /*
     * Steps 2–4: decrypt, materialize, and re-encrypt. Any failure here is a client-side vault-processing error
     * (codec/format mismatch, integrity failure, corrupt blob, …). We wrap it in a VaultProcessingError so the UI
     * can surface the real technical detail in a copyable report instead of a misleading "server unreachable".
     */
    try {
      if (snapshot.storageFormat === STORAGE_FORMAT_MANIFEST) {
        // Manifest-v1 user: materialize the manifest + metadata + blobs into a SQLite blob, then encrypt it.
        devLog('[V2Pull] Step 2/4: manifest format: decrypting and reassembling local SQLite...');
        const pull = await this.materializeFromSnapshot(snapshot, encryptionKey);
        devLog(`[V2Pull] Step 3/4: materialized SQLite (${pull.sqliteBase64.length} base64 chars); re-encrypting for local storage...`);
        const encryptedVault = await EncryptionUtility.symmetricEncrypt(pull.sqliteBase64, encryptionKey);
        devLog('[V2Pull] Step 4/4: re-encryption done, returning VaultResponse.');
        return this.buildResponse(encryptedVault, '2.0.0', pull.manifestRevision, snapshot);
      }

      /*
       * Not-yet-migrated (sqlite-blob fallback) user: the server returned the legacy encrypted SQLite blob. It's already in the stored
       * format (encrypted SQLite), so we pass it through unchanged: the on-open schema upgrade handles the rest.
       * There is no manifest-v1 server state, so drop any stale content fingerprints.
       */
      await storage.removeItem(StorageKeys.VAULT_V2_CONTENT_FINGERPRINTS);
      devLog('[V2Pull] Step 2/4: legacy blob pass-through (user not yet migrated), returning as-is.');
      return this.buildResponse(
        snapshot.legacyVaultBlob ?? '',
        snapshot.version ?? '',
        typeof snapshot.legacyRevision === 'number' ? snapshot.legacyRevision : 0,
        snapshot
      );
    } catch (error) {
      devError('[V2Pull] FAILED: the last logged step above is where it broke:', error);
      throw new VaultProcessingError('vault-pull', error);
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
      const { canonicalized } = await this.canonicalizeVault(sqliteClient);

      /*
       * Canonicalize already handed us every extracted favicon/attachment as plaintext bytes, so materialize can
       * resolve its blob references without a single fetch.
       */
      const blobMap = new Map<string, Uint8Array>();
      for (const [hash, entry] of Object.entries(canonicalized.blobs)) {
        blobMap.set(hash, VaultCodec.base64ToBytes(entry.bytesBase64));
      }
      for (const sharedVault of canonicalized.sharedVaults ?? []) {
        for (const [hash, entry] of Object.entries(sharedVault.blobs)) {
          blobMap.set(hash, VaultCodec.base64ToBytes(entry.bytesBase64));
        }
      }

      const schemaSql = new VaultSqlGenerator().getCompleteSchemaSql();
      const schemaColumns = await VaultCodec.getSchemaColumns(schemaSql);
      const sharedManifests = (canonicalized.sharedVaults ?? []).map(v => v.manifest);
      const materialized = await vaultCodecMaterializeAsSqlite(canonicalized.manifest, canonicalized.dataBuckets, schemaColumns, sharedManifests);
      const sqliteBase64 = await VaultCodec.insertTables(materialized, blobMap, schemaSql);

      devLog(`[ManifestMigration] Migration complete: ${blobMap.size} blobs re-embedded, ${sqliteBase64.length} base64 chars.`);
      return sqliteBase64;
    } catch (error) {
      devError('[ManifestMigration] FAILED to migrate the local vault:', error);
      throw new VaultProcessingError('vault-storage-migration', error);
    }
  }

  /**
   * Run a write against the v2 API and translate the outdated-server 404 into {@link ServerUpdateRequiredError}.
   * TODO: this wrapper can be deleted once enough time has passed since the v2 API was introduced (so all self-hosted installs have had time to upgrade).
   * @param fn - the write to run
   */
  private async withOutdatedServerGuard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isNotFoundError(e)) {
        throw new ServerUpdateRequiredError();
      }
      throw e;
    }
  }

  /**
   * Fetch the raw snapshot (GET /v2/Vault) without decrypting/reassembling. Throws error if the server predates the v2 API.
   */
  private async fetchSnapshot(): Promise<GetResponseDto> {
    return this.withOutdatedServerGuard(() => new WebApiService().get<GetResponseDto>(VAULT_ENDPOINT));
  }

  /**
   * Materialize a local SQLite database from an already-fetched manifest-v1 snapshot: verify ciphertext integrity,
   * decrypt + unwrap the manifest/metadata, fetch any missing referenced blobs, then run the codec.
   * @param snapshot - the raw GET /v2/Vault response
   * @param vek - the symmetric key used to decrypt the manifest + metadata + blobs
   */
  private async materializeFromSnapshot(snapshot: GetResponseDto, vek: string): Promise<PullResult> {
    const webApi = new WebApiService();

    const rootManifest = selectRootManifest(snapshot.manifests);
    if (!rootManifest) {
      throw new Error('VaultSyncService: server returned no root manifest, refusing to assemble.');
    }

    if (!rootManifest.blob) {
      throw new Error('VaultSyncService: server returned no manifest blob, nothing to assemble.');
    }

    devLog('[V2Pull] Verifying manifest ciphertext hash; decrypting + opening manifest...');
    const manifestJson = await verifyDecryptUnpack(rootManifest.blob, vek, rootManifest.ciphertextHash, 'manifest');
    const manifest = JSON.parse(manifestJson) as VaultManifest;
    devLog(`[V2Pull] Manifest opened (content hash verified): schemaVersion=${manifest.schemaVersion}, migrationId=${manifest.migrationId}, tables: ${Object.entries(manifest.tables).map(([t, rows]) => `${t}=${rows.length}`).join(', ')}`);

    // Content baselines for the push-side change detection: fingerprint every target as served by the server.
    const pulledFingerprints: Record<string, string> = {};
    pulledFingerprints[FINGERPRINT_ROOT_KEY] = await vaultCodecComputeContentFingerprint(manifestJson);

    // Persist the user salt locally so subsequent canonicalizes hash blobs the same way.
    await storage.setItem(StorageKeys.VAULT_V2_USER_SALT, manifest.userSalt);
    const manifestRevision = typeof rootManifest.revision === 'number' ? rootManifest.revision : 0;
    await storage.setItem(StorageKeys.SERVER_REVISION, manifestRevision);

    /*
     * Persist the revision of every non-root manifest (e.g. shared folders) so sync can detect when one is added or
     * updated server-side. The root manifest is excluded on purpose, it's tracked via local:serverRevision above.
     */
    const sharedManifestRevisions: Record<string, number> = {};
    for (const m of (snapshot.manifests ?? [])) {
      if (!m.isRoot && typeof m.revision === 'number') {
        sharedManifestRevisions[m.manifestId] = m.revision;
      }
    }
    await storage.setItem(StorageKeys.SERVER_MANIFEST_REVISIONS, sharedManifestRevisions);
    devLog(`[V2Pull] Stored local shared-manifest revisions from snapshot: ${Object.keys(sharedManifestRevisions).length === 0 ? '(none)' : Object.entries(sharedManifestRevisions).map(([id, rev]) => `${id}=${rev}`).join(', ')}. Next status check compares against these.`);

    // Decrypt every data bucket in the snapshot (Settings today; more categories later).
    const dataBuckets: VaultDataBucket[] = [];
    for (const bucketDto of (snapshot.buckets ?? [])) {
      if (!bucketDto.blob) {
        continue;
      }
      const bucketJson = await verifyDecryptUnpack(bucketDto.blob, vek, bucketDto.ciphertextHash, `"${bucketDto.category}" bucket`);
      const bucket = JSON.parse(bucketJson) as VaultDataBucket;
      dataBuckets.push(bucket);
      pulledFingerprints[fingerprintBucketKey(bucketDto.category)] = await vaultCodecComputeContentFingerprint(bucketJson);
      const rowCount = Object.values(bucket.tables ?? {}).reduce((n, rows) => n + rows.length, 0);
      devLog(`[V2Pull] Data bucket "${bucketDto.category}" opened: ${rowCount} rows (revision ${bucketDto.revision}).`);
      if (typeof bucketDto.revision === 'number') {
        await storage.setItem(bucketRevisionStorageKey(bucketDto.category), bucketDto.revision);
      }
    }
    if (dataBuckets.length === 0) {
      devLog('[V2Pull] No data buckets in snapshot.');
    }

    /*
     * Resolve every non-root (shared-folder) manifest in the snapshot. The snapshot carries the folder VEK encrypted with the user's public key.
     * Unwrap it with the private key, read from the small EncryptionKeys data bucket. A manifest whose key can't be resolved is skipped.
     */
    const sharedManifestDtos = (snapshot.manifests ?? []).filter(m => !m.isRoot && m.blob);
    const sharedManifests: VaultManifest[] = [];
    const sessionSharedFolders: Record<string, SessionSharedFolder> = {};
    const encryptionKeysBucket = dataBuckets.find(b => b.category === VaultDataBucketCategory.EncryptionKeys) ?? null;
    for (const dto of sharedManifestDtos) {
      let vek: string | null = null;
      if (dto.encryptedVek && dto.encryptionPublicKey) {
        /*
         * Each grant was encrypted for a specific public key; select the matching private key so a grant encrypted
         * before a key rotation still decrypts (the current primary is never assumed). A grant without an encryption
         * public key cannot be resolved, so it falls through and the manifest is skipped below.
         */
        const privateKeyJwk = await this.resolvePrivateKeyJwk(encryptionKeysBucket, dto.encryptionPublicKey);
        if (privateKeyJwk) {
          try {
            vek = await SharingService.unwrapFolderVek(dto.encryptedVek, privateKeyJwk);
          } catch (e) {
            devWarn(`[V2Pull] Failed to unwrap VEK of shared manifest ${dto.manifestId}, skipping it.`, e);
          }
        }
      }
      if (!vek) {
        devWarn(`[V2Pull] No key available for shared manifest ${dto.manifestId}, skipping it.`);
        continue;
      }

      try {
        const sharedManifestJson = await verifyDecryptUnpack(dto.blob!, vek, dto.ciphertextHash, `shared manifest ${dto.manifestId}`);
        const sharedManifest = JSON.parse(sharedManifestJson) as VaultManifest;
        const folderId = typeof sharedManifest.sharedFolderId === 'string' ? sharedManifest.sharedFolderId : null;
        sharedManifests.push(sharedManifest);
        pulledFingerprints[fingerprintManifestKey(dto.manifestId)] = await vaultCodecComputeContentFingerprint(sharedManifestJson);
        devLog(`[V2Pull] Shared manifest ${dto.manifestId} opened (folder ${folderId ?? 'unassigned'}): tables: ${Object.entries(sharedManifest.tables).map(([t, rows]) => `${t}=${rows.length}`).join(', ')}`);
        if (folderId) {
          // A folder the user owns (ownerUsername null) must win over any shared-with-me entry for the same id.
          const existing = sessionSharedFolders[folderId];
          if (!(existing && !existing.ownerUsername && dto.ownerUsername)) {
            sessionSharedFolders[folderId] = {
              folderId,
              manifestId: dto.manifestId,
              vek,
              salt: sharedManifest.userSalt,
              revision: dto.revision,
              name: dto.name ?? null,
              ownerUsername: dto.ownerUsername ?? null,
            };
          }
        }
      } catch (e) {
        devWarn(`[V2Pull] Failed to open shared manifest ${dto.manifestId}, skipping it.`, e);
      }
    }
    await SharingService.setSessionSharedFolders(sessionSharedFolders);

    /*
     * Fetch any referenced blobs that aren't already in the local (encrypted) cache. Refs of the root manifest
     * decrypt with the root VEK; refs of a shared manifest decrypt with that folder's VEK.
     */
    const refVeks = new Map<string, string>();
    const refs: BlobRefDto[] = [];
    for (const r of rootManifest.blobReferences ?? []) {
      refs.push(r);
      refVeks.set(r.hash, vek);
    }
    for (const dto of sharedManifestDtos) {
      const folder = Object.values(sessionSharedFolders).find(f => f.manifestId === dto.manifestId);
      if (!folder) {
        continue;
      }
      for (const r of dto.blobReferences ?? []) {
        if (!refVeks.has(r.hash)) {
          refs.push(r);
          refVeks.set(r.hash, folder.vek);
        }
      }
    }
    const cache = await this.loadBlobCache();
    const missingHashes = refs.map(r => r.hash).filter(h => !(h in cache));
    devLog(`[V2Pull] Blob refs: ${refs.length} referenced, ${refs.length - missingHashes.length} cached locally, ${missingHashes.length} to download.`);
    for (let i = 0; i < missingHashes.length; i += BLOB_DOWNLOAD_BATCH_SIZE) {
      const chunk = missingHashes.slice(i, i + BLOB_DOWNLOAD_BATCH_SIZE);
      const blobs = await webApi.post<{ hashes: string[] }, BlobDto[]>(BLOBS_DOWNLOAD_ENDPOINT, { hashes: chunk });
      devLog(`[V2Pull] Downloaded blob batch ${Math.floor(i / BLOB_DOWNLOAD_BATCH_SIZE) + 1}: requested ${chunk.length}, received ${blobs.length}.`);
      for (const dto of blobs) {
        cache[dto.hash] = dto.encryptedDataBase64;
      }
    }

    /*
     * Decrypt referenced blobs for reassembly and prune the persisted cache to exactly the referenced set, so
     * the cache stays bounded by the current vault size. A blob that can't be reconstituted: the server couldn't
     * serve it (missing) or its ciphertext won't decrypt with the current key (stale key / corruption): is fatal
     * for attachments (silently dropping bytes would propagate permanent data loss on the next push); a favicon
     * only degrades cosmetically, so it's logged and skipped. The codec inserts NULL for any skipped blob ref.
     */
    const prunedCache: Record<string, string> = {};
    const blobMap = new Map<string, Uint8Array>();
    for (const r of refs) {
      const ciphertext = cache[r.hash];
      const blobKey = refVeks.get(r.hash) ?? vek;
      /*
       * Root-manifest attachments are load-bearing (a NULL insert would propagate data loss on the next push);
       * shared-manifest blob gaps only degrade that folder, so they are logged and skipped. TODO: revisit once
       * cross-member blob availability is guaranteed (shared attachment gaps currently degrade like favicons).
       */
      const strict = r.category === 'attachment' && blobKey === vek;
      if (!ciphertext) {
        if (strict) {
          throw new Error(`VaultSyncService: attachment blob ${r.hash} is referenced by the manifest but missing on the server, refusing to assemble an incomplete vault.`);
        }
        devWarn(`[V2Sync] Referenced ${r.category} blob ${r.hash} missing on server, continuing without it.`);
        continue;
      }
      try {
        blobMap.set(r.hash, await this.decryptBlobToBytes(ciphertext, blobKey));
        prunedCache[r.hash] = ciphertext;
      } catch (e) {
        // Present on the server but undecryptable with the current key. Apply the same policy as a missing blob.
        if (strict) {
          throw new Error(`VaultSyncService: attachment blob ${r.hash} is referenced by the manifest but could not be decrypted with the current key (stale key or corrupt ciphertext), refusing to assemble an incomplete vault. Underlying: ${e instanceof Error ? e.message : String(e)}`);
        }
        devWarn(`[V2Sync] Referenced ${r.category} blob ${r.hash} failed to decrypt with the current key, continuing without it.`);
      }
    }
    await this.saveBlobCache(prunedCache);

    // The server demonstrably has every blob it just served or referenced, seed the upload diff with them.
    await storage.setItem(StorageKeys.VAULT_V2_SERVER_BLOB_HASHES, refs.map(r => r.hash));

    /*
     * Replace (not merge) the content-fingerprint baselines: the record must mirror exactly the manifests and
     * buckets the server holds right now, so entries of revoked/removed manifests drop out.
     */
    await storage.setItem(StorageKeys.VAULT_V2_CONTENT_FINGERPRINTS, pulledFingerprints);
    devLog(`[V2Pull] Stored ${Object.keys(pulledFingerprints).length} content fingerprint baseline(s) for push-side change detection.`);

    devLog(`[V2Pull] ${blobMap.size} blobs decrypted; running codec reassembly into a fresh SQLite (${sharedManifests.length} shared manifest(s) combined)...`);
    const sqlGen = new VaultSqlGenerator();
    const schemaSql = sqlGen.getCompleteSchemaSql();
    const schemaColumns = await VaultCodec.getSchemaColumns(schemaSql);
    const materialized = await vaultCodecMaterializeAsSqlite(manifest, dataBuckets, schemaColumns, sharedManifests);

    /*
     * Anything a newer client wrote that our schema can't hold was split off the insert set into the
     * CodecOverflows carrier row (part of the tables inserted below, so it lives inside the encrypted
     * vault DB). Canonicalize re-merges it on push, so this client never deletes a newer writer's data.
     */
    const overflowTableCount = Object.keys(materialized.overflow.tables).length + Object.values(materialized.overflow.bucketTables).reduce((n, t) => n + Object.keys(t).length, 0);
    const overflowColumnTables = Object.keys(materialized.overflow.columns);
    if (overflowTableCount > 0 || overflowColumnTables.length > 0) {
      devWarn(`[V2Pull] Newer-schema data preserved as overflow: ${overflowTableCount} unknown table(s), unknown columns on [${overflowColumnTables.join(', ')}]. It will round-trip on push but is not usable locally until the app is updated.`);
    }

    const sqliteBase64 = await VaultCodec.insertTables(materialized, blobMap, schemaSql);
    devLog('[V2Pull] Codec reassembly complete.');

    return { sqliteBase64, manifestRevision };
  }

  /**
   * Resolve the user's asymmetric private key (JWK string) for unwrapping a shared-folder VEK. The keypair lives
   * in the small EncryptionKeys data bucket, decryptable on its own without materializing the root manifest. The
   * keypair matching `encryptionPublicKey` is selected, so a grant encrypted before a key rotation still decrypts even
   * though that key is no longer primary. Returns null when no matching key is available.
   * @param encryptionKeysBucket - the decrypted EncryptionKeys data bucket, or null when absent
   * @param encryptionPublicKey - the public key the grant's VEK was encrypted with
   */
  private async resolvePrivateKeyJwk(encryptionKeysBucket: VaultDataBucket | null, encryptionPublicKey: string): Promise<string | null> {
    if (!encryptionKeysBucket) {
      return null;
    }
    const keyRow = await vaultCodecExtractEncryptionKeyForPublicKeyFromBucket(encryptionKeysBucket, encryptionPublicKey);
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
   * its last-known server state OUT of the write, so a credential edit uploads the root manifest alone and a
   * shared-folder edit uploads that folder's manifest alone. Only blobs the server doesn't
   * already have are encrypted and pre-uploaded (in size-capped batches) before the manifest POST, so a routine
   * save of a vault with hundreds of attachments uploads kilobytes, not the whole blob set. If the manifest POST
   * reports missing blobs still missing (stale local knowledge, e.g. server-side GC), the missing bytes are uploaded
   * and the POST retried once.
   * @param sqliteClient - the in-memory SQLite the user has been editing
   * @param vek - the symmetric encryption key (on a KEK/VEK migration push this is the password-derived key,
   *   which becomes the KEK; on a normal push it is the VEK itself)
   * @param username - the user's username (sent in the upload payload for cross-check)
   * @param emailAddressList - claimed email aliases (server needs these in plaintext for routing)
   * @param options - set createVaultKey to perform the KEK/VEK migration as part of this push (decided once, in
   *   handleUploadVault); set forceFullWrite to bypass the content-fingerprint gating and
   *   rewrite every manifest and bucket (server rollback recovery)
   * @returns Push outcome.
   */
  public async push(
    sqliteClient: SqliteClient,
    vek: string,
    username: string,
    emailAddressList: string[],
    options?: { createVaultKey?: boolean; forceFullWrite?: boolean }
  ): Promise<PushResult> {
    return this.withOutdatedServerGuard(() => this.pushInternal(sqliteClient, vek, username, emailAddressList, options));
  }

  /**
   * The push implementation; {@link push} wraps it with the outdated-server guard.
   * @param sqliteClient - the in-memory SQLite the user has been editing
   * @param vek - the symmetric encryption key
   * @param username - the user's username
   * @param emailAddressList - claimed email aliases
   * @param options - see {@link push}
   */
  private async pushInternal(
    sqliteClient: SqliteClient,
    vek: string,
    username: string,
    emailAddressList: string[],
    options?: { createVaultKey?: boolean; forceFullWrite?: boolean }
  ): Promise<PushResult> {
    /*
     * KEK/VEK migration: on the first push after this feature ships, generate a fresh VEK and encrypt everything
     * with it; the passed-in password-derived key becomes the KEK that wraps the VEK. On a normal push the
     * passed-in key IS the VEK and is used directly.
     */
    const migrateToVaultKey = options?.createVaultKey === true;
    const contentKey = migrateToVaultKey ? EncryptionUtility.generateVaultEncryptionKey() : vek;
    const encryptedVek = migrateToVaultKey ? await EncryptionUtility.wrapVaultEncryptionKey(contentKey, vek) : null;
    if (migrateToVaultKey) {
      devLog('[V2Push] KEK/VEK migration: generated new VEK, vault content and all blobs will be re-encrypted and re-uploaded.');
    }

    // 1) Canonicalize, reusing the pre-push no-op check's result when it is still current (same client instance, no mutations since).
    const currentMutationSequence = ((await storage.getItem(StorageKeys.MUTATION_SEQUENCE)) as number | null) ?? 0;
    const cachedSet = (canonicalizeCache && canonicalizeCache.client === sqliteClient && canonicalizeCache.mutationSequence === currentMutationSequence) ? canonicalizeCache : null;
    if (cachedSet) {
      devLog('[V2Push] Reusing the canonicalize result from the pre-push no-op check.');
    }
    const { canonicalized, sharedFolderRecords } = cachedSet ?? await this.canonicalizeVault(sqliteClient);

    // Plaintext blob bytes held platform-side for encryption/upload, each staged with the key that encrypts it.
    const rootBlobEntries = new Map<string, UploadBlobEntry>(
      Object.entries(canonicalized.blobs).map(([hash, entry]) => [hash, { kind: entry.kind as 'favicon' | 'attachment', bytes: VaultCodec.base64ToBytes(entry.bytesBase64), vek: contentKey }])
    );

    /*
     * Debug: manifest-set summary + full unencrypted manifests + data buckets, inspectable in the console.
     * TODO: delete the unencrypted-content logs below before release — they print plaintext vault data.
     */
    devLog(`[V2Push] Canonicalize produced 1 root manifest + ${canonicalized.sharedVaults?.length ?? 0} shared folder manifest(s) + ${canonicalized.dataBuckets.length} data bucket(s).`);
    devLog('[V2Push] Unencrypted manifest:', canonicalized.manifest);
    devLog(`[V2Push] Unencrypted data buckets (${canonicalized.dataBuckets.length}):`, canonicalized.dataBuckets);
    for (const sharedVault of canonicalized.sharedVaults ?? []) {
      devLog(`[V2Push] Unencrypted shared manifest (folder ${sharedVault.folderId}): tables: ${Object.entries(sharedVault.manifest.tables).map(([t, rows]) => `${t}=${rows.length}`).join(', ')}`, sharedVault.manifest);
    }

    /*
     * 2) Content-fingerprint gating: compare every canonicalized target (root manifest, each data bucket, each
     * shared manifest below) against the fingerprint of its last-known server state and only write the targets
     * that actually changed. A missing baseline means "server state unknown" and always writes. Two cases force
     * a blanket write: a KEK/VEK migration re-keys the root manifest and all buckets (their ciphertext must be
     * re-encrypted with the new VEK even when the content is unchanged), and forceFullWrite (server rollback
     * recovery) rewrites everything so the server is restored from the client's state.
     */
    const forceFullWrite = options?.forceFullWrite === true;
    const fingerprints = await this.loadContentFingerprints();
    const manifestPlaintext = await timedStage('stringify-manifest', () => JSON.stringify(canonicalized.manifest));
    const rootFingerprint = await vaultCodecComputeContentFingerprint(manifestPlaintext);
    const writeRoot = forceFullWrite || migrateToVaultKey || fingerprints[FINGERPRINT_ROOT_KEY] !== rootFingerprint;
    if (!writeRoot) {
      devLog('[V2Push] Root manifest unchanged versus server baseline, leaving it out of this write.');
    }

    // 3) Pre-upload structural validation (write set only), then pack + AES-GCM encrypt.
    if (writeRoot) {
      const manifestValidation = await timedStage('validate-manifest (incl. JS→Rust conversion)', () => vaultCodecValidateManifest(canonicalized.manifest));
      if (!manifestValidation.ok) {
        return {
          status: 'rejected',
          newManifestRevision: null,
          reasons: [`Manifest validation failed: ${manifestValidation.failedRules.join(', ')}. ${manifestValidation.message}`.trim()],
        };
      }
    }

    /*
     * Pack + encrypt each changed data bucket, carrying the client's believed-current revision so each bucket
     * participates in the same all-or-nothing revision gate as the manifests. Unchanged buckets are skipped
     * (unless the write is forced, see the gating comment above).
     */
    const bucketDtos: Array<{ category: string; blob: string; ciphertextHash: string; currentRevision: number }> = [];
    const writtenBucketFingerprints: Record<string, string> = {};
    for (const bucket of canonicalized.dataBuckets) {
      const bucketPlaintext = JSON.stringify(bucket);
      const bucketFingerprint = await vaultCodecComputeContentFingerprint(bucketPlaintext);
      if (!forceFullWrite && !migrateToVaultKey && fingerprints[fingerprintBucketKey(bucket.category)] === bucketFingerprint) {
        devLog(`[V2Push] Data bucket "${bucket.category}" unchanged versus server baseline, leaving it out of this write.`);
        continue;
      }

      const bucketValidation = await vaultCodecValidateDataBucket(bucket);
      if (!bucketValidation.ok) {
        return {
          status: 'rejected',
          newManifestRevision: null,
          reasons: [`Data bucket "${bucket.category}" validation failed: ${bucketValidation.failedRules.join(', ')}. ${bucketValidation.message}`.trim()],
        };
      }

      const { ciphertext, compressedBytes } = await packEncrypt(bucketPlaintext, contentKey);
      const ciphertextHash = await vaultCodecComputeCiphertextHash(ciphertext);
      const currentRevision = ((await storage.getItem(bucketRevisionStorageKey(bucket.category))) as number | null) ?? 0;
      bucketDtos.push({ category: bucket.category, blob: ciphertext, ciphertextHash, currentRevision });
      writtenBucketFingerprints[bucket.category] = bucketFingerprint;
      devLog(`[V2Push] Data bucket "${bucket.category}": raw ${formatKb(bucketPlaintext.length)} → compressed ${formatKb(compressedBytes)} → encrypted ${formatKb(ciphertext.length)}.`);
    }

    // Pack + encrypt the root manifest when it is part of the write (reuses the plaintext the fingerprint hashed).
    let rootManifestWrite: Omit<ManifestWriteDto, 'blobReferences' | 'currentRevision' | 'credentialsCount'> | null = null;
    if (writeRoot) {
      const { ciphertext: manifestCiphertext, compressedBytes: manifestCompressedBytes } = await packEncrypt(manifestPlaintext, contentKey);
      const manifestCiphertextHash = await vaultCodecComputeCiphertextHash(manifestCiphertext);
      devLog(`[V2Push] Manifest blob: raw ${formatKb(manifestPlaintext.length)} → compressed ${formatKb(manifestCompressedBytes)} → encrypted ${formatKb(manifestCiphertext.length)}.`);
      rootManifestWrite = { isRoot: true, manifestBlob: manifestCiphertext, manifestCiphertextHash };
    }

    /*
     * Encrypt each changed shared-folder manifest with its own folder VEK and add it to the batch. Blob bytes for
     * every manifest are pre-uploaded together further down. A malformed shared manifest is dropped from the batch
     * (logged) rather than failing the whole write — its folder just isn't updated this round. An unchanged shared
     * manifest is skipped entirely: this both avoids re-uploading it and keeps its (possibly stale) revision out of
     * the all-or-nothing gate, so another member's update to that folder can't fail an unrelated write.
     */
    const sharedRevisions = ((await storage.getItem(StorageKeys.SERVER_MANIFEST_REVISIONS)) as Record<string, number> | null) ?? {};
    const sharedBlobEntries = new Map<string, UploadBlobEntry>();
    const sharedManifestWrites: ManifestWriteDto[] = [];
    const writtenSharedFingerprints: Record<string, string> = {};
    for (const sharedVault of canonicalized.sharedVaults ?? []) {
      const record = sharedFolderRecords[sharedVault.folderId];
      if (!record) {
        continue;
      }

      /*
       * Blob bytes are collected for every resolved folder, written or not: the blob-cache/server-hash
       * bookkeeping below covers all referenced blobs, and the missing-diff only uploads genuine gaps anyway.
       * Folder blob hashes are salt-unique per folder, so they never collide with root or other folders' hashes.
       */
      for (const [hash, entry] of Object.entries(sharedVault.blobs)) {
        if (rootBlobEntries.has(hash) || sharedBlobEntries.has(hash)) {
          continue;
        }
        sharedBlobEntries.set(hash, { kind: entry.kind as 'favicon' | 'attachment', bytes: VaultCodec.base64ToBytes(entry.bytesBase64), vek: record.vek });
      }

      const sharedPlaintext = JSON.stringify(sharedVault.manifest);
      const sharedFingerprint = await vaultCodecComputeContentFingerprint(sharedPlaintext);
      if (!forceFullWrite && fingerprints[fingerprintManifestKey(record.manifestId)] === sharedFingerprint) {
        devLog(`[V2Push] Shared manifest "${record.manifestId}" (folder ${sharedVault.folderId}) unchanged versus server baseline, leaving it out of this write.`);
        continue;
      }

      const validation = await vaultCodecValidateManifest(sharedVault.manifest);
      if (!validation.ok) {
        devWarn(`[V2Push] Shared manifest for folder ${sharedVault.folderId} failed validation (${validation.failedRules.join(', ')}), dropping it from this write.`);
        continue;
      }

      const { ciphertext: sharedCiphertext, compressedBytes: sharedCompressedBytes } = await packEncrypt(sharedPlaintext, record.vek);
      const sharedCiphertextHash = await vaultCodecComputeCiphertextHash(sharedCiphertext);
      devLog(`[V2Push] Shared manifest "${record.manifestId}" (folder ${sharedVault.folderId}): raw ${formatKb(sharedPlaintext.length)} → compressed ${formatKb(sharedCompressedBytes)} → encrypted ${formatKb(sharedCiphertext.length)}.`);

      sharedManifestWrites.push({
        manifestId: record.manifestId,
        manifestBlob: sharedCiphertext,
        manifestCiphertextHash: sharedCiphertextHash,
        currentRevision: sharedRevisions[record.manifestId] ?? record.revision ?? 0,
        credentialsCount: (sharedVault.manifest.tables.Items ?? []).length,
        blobReferences: Object.entries(sharedVault.blobs).map(([hash, entry]) => ({ hash, category: entry.kind })),
      });
      writtenSharedFingerprints[record.manifestId] = sharedFingerprint;
    }

    const currentManifestRevision = ((await storage.getItem(StorageKeys.SERVER_REVISION)) as number | null) ?? 0;

    /*
     * Nothing changed versus the server baselines: skip the write (and the blob diff) entirely. Reachable when a
     * mutation was recorded but produced no canonical content change (e.g. an edit reverted to the original value).
     */
    if (rootManifestWrite === null && sharedManifestWrites.length === 0 && bucketDtos.length === 0) {
      devLog('[V2Push] No content changes detected (root manifest, shared manifests and data buckets all match the server baselines); skipping upload.');
      return { status: 'ok', newManifestRevision: currentManifestRevision };
    }

    /*
     * 4) Blob diff across the root manifest and every shared manifest in this write: only encrypt + upload blobs the
     * server doesn't already have. On a KEK/VEK migration all ROOT blobs are re-encrypted with the new VEK and
     * overwritten in place; shared-folder blobs keep their own (unchanged) folder VEK and only fill genuine gaps.
     */
    const webApi = new WebApiService();
    const rootHashes = Array.from(rootBlobEntries.keys());
    const sharedHashes = Array.from(sharedBlobEntries.keys());
    const allBlobHashes = [...rootHashes, ...sharedHashes];
    const knownServerHashes = new Set(((await storage.getItem(StorageKeys.VAULT_V2_SERVER_BLOB_HASHES)) as string[] | null) ?? []);

    let rootToUpload: string[] = [];
    let sharedToUpload: string[] = [];
    if (migrateToVaultKey) {
      rootToUpload = rootHashes;
      const sharedCandidates = sharedHashes.filter(h => !knownServerHashes.has(h));
      if (sharedCandidates.length > 0) {
        const missingResp = await webApi.post<{ hashes: string[] }, MissingBlobsResponseDto>(BLOBS_MISSING_ENDPOINT, { hashes: sharedCandidates });
        sharedToUpload = missingResp.missing ?? [];
      }
    } else {
      const candidates = allBlobHashes.filter(h => !knownServerHashes.has(h));
      let toUpload: string[] = [];
      if (candidates.length > 0) {
        const missingResp = await webApi.post<{ hashes: string[] }, MissingBlobsResponseDto>(BLOBS_MISSING_ENDPOINT, { hashes: candidates });
        toUpload = missingResp.missing ?? [];
      }
      const toUploadSet = new Set(toUpload);
      rootToUpload = rootHashes.filter(h => toUploadSet.has(h));
      sharedToUpload = sharedHashes.filter(h => toUploadSet.has(h));
    }

    devLog(`[V2Push] Blob diff: ${allBlobHashes.length} blobs across ${1 + sharedManifestWrites.length} manifest(s), uploading ${rootToUpload.length} root + ${sharedToUpload.length} shared${migrateToVaultKey ? ' (root re-encrypted, VEK migration)' : ''}.`);

    // Pre-upload the missing bytes so the write below carries references only; each staged entry carries its own key.
    const uploadedCiphertexts = await this.uploadBlobs(webApi, rootBlobEntries, rootToUpload, migrateToVaultKey);
    const uploadedShared = await this.uploadBlobs(webApi, sharedBlobEntries, sharedToUpload);
    for (const [hash, ciphertext] of uploadedShared) {
      uploadedCiphertexts.set(hash, ciphertext);
    }

    const rootBlobReferences: BlobRefDto[] = rootHashes.map(hash => ({ hash, category: rootBlobEntries.get(hash)!.kind }));

    const itemCount = (canonicalized.manifest.tables.Items ?? []).length;

    const manifests: ManifestWriteDto[] = [
      // Explicit root target (no manifestId) — the server resolves the root from the auth session (see ManifestWriteDto).
      ...(rootManifestWrite ? [{
        ...rootManifestWrite,
        currentRevision: currentManifestRevision,
        credentialsCount: itemCount,
        blobReferences: rootBlobReferences,
        /*
         * Set only on the KEK/VEK migration push, where the server creates the vault key alongside this root revision.
         * A migration always forces a root write (see writeRoot), so the key can never be stranded without one.
         */
        ...(encryptedVek ? { encryptedVek } : {}),
      }] : []),
      ...sharedManifestWrites,
    ];

    const payload = {
      username,
      manifests,
      buckets: bucketDtos,
      newBlobs: [] as BlobDto[],
      emailRouting: { emailAddressList },
      userEncryptionPublicKey: '',
    };

    let resp = await webApi.post<typeof payload, VaultWriteResponseDto>(VAULT_ENDPOINT, payload);

    if (resp.missingBlobHashes && resp.missingBlobHashes.length > 0) {
      /*
       * Our local knowledge of the server's blob set was stale (e.g. the server GC'd a blob between syncs).
       * Upload the bytes it asked for (each with its correct key) and retry the write once. Nothing was committed
       * (all-or-nothing), so the retry sends the identical payload.
       */
      const unsatisfiable = resp.missingBlobHashes.filter(h => !rootBlobEntries.has(h) && !sharedBlobEntries.has(h));
      if (unsatisfiable.length > 0) {
        return { status: 'missing-blobs', newManifestRevision: currentManifestRevision, reasons: unsatisfiable };
      }

      devWarn(`[V2Sync] Server reported ${resp.missingBlobHashes.length} missing blob(s); uploading and retrying once.`);
      const retriedRoot = await this.uploadBlobs(webApi, rootBlobEntries, resp.missingBlobHashes.filter(h => rootBlobEntries.has(h)), migrateToVaultKey);
      const retriedShared = await this.uploadBlobs(webApi, sharedBlobEntries, resp.missingBlobHashes.filter(h => sharedBlobEntries.has(h)));
      for (const [hash, ciphertext] of [...retriedRoot, ...retriedShared]) {
        uploadedCiphertexts.set(hash, ciphertext);
      }

      resp = await webApi.post<typeof payload, VaultWriteResponseDto>(VAULT_ENDPOINT, payload);
      if (resp.missingBlobHashes && resp.missingBlobHashes.length > 0) {
        return { status: 'missing-blobs', newManifestRevision: currentManifestRevision, reasons: resp.missingBlobHashes };
      }
    }

    const rootResult = (resp.manifestRevisions ?? []).find(r => r.isRoot);
    const newRootRevision = rootResult?.revision ?? currentManifestRevision;

    if (resp.status !== 0) {
      // All-or-nothing: a single stale manifest or bucket rejected the whole write; the orchestrator pulls/merges/retries.
      return { status: 'outdated', newManifestRevision: newRootRevision };
    }

    // 5) Update local persisted state on success.
    await storage.setItem(StorageKeys.SERVER_REVISION, newRootRevision);
    for (const br of (resp.bucketRevisions ?? [])) {
      await storage.setItem(bucketRevisionStorageKey(br.category), br.revision);
    }

    /*
     * Persist the new revision of every shared manifest written, mirrored onto the session records so a subsequent
     * push in the same session rebases on the right revision.
     */
    const persistedSharedRevisions = ((await storage.getItem(StorageKeys.SERVER_MANIFEST_REVISIONS)) as Record<string, number> | null) ?? {};
    const sessionShared = await SharingService.getSessionSharedFolders();
    for (const r of (resp.manifestRevisions ?? [])) {
      if (r.isRoot || r.manifestId == null) {
        continue;
      }
      persistedSharedRevisions[r.manifestId] = r.revision;
      const folder = Object.values(sessionShared).find(f => f.manifestId === r.manifestId);
      if (folder && sessionShared[folder.folderId]) {
        sessionShared[folder.folderId].revision = r.revision;
      }
    }
    await storage.setItem(StorageKeys.SERVER_MANIFEST_REVISIONS, persistedSharedRevisions);
    await SharingService.setSessionSharedFolders(sessionShared);

    /*
     * Record the new content baselines for every target this write actually carried, so the next push can skip
     * them again when unchanged. Targets left out of the write keep their existing baselines.
     */
    if (rootManifestWrite) {
      fingerprints[FINGERPRINT_ROOT_KEY] = rootFingerprint;
    }
    for (const [category, fingerprint] of Object.entries(writtenBucketFingerprints)) {
      fingerprints[fingerprintBucketKey(category)] = fingerprint;
    }
    for (const [manifestId, fingerprint] of Object.entries(writtenSharedFingerprints)) {
      fingerprints[fingerprintManifestKey(manifestId)] = fingerprint;
    }
    await this.saveContentFingerprints(fingerprints);

    // Every referenced hash is now known to be on the server, refresh the diff baseline.
    await storage.setItem(StorageKeys.VAULT_V2_SERVER_BLOB_HASHES, allBlobHashes);

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

    /*
     * KEK/VEK migration completed: cache the encrypted VEK for offline unlock and hand the new VEK to the caller,
     * which must adopt it as the session encryption key and re-encrypt the locally stored vault with it.
     */
    if (migrateToVaultKey && encryptedVek) {
      await storage.setItem(StorageKeys.ENCRYPTED_VEK, encryptedVek);
      devLog('[V2Push] KEK/VEK migration complete: vault key created server-side, encrypted VEK cached locally.');
    }

    const uploadedBlobChars = Array.from(uploadedCiphertexts.values()).reduce((sum, c) => sum + c.length, 0);
    const bucketChars = bucketDtos.reduce((sum, b) => sum + b.blob.length, 0);
    const sharedManifestChars = sharedManifestWrites.reduce((sum, m) => sum + m.manifestBlob.length, 0);
    const rootManifestChars = rootManifestWrite?.manifestBlob.length ?? 0;
    const totalChars = rootManifestChars + sharedManifestChars + bucketChars + uploadedBlobChars;
    devLog(`[V2Push] Total pushed (encrypted): root manifest ${formatKb(rootManifestChars)} + ${sharedManifestWrites.length} shared manifest(s) ${formatKb(sharedManifestChars)} + ${bucketDtos.length} buckets ${formatKb(bucketChars)} + ${uploadedCiphertexts.size} blobs ${formatKb(uploadedBlobChars)} = ${formatKb(totalChars)}.`);

    return { status: 'ok', newManifestRevision: newRootRevision, newEncryptionKey: migrateToVaultKey ? contentKey : undefined };
  }

  /**
   * Canonicalize the local vault into the manifest-v1 format using the persisted user salt (generated on first
   * save), splitting off shared folders into their own manifests.
   * @param sqliteClient - the in-memory SQLite database to canonicalize
   * @returns The canonicalized set plus the resolved shared-folder session records
   */
  private async canonicalizeVault(sqliteClient: SqliteClient): Promise<CanonicalizedVaultSet> {
    let userSalt = (await storage.getItem(StorageKeys.VAULT_V2_USER_SALT)) as string | null;
    if (!userSalt) {
      userSalt = await vaultCodecGenerateUserSalt();
      await storage.setItem(StorageKeys.VAULT_V2_USER_SALT, userSalt);
    }

    // Read tables from the SQLite database and apply the manifest-v1 format rules.
    const tables = VaultCodec.readTables(sqliteClient);
    const migrationId = VaultCodec.getLatestMigrationId(sqliteClient);

    /*
     * Shared folders to split into their own manifests. Keys come from the vault's own Settings mappings
     * (folders the user shared) merged with the session records from the last pull (folders shared WITH the
     * user). A spec is only included when its folder actually exists in the local DB — a folder whose shared
     * manifest failed to materialize on pull must not be re-pushed as an empty manifest (that would wipe it
     * server-side for every member).
     */
    const sharedFolderRecords = await this.resolveSharedFolderRecords(sqliteClient);
    const sharedFolders: CodecSharedFolderSpec[] = Object.values(sharedFolderRecords).map(r => ({ folderId: r.folderId, userSalt: r.salt }));

    const canonicalized = await timedStage('canonicalize (incl. Rust→JS conversion)', () => vaultCodecCanonicalizeFromSqlite({
      tables,
      userSalt,
      migrationId,
      sharedFolders,
      canonicalizedAt: new Date().toISOString(),
    }));

    return { canonicalized, sharedFolderRecords };
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

    const { canonicalized, sharedFolderRecords } = canonicalizedSet;
    const fingerprints = await this.loadContentFingerprints();
    if (fingerprints[FINGERPRINT_ROOT_KEY] !== await vaultCodecComputeContentFingerprint(JSON.stringify(canonicalized.manifest))) {
      return false;
    }
    for (const bucket of canonicalized.dataBuckets) {
      if (fingerprints[fingerprintBucketKey(bucket.category)] !== await vaultCodecComputeContentFingerprint(JSON.stringify(bucket))) {
        return false;
      }
    }
    for (const sharedVault of canonicalized.sharedVaults ?? []) {
      // A folder without a resolved session record is dropped from the push write set too, so it cannot make the push a non-no-op.
      const record = sharedFolderRecords[sharedVault.folderId];
      if (!record) {
        continue;
      }
      if (fingerprints[fingerprintManifestKey(record.manifestId)] !== await vaultCodecComputeContentFingerprint(JSON.stringify(sharedVault.manifest))) {
        return false;
      }
    }

    return true;
  }

  /**
   * Single-data-bucket upload, for changes scoped to a separate data bucket and not touching any manifest. Goes
   * through the unified POST /v2/Vault write with an empty manifest list and one bucket; the server's all-or-nothing
   * revision gate reports the current bucket revision on conflict, which we rebase onto and retry once.
   * @param bucket - the new data bucket contents (its `category` selects the server bucket)
   * @param vek - encryption key
   * @param username - the user's username (the unified write cross-checks it against the auth session)
   */
  public async pushDataBucketOnly(bucket: VaultDataBucket, vek: string, username: string): Promise<{ status: 'ok' | 'outdated'; revision: number }> {
    return this.withOutdatedServerGuard(() => this.pushDataBucketOnlyInternal(bucket, vek, username));
  }

  /**
   * The bucket-only push implementation; {@link pushDataBucketOnly} wraps it with the outdated-server guard.
   * @param bucket - the new data bucket contents
   * @param vek - encryption key
   * @param username - the user's username
   */
  private async pushDataBucketOnlyInternal(bucket: VaultDataBucket, vek: string, username: string): Promise<{ status: 'ok' | 'outdated'; revision: number }> {
    const { category } = bucket;

    const plaintext = JSON.stringify(bucket);

    // Same content-fingerprint gate as the full push: a mutation that ended up changing nothing skips the write.
    const fingerprints = await this.loadContentFingerprints();
    const bucketFingerprint = await vaultCodecComputeContentFingerprint(plaintext);
    if (fingerprints[fingerprintBucketKey(category)] === bucketFingerprint) {
      const revision = ((await storage.getItem(bucketRevisionStorageKey(category))) as number | null) ?? 0;
      devLog(`[V2Push] Bucket "${category}" (bucket-only) unchanged versus server baseline, skipping upload.`);
      return { status: 'ok', revision };
    }

    const { ciphertext, compressedBytes } = await packEncrypt(plaintext, vek);
    const ciphertextHash = await vaultCodecComputeCiphertextHash(ciphertext);
    devLog(`[V2Push] Bucket "${category}" (bucket-only): raw ${formatKb(plaintext.length)} → compressed ${formatKb(compressedBytes)} → encrypted ${formatKb(ciphertext.length)}.`);

    const webApi = new WebApiService();
    /** POST the single-bucket write with the given believed-current revision (called again on the rebase retry). */
    const postBucket = (currentRevision: number): Promise<VaultWriteResponseDto> => webApi.post<Record<string, unknown>, VaultWriteResponseDto>(VAULT_ENDPOINT, {
      username, manifests: [], buckets: [{ category, blob: ciphertext, ciphertextHash, currentRevision }], newBlobs: [], emailRouting: null, userEncryptionPublicKey: '',
    });

    let currentRevision = (((await storage.getItem(bucketRevisionStorageKey(category))) as number | null) ?? 0);
    let resp = await postBucket(currentRevision);

    if (resp.status !== 0) {
      const serverRevision = (resp.bucketRevisions ?? []).find(b => b.category === category)?.revision ?? currentRevision;
      devWarn(`[V2Push] Bucket "${category}" outdated (server at revision ${serverRevision}, we assumed ${currentRevision}); rebasing and retrying once.`);
      currentRevision = serverRevision;
      resp = await postBucket(currentRevision);
    }

    if (resp.status !== 0) {
      return { status: 'outdated', revision: (resp.bucketRevisions ?? []).find(b => b.category === category)?.revision ?? currentRevision };
    }

    const newRevision = (resp.bucketRevisions ?? []).find(b => b.category === category)?.revision ?? currentRevision + 1;
    await storage.setItem(bucketRevisionStorageKey(category), newRevision);

    // New server baseline for this bucket, so an unchanged follow-up push (bucket-only or full) can skip it.
    fingerprints[fingerprintBucketKey(category)] = bucketFingerprint;
    await this.saveContentFingerprints(fingerprints);

    return { status: 'ok', revision: newRevision };
  }

  /**
   * Resolve the set of shared-folder records for a push: the session records from the last pull (and any folder
   * created/shared this session), filtered to folders that still exist in the local DB. A folder whose shared
   * manifest failed to materialize on pull is absent from the session records and is therefore not re-pushed as
   * an empty manifest (which would wipe it server-side for every member).
   * @param sqliteClient - the open local vault DB
   */
  private async resolveSharedFolderRecords(sqliteClient: SqliteClient): Promise<Record<string, SessionSharedFolder>> {
    const folderIdsInDb = new Set(sqliteClient.executeQuery<{ Id: string }>('SELECT Id FROM Folders').map(r => r.Id));
    const records: Record<string, SessionSharedFolder> = {};

    const sessionShared = await SharingService.getSessionSharedFolders();
    for (const record of Object.values(sessionShared)) {
      if (folderIdsInDb.has(record.folderId)) {
        records[record.folderId] = record;
      }
    }

    return records;
  }

  /**
   * Encrypt the given blobs (each staged with its own VEK: root VEK or a folder VEK) and upload them via
   * POST /v2/Vault/blobs in size-capped batches. `overwrite` is set only for root blobs on a KEK/VEK migration;
   * shared-folder blobs keep their folder VEK across a migration, so their ciphertext is never re-keyed.
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

      if (batch.length > 0 && batchChars + ciphertext.length > BLOB_UPLOAD_BATCH_MAX_CHARS) {
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
   * Encrypt raw blob bytes with the VEK. Result is base64-of-(IV ‖ ciphertext ‖ tag), which is what
   * symmetricEncrypt produces. Bytes round-trip through symmetricEncrypt's string interface via latin-1.
   * @param bytes - plaintext bytes
   * @param vek - symmetric encryption key
   */
  private async encryptBlobBytes(bytes: Uint8Array, vek: string): Promise<string> {
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
      s += String.fromCharCode(bytes[i]);
    }

    return EncryptionUtility.symmetricEncrypt(s, vek);
  }

  /**
   * Decrypt a blob ciphertext (base64) and return raw plaintext bytes.
   * @param encryptedDataBase64 - base64 IV‖ciphertext‖tag from the server
   * @param vek - symmetric encryption key
   */
  private async decryptBlobToBytes(encryptedDataBase64: string, vek: string): Promise<Uint8Array> {
    const plaintextLatin1 = await EncryptionUtility.symmetricDecrypt(encryptedDataBase64, vek);
    const out = new Uint8Array(plaintextLatin1.length);
    for (let i = 0; i < plaintextLatin1.length; i++) {
      out[i] = plaintextLatin1.charCodeAt(i) & 0xff;
    }
    return out;
  }

  /**
   * Load the per-target content-fingerprint baselines (see {@link StorageKeys.VAULT_V2_CONTENT_FINGERPRINTS}).
   */
  private async loadContentFingerprints(): Promise<Record<string, string>> {
    return ((await storage.getItem(StorageKeys.VAULT_V2_CONTENT_FINGERPRINTS)) as Record<string, string> | null) ?? {};
  }

  /**
   * Persist the per-target content-fingerprint baselines.
   * @param fingerprints - fingerprint record to persist
   */
  private async saveContentFingerprints(fingerprints: Record<string, string>): Promise<void> {
    await storage.setItem(StorageKeys.VAULT_V2_CONTENT_FINGERPRINTS, fingerprints);
  }

  /**
   * Load the local encrypted blob cache (hash → base64 ciphertext) used to skip re-downloading known blobs.
   * Entries are stored as served to/from the server, so nothing in the cache is plaintext at rest.
   */
  private async loadBlobCache(): Promise<Record<string, string>> {
    return ((await storage.getItem(StorageKeys.VAULT_V2_BLOB_CIPHER_CACHE)) as Record<string, string> | null) ?? {};
  }

  /**
   * Persist the local encrypted blob cache (hash → base64 ciphertext).
   * @param cache - cache to persist
   */
  private async saveBlobCache(cache: Record<string, string>): Promise<void> {
    await storage.setItem(StorageKeys.VAULT_V2_BLOB_CIPHER_CACHE, cache);
  }

}

export const vaultSyncService = new VaultSyncService();
