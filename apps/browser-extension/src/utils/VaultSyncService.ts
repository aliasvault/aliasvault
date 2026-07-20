/**
 * VaultSyncService.
 * 
 * Handles syncing the vault with the server and interfaces with the Rust codec.
 */

import { storage } from 'wxt/utils/storage';

import { devError, devLog, devWarn } from '@/utils/devLogger/DevLogger';
import { VaultDataBucketCategory } from '@/utils/dist/core/models/vault';
import type { VaultResponse } from '@/utils/dist/core/models/webapi';
import { VaultSqlGenerator } from '@/utils/dist/core/vault';
import { EncryptionUtility } from '@/utils/EncryptionUtility';
import {vaultCodecComputeCiphertextHash, vaultCodecCanonicalizeFromSqlite, vaultCodecGenerateUserSalt, vaultCodecUnpackPayload, vaultCodecMaterializeAsSqlite, vaultCodecPackPayload, vaultCodecValidateManifest, vaultCodecValidateDataBucket} from '@/utils/RustCore';
import { SqliteClient } from '@/utils/SqliteClient';
import { ServerUpdateRequiredError } from '@/utils/types/errors/ServerUpdateRequiredError';
import { VaultProcessingError } from '@/utils/types/errors/VaultProcessingError';
import { type BlobEntry, type VaultManifest, type VaultDataBucket, VaultCodec } from '@/utils/VaultCodec';
import { WebApiService } from '@/utils/WebApiService';

// Endpoints are relative; WebApiService resolves them under the API's /v2/ prefix.
const STATUS_ENDPOINT = 'Vault/status';
const SNAPSHOT_ENDPOINT = 'Vault';
const UPLOAD_ENDPOINT = 'Vault';
const BUCKETS_ENDPOINT = 'Vault/buckets';
const BLOBS_UPLOAD_ENDPOINT = 'Vault/blobs';
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
 * Decrypt a manifest/bucket ciphertext and open it via the Rust codec: gunzip, verify the embedded
 * content hash, and return the inner payload JSON string. Throws if the content hash mismatches
 * (possible application-layer corruption).
 * @param base64Ciphertext - base64(IV ‖ ciphertext ‖ tag) from the server
 * @param vek - symmetric encryption key
 */
async function decryptUnpack(base64Ciphertext: string, vek: string): Promise<string> {
  const encryptedBytes = Uint8Array.from(atob(base64Ciphertext), c => c.charCodeAt(0));
  const plainBytes = await EncryptionUtility.symmetricDecryptBytes(encryptedBytes, vek);
  return vaultCodecUnpackPayload(plainBytes);
}

const SALT_STORAGE_KEY = 'local:vaultV2UserSalt';
/** Per-category data-bucket revision number. */
const bucketRevKey = (category: string): `local:${string}` => `local:vaultV2BucketRev:${category}`;
/** Local cache of encrypted blobs (hash → base64 AES-GCM ciphertext). Never stores plaintext at rest. */
const BLOB_CACHE_STORAGE_KEY = 'local:vaultV2BlobCipherCache';
/** Hashes the server has stored (refreshed on every pull/push). */
const SERVER_HASHES_STORAGE_KEY = 'local:vaultV2ServerBlobHashes';

/** Max accumulated base64 ciphertext characters per POST /v2/Vault/blobs call (~4 MB request body). */
const BLOB_UPLOAD_BATCH_MAX_CHARS = 4 * 1024 * 1024;
/** Hashes per POST /v2/Vault/blobs/download call. */
const BLOB_DOWNLOAD_BATCH_SIZE = 100;

/** Bucket category for the settings data bucket (generated from the Rust BUCKET_TABLES). */
const SETTINGS_BUCKET_CATEGORY = VaultDataBucketCategory.Settings;

/**
 * Status response from the server.
 */
export type VaultSyncStatus = {
  /** Whether the user has been migrated to manifest-v1 storage (false = still legacy, migrate on next save). */
  isMigrated: boolean;
  manifestRevision: number | null;
  settingsRevision: number | null;
};

/**
 * Email routing block as returned by the snapshot (server-readable plaintext, used for email delivery).
 */
export type EmailRouting = {
  emailAddressList: string[];
  privateEmailDomainList: string[];
  hiddenPrivateEmailDomainList: string[];
  publicEmailDomainList: string[];
};

