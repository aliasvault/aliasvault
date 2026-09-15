/**
 * ManifestRevisions.
 *
 * The client's last-known server revision per manifest.
 */

import { StorageKeys } from '../constants/StorageKeys';
import { getPlatform } from '../platform/ClientPlatform';

/**
 * Every manifest's last-known server revision, keyed by manifest id; empty when nothing has been pulled yet.
 */
async function getManifestRevisions(): Promise<Record<string, number>> {
  return ((await getPlatform().storage.get(StorageKeys.SERVER_MANIFEST_REVISIONS)) as Record<string, number> | null) ?? {};
}

/**
 * Merge new revisions into the stored map, used after a write where only the manifests actually written advanced.
 * @param revisions - the manifest revisions to record
 */
export async function recordManifestRevisions(revisions: Record<string, number>): Promise<void> {
  await getPlatform().storage.set(StorageKeys.SERVER_MANIFEST_REVISIONS, { ...await getManifestRevisions(), ...revisions });
}
