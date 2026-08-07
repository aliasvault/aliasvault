/**
 * VaultSyncService.
 *
 * Handles syncing the vault with the server and interfaces with the Rust codec.
 */

import { storage } from 'wxt/utils/storage';

import { bucketRevisionStorageKey, StorageKeys } from '@/utils/constants/storageKeys';
import { BaseQueries } from '@/utils/db/queries/BaseQueries';
import { devError, devLog, devWarn } from '@/utils/devLogger/DevLogger';
import type { VaultResponse } from '@/utils/dist/core/models/webapi';
import { VaultSqlGenerator } from '@/utils/dist/core/vault';
import { buildEmailRouting } from '@/utils/EmailRouting';
import { EncryptionUtility } from '@/utils/EncryptionUtility';
import {vaultCodecComputeCiphertextHash, vaultCodecComputeContentFingerprint, vaultCodecCanonicalizeFromSqlite, vaultCodecExtractEncryptionKeyForPublicKey, vaultCodecGenerateManifestSalt, vaultCodecUnpackPayload, vaultCodecMaterializeAsSqlite, vaultCodecPackPayload, vaultCodecValidateManifest, vaultCodecValidateDataBucket, type CodecBlobEntry, type CodecCanonicalized, type CodecManifest, type CodecManifestSpec, type CodecMaterialized} from '@/utils/RustCore';
import { SharingService, type SessionSharedManifest } from '@/utils/SharingService';
import { SqliteClient } from '@/utils/SqliteClient';
import { getItemWithFallback } from '@/utils/StorageUtility';
import { ServerUpdateRequiredError } from '@/utils/types/errors/ServerUpdateRequiredError';
import { VaultProcessingError } from '@/utils/types/errors/VaultProcessingError';
import { type VaultManifest, type VaultDataBucket, VaultCodec } from '@/utils/VaultCodec';
import { VaultKeyService } from '@/utils/VaultKeyService';
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

/**
 * The folder a client renders a manifest at: the single top-level folder inside it (the one whose
 * parent lives in a namespace this manifest cannot see, so canonicalize nulled it).
 * @param manifest - the decrypted manifest
 */
function topLevelFolderId(manifest: VaultManifest): string | null {
  const roots = (manifest.tables.Folders ?? []).filter(row => row.ParentFolderId == null && !row.IsDeleted).map(row => String(row.Id));
  return roots.length === 1 ? roots[0] : null;
}

/** Fingerprint record key for a manifest. */
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

/** A plaintext blob staged for upload: its bytes plus the key that encrypts it. */
type UploadBlobEntry = { bytes: Uint8Array; kind: 'favicon' | 'attachment'; vek: string; fromRoot: boolean };

/**
 * One manifest of a pull.
 */
type ResolvedManifest = {
  manifestId: string;
  isRoot: boolean;
  manifest: VaultManifest;
  /** The key that decrypts this manifest and every blob it references. */
  vek: string;
  revision: number;
  blobReferences: BlobRefDto[];
  /** Fingerprint of the plaintext exactly as the server served it: the push-side change-detection baseline. */
  contentFingerprint: string;
};

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
  /** Plaintext display name of a shared manifest (null for the root manifest). */
  name?: string | null;
  /** Username of the manifest owner; set only when the caller is not an owner of the group owning it. Display only. */
  ownerUsername?: string | null;
  /** Whether the caller may grant/revoke access to this manifest and publish its email delivery key. */
  canAdminister?: boolean;
  /** How the caller's access to this manifest's VEK is encrypted. */
  keyType?: string | null;
  /** The manifest VEK encrypted with the caller's public key; set only on manifests we open through a grant. */
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

/** The manifest's VEK hangs off the account key hierarchy: the unlock chain produced it, nothing travels on the wire. */
const MANIFEST_KEY_TYPE_ACCOUNT = 'accountkey';

/** The manifest's VEK is encrypted to one of our public keys and carried on the manifest itself. */
const MANIFEST_KEY_TYPE_GRANT = 'grantkey';

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
  /** The caller's root manifest id; set on the sqlite-blob path where the manifests list is empty. */
  rootManifestId?: string | null;
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
 * One manifest element in a POST /v2/Vault write. Every manifest is addressed by `manifestId`, root included; `isRoot`
 * asserts what kind of target that id is and the server rejects the write when the two disagree.
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

/**
 * One manifest canonicalize produced, staged as a write candidate.
 */
type PushManifest = {
  manifestId: string;
  isRoot: boolean;
  manifest: CodecManifest;
  /** The key this manifest and its blobs encrypt with: the vault's content key for the root, the grant's VEK otherwise. */
  vek: string;
  blobs: Record<string, CodecBlobEntry>;
  /** The revision this write rebases on; the server rejects the whole batch when any is stale. */
  currentRevision: number;
};

/**
 * One manifest this vault can write, as resolved from local state before canonicalizing. The list is uniform on
 * purpose: the codec treats every manifest alike and the push drives one loop over all of them. `isRoot` marks the
 * few places where the user's own manifest genuinely differs (see {@link resolveManifestRecords}).
 */
