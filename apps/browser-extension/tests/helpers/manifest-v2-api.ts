/**
 * Node-side manifest-v1 vault client for E2E tests.
 *
 * Lets a test act as a second, "newer" client against the v2 Vault API: pull the snapshot,
 * decrypt + unpack the personal manifest, modify it (e.g. inject columns/tables an older client's
 * schema doesn't know), and push it back as a new revision. Everything below the wire format goes
 * through the shared client core the extension itself ships.
 */

import { createHash } from 'crypto';

import { SrpAuthService } from '@aliasvault/client/auth/SrpAuthService';
import { getSyncableTableNames, openAccountKeyChain, vaultCodecCanonicalizeFromSqlite, vaultCodecGenerateManifestSalt, vaultCodecPackPayload, vaultCodecUnpackPayload } from '@aliasvault/client/rust/RustCore';

import { bucketAad, manifestAad, symmetricDecryptBytes, symmetricEncryptBytes } from './vault-crypto';

/** One manifest entry in the v2 GET snapshot. */
export type SnapshotManifest = {
  manifestId: string;
  offset: number;
  size: number;
  blob: string;
  ciphertextHash: string;
  revision: number;
  blobReferences: Array<{ hash: string; category: string }>;
};

/** The v2 GET /Vault snapshot (fields relevant to these tests). */
export type VaultSnapshot = {
  storageFormat: 'sqlite-blob' | 'manifest';
  manifests?: SnapshotManifest[];
  /** The manifest owned by the caller's personal group; every other entry is a shared one. */
  personalManifestId?: string | null;
  buckets?: Array<{ category: string; offset: number; size: number; blob: string; ciphertextHash: string; revision: number }>;
};

/** The account-key unlock chain from GET /v2/VaultKey/{type} (fields relevant to these tests). */
type VaultKeyEnvelope = {
  encryptedAccountKey: string;
  encryptedVek?: string | null;
};

/** A decrypted manifest-v1 manifest: known top-level fields plus free-form tables. */
export type DecryptedManifest = {
  schemaVersion: number;
  manifestSalt: string;
  canonicalizedAt: string;
  tables: Record<string, Array<Record<string, unknown>>>;
  [key: string]: unknown;
};

/** One manifest element of a POST /v2/Vault write. */
type ManifestWrite = {
  manifestId: string;
  manifestBlob: string;
  manifestCiphertextHash: string;
  currentRevision: number;
  credentialsCount: number;
  blobReferences: Array<{ hash: string; category: string }>;
};

/** One data bucket element of a POST /v2/Vault write. */
type BucketWrite = {
  manifestId: string;
  category: string;
  blob: string;
  ciphertextHash: string;
  currentRevision: number;
};

/** The result of a POST /v2/Vault write. */
type VaultWriteResult = {
  status: 'ok' | 'outdated';
  manifestRevisions?: Array<{ manifestId: string; revision: number }>;
  missingBlobHashes?: string[];
};

/**
 * Fetches the v2 vault snapshot for the authenticated user, with each manifest and bucket ciphertext as base64 `blob`.
 *
 * @param apiBaseUrl - The base URL of the API
 * @param token - Bearer token
 * @returns The snapshot response
 */
export async function getVaultSnapshot(apiBaseUrl: string, token: string): Promise<VaultSnapshot> {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/v2/Vault`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream' },
  });
  if (!response.ok) {
    throw new Error(`GET /v2/Vault failed with status ${response.status}: ${await response.text()}`);
  }

  // The body is a 4-byte big-endian header length, the JSON header, then the ciphertexts, each at its entry's offset after the header.
  const body = Buffer.from(await response.arrayBuffer());
  const headerLength = body.readUInt32BE(0);
  const snapshot = JSON.parse(body.subarray(4, 4 + headerLength).toString('utf8')) as VaultSnapshot;
  const data = body.subarray(4 + headerLength);
  for (const entry of [...(snapshot.manifests ?? []), ...(snapshot.buckets ?? [])]) {
    entry.blob = data.subarray(entry.offset, entry.offset + entry.size).toString('base64');
  }
  return snapshot;
}

/**
 * Returns the personal manifest entry of a snapshot, or throws if the user isn't on manifest-v1 yet.
 *
 * @param snapshot - The v2 snapshot
 * @returns The personal manifest entry
 */
export function requirePersonalManifest(snapshot: VaultSnapshot): SnapshotManifest {
  const personal = (snapshot.manifests ?? []).find((m) => m.manifestId === snapshot.personalManifestId);
  if (snapshot.storageFormat !== 'manifest' || !personal?.blob) {
    throw new Error(`Snapshot is not manifest-v1 yet (storageFormat=${snapshot.storageFormat}, manifests=${snapshot.manifests?.length ?? 0}).`);
  }
  return personal;
}

/**
 * Resolves the key the vault content is actually encrypted with.
 *
 * @param apiBaseUrl - The base URL of the API
 * @param token - Bearer token
 * @param derivedKey - The user's Argon2Id password-derived key
 * @returns The key that encrypts this account's vault content
 */
export async function resolveVaultEncryptionKey(apiBaseUrl: string, token: string, derivedKey: Uint8Array): Promise<Uint8Array> {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/v2/VaultKey/password`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`GET /v2/VaultKey failed with status ${response.status}: ${await response.text()}`);
  }

  const { vaultKey } = (await response.json()) as { vaultKey?: VaultKeyEnvelope | null };
  if (!vaultKey) {
    return derivedKey;
  }

  if (!vaultKey.encryptedVek) {
    throw new Error('Vault key chain is missing the encrypted VEK');
  }

  const opened = await openAccountKeyChain(Buffer.from(derivedKey).toString('base64'), vaultKey.encryptedAccountKey, vaultKey.encryptedVek, null);
  if (opened.status !== 'opened') {
    throw new Error(`Vault key chain did not open: ${opened.status}`);
  }
  return new Uint8Array(Buffer.from(opened.vaultEncryptionKey, 'base64'));
}

