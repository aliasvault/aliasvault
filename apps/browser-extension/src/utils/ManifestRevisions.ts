/**
 * ManifestRevisions.
 *
 * The client's last-known server revision per manifest.
 */

import { storage } from 'wxt/utils/storage';

import { StorageKeys } from '@/utils/constants/storageKeys';
import { devWarn } from '@/utils/devLogger/DevLogger';

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

/** The personal manifest's last-known server revision. */
export async function getPersonalManifestRevision(): Promise<number> {
  const personalManifestId = await getPersonalManifestId();
  return personalManifestId ? (await getManifestRevisions())[personalManifestId] ?? 0 : 0;
}

/**
 * Record the personal manifest's revision.
 * @param revision - the revision the server reported for the personal manifest
 */
export async function recordPersonalManifestRevision(revision: number): Promise<void> {
  const personalManifestId = await getPersonalManifestId();
  if (!personalManifestId) {
    devWarn(`[VaultSync] No personal manifest id known, dropping personal revision ${revision}; the next sync pulls to rebuild the baseline.`);
    return;
  }

  await recordManifestRevisions({ [personalManifestId]: revision });
}