/**
 * Result of a pull: the materialized SQLite plus the side-channel data the caller needs to build a VaultResponse.
 */
export type PullResult = {
  sqliteBase64: string;
  manifestRevision: number;
  emailRouting: EmailRouting;
};

/**
 * Result of a push.
 */
export type PushResult = {
  status: 'ok' | 'outdated' | 'missing-blobs' | 'rejected';
  newManifestRevision: number | null;
  reasons?: string[];
};

type BlobRefDto = { hash: string; category: string };
type BlobDto = { hash: string; category: string; encryptedDataBase64: string };

/** A data bucket as carried in the GET snapshot / bundled upload. `category` matches the server enum name (e.g. "Settings"). */
type BucketDto = { category: string; blob?: string | null; ciphertextHash?: string | null; revision?: number };

/** Per-kind revision as carried in status / upload responses. */
type BucketRevisionDto = { category: string; revision: number };

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
  manifestBlob?: string | null;
  manifestCiphertextHash?: string | null;
  manifestRevision?: number | null;
  buckets?: BucketDto[];
  blobReferences?: BlobRefDto[];
  emailRouting?: {
    emailAddressList?: string[];
    privateEmailDomainList?: string[];
    hiddenPrivateEmailDomainList?: string[];
    publicEmailDomainList?: string[];
  };
};

type StatusResponseDto = {
  storageFormat: number;
  manifestRevision: number | null;
  bucketRevisions: BucketRevisionDto[];
};

type UploadResponseDto = {
  status: number;
  newManifestRevision: number;
  newBucketRevisions: BucketRevisionDto[];
  missingBlobHashes: string[];
};