/**
 * Decrypts and unpacks a manifest blob into its JSON object (content hash verified by the codec).
 *
 * @param manifestId - The manifest the blob belongs to
 * @param blobBase64 - The encrypted manifest blob from the snapshot
 * @param encryptionKey - The key the vault content is encrypted with, from `resolveVaultEncryptionKey`
 * @returns The decrypted manifest object
 */
export async function openManifest(manifestId: string, blobBase64: string, encryptionKey: Uint8Array): Promise<DecryptedManifest> {
  const packedBytes = await symmetricDecryptBytes(blobBase64, encryptionKey, manifestAad(manifestId));
  return JSON.parse(await vaultCodecUnpackPayload(packedBytes)) as DecryptedManifest;
}

/**
 * Packs (envelope + canonical content hash + gzip via the Rust codec), encrypts, and uploads a
 * manifest as a new revision, exactly like the extension's full push does.
 *
 * @param apiBaseUrl - The base URL of the API
 * @param token - Bearer token
 * @param username - The vault owner's username
 * @param manifest - The (modified) manifest object to upload
 * @param manifestId - The manifest this write targets
 * @param currentRevision - The revision this upload is based on (server assigns currentRevision + 1)
 * @param blobReferences - Blob references to carry over to the new revision
 * @param encryptionKey - The key the vault content is encrypted with, from `resolveVaultEncryptionKey`
 * @returns The new manifest revision number assigned by the server
 */
export async function pushManifest(
  apiBaseUrl: string,
  token: string,
  username: string,
  manifestId: string,
  manifest: DecryptedManifest,
  currentRevision: number,
  blobReferences: Array<{ hash: string; category: string }>,
  encryptionKey: Uint8Array
): Promise<number> {
  const write = await buildManifestWrite(manifestId, manifest, currentRevision, blobReferences, encryptionKey);
  const result = await postVaultWrite(apiBaseUrl, token, username, [write], []);

  const written = (result.manifestRevisions ?? []).find((r) => r.manifestId === manifestId);
  if (!written) {
    throw new Error(`Manifest push returned no revision for ${manifestId}.`);
  }
  return written.revision;
}

/**
 * Uploads an already encrypted manifest blob as a new revision, so a test can write bytes no client would.
 *
 * @param apiBaseUrl - The base URL of the API
 * @param token - Bearer token
 * @param username - The vault owner's username
 * @param manifestId - The manifest this write targets
 * @param blob - The base64 manifest ciphertext to store
 * @param currentRevision - The revision this upload is based on
 */
export async function pushManifestBlob(apiBaseUrl: string, token: string, username: string, manifestId: string, blob: string, currentRevision: number): Promise<void> {
  const manifestCiphertextHash = createHash('sha256').update(Buffer.from(blob, 'base64')).digest('hex');
  const write = { manifestId, manifestBlob: blob, manifestCiphertextHash, currentRevision, credentialsCount: 0, blobReferences: [] };
  await postVaultWrite(apiBaseUrl, token, username, [write], []);
}

/**
 * Writes the first manifest-v1 revision for a newly registered account.
 *
 * @param apiBaseUrl - The base URL of the API
 * @param token - Bearer token
 * @param username - The vault owner's username
 * @param encryptionKey - The account's VEK, which the vault content is encrypted with
 * @returns The id of the personal manifest that was written
 */
export async function pushInitialVault(apiBaseUrl: string, token: string, username: string, encryptionKey: Uint8Array): Promise<string> {
  const snapshot = await getVaultSnapshot(apiBaseUrl, token);
  const manifestId = snapshot.personalManifestId;
  if (!manifestId) {
    throw new Error('Freshly registered account has no personal manifest to write the initial vault into.');
  }

  /*
   * A brand-new vault is every syncable table, all empty. Taking the list from the shared table registry keeps
   * this in step with the schema: canonicalize refuses a manifest that carries no tables at all.
   */
  const tables = (await getSyncableTableNames()).map((name) => ({ name, records: [] }));
  const canonicalized = await vaultCodecCanonicalizeFromSqlite({
    tables,
    canonicalizedAt: new Date().toISOString(),
    manifests: [{ manifestId, manifestSalt: await vaultCodecGenerateManifestSalt(), name: null }],
  });

  const manifest = canonicalized.manifests[0].manifest as DecryptedManifest;
  const manifestWrite = await buildManifestWrite(manifestId, manifest, 0, [], encryptionKey);

  const bucketWrites: BucketWrite[] = [];
  for (const bucket of canonicalized.dataBuckets) {
    const { blob, ciphertextHash } = await packEncrypt(JSON.stringify(bucket), encryptionKey, bucketAad(bucket.manifestId, bucket.category));
    bucketWrites.push({ manifestId: bucket.manifestId, category: bucket.category, blob, ciphertextHash, currentRevision: 0 });
  }

  await postVaultWrite(apiBaseUrl, token, username, [manifestWrite], bucketWrites);
  return manifestId;
}

