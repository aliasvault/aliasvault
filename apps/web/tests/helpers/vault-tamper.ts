/**
 * Breaks a test account's server vault on purpose, through the same API a client writes with, so tests can check
 * how the app reports a vault it cannot open.
 */

import { createHash, randomBytes } from 'node:crypto';

import { SrpAuthService } from '@aliasvault/client/auth/SrpAuthService';
import { EncryptionUtility } from '@aliasvault/client/crypto/EncryptionUtility';
import { getSyncableTableNames, vaultCodecCanonicalizeFromSqlite, vaultCodecGenerateManifestSalt, vaultCodecPackPayload } from '@aliasvault/client/rust/RustCore';

import './client-platform';

import type { TestUser } from './test-api';

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
  await writePersonalManifest(apiUrl, user, await EncryptionUtility.symmetricEncryptBytes(packed, user.vaultEncryptionKey));
}

/**
 * The account's personal manifest id and current revision.
 */
async function getPersonalManifest(apiUrl: string, user: TestUser): Promise<{ manifestId: string; revision: number }> {
  const response = await fetch(`${apiUrl}/v2/Vault`, { headers: { Authorization: `Bearer ${user.token}` } });
  if (!response.ok) {
    throw new Error(`GET /v2/Vault failed with status ${response.status}: ${await response.text()}`);
  }
  const snapshot = (await response.json()) as VaultSnapshot;
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
  const response = await fetch(`${apiUrl}/v2/Vault`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
    body: JSON.stringify({
      username: SrpAuthService.normalizeUsername(user.username),
      manifests: [{
        manifestId,
        manifestBlob: blob,
        manifestCiphertextHash: createHash('sha256').update(Buffer.from(blob, 'base64')).digest('hex'),
        currentRevision: revision,
        credentialsCount: 0,
        blobReferences: [],
      }],
      buckets: [],
      newBlobs: [],
      emailRouting: null,
    }),
  });
  const result = response.ok ? (await response.json()) as { status: number } : null;
  if (!result || result.status !== 0) {
    throw new Error(`POST /v2/Vault did not accept the manifest (HTTP ${response.status}, status ${result?.status}).`);
  }
}
