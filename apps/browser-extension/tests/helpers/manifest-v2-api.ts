/**
 * Node-side manifest-v1 vault client for E2E tests.
 *
 * Lets a test act as a second, "newer" client against the v2 Vault API: pull the snapshot,
 * decrypt + unpack the root manifest, modify it (e.g. inject columns/tables an older client's
 * schema doesn't know), and push it back as a new revision. Pack/unpack goes through the real
 * Rust WASM codec so the integrity envelope's canonical content hash matches exactly what the
 * extension verifies on pull.
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { initSync, vaultCodecPackPayload, vaultCodecUnpackPayload } from '../../src/utils/dist/core/rust/aliasvault_core.js';

import { normalizeUsername, symmetricDecryptBytes, symmetricEncryptBytes } from './test-api';

/** One manifest entry in the v2 GET snapshot. */
export type SnapshotManifest = {
  manifestId: string;
  isRoot: boolean;
  blob: string;
  ciphertextHash: string;
  revision: number;
  blobReferences: Array<{ hash: string; category: string }>;
};

/** The v2 GET /Vault snapshot (fields relevant to these tests). */
export type VaultSnapshot = {
  status: number;
  /** Server StorageFormat enum: 0 = legacy sqlite-blob, 1 = manifest-v1. */
  storageFormat: number;
  manifests?: SnapshotManifest[];
  buckets?: Array<{ category: string; blob: string; ciphertextHash: string; revision: number }>;
};

/** A decrypted manifest-v1 manifest: known top-level fields plus free-form tables. */
export type DecryptedManifest = {
  schemaVersion: number;
  migrationId: string;
  version: string;
  userSalt: string;
  canonicalizedAt: string;
  tables: Record<string, Array<Record<string, unknown>>>;
  [key: string]: unknown;
};

let wasmInitialized = false;

/**
 * Initializes the Rust core WASM module from the extension's dist (idempotent).
 */
function ensureWasm(): void {
  if (!wasmInitialized) {
    const wasmPath = join(process.cwd(), 'src/utils/dist/core/rust/aliasvault_core_bg.wasm');
    initSync({ module: readFileSync(wasmPath) });
    wasmInitialized = true;
  }
}

/**
 * Fetches the v2 vault snapshot for the authenticated user.
 *
 * @param apiBaseUrl - The base URL of the API
 * @param token - Bearer token
 * @returns The snapshot response
 */
export async function getVaultSnapshot(apiBaseUrl: string, token: string): Promise<VaultSnapshot> {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/v2/Vault`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`GET /v2/Vault failed with status ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as VaultSnapshot;
}

/**
 * Returns the root manifest entry of a snapshot, or throws if the user isn't on manifest-v1 yet.
 *
 * @param snapshot - The v2 snapshot
 * @returns The root manifest entry
 */
export function requireRootManifest(snapshot: VaultSnapshot): SnapshotManifest {
  const root = (snapshot.manifests ?? []).find((m) => m.isRoot);
  if (snapshot.storageFormat !== 1 || !root?.blob) {
    throw new Error(`Snapshot is not manifest-v1 yet (storageFormat=${snapshot.storageFormat}, manifests=${snapshot.manifests?.length ?? 0}).`);
  }
  return root;
}

/**
 * Decrypts and unpacks a manifest blob into its JSON object (content hash verified by the codec).
 *
 * @param blobBase64 - The encrypted manifest blob from the snapshot
 * @param encryptionKey - The user's derived vault encryption key
 * @returns The decrypted manifest object
 */
export async function openManifest(blobBase64: string, encryptionKey: Uint8Array): Promise<DecryptedManifest> {
  ensureWasm();
  const packedBytes = await symmetricDecryptBytes(blobBase64, encryptionKey);
  return JSON.parse(vaultCodecUnpackPayload(packedBytes)) as DecryptedManifest;
}

/**
 * Packs (envelope + canonical content hash + gzip via the Rust codec), encrypts, and uploads a
 * manifest as a new revision, exactly like the extension's full push does.
 *
 * @param apiBaseUrl - The base URL of the API
 * @param token - Bearer token
 * @param username - The vault owner's username
 * @param manifest - The (modified) manifest object to upload
 * @param currentRevision - The revision this upload is based on (server assigns currentRevision + 1)
 * @param blobReferences - Blob references to carry over to the new revision
 * @param encryptionKey - The user's derived vault encryption key
 * @returns The new manifest revision number assigned by the server
 */
export async function pushManifest(
  apiBaseUrl: string,
  token: string,
  username: string,
  manifest: DecryptedManifest,
  currentRevision: number,
  blobReferences: Array<{ hash: string; category: string }>,
  encryptionKey: Uint8Array
): Promise<number> {
  ensureWasm();
  const packedBytes = vaultCodecPackPayload(JSON.stringify(manifest));
  const manifestBlob = await symmetricEncryptBytes(packedBytes, encryptionKey);
  const manifestCiphertextHash = createHash('sha256').update(Buffer.from(manifestBlob, 'base64')).digest('hex');

  const payload = {
    username: normalizeUsername(username),
    version: manifest.version,
    manifestBlob,
    manifestCiphertextHash,
    currentManifestRevision: currentRevision,
    credentialsCount: (manifest.tables.Items ?? []).length,
    buckets: [],
    newBlobs: [],
    blobReferences,
    emailRouting: { emailAddressList: [] },
    encryptionPublicKey: '',
  };

  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/v2/Vault`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`POST /v2/Vault failed with status ${response.status}: ${await response.text()}`);
  }

  const result = (await response.json()) as { status: number; newManifestRevision: number; missingBlobHashes?: string[] };
  if (result.status !== 0 || (result.missingBlobHashes?.length ?? 0) > 0) {
    throw new Error(`Manifest push rejected: status=${result.status}, missingBlobs=${result.missingBlobHashes?.join(',') ?? 'none'}`);
  }
  return result.newManifestRevision;
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