/**
 * Polls until `predicate` returns a truthy value or the timeout elapses.
 *
 * @param predicate - Async condition; return a truthy value to stop polling
 * @param timeoutMs - Total time budget in milliseconds
 * @param intervalMs - Delay between attempts in milliseconds
 * @returns The first truthy value the predicate returned
 */
export async function pollUntil<T>(predicate: () => Promise<T | undefined | false>, timeoutMs = 20000, intervalMs = 1000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) {
        return result;
      }
    } catch (e) {
      lastError = e;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms${lastError ? `; last error: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ''}`);
}

/**
 * Packs a payload through the Rust codec and encrypts it.
 *
 * @param payloadJson - The payload to pack
 * @param encryptionKey - The key the vault content is encrypted with
 * @param aad - The associated data the ciphertext is bound to
 * @returns The encrypted blob and the ciphertext hash the server verifies it against
 */
async function packEncrypt(payloadJson: string, encryptionKey: Uint8Array, aad: Uint8Array): Promise<{ blob: string; ciphertextHash: string }> {
  const packedBytes = await vaultCodecPackPayload(payloadJson);
  const blob = await symmetricEncryptBytes(packedBytes, encryptionKey, aad);
  return { blob, ciphertextHash: createHash('sha256').update(Buffer.from(blob, 'base64')).digest('hex') };
}

/**
 * Builds one manifest element of a vault write.
 *
 * @param manifestId - The manifest this write targets
 * @param manifest - The manifest object to upload
 * @param currentRevision - The revision this upload is based on
 * @param blobReferences - Blob references to carry over to the new revision
 * @param encryptionKey - The key the vault content is encrypted with
 * @returns The manifest write element
 */
async function buildManifestWrite(
  manifestId: string,
  manifest: DecryptedManifest,
  currentRevision: number,
  blobReferences: Array<{ hash: string; category: string }>,
  encryptionKey: Uint8Array
): Promise<ManifestWrite> {
  const { blob, ciphertextHash } = await packEncrypt(JSON.stringify(manifest), encryptionKey, manifestAad(manifestId));
  return {
    manifestId,
    manifestBlob: blob,
    manifestCiphertextHash: ciphertextHash,
    currentRevision,
    credentialsCount: (manifest.tables.Items ?? []).length,
    blobReferences,
  };
}

/**
 * Sends a atomic POST /v2/Vault write.
 *
 * @param apiBaseUrl - The base URL of the API
 * @param token - Bearer token
 * @param username - The vault owner's username
 * @param manifests - The manifests this write targets, each addressed by id exactly as a real client does
 * @param buckets - The data buckets this write targets
 * @returns The write result
 */
async function postVaultWrite(
  apiBaseUrl: string,
  token: string,
  username: string,
  manifests: ManifestWrite[],
  buckets: BucketWrite[]
): Promise<VaultWriteResult> {
  // The body is a 4-byte big-endian header length, the JSON header (offset and size in place of each base64 ciphertext), then the ciphertexts.
  const ciphertexts: Buffer[] = [];
  let dataLength = 0;
  const place = (base64: string): { offset: number; size: number } => {
    const bytes = Buffer.from(base64, 'base64');
    ciphertexts.push(bytes);
    dataLength += bytes.length;
    return { offset: dataLength - bytes.length, size: bytes.length };
  };
  const header = Buffer.from(JSON.stringify({
    username: SrpAuthService.normalizeUsername(username),
    manifests: manifests.map(({ manifestBlob, ...rest }) => ({ ...rest, ...place(manifestBlob) })),
    buckets: buckets.map(({ blob, ...rest }) => ({ ...rest, ...place(blob) })),
    emailRouting: null,
  }));
  const headerLength = Buffer.alloc(4);
  headerLength.writeUInt32BE(header.length);

  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/v2/Vault`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}` },
    body: Buffer.concat([headerLength, header, ...ciphertexts]),
  });
  if (!response.ok) {
    throw new Error(`POST /v2/Vault failed with status ${response.status}: ${await response.text()}`);
  }

  const result = (await response.json()) as VaultWriteResult;
  if (result.status !== 'ok' || (result.missingBlobHashes?.length ?? 0) > 0) {
    throw new Error(`Vault write rejected: status=${result.status}, missingBlobs=${result.missingBlobHashes?.join(',') ?? 'none'}`);
  }
  return result;
}