type ManifestRecord = {
  manifestId: string;
  isRoot: boolean;
  /** Salt this manifest's blob hashes are derived with. */
  salt: string;
  /** The folder this manifest is anchored at; null for the root, which anchors nowhere. */
  folderId: string | null;
  /** The key this manifest encrypts with; null for the root, whose content key the push supplies (it can be freshly minted). */
  vek: string | null;
  /** Last-known server revision as of this resolve; the push overlays anything newer it has recorded since. */
  revision: number;
  /** Plaintext display name; null for the root. */
  name: string | null;
  /** Whether the caller may publish this manifest's email delivery key. */
  canAdminister: boolean;
};

/**
 * The canonicalized vault plus the manifest records it was split against, root first (the order canonicalize
 * requires: the first spec is the manifest being written from).
 */
type CanonicalizedVaultSet = {
  canonicalized: CodecCanonicalized;
  manifestRecords: ManifestRecord[];
};

/**
 * Write the caller's own manifest id into the `Settings` rows of a materialized vault, so every later
 * local query and write can resolve it offline. Left untouched when it is already correct: the row is
 * ordinary synced user data, and rewriting its timestamp on every pull would make each pull look like
 * a change and trigger a push.
 * @param materialized - the table set about to be inserted into the fresh vault DB
 * @param manifestId - the id of the manifest the server reported as the caller's own
 */
