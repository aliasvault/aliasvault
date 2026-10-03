/**
 * Breaks a test account's server vault on purpose, through the same API a client writes with, so tests can check
 * how the extension reports a vault it cannot open.
 */

import { randomBytes } from 'crypto';

import { getSyncableTableNames, vaultCodecCanonicalizeFromSqlite, vaultCodecGenerateManifestSalt } from '@aliasvault/client/rust/RustCore';

import { getVaultSnapshot, pushManifest, pushManifestBlob, requirePersonalManifest, resolveVaultEncryptionKey, type DecryptedManifest } from './manifest-v2-api';

import type { TestUser } from './test-api';

/**
 * Replace the personal manifest with bytes that do not decrypt with the account's vault key.
 */
export async function writeUndecryptableManifest(apiUrl: string, user: TestUser): Promise<void> {
  const token = user.token!.token;
  const { manifestId, revision } = requirePersonalManifest(await getVaultSnapshot(apiUrl, token));
  await pushManifestBlob(apiUrl, token, user.username, manifestId, randomBytes(256).toString('base64'), revision);
}

/**
 * Replace the personal manifest with a well-formed one that decrypts, holding a row the client cannot load.
 */
export async function writeManifestWithBrokenRow(apiUrl: string, user: TestUser, table: string, row: Record<string, unknown>): Promise<void> {
  const token = user.token!.token;
  const { manifestId, revision } = requirePersonalManifest(await getVaultSnapshot(apiUrl, token));
  const canonicalized = await vaultCodecCanonicalizeFromSqlite({
    tables: (await getSyncableTableNames()).map((name) => ({ name, records: [] })),
    canonicalizedAt: new Date().toISOString(),
    manifests: [{ manifestId, manifestSalt: await vaultCodecGenerateManifestSalt(), name: null }],
  });
  const manifest = canonicalized.manifests[0].manifest as DecryptedManifest;
  manifest.tables[table] = [...(manifest.tables[table] ?? []), row];

  const vaultKey = await resolveVaultEncryptionKey(apiUrl, token, user.encryptionKey!);
  await pushManifest(apiUrl, token, user.username, manifestId, manifest, revision, [], vaultKey);
}
