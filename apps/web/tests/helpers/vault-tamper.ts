/**
 * Breaks a test account's server vault on purpose, through the same API a client writes with, so tests can check
 * how the app reports a vault it cannot open.
 */

import { createHash, randomBytes, webcrypto } from 'node:crypto';

import { SrpAuthService } from '@aliasvault/client/auth/SrpAuthService';
import { getSyncableTableNames, vaultCodecCanonicalizeFromSqlite, vaultCodecGenerateManifestSalt, vaultCodecPackPayload } from '@aliasvault/client/rust/RustCore';

import './client-platform';

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
  const canonicalized = await vaultCodecCanonicalizeFromSqlite({
    tables: (await getSyncableTableNames()).map((name) => ({ name, records: [] })),
    canonicalizedAt: new Date().toISOString(),
    manifests: [{ manifestId, manifestSalt: await vaultCodecGenerateManifestSalt(), name: null }],
  });
  const manifest = canonicalized.manifests[0].manifest as { tables: Record<string, unknown[]> };
  manifest.tables[table] = [...(manifest.tables[table] ?? []), row];

  const packed = await vaultCodecPackPayload(JSON.stringify(manifest));
  await writePersonalManifest(apiUrl, user, await encryptManifest(packed, user.vaultEncryptionKey, manifestId));
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