function recordOwnManifestId(materialized: CodecMaterialized, manifestId: string): void {
  let settings = materialized.tables.find(t => t.name === 'Settings');
  if (!settings) {
    settings = { name: 'Settings', records: [] };
    materialized.tables.push(settings);
  }

  const existing = settings.records.find(r => r.Key === BaseQueries.ROOT_MANIFEST_SETTING_KEY);
  if (existing && existing.Value === manifestId && !existing.IsDeleted) {
    return;
  }

  const now = new Date().toISOString();
  if (existing) {
    Object.assign(existing, { Value: manifestId, UpdatedAt: now, IsDeleted: 0 });
    return;
  }
  settings.records.push({ Key: BaseQueries.ROOT_MANIFEST_SETTING_KEY, Value: manifestId, CreatedAt: now, UpdatedAt: now, IsDeleted: 0 });
}

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
      await storage.removeItem(StorageKeys.VAULT_CONTENT_FINGERPRINTS);

      /*
       * Legacy user: the vault has never been materialized, so it carries no record of which manifest is
       * ours. Persist it in local storage so the first migration canonicalize step can stamp rows with it.
       */
      if (snapshot.rootManifestId) {
        await storage.setItem(StorageKeys.VAULT_ROOT_MANIFEST_ID, snapshot.rootManifestId);
      }
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
      /*
       * For legacy sqlite-blob migration: the manifest that unstamped rows are adopted into.
       * TODO: delete this field once the migration is complete.
       */
      const ownManifestId = await this.resolveRootManifestId(sqliteClient);
      const { canonicalized, manifestRecords } = await this.canonicalizeVault(sqliteClient, { adoptUnstampedInto: ownManifestId });

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

      /*
       * Record which manifest is ours in the migrated vault, exactly as a pull does. A legacy vault has
       * never been materialized and so carries no such row, while the write path resolves the stamp for
       * a new row from it (see `BaseQueries.ROOT_MANIFEST_ID`). Without this, every root-level insert
       * between the migration and the next pull resolves its stamp to NULL and is rejected outright by
       * the column's NOT NULL constraint.
       */
      recordOwnManifestId(materialized, manifestRecords[0].manifestId);

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
   * decrypt every manifest and the data buckets, fetch any missing referenced blobs, then run the codec.
   * @param snapshot - the raw GET /v2/Vault response
   * @param vek - the root manifest's symmetric key (from the unlock chain); decrypts the root manifest and the data buckets
   */
  private async materializeFromSnapshot(snapshot: GetResponseDto, vek: string): Promise<PullResult> {
    const webApi = new WebApiService();

    const rootDto = selectRootManifest(snapshot.manifests);
    if (!rootDto) {
      throw new Error('VaultSyncService: server returned no root manifest, refusing to assemble.');
    }

    if (!rootDto.blob) {
      throw new Error('VaultSyncService: server returned no manifest blob, nothing to assemble.');
    }

    // Content baselines for the push-side change detection: fingerprint every target as served by the server.
    const pulledFingerprints: Record<string, string> = {};

    /*
     * Open every manifest in the snapshot through one path, root first.
     */
    const accountKeyVeks = new Map<string, string>([[rootDto.manifestId, vek]]);
    const resolved: ResolvedManifest[] = [];
    const sessionSharedManifests: Record<string, SessionSharedManifest> = {};
    /*
     * Folder id of each manifest as of the last pull, so a manifest that is currently empty (created
     * but not yet split into) still resolves to the folder the client renders it at.
     */
    const priorFolderIds = new Map(Object.values(await SharingService.getSessionSharedManifests()).map(r => [r.manifestId, r.folderId]));
    for (const dto of [rootDto, ...(snapshot.manifests ?? []).filter(m => m.manifestId !== rootDto.manifestId)]) {
      const manifestKey = await this.resolveManifestVek(dto, accountKeyVeks, resolved[0]?.manifest ?? null);
      if (!manifestKey || !dto.blob) {
        // Same policy as a manifest that fails to open: a shared one only costs us that folder, the home one is the vault.
        if (dto.manifestId === rootDto.manifestId) {
          throw new Error(`VaultSyncService: no key resolved for the home manifest ${dto.manifestId} (key type "${dto.keyType ?? 'unspecified'}"), refusing to assemble.`);
        }
        continue;
      }

      let entry: ResolvedManifest;
      try {
        devLog(`[V2Pull] Verifying ciphertext hash; decrypting + opening ${dto.isRoot ? 'root manifest' : `shared manifest ${dto.manifestId}`}...`);
        entry = await this.openManifest(dto, manifestKey);
      } catch (e) {
        if (dto.isRoot) {
          throw e;
        }
        devWarn(`[V2Pull] Failed to open shared manifest ${dto.manifestId}, skipping it.`, e);
        continue;
      }
      resolved.push(entry);

      const folderId = dto.isRoot ? null : (topLevelFolderId(entry.manifest) ?? priorFolderIds.get(dto.manifestId) ?? null);
      devLog(`[V2Pull] Manifest ${entry.manifestId} opened (content hash verified, ${dto.isRoot ? 'root' : `folder ${folderId ?? 'unassigned'}`}): tables: ${Object.entries(entry.manifest.tables).map(([t, rows]) => `${t}=${rows.length}`).join(', ')}`);

      if (dto.isRoot) {
        /*
         * Persist the root manifest's blob salt locally so subsequent canonicalizes hash blobs the same way, and the root
         * manifest id so a push can resolve it even before the vault DB records it (see `recordOwnManifestId`).
         */
        await storage.setItem(StorageKeys.VAULT_MANIFEST_SALT, entry.manifest.manifestSalt);
        await storage.setItem(StorageKeys.VAULT_ROOT_MANIFEST_ID, entry.manifestId);
        continue;
      }

      if (folderId) {
        // A manifest the user administers must win over one they only have read access to for the same folder id.
        const existing = sessionSharedManifests[folderId];
        if (!(existing?.canAdminister && !dto.canAdminister)) {
          sessionSharedManifests[folderId] = {
            folderId,
            manifestId: dto.manifestId,
            vek: manifestKey,
            salt: entry.manifest.manifestSalt,
            revision: entry.revision,
            name: entry.manifest.name ?? dto.name ?? null,
            ownerUsername: dto.ownerUsername ?? null,
            canAdminister: dto.canAdminister ?? false,
          };
        }
      }
    }
    await SharingService.setSessionSharedManifests(sessionSharedManifests);

    const root = resolved[0];

    /*
     * Decrypt every data bucket in the snapshot (Settings today; more categories later). Buckets belong to the root
     * manifest alone (personal tables are stripped out of every shared manifest), so they all open with the root VEK.
     */
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

    // One fingerprint baseline per opened manifest, addressed by manifest id (root included).
    for (const entry of resolved) {
      pulledFingerprints[fingerprintManifestKey(entry.manifestId)] = entry.contentFingerprint;
    }

    // Persist the revision of every manifest so sync can detect when one is added or updated server-side.
    await storage.setItem(StorageKeys.SERVER_REVISION, root.revision);
    const sharedManifestRevisions = Object.fromEntries(resolved.filter(m => !m.isRoot).map(m => [m.manifestId, m.revision]));
    await storage.setItem(StorageKeys.SERVER_MANIFEST_REVISIONS, sharedManifestRevisions);
    devLog(`[V2Pull] Stored local shared-manifest revisions from snapshot: ${Object.keys(sharedManifestRevisions).length === 0 ? '(none)' : Object.entries(sharedManifestRevisions).map(([id, rev]) => `${id}=${rev}`).join(', ')}. Next status check compares against these.`);

    // Fetch any referenced blobs that aren't already in the local (encrypted) cache.
    const refOwners = new Map<string, ResolvedManifest>();
    const refs: BlobRefDto[] = [];
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
      const owner = refOwners.get(r.hash);
      const blobKey = owner?.vek ?? vek;
      /*
       * Root-manifest attachments are load-bearing (a NULL insert would propagate data loss on the next push);
       * shared-manifest blob gaps only degrade that folder, so they are logged and skipped. TODO: revisit once
       * cross-member blob availability is guaranteed (shared attachment gaps currently degrade like favicons).
       */
      const strict = r.category === 'attachment' && owner?.isRoot === true;
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
    await storage.setItem(StorageKeys.VAULT_SERVER_BLOB_HASHES, refs.map(r => r.hash));

    /*
     * Replace (not merge) the content-fingerprint baselines: the record must mirror exactly the manifests and
     * buckets the server holds right now, so entries of revoked/removed manifests drop out.
     */
    await storage.setItem(StorageKeys.VAULT_CONTENT_FINGERPRINTS, pulledFingerprints);
    devLog(`[V2Pull] Stored ${Object.keys(pulledFingerprints).length} content fingerprint baseline(s) for push-side change detection.`);

    devLog(`[V2Pull] ${blobMap.size} blobs decrypted; running codec reassembly into a fresh SQLite (${resolved.length} manifest(s) combined)...`);
    const sqlGen = new VaultSqlGenerator();
    const schemaSql = sqlGen.getCompleteSchemaSql();
    const schemaColumns = await VaultCodec.getSchemaColumns(schemaSql);
    const materialized = await vaultCodecMaterializeAsSqlite(resolved.map(m => m.manifest), dataBuckets, schemaColumns);

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

    /*
     * Record which of these manifests is ours, inside the vault we are assembling. The codec treats
     * every manifest alike: a user may own several, and which one a client calls home is its own
     * state. So this comes from what the server reported in this snapshot, and it is what the local
     * write path stamps new rows with (see `BaseQueries.ROOT_MANIFEST_ID`).
     */
    recordOwnManifestId(materialized, root.manifestId);

    const sqliteBase64 = await VaultCodec.insertTables(materialized, blobMap, schemaSql);
    devLog('[V2Pull] Codec reassembly complete.');

    return { sqliteBase64, manifestRevision: root.revision };
  }

  /**
   * Verify one snapshot manifest's ciphertext, decrypt and open it into a {@link ResolvedManifest}.
   * @param dto - the snapshot manifest (must carry a blob)
   * @param vek - the key that decrypts it
   */
  private async openManifest(dto: ManifestDto, vek: string): Promise<ResolvedManifest> {
    const isRoot = dto.isRoot === true;
    const manifestJson = await verifyDecryptUnpack(dto.blob!, vek, dto.ciphertextHash, isRoot ? 'manifest' : `shared manifest ${dto.manifestId}`);
    return {
      manifestId: dto.manifestId,
      isRoot,
      manifest: JSON.parse(manifestJson) as VaultManifest,
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
   * @param rootManifest - the already-decrypted root manifest (the durable home of rotated private keys), or null when none is open yet
   * @returns The manifest's VEK, or null when this client holds no key for it.
   */
  private async resolveManifestVek(dto: ManifestDto, accountKeyVeks: Map<string, string>, rootManifest: CodecManifest | null): Promise<string | null> {
    // A server that predates the field says nothing, and there the home manifest is the account-key one by definition.
    const keyType = dto.keyType ?? (dto.isRoot ? MANIFEST_KEY_TYPE_ACCOUNT : MANIFEST_KEY_TYPE_GRANT);

    if (keyType === MANIFEST_KEY_TYPE_ACCOUNT) {
      const accountKeyVek = accountKeyVeks.get(dto.manifestId);
      if (!accountKeyVek) {
        // Our unlock chain produced a VEK for a different manifest than the one this key is filed under.
        devWarn(`[V2Pull] Manifest ${dto.manifestId} is unlocked by the account key hierarchy, but this session holds no key for it; skipping it.`);
        return null;
      }
      return accountKeyVek;
    }

    if (keyType !== MANIFEST_KEY_TYPE_GRANT) {
      devWarn(`[V2Pull] Manifest ${dto.manifestId} states an unknown key type "${keyType}" (newer server?), skipping it.`);
      return null;
    }

    if (!rootManifest) {
      devWarn(`[V2Pull] Manifest ${dto.manifestId} is opened through a grant, but no root manifest is open to resolve the private key from; skipping it.`);
      return null;
    }

    return this.resolveGrantedVek(rootManifest, dto);
  }

  /**
   * Decrypt the VEK the server granted the caller on a manifest.
   * @param rootManifest - the already-decrypted root manifest, the durable home of rotated private keys
   * @param dto - the snapshot manifest carrying the grant
   */
  private async resolveGrantedVek(rootManifest: CodecManifest, dto: ManifestDto): Promise<string | null> {
    if (!dto.encryptedVek || !dto.encryptionPublicKey) {
      devWarn(`[V2Pull] No key available for shared manifest ${dto.manifestId}, skipping it.`);
      return null;
    }

    const privateKeyJwk = await this.resolvePrivateKeyJwk(rootManifest, dto.encryptionPublicKey);
    if (!privateKeyJwk) {
      devWarn(`[V2Pull] No key available for shared manifest ${dto.manifestId}, skipping it.`);
      return null;
    }

    try {
      return await SharingService.decryptManifestVek(dto.encryptedVek, privateKeyJwk);
    } catch (e) {
      devWarn(`[V2Pull] Failed to decrypt VEK of shared manifest ${dto.manifestId}, skipping it.`, e);
      return null;
    }
  }

  /**
   * Resolve the user's asymmetric private key (JWK string) for decrypting a shared manifest's VEK.
   * @param rootManifest - the decrypted root manifest
   * @param encryptionPublicKey - the public key the grant's VEK was encrypted with
   */
  private async resolvePrivateKeyJwk(rootManifest: CodecManifest, encryptionPublicKey: string): Promise<string | null> {
    const accountPublicKey = await VaultKeyService.getAccountPublicKey();
    if (accountPublicKey === encryptionPublicKey) {
      const sessionPrivateKey = await VaultKeyService.getSessionAccountPrivateKey();
      if (sessionPrivateKey) {
        return sessionPrivateKey;
      }
    }

    const keyRow = await vaultCodecExtractEncryptionKeyForPublicKey(rootManifest, encryptionPublicKey);
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
   *   handleUploadVault); set forceFullWrite to bypass the content-fingerprint gating and
   *   rewrite every manifest and bucket (server rollback recovery)
   * @returns Push outcome.
   */
  public async push(
    sqliteClient: SqliteClient,
    vek: string,
    username: string,
    options?: { createVaultKey?: boolean; forceFullWrite?: boolean }
  ): Promise<PushResult> {
    return this.withOutdatedServerGuard(() => this.pushInternal(sqliteClient, vek, username, options));
  }

  /**
   * The push implementation; {@link push} encrypts it with the outdated-server guard.
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
     * KEK/VEK migration: on the first push after this feature ships, generate a fresh VEK and encrypt everything
     * with it; the passed-in password-derived key becomes the KEK that encrypts the VEK. On a normal push the
     * passed-in key IS the VEK and is used directly.
     */
    const migrateToVaultKey = options?.createVaultKey === true;
    const contentKey = migrateToVaultKey ? EncryptionUtility.generateVaultEncryptionKey() : vek;

    /*
     * The full account-key hierarchy is created in one shot: a random Account Key encrypted with the KEK, the VEK
     * encrypted with the AK, and the account keypair whose private half is encrypted with the AK too.
     */
    const accountKey = migrateToVaultKey ? EncryptionUtility.generateVaultEncryptionKey() : null;
    const accountKeyPair = migrateToVaultKey ? await EncryptionUtility.generateRsaKeyPair() : null;
    const encryptedVek = accountKey ? await EncryptionUtility.encryptVaultEncryptionKey(contentKey, accountKey) : null;
    const accountKeys = accountKey && accountKeyPair ? {
      encryptedAccountKey: await EncryptionUtility.encryptVaultEncryptionKey(accountKey, vek),
      accountPublicKey: accountKeyPair.publicKey,
      encryptedAccountPrivateKey: await EncryptionUtility.symmetricEncrypt(accountKeyPair.privateKey, accountKey),
    } : null;
    if (migrateToVaultKey) {
      devLog('[V2Push] Account-key migration: generated new VEK, AK and account keypair; vault content and all blobs will be re-encrypted and re-uploaded.');
    }

    // 1) Canonicalize, reusing the pre-push no-op check's result when it is still current (same client instance, no mutations since).
    const currentMutationSequence = ((await storage.getItem(StorageKeys.MUTATION_SEQUENCE)) as number | null) ?? 0;
    const cachedSet = (canonicalizeCache && canonicalizeCache.client === sqliteClient && canonicalizeCache.mutationSequence === currentMutationSequence) ? canonicalizeCache : null;
    if (cachedSet) {
      devLog('[V2Push] Reusing the canonicalize result from the pre-push no-op check.');
    }
    const { canonicalized, manifestRecords } = cachedSet ?? await this.canonicalizeVault(sqliteClient);
    // Root first by construction (see `resolveManifestRecords`), which is also the order canonicalize requires.
    const [rootRecord, ...sharedRecords] = manifestRecords;
    const privateEmailDomains = (await getItemWithFallback<string[]>(StorageKeys.PRIVATE_EMAIL_DOMAINS)) ?? [];
    const emailRouting = buildEmailRouting(canonicalized.manifests.map(m => m.manifest), rootRecord.manifestId, privateEmailDomains);

    /*
     * Debug: manifest-set summary + full unencrypted manifests + data buckets, inspectable in the console.
     * TODO: delete the unencrypted-content logs below before release: they print plaintext vault data.
     */
    const canonicalizedBuckets = canonicalized.dataBuckets;
    devLog(`[V2Push] Canonicalize produced ${canonicalized.manifests.length} manifest(s) + ${canonicalizedBuckets.length} data bucket(s).`);
    devLog(`[V2Push] Unencrypted data buckets (${canonicalizedBuckets.length}):`, canonicalizedBuckets);
    for (const { manifest } of canonicalized.manifests) {
      const isRoot = manifest.manifestId === rootRecord.manifestId;
      devLog(`[V2Push] Unencrypted ${isRoot ? 'root manifest' : `manifest "${manifest.name ?? manifest.manifestId}"`}: tables: ${Object.entries(manifest.tables).map(([t, rows]) => `${t}=${rows.length}`).join(', ')}`, manifest);
    }

    /*
     * 2) Content-fingerprint gating: compare every canonicalized target (each manifest below, each data bucket)
     * against the fingerprint of its last-known server state and only write the targets that actually changed. A
     * missing baseline means "server state unknown" and always writes. Two cases force a blanket write: a KEK/VEK
     * migration re-keys the root manifest and all buckets (their ciphertext must be re-encrypted with the new VEK
     * even when the content is unchanged), and forceFullWrite (server rollback recovery) rewrites everything so
     * the server is restored from the client's state.
     */
    const forceFullWrite = options?.forceFullWrite === true;
    const fingerprints = await this.loadContentFingerprints();

    /*
     * The revision each manifest rebases on, re-read here rather than taken off the records: canonicalize may have
     * run earlier (the pre-push no-op check caches its result) and a write in between advances them.
     */
    const currentManifestRevision = await this.currentRootRevision();
    const storedSharedRevisions = ((await storage.getItem(StorageKeys.SERVER_MANIFEST_REVISIONS)) as Record<string, number> | null) ?? {};
    /**
     * The revision one manifest's write rebases on, falling back to the revision its grant was resolved at.
     * @param record - the manifest record
     */
    const revisionOf = (record: ManifestRecord): number => record.isRoot ? currentManifestRevision : storedSharedRevisions[record.manifestId] ?? record.revision;

    /*
     * Every manifest canonicalize produced, joined to its record: one candidate list the whole write is derived
     * from. A canonicalized manifest with no record is one this vault cannot write — its grant was not resolved on
     * the last pull — and is dropped rather than pushed with a key or revision we would have to invent.
     */
    const recordByManifestId = new Map(manifestRecords.map(r => [r.manifestId, r]));
    const candidates: PushManifest[] = canonicalized.manifests.flatMap(({ manifest, blobs }): PushManifest[] => {
      const record = recordByManifestId.get(manifest.manifestId);
      if (!record) {
        return [];
      }
      return [{
        manifestId: record.manifestId,
        isRoot: record.isRoot,
        manifest,
        // Only the root leaves its key open, for the content key resolved above.
        vek: record.vek ?? contentKey,
        blobs,
        currentRevision: revisionOf(record),
      }];
    });

    // Set up the blob entries for the write.
    const blobEntries = new Map<string, UploadBlobEntry>();
    for (const candidate of candidates) {
      for (const [hash, blob] of Object.entries(candidate.blobs)) {
        if (blobEntries.has(hash)) {
          continue;
        }
        blobEntries.set(hash, { kind: blob.kind as 'favicon' | 'attachment', bytes: VaultCodec.base64ToBytes(blob.bytesBase64), vek: candidate.vek, fromRoot: candidate.isRoot });
      }
    }

    /*
     * Pack + encrypt each changed data bucket, carrying the client's believed-current revision so each bucket
     * participates in the same all-or-nothing revision gate as the manifests. Unchanged buckets are skipped
     * (unless the write is forced, see the gating comment above).
     */
    const bucketDtos: Array<{ category: string; blob: string; ciphertextHash: string; currentRevision: number }> = [];
    const writtenBucketFingerprints: Record<string, string> = {};
    for (const bucket of canonicalizedBuckets) {
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

    /*
     * Gate, validate, pack and encrypt every candidate manifest into the write batch, each with its own VEK. An
     * unchanged manifest is skipped entirely: that avoids re-uploading it and keeps its (possibly stale) revision
     * out of the all-or-nothing gate, so another member's update to a shared folder can't fail an unrelated write.
     */
    const manifestWrites: ManifestWriteDto[] = [];
    const writtenManifestFingerprints: Record<string, string> = {};
    for (const candidate of candidates) {
      const label = candidate.isRoot ? 'Root manifest' : `Shared manifest "${candidate.manifest.name ?? candidate.manifestId}"`;
      const plaintext = await timedStage(`stringify-manifest ${candidate.manifestId}`, () => JSON.stringify(candidate.manifest));
      const fingerprint = await vaultCodecComputeContentFingerprint(plaintext);

      /*
       * A KEK/VEK migration re-keys the root manifest and all buckets (their ciphertext must be re-encrypted with
       * the new VEK even when the content is unchanged) but not the shared manifests, which keep their own VEK.
       */
      if (!forceFullWrite && !(migrateToVaultKey && candidate.isRoot) && fingerprints[fingerprintManifestKey(candidate.manifestId)] === fingerprint) {
        devLog(`[V2Push] ${label} unchanged versus server baseline, leaving it out of this write.`);
        continue;
      }

      const validation = await timedStage(`validate-manifest ${candidate.manifestId} (incl. JS→Rust conversion)`, () => vaultCodecValidateManifest(candidate.manifest));
      if (!validation.ok) {
        if (candidate.isRoot) {
          return {
            status: 'rejected',
            newManifestRevision: null,
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
        isRoot: candidate.isRoot,
        manifestBlob: ciphertext,
        manifestCiphertextHash: ciphertextHash,
        currentRevision: candidate.currentRevision,
        credentialsCount: (candidate.manifest.tables.Items ?? []).length,
        blobReferences: Object.entries(candidate.blobs).map(([hash, blob]) => ({ hash, category: blob.kind })),
        /*
         * Set only on the KEK/VEK migration push, where the server creates the vault key alongside this root revision.
         * A migration always forces a root write (see the gate above), so the key can never be stranded without one.
         */
        ...(candidate.isRoot && encryptedVek ? { encryptedVek } : {}),
      });
      writtenManifestFingerprints[candidate.manifestId] = fingerprint;
    }

    /*
     * Nothing changed versus the server baselines: skip the write (and the blob diff) entirely. Reachable when a
     * mutation was recorded but produced no canonical content change (e.g. an edit reverted to the original value).
     */
    if (manifestWrites.length === 0 && bucketDtos.length === 0) {
      devLog('[V2Push] No content changes detected (every manifest and data bucket matches the server baselines); skipping upload.');
      return { status: 'ok', newManifestRevision: currentManifestRevision };
    }

    /*
     * 4) Blob diff across the root manifest and every shared manifest in this write: only encrypt + upload blobs the
     * server doesn't already have. On a KEK/VEK migration all ROOT blobs are re-encrypted with the new VEK and
     * overwritten in place; shared-manifest blobs keep their own (unchanged) VEK and only fill genuine gaps.
     */
    const webApi = new WebApiService();
    const rootHashes = Array.from(blobEntries).filter(([, entry]) => entry.fromRoot).map(([hash]) => hash);
    const sharedHashes = Array.from(blobEntries).filter(([, entry]) => !entry.fromRoot).map(([hash]) => hash);
    const allBlobHashes = Array.from(blobEntries.keys());
    const knownServerHashes = new Set(((await storage.getItem(StorageKeys.VAULT_SERVER_BLOB_HASHES)) as string[] | null) ?? []);

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
      const uploadCandidates = allBlobHashes.filter(h => !knownServerHashes.has(h));
      let toUpload: string[] = [];
      if (uploadCandidates.length > 0) {
        const missingResp = await webApi.post<{ hashes: string[] }, MissingBlobsResponseDto>(BLOBS_MISSING_ENDPOINT, { hashes: uploadCandidates });
        toUpload = missingResp.missing ?? [];
      }
      const toUploadSet = new Set(toUpload);
      rootToUpload = rootHashes.filter(h => toUploadSet.has(h));
      sharedToUpload = sharedHashes.filter(h => toUploadSet.has(h));
    }

    devLog(`[V2Push] Blob diff: ${allBlobHashes.length} blobs across ${candidates.length} manifest(s), uploading ${rootToUpload.length} root + ${sharedToUpload.length} shared${migrateToVaultKey ? ' (root re-encrypted, VEK migration)' : ''}.`);

    // Pre-upload the missing bytes so the write below carries references only; each staged entry carries its own key.
    const uploadedCiphertexts = await this.uploadBlobs(webApi, blobEntries, rootToUpload, migrateToVaultKey);
    for (const [hash, ciphertext] of await this.uploadBlobs(webApi, blobEntries, sharedToUpload)) {
      uploadedCiphertexts.set(hash, ciphertext);
    }

    /*
     * Publish the public half of the vault's active personal keypair, which is e.g. used by SMTP services to encrypt mail for personal aliases.
     */
    const primaryKey = sqliteClient.settings.getPrimaryEncryptionKey();

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
      const manifestKey = sqliteClient.settings.getActiveManifestEncryptionKey(record.manifestId);
      if (manifestKey) {
        sharedManifestEncryptionPublicKeys.push({ manifestId: record.manifestId, publicKey: manifestKey.PublicKey });
      } else {
        /*
         * Sharing a folder mints its keypair in the same vault mutation, so an owned shared manifest without one
         * means that mutation was interrupted after the manifest was created server-side. Aliases in its subtree
         * stay personal (readable by the owner only) until sharing is toggled again.
         */
        devWarn(`[V2Push] Shared manifest anchored at folder ${record.folderId} is missing its email keypair; its aliases stay personal until sharing is re-enabled.`);
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
      accountKeys,
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
        return { status: 'missing-blobs', newManifestRevision: currentManifestRevision, reasons: unsatisfiable };
      }

      devWarn(`[V2Sync] Server reported ${resp.missingBlobHashes.length} missing blob(s); uploading and retrying once.`);
      const retriedRoot = await this.uploadBlobs(webApi, blobEntries, resp.missingBlobHashes.filter(h => blobEntries.get(h)?.fromRoot === true), migrateToVaultKey);
      const retriedShared = await this.uploadBlobs(webApi, blobEntries, resp.missingBlobHashes.filter(h => blobEntries.get(h)?.fromRoot === false));
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
    const sessionShared = await SharingService.getSessionSharedManifests();
    const writtenRevisions = new Map((resp.manifestRevisions ?? []).filter(r => !r.isRoot && r.manifestId != null).map(r => [r.manifestId as string, r.revision]));
    for (const [manifestId, revision] of writtenRevisions) {
      persistedSharedRevisions[manifestId] = revision;
    }
    for (const record of Object.values(sessionShared)) {
      const revision = writtenRevisions.get(record.manifestId);
      if (revision !== undefined) {
        record.revision = revision;
      }
    }
    await storage.setItem(StorageKeys.SERVER_MANIFEST_REVISIONS, persistedSharedRevisions);
    await SharingService.setSessionSharedManifests(sessionShared);

    /*
     * Record the new content baselines for every target this write actually carried, so the next push can skip
     * them again when unchanged. Targets left out of the write keep their existing baselines.
     */
    for (const [category, fingerprint] of Object.entries(writtenBucketFingerprints)) {
      fingerprints[fingerprintBucketKey(category)] = fingerprint;
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

    /*
     * Account-key migration completed: cache the whole blob chain for offline unlock, stage the session account
     * private key, and hand the new VEK to the caller, which must adopt it as the session encryption key and
     * re-encrypt the locally stored vault with it.
     */
    if (migrateToVaultKey && encryptedVek && accountKeys && accountKeyPair) {
      await VaultKeyService.adoptLocalAccountKeys({
        encryptedAccountKey: accountKeys.encryptedAccountKey,
        encryptedVek,
        accountPublicKey: accountKeys.accountPublicKey,
        encryptedAccountPrivateKey: accountKeys.encryptedAccountPrivateKey,
        accountPrivateKey: accountKeyPair.privateKey,
      });
      devLog('[V2Push] Account-key migration complete: hierarchy created server-side, blob chain cached locally.');
    }

    const uploadedBlobChars = Array.from(uploadedCiphertexts.values()).reduce((sum, c) => sum + c.length, 0);
    const bucketChars = bucketDtos.reduce((sum, b) => sum + b.blob.length, 0);
    const manifestChars = manifestWrites.reduce((sum, m) => sum + m.manifestBlob.length, 0);
    const totalChars = manifestChars + bucketChars + uploadedBlobChars;
    devLog(`[V2Push] Total pushed (encrypted): ${manifestWrites.length} manifest(s) ${formatKb(manifestChars)} + ${bucketDtos.length} buckets ${formatKb(bucketChars)} + ${uploadedCiphertexts.size} blobs ${formatKb(uploadedBlobChars)} = ${formatKb(totalChars)}.`);

    return { status: 'ok', newManifestRevision: newRootRevision, newEncryptionKey: migrateToVaultKey ? contentKey : undefined };
  }

  /**
   * Canonicalize the local vault into the manifest-v1 format against every manifest this vault writes, splitting
   * each shared manifest's anchor subtree off into its own manifest.
   * @param sqliteClient - the in-memory SQLite database to canonicalize
   * @returns The canonicalized set plus the manifest records it was split against
   */
  private async canonicalizeVault(sqliteClient: SqliteClient, options?: { adoptUnstampedInto?: string | null }): Promise<CanonicalizedVaultSet> {
    // Read tables from the SQLite database and apply the manifest-v1 format rules.
    const tables = VaultCodec.readTables(sqliteClient);
    const migrationId = VaultCodec.getLatestMigrationId(sqliteClient);

    const manifestRecords = await this.resolveManifestRecords(sqliteClient);
    /*
     * Membership is the ManifestId stamp on each row (written by the repositories at insert, move and share time),
     * so a spec only has to name the manifest and supply its blob salt. The root goes first: the codec reads the
     * first spec as the manifest being written from, which is the routing key every row is matched against and
     * which keeps any table the registry does not scope per manifest.
     */
    const manifests: CodecManifestSpec[] = manifestRecords.map(r => ({ manifestId: r.manifestId, manifestSalt: r.salt, name: r.name }));

    const canonicalized = await timedStage('canonicalize (incl. Rust→JS conversion)', () => vaultCodecCanonicalizeFromSqlite({
      tables,
      migrationId,
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
      if (fingerprints[fingerprintBucketKey(bucket.category)] !== await vaultCodecComputeContentFingerprint(JSON.stringify(bucket))) {
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
   * Resolve every manifest this vault can write, root first, as one uniform list.
   * @param sqliteClient - the open local vault DB
   */
  private async resolveManifestRecords(sqliteClient: SqliteClient): Promise<ManifestRecord[]> {
    let manifestSalt = (await storage.getItem(StorageKeys.VAULT_MANIFEST_SALT)) as string | null;
    if (!manifestSalt) {
      manifestSalt = await vaultCodecGenerateManifestSalt();
      await storage.setItem(StorageKeys.VAULT_MANIFEST_SALT, manifestSalt);
    }

    const records: ManifestRecord[] = [{
      manifestId: await this.resolveRootManifestId(sqliteClient),
      isRoot: true,
      salt: manifestSalt,
      folderId: null,
      vek: null,
      revision: await this.currentRootRevision(),
      name: null,
      // The root's own delivery key is published as the account-level key, not per manifest.
      canAdminister: false,
    }];

    const folderIdsInDb = new Set(sqliteClient.executeQuery<{ Id: string }>('SELECT Id FROM Folders').map(r => r.Id));
    for (const record of Object.values(await SharingService.getSessionSharedManifests())) {
      if (!folderIdsInDb.has(record.folderId)) {
        continue;
      }
      records.push({
        manifestId: record.manifestId,
        isRoot: false,
        salt: record.salt,
        folderId: record.folderId,
        vek: record.vek,
        revision: record.revision ?? 0,
        name: record.name ?? null,
        canAdminister: record.canAdminister === true,
      });
    }

    return records;
  }

  /**
   * The root manifest's last-known server revision. It lives under its own storage key rather than in the
   * per-manifest revision map: the server addresses the root by the auth session, never by id.
   */
  private async currentRootRevision(): Promise<number> {
    return ((await storage.getItem(StorageKeys.SERVER_REVISION)) as number | null) ?? 0;
  }

  /**
   * The id of this vault's own (root) manifest. The vault DB's own setting is the durable source (written on each
   * materialize); the storage copy covers the one case where no materialize has run yet: the local schema
   * migration of a legacy sqlite-blob vault, which canonicalizes before it records the setting row.
   * @param sqliteClient - the open local vault DB
   */
  private async resolveRootManifestId(sqliteClient: SqliteClient): Promise<string> {
    const rootManifestId = sqliteClient.settings.getRootManifestId() ?? ((await storage.getItem(StorageKeys.VAULT_ROOT_MANIFEST_ID)) as string | null);
    if (!rootManifestId) {
      throw new Error('VaultSyncService: no root manifest id available (no vault setting and no snapshot baseline); pull once before pushing.');
    }
    return rootManifestId;
  }

  /**
   * Encrypt the given blobs (each staged with its own VEK: root VEK or a folder VEK) and upload them via
   * POST /v2/Vault/blobs in size-capped batches. `overwrite` is set only for root blobs on a KEK/VEK migration;
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
