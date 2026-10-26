/**
 * Breaks a test account's server vault on purpose, through the same API a client writes with, so tests can check
 * how the app reports a vault it cannot open.
 */

import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { SrpAuthService } from '@aliasvault/client/auth/SrpAuthService';

import { getVaultSnapshotHeader, type TestUser } from './test-api';

/**
 * The part of GET /v2/Vault these helpers read.
 */
type VaultSnapshot = {
  personalManifestId?: string | null;
  manifests?: Array<{ manifestId: string; revision: number }>;
};

/**
 * Replace the personal manifest with bytes that do not decrypt with the account's vault key.
 */
export async function writeUndecryptableManifest(apiUrl: string, user: TestUser): Promise<void> {
  await writePersonalManifest(apiUrl, user, randomBytes(256).toString('base64'));
}

/**
 * Replace the personal manifest with a well-formed one that decrypts, holding a row the client cannot load.
 */
export async function writeManifestWithBrokenRow(apiUrl: string, user: TestUser, table: string, row: Record<string, unknown>): Promise<void> {
  const { manifestId } = await getPersonalManifest(apiUrl, user);
  const manifest = { schemaVersion: 1, manifestSalt: randomBytes(32).toString('hex'), canonicalizedAt: new Date().toISOString(), manifestId, tables: { [table]: [row] } };
  const packed = packPayload(manifest);
  await writePersonalManifest(apiUrl, user, await encryptManifest(packed, user.vaultEncryptionKey, manifestId));
}

/**
 * Pack a payload as the Rust core does (`core/rust/src/vault_codec/mod.rs`): gzip of `{ schemaVersion, contentHash, payload }`,
 * the hash taken over the payload's canonical JSON.
 */
function packPayload(payload: unknown): Uint8Array {
  const contentHash = createHash('sha256').update(canonicalJson(payload)).digest('hex');
  return gzipSync(JSON.stringify({ schemaVersion: 1, contentHash, payload }));
}

/**
 * The canonical JSON the content hash is taken over: object keys sorted recursively, arrays kept in order.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Encrypt a packed manifest as the Rust core does: base64 of `IV | ciphertext | tag`, bound to the manifest's
 * associated data from `core/rust/src/crypto/aad.rs`.
 */
async function encryptManifest(packed: Uint8Array, base64Key: string, manifestId: string): Promise<string> {
  const key = await webcrypto.subtle.importKey('raw', Buffer.from(base64Key, 'base64'), 'AES-GCM', false, ['encrypt']);
  const iv = randomBytes(12);
  const additionalData = new TextEncoder().encode(`aliasvault/v1/manifest/${manifestId.trim().toLowerCase()}`);
  const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, packed);
  return Buffer.concat([iv, Buffer.from(ciphertext)]).toString('base64');
}

/**
 * The account's personal manifest id and current revision.
 */
async function getPersonalManifest(apiUrl: string, user: TestUser): Promise<{ manifestId: string; revision: number }> {
  const snapshot = await getVaultSnapshotHeader<VaultSnapshot>(apiUrl, user.token);
  const current = snapshot.manifests?.find((m) => m.manifestId === snapshot.personalManifestId);
  if (!current) {
    throw new Error('Test account has no personal manifest to overwrite.');
  }
  return current;
}

/**
 * Write the given ciphertext as the next revision of the account's personal manifest.
 */
async function writePersonalManifest(apiUrl: string, user: TestUser, blob: string): Promise<void> {
  const { manifestId, revision } = await getPersonalManifest(apiUrl, user);
  // The body is a 4-byte big-endian header length, the JSON header, then the manifest ciphertext.
  const ciphertext = Buffer.from(blob, 'base64');
  const header = Buffer.from(JSON.stringify({
    username: SrpAuthService.normalizeUsername(user.username),
    manifests: [{
      manifestId,
      offset: 0,
      size: ciphertext.length,
      manifestCiphertextHash: createHash('sha256').update(ciphertext).digest('hex'),
      currentRevision: revision,
      credentialsCount: 0,
      blobReferences: [],
    }],
    buckets: [],
    emailRouting: null,
  }));
  const headerLength = Buffer.alloc(4);
  headerLength.writeUInt32BE(header.length);
  const response = await fetch(`${apiUrl}/v2/Vault`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${user.token}` },
    body: Buffer.concat([headerLength, header, ciphertext]),
  });
  const result = response.ok ? (await response.json()) as { status: string } : null;
  if (!result || result.status !== 'ok') {
    throw new Error(`POST /v2/Vault did not accept the manifest (HTTP ${response.status}, status ${result?.status}).`);
  }
}
