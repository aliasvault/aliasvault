/**
 * Breaks a test account's server vault on purpose, through the same API a client writes with, so tests can check
 * how the extension reports a vault it cannot open.
 */

import { randomBytes } from 'crypto';

import { getVaultSnapshot, pushManifest, pushManifestBlob, resolveVaultEncryptionKey, type SnapshotManifest } from './manifest-v2-api';

import type { TestUser } from './test-api';

/**
 * Replace the personal manifest with bytes that do not decrypt with the account's vault key.
 */
export async function writeUndecryptableManifest(apiUrl: string, user: TestUser): Promise<void> {
  const token = user.token!.token;
  const { manifestId, revision } = await getPersonalManifest(apiUrl, token);
  await pushManifestBlob(apiUrl, token, user.username, manifestId, randomBytes(256).toString('base64'), revision);
}

/**
 * Replace the personal manifest with a well-formed one that decrypts, holding a row the client cannot load.
 */
export async function writeManifestWithBrokenRow(apiUrl: string, user: TestUser, table: string, row: Record<string, unknown>): Promise<void> {
  const token = user.token!.token;
  const { manifestId, revision } = await getPersonalManifest(apiUrl, token);
  const manifest = { schemaVersion: 1, manifestSalt: randomBytes(32).toString('hex'), canonicalizedAt: new Date().toISOString(), manifestId, tables: { [table]: [row] } };

  const vaultKey = await resolveVaultEncryptionKey(apiUrl, token, user.encryptionKey!);
  await pushManifest(apiUrl, token, user.username, manifestId, manifest, revision, [], vaultKey);
}

/**
 * The account's personal manifest entry, which exists from registration on, before any client wrote to it.
 */
async function getPersonalManifest(apiUrl: string, token: string): Promise<SnapshotManifest> {
  const snapshot = await getVaultSnapshot(apiUrl, token);
  const personal = snapshot.manifests?.find((m) => m.manifestId === snapshot.personalManifestId);
  if (!personal) {
    throw new Error('Test account has no personal manifest to overwrite.');
  }
  return personal;
}