type MissingBlobsResponseDto = { missing: string[] };

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
     * Step 1 — network fetch. Failures here (server unreachable, HTTP error, or ServerUpdateRequiredError for an
     * outdated server) are "can't reach / must update the server" conditions, NOT vault-processing problems, so
     * they propagate unchanged and the caller maps them to the appropriate "server" message.
     */
    devLog('[V2Pull] Step 1/4: fetching vault snapshot (GET /v2/Vault)...');
    const snapshot = await this.fetchSnapshot();
    devLog(`[V2Pull] Step 1/4 done: storageFormat=${snapshot.storageFormat}, revision=${snapshot.manifestRevision}, manifestBlob=${snapshot.manifestBlob?.length ?? 0} chars, buckets=${snapshot.buckets?.length ?? 0}, blobRefs=${snapshot.blobReferences?.length ?? 0}`);

    /*
     * Steps 2–4 — decrypt, materialize, and re-encrypt. Any failure here is a client-side vault-processing error
     * (codec/format mismatch, integrity failure, corrupt blob, …). We wrap it in a VaultProcessingError so the UI
     * can surface the real technical detail in a copyable report instead of a misleading "server unreachable".
     */
    try {
      if (snapshot.storageFormat === STORAGE_FORMAT_MANIFEST) {
        // Manifest-v1 user: materialize the manifest + metadata + blobs into a SQLite blob, then encrypt it.
        devLog('[V2Pull] Step 2/4: manifest format — decrypting and reassembling local SQLite...');
        const pull = await this.materializeFromSnapshot(snapshot, encryptionKey);
        devLog(`[V2Pull] Step 3/4: materialized SQLite (${pull.sqliteBase64.length} base64 chars); re-encrypting for local storage...`);
        const encryptedVault = await EncryptionUtility.symmetricEncrypt(pull.sqliteBase64, encryptionKey);
        devLog('[V2Pull] Step 4/4: re-encryption done, returning VaultResponse.');
        return this.buildResponse(encryptedVault, '2.0.0', pull.manifestRevision, snapshot);
      }

      /*
       * Not-yet-migrated (sqlite-blob fallback) user: the server returned the legacy encrypted SQLite blob. It's already in the stored
       * format (encrypted SQLite), so we pass it through unchanged — the on-open schema upgrade handles the rest.
       */
      devLog('[V2Pull] Step 2/4: legacy blob pass-through (user not yet migrated), returning as-is.');
      return this.buildResponse(
        snapshot.legacyVaultBlob ?? '',
        snapshot.version ?? '',
        typeof snapshot.manifestRevision === 'number' ? snapshot.manifestRevision : 0,
        snapshot
      );
    } catch (error) {
      devError('[V2Pull] FAILED — the last logged step above is where it broke:', error);
      throw new VaultProcessingError('vault-pull', error);
    }
  }

  /**
   * Ask the server which storage format the user is on. Throws error if the server predates the v2 API.
   */
  public async checkStatus(): Promise<VaultSyncStatus> {
    const webApi = new WebApiService();
    try {
      const dto = await webApi.get<StatusResponseDto>(STATUS_ENDPOINT);
      const settingsRevision = (dto.bucketRevisions ?? []).find(b => b.category === SETTINGS_BUCKET_CATEGORY)?.revision ?? null;
      return {
        isMigrated: dto.storageFormat === STORAGE_FORMAT_MANIFEST,
        manifestRevision: dto.manifestRevision,
        settingsRevision,
      };
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
    const webApi = new WebApiService();
    try {
      return await webApi.get<GetResponseDto>(SNAPSHOT_ENDPOINT);
    } catch (e) {
      if (isNotFoundError(e)) {
        throw new ServerUpdateRequiredError();
      }
      throw e;
    }
  }

  /**
   * Materialize a local SQLite database from an already-fetched manifest-v1 snapshot: verify ciphertext integrity,
   * decrypt + unwrap the manifest/metadata, fetch any missing referenced blobs, then run the codec.
   * @param snapshot - the raw GET /v2/Vault response
   * @param vek - the symmetric key used to decrypt the manifest + metadata + blobs
   */
  private async materializeFromSnapshot(snapshot: GetResponseDto, vek: string): Promise<PullResult> {
    const webApi = new WebApiService();
    if (!snapshot.manifestBlob) {
      throw new Error('VaultSyncService: server returned no manifest blob, nothing to assemble.');
    }

    // Storage-layer integrity: verify the ciphertext we received matches the hash the server stored.
    if (snapshot.manifestCiphertextHash) {
      const actual = await vaultCodecComputeCiphertextHash(snapshot.manifestBlob);
      if (actual !== snapshot.manifestCiphertextHash) {
        throw new Error('VaultSyncService: manifest ciphertext hash mismatch, refusing to load. Possible storage corruption.');
      }
    }

    devLog('[V2Pull] Manifest ciphertext hash verified; decrypting + opening manifest...');
    const manifestJson = await decryptUnpack(snapshot.manifestBlob, vek);
    const manifest = JSON.parse(manifestJson) as VaultManifest;
    devLog(`[V2Pull] Manifest opened (content hash verified): schemaVersion=${manifest.schemaVersion}, migrationId=${manifest.migrationId}, tables: ${Object.entries(manifest.tables).map(([t, rows]) => `${t}=${rows.length}`).join(', ')}`);

    // Persist the user salt locally so subsequent canonicalizes hash blobs the same way.
    await storage.setItem(SALT_STORAGE_KEY, manifest.userSalt);
    const manifestRevision = typeof snapshot.manifestRevision === 'number' ? snapshot.manifestRevision : 0;
    await storage.setItem('local:serverRevision', manifestRevision);

    // Decrypt every data bucket in the snapshot (Settings today; more categories later).
    const dataBuckets: VaultDataBucket[] = [];
    for (const bucketDto of (snapshot.buckets ?? [])) {
      if (!bucketDto.blob) {
        continue;
      }
      if (bucketDto.ciphertextHash) {
        const actual = await vaultCodecComputeCiphertextHash(bucketDto.blob);
        if (actual !== bucketDto.ciphertextHash) {
          throw new Error(`VaultSyncService: "${bucketDto.category}" bucket ciphertext hash mismatch, refusing to load.`);
        }
      }
      const bucketJson = await decryptUnpack(bucketDto.blob, vek);
      const bucket = JSON.parse(bucketJson) as VaultDataBucket;
      dataBuckets.push(bucket);
      const rowCount = Object.values(bucket.tables ?? {}).reduce((n, rows) => n + rows.length, 0);
      devLog(`[V2Pull] Data bucket "${bucketDto.category}" opened: ${rowCount} rows (revision ${bucketDto.revision}).`);
      if (typeof bucketDto.revision === 'number') {
        await storage.setItem(bucketRevKey(bucketDto.category), bucketDto.revision);
      }
    }
    if (dataBuckets.length === 0) {
      devLog('[V2Pull] No data buckets in snapshot.');
    }

    // Fetch any blobs referenced by the manifest that aren't already in the local (encrypted) cache.
    const refs = snapshot.blobReferences ?? [];
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
     * the cache stays bounded by the current vault size. A referenced blob the server couldn't serve is fatal
     * for attachments (silently dropping bytes would propagate permanent data loss on the next push); a missing
     * favicon only degrades cosmetically, so it's logged and skipped.
     */
    const prunedCache: Record<string, string> = {};
    const blobMap = new Map<string, Uint8Array>();
    for (const r of refs) {
      const ciphertext = cache[r.hash];
      if (!ciphertext) {
        if (r.category === 'attachment') {
          throw new Error(`VaultSyncService: attachment blob ${r.hash} is referenced by the manifest but missing on the server, refusing to assemble an incomplete vault.`);
        }
        devWarn(`[V2Sync] Referenced ${r.category} blob ${r.hash} missing on server, continuing without it.`);
        continue;
      }
      prunedCache[r.hash] = ciphertext;
      blobMap.set(r.hash, await this.decryptBlobToBytes(ciphertext, vek));
    }
    await this.saveBlobCache(prunedCache);

    // The server demonstrably has every blob it just served or referenced, seed the upload diff with them.
    await storage.setItem(SERVER_HASHES_STORAGE_KEY, refs.map(r => r.hash));

    devLog(`[V2Pull] ${blobMap.size} blobs decrypted; running codec reassembly into a fresh SQLite...`);
    const sqlGen = new VaultSqlGenerator();
    const schemaSql = sqlGen.getCompleteSchemaSql();
    const materialized = await vaultCodecMaterializeAsSqlite(manifest, dataBuckets);
    const sqliteBase64 = await VaultCodec.insertTables(materialized, blobMap, schemaSql);
    devLog('[V2Pull] Codec reassembly complete.');

    return {
      sqliteBase64,
      manifestRevision,
      emailRouting: {
        emailAddressList: snapshot.emailRouting?.emailAddressList ?? [],
        privateEmailDomainList: snapshot.emailRouting?.privateEmailDomainList ?? [],
        hiddenPrivateEmailDomainList: snapshot.emailRouting?.hiddenPrivateEmailDomainList ?? [],
        publicEmailDomainList: snapshot.emailRouting?.publicEmailDomainList ?? [],
      },
    };
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
   * Canonicalize the current SQLite vault, validate, encrypt, and POST /v2/Vault. Only blobs the server doesn't
   * already have are encrypted and pre-uploaded (in size-capped batches) before the manifest POST, so a routine
   * save of a vault with hundreds of attachments uploads kilobytes, not the whole blob set. If the manifest POST
   * reports missing blobs still missing (stale local knowledge, e.g. server-side GC), the missing bytes are uploaded
   * and the POST retried once.
   * @param sqliteClient - the in-memory SQLite the user has been editing
   * @param vek - the symmetric encryption key
   * @param username - the user's username (sent in the upload payload for cross-check)
   * @param emailAddressList - claimed email aliases (server needs these in plaintext for routing)
   * @returns Push outcome.
   */
  public async push(
    sqliteClient: SqliteClient,
    vek: string,
    username: string,
    emailAddressList: string[]
  ): Promise<PushResult> {
    // 1) Canonicalize using the persisted user salt (or generate one on first save).
    let userSalt = (await storage.getItem(SALT_STORAGE_KEY)) as string | null;
    if (!userSalt) {
      userSalt = await vaultCodecGenerateUserSalt();
      await storage.setItem(SALT_STORAGE_KEY, userSalt);
    }

    // Read tables from the SQLite database and apply the manifest-v1 format rules.
    const tables = VaultCodec.readTables(sqliteClient);
    const migrationId = VaultCodec.getLatestMigrationId(sqliteClient);
    const canonicalized = await timedStage('canonicalize (incl. Rust→JS conversion)', () => vaultCodecCanonicalizeFromSqlite({
      tables,
      userSalt,
      migrationId,
      version: '2.0.0',
      canonicalizedAt: new Date().toISOString(),
    }));

    // Plaintext blob bytes held platform-side for encryption/upload.
    const blobEntries = new Map<string, BlobEntry>(
      Object.entries(canonicalized.blobs).map(([hash, entry]) => [
        hash,
        { kind: entry.kind as 'favicon' | 'attachment', bytes: VaultCodec.base64ToBytes(entry.bytesBase64) },
      ])
    );

    // Debug: full unencrypted manifest + data buckets, inspectable in the console. TODO: remove when going to production.
    devLog('[V2Push] Unencrypted manifest:', canonicalized.manifest);
    devLog(`[V2Push] Unencrypted data buckets (${canonicalized.dataBuckets.length}):`, canonicalized.dataBuckets);

    // 2) Pre-upload structural validation, refuses to upload malformed manifests / data buckets.
    const manifestValidation = await timedStage('validate-manifest (incl. JS→Rust conversion)', () => vaultCodecValidateManifest(canonicalized.manifest));
    if (!manifestValidation.ok) {
      return {
        status: 'rejected',
        newManifestRevision: null,
        reasons: [`Manifest validation failed: ${manifestValidation.failedRules.join(', ')}. ${manifestValidation.message}`.trim()],
      };
    }

    for (const bucket of canonicalized.dataBuckets) {
      const bucketValidation = await vaultCodecValidateDataBucket(bucket);
      if (!bucketValidation.ok) {
        return {
          status: 'rejected',
          newManifestRevision: null,
          reasons: [`Data bucket "${bucket.category}" validation failed: ${bucketValidation.failedRules.join(', ')}. ${bucketValidation.message}`.trim()],
        };
      }
    }

    // 3) Pack then AES-GCM encrypt.
    const manifestPlaintext = await timedStage('stringify-manifest', () => JSON.stringify(canonicalized.manifest));
    const { ciphertext: manifestCiphertext, compressedBytes: manifestCompressedBytes } = await packEncrypt(manifestPlaintext, vek);
    const manifestCiphertextHash = await vaultCodecComputeCiphertextHash(manifestCiphertext);
    devLog(`[V2Push] Manifest blob: raw ${formatKb(manifestPlaintext.length)} → compressed ${formatKb(manifestCompressedBytes)} → encrypted ${formatKb(manifestCiphertext.length)}.`);

    // Pack + encrypt each data bucket into its own upload entry.
    const bucketDtos: Array<{ category: string; blob: string; ciphertextHash: string }> = [];
    for (const bucket of canonicalized.dataBuckets) {
      const bucketPlaintext = JSON.stringify(bucket);
      const { ciphertext, compressedBytes } = await packEncrypt(bucketPlaintext, vek);
      const ciphertextHash = await vaultCodecComputeCiphertextHash(ciphertext);
      bucketDtos.push({ category: bucket.category, blob: ciphertext, ciphertextHash });
      devLog(`[V2Push] Data bucket "${bucket.category}": raw ${formatKb(bucketPlaintext.length)} → compressed ${formatKb(compressedBytes)} → encrypted ${formatKb(ciphertext.length)}.`);
    }

    /*
     * 4) Blob diff: only encrypt + upload blobs the server doesn't already have. First filter by local knowledge
     * of the server's blob set (refreshed on every pull/push), then confirm the remainder with the server via
     * POST blobs/missing.
     */
    const webApi = new WebApiService();
    const allBlobHashes = Array.from(blobEntries.keys());
    const knownServerHashes = new Set(((await storage.getItem(SERVER_HASHES_STORAGE_KEY)) as string[] | null) ?? []);
    const candidates = allBlobHashes.filter(h => !knownServerHashes.has(h));

    let hashesToUpload: string[] = [];
    if (candidates.length > 0) {
      const missingResp = await webApi.post<{ hashes: string[] }, MissingBlobsResponseDto>(BLOBS_MISSING_ENDPOINT, { hashes: candidates });
      hashesToUpload = missingResp.missing ?? [];
    }

    devLog(`[V2Push] Blob diff: ${allBlobHashes.length} blobs in vault, ${candidates.length} not known to be on server, ${hashesToUpload.length} confirmed missing → uploading ${hashesToUpload.length}.`);

    // Pre-upload the missing blobs in size-capped batches so the manifest POST below carries references only.
    const uploadedCiphertexts = await this.uploadBlobs(webApi, blobEntries, hashesToUpload, vek);

    const blobReferences: BlobRefDto[] = Array.from(blobEntries.entries()).map(([hash, entry]) => ({
      hash,
      category: entry.kind,
    }));

    const currentManifestRevision = ((await storage.getItem('local:serverRevision')) as number | null) ?? 0;
    const itemCount = (canonicalized.manifest.tables.Items ?? []).length;

    const payload = {
      username,
      version: canonicalized.manifest.version,
      manifestBlob: manifestCiphertext,
      manifestCiphertextHash,
      currentManifestRevision,
      credentialsCount: itemCount,
      buckets: bucketDtos,
      newBlobs: [],
      blobReferences,
      emailRouting: { emailAddressList },
      encryptionPublicKey: '',
    };

    let resp = await webApi.post<typeof payload, UploadResponseDto>(UPLOAD_ENDPOINT, payload);

    if (resp.missingBlobHashes && resp.missingBlobHashes.length > 0) {
      /*
       * Our local knowledge of the server's blob set was stale (e.g. the server GC'd a blob between syncs).
       * Upload the bytes it asked for and retry the manifest POST once.
       */
      const unsatisfiable = resp.missingBlobHashes.filter(h => !blobEntries.has(h));
      if (unsatisfiable.length > 0) {
        return { status: 'missing-blobs', newManifestRevision: resp.newManifestRevision, reasons: unsatisfiable };
      }

      devWarn(`[V2Sync] Server reported ${resp.missingBlobHashes.length} missing blob(s); uploading and retrying once.`);
      const retried = await this.uploadBlobs(webApi, blobEntries, resp.missingBlobHashes, vek);
      for (const [hash, ciphertext] of retried.entries()) {
        uploadedCiphertexts.set(hash, ciphertext);
      }

      resp = await webApi.post<typeof payload, UploadResponseDto>(UPLOAD_ENDPOINT, payload);
      if (resp.missingBlobHashes && resp.missingBlobHashes.length > 0) {
        return { status: 'missing-blobs', newManifestRevision: resp.newManifestRevision, reasons: resp.missingBlobHashes };
      }
    }

    if (resp.status !== 0) {
      return { status: 'outdated', newManifestRevision: resp.newManifestRevision };
    }

    // 5) Update local persisted state on success.
    await storage.setItem('local:serverRevision', resp.newManifestRevision);
    for (const br of (resp.newBucketRevisions ?? [])) {
      await storage.setItem(bucketRevKey(br.category), br.revision);
    }

    // Every referenced hash is now known to be on the server, refresh the diff baseline.
    await storage.setItem(SERVER_HASHES_STORAGE_KEY, allBlobHashes);

    /*
     * Refresh the encrypted blob cache: keep entries still referenced by the new manifest, add the ciphertexts we just uploaded.
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

    const uploadedBlobChars = Array.from(uploadedCiphertexts.values()).reduce((sum, c) => sum + c.length, 0);
    const bucketChars = bucketDtos.reduce((sum, b) => sum + b.blob.length, 0);
    const totalChars = manifestCiphertext.length + bucketChars + uploadedBlobChars;
    devLog(`[V2Push] Total pushed (encrypted): manifest ${formatKb(manifestCiphertext.length)} + ${bucketDtos.length} buckets ${formatKb(bucketChars)} + ${uploadedCiphertexts.size} blobs ${formatKb(uploadedBlobChars)} = ${formatKb(totalChars)} (+ ${blobReferences.length} blob references).`);

    return { status: 'ok', newManifestRevision: resp.newManifestRevision };
  }

  /**
   * Single-data-bucket upload, for changes scoped to a separate data bucket and not touching the (main) manifest.
   * @param bucket - the new data bucket contents (its `category` selects the server bucket)
   * @param vek - encryption key
   */
  public async pushDataBucketOnly(bucket: VaultDataBucket, vek: string): Promise<{ status: 'ok' | 'outdated'; revision: number }> {
    const { category } = bucket;
    const plaintext = JSON.stringify(bucket);
    const { ciphertext, compressedBytes } = await packEncrypt(plaintext, vek);
    const ciphertextHash = await vaultCodecComputeCiphertextHash(ciphertext);
    devLog(`[V2Push] Bucket "${category}" (bucket-only): raw ${formatKb(plaintext.length)} → compressed ${formatKb(compressedBytes)} → encrypted ${formatKb(ciphertext.length)}.`);

    const webApi = new WebApiService();
    let currentRevision = (((await storage.getItem(bucketRevKey(category))) as number | null) ?? 0);
    let resp = await webApi.post<unknown, { status: number; category: string; newRevision: number }>(BUCKETS_ENDPOINT, {
      category,
      bucketBlob: ciphertext,
      bucketCiphertextHash: ciphertextHash,
      currentRevision,
    });

    if (resp.status !== 0) {
      devWarn(`[V2Push] Bucket "${category}" outdated (server at revision ${resp.newRevision}, we assumed ${currentRevision}); rebasing and retrying once.`);
      currentRevision = resp.newRevision;
      resp = await webApi.post<unknown, { status: number; category: string; newRevision: number }>(BUCKETS_ENDPOINT, {
        category,
        bucketBlob: ciphertext,
        bucketCiphertextHash: ciphertextHash,
        currentRevision,
      });
    }

    if (resp.status !== 0) {
      return { status: 'outdated', revision: resp.newRevision };
    }

    await storage.setItem(bucketRevKey(category), resp.newRevision);
    return { status: 'ok', revision: resp.newRevision };
  }

  /**
   * Encrypt the given blobs and upload them via POST /v2/Vault/blobs in size-capped batches.
   * @param blobs - plaintext blob map keyed by content hash (source of the bytes)
   * @param hashes - the subset of hashes to upload (hashes without an entry in `blobs` are skipped)
   * @param vek - symmetric encryption key
   * @param webApi - API client to reuse
   * @returns Map of hash → uploaded ciphertext (base64), for the local encrypted blob cache.
   */
  private async uploadBlobs(webApi: WebApiService, blobs: Map<string, BlobEntry>, hashes: string[], vek: string): Promise<Map<string, string>> {
    const ciphertexts = new Map<string, string>();
    if (hashes.length === 0) {
      return ciphertexts;
    }

    let batch: BlobDto[] = [];
    let batchChars = 0;
    for (const hash of hashes) {
      const entry = blobs.get(hash);
      if (!entry) {
        continue;
      }

      const ciphertext = await this.encryptBlobBytes(entry.bytes, vek);
      ciphertexts.set(hash, ciphertext);
      devLog(`[V2Push] Blob ${hash.substring(0, 12)}… (${entry.kind}): raw ${formatKb(entry.bytes.length)} → encrypted ${formatKb(ciphertext.length)}.`);

      if (batch.length > 0 && batchChars + ciphertext.length > BLOB_UPLOAD_BATCH_MAX_CHARS) {
        devLog(`[V2Push] Uploading blob batch: ${batch.length} blobs, ${formatKb(batchChars)}.`);
        await webApi.post(BLOBS_UPLOAD_ENDPOINT, { blobs: batch });
        batch = [];
        batchChars = 0;
      }

      batch.push({ hash, category: entry.kind, encryptedDataBase64: ciphertext });
      batchChars += ciphertext.length;
    }

    if (batch.length > 0) {
      devLog(`[V2Push] Uploading blob batch: ${batch.length} blobs, ${formatKb(batchChars)}.`);
      await webApi.post(BLOBS_UPLOAD_ENDPOINT, { blobs: batch });
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
   * Load the local encrypted blob cache (hash → base64 ciphertext) used to skip re-downloading known blobs.
   * Entries are stored as served to/from the server, so nothing in the cache is plaintext at rest.
   */
  private async loadBlobCache(): Promise<Record<string, string>> {
    return ((await storage.getItem(BLOB_CACHE_STORAGE_KEY)) as Record<string, string> | null) ?? {};
  }

  /**
   * Persist the local encrypted blob cache (hash → base64 ciphertext).
   * @param cache - cache to persist
   */
  private async saveBlobCache(cache: Record<string, string>): Promise<void> {
    await storage.setItem(BLOB_CACHE_STORAGE_KEY, cache);
  }
}

export const vaultSyncService = new VaultSyncService();
