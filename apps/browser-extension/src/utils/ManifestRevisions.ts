/**
 * ManifestRevisions.
 *
 * The client's last-known server revision per manifest.
 */

import { storage } from 'wxt/utils/storage';

import { StorageKeys } from '@/utils/constants/storageKeys';

/**
 * Every manifest's last-known server revision, keyed by manifest id; empty when nothing has been pulled yet.
 */
export async function getManifestRevisions(): Promise<Record<string, number>> {
  return ((await storage.getItem(StorageKeys.SERVER_MANIFEST_REVISIONS)) as Record<string, number> | null) ?? {};
}

/**
 * Replace with new data (from server).
 * @param revisions - the full set of manifest revisions from the snapshot
 */
export async function replaceManifestRevisions(revisions: Record<string, number>): Promise<void> {
  await storage.setItem(StorageKeys.SERVER_MANIFEST_REVISIONS, revisions);
}

/**
 * Merge new revisions into the stored map, used after a write where only the manifests actually written advanced.
 * @param revisions - the manifest revisions to record
 */
export async function recordManifestRevisions(revisions: Record<string, number>): Promise<void> {
  await replaceManifestRevisions({ ...await getManifestRevisions(), ...revisions });
}

/**
 * The id of this vault's own (personal) manifest, as reported by the server on the last pull.
 */
export async function getPersonalManifestId(): Promise<string | null> {
  return (await storage.getItem(StorageKeys.VAULT_PERSONAL_MANIFEST_ID)) as string | null;
}
