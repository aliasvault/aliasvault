/**
 * ManifestRevisions.
 *
 * The client's last-known server revisions: one per manifest, plus one per data bucket split out of a manifest.
 * The two counters advance independently, so both are compared before deciding a pull.
 */

import { storage } from 'wxt/utils/storage';

import { bucketRevisionKey, StorageKeys } from '@/utils/constants/storageKeys';
import type { BucketRevision, ManifestRevision } from '@/utils/dist/core/models/webapi';

/**
 * Index a revision list as reported by the server (status call) by manifest id.
 * @param revisions - the per-manifest revisions from the server
 */
export function toManifestRevisionMap(revisions: ManifestRevision[] | null | undefined): Record<string, number> {
  return Object.fromEntries((revisions ?? []).map(m => [m.manifestId, m.revision]));
}

/**
 * Index a data-bucket revision list as reported by the server (status call) by {@link bucketRevisionKey}.
 * @param revisions - the per-bucket revisions from the server
 */
export function toBucketRevisionMap(revisions: BucketRevision[] | null | undefined): Record<string, number> {
  return Object.fromEntries((revisions ?? []).map(b => [bucketRevisionKey(b.manifestId, b.category), b.revision]));
}

/**
 * The manifests whose local state no longer matches what the server reports, so the client has to pull and
 * re-materialize. Every manifest is judged on its own, the personal one included: the server reports it by id like
 * any other, and with shared folders in play only some of them move at a time.
 *
 * Idempotent: right after a successful materialize both maps match, so this returns nothing until the next change.
 * @param serverRevisions - the server's current revision per manifest
 * @param localRevisions - the client's last-known revision per manifest
 */
export function manifestsRequiringPull(serverRevisions: Record<string, number>, localRevisions: Record<string, number>): string[] {
  const requiringPull = Object.keys(serverRevisions).filter(manifestId => localRevisions[manifestId] !== serverRevisions[manifestId]);

  // A manifest the client still tracks but the server no longer lists was removed or revoked; re-materializing drops it.
  requiringPull.push(...Object.keys(localRevisions).filter(manifestId => !(manifestId in serverRevisions)));

  return requiringPull;
}

/**
 * The data buckets whose local state no longer matches what the server reports.
 *
 * Same shape and idempotence as the manifest comparison; keys are {@link bucketRevisionKey}.
 * @param serverRevisions - the server's current revision per data bucket
 * @param localRevisions - the client's last-known revision per data bucket
 */
export function bucketsRequiringPull(serverRevisions: Record<string, number>, localRevisions: Record<string, number>): string[] {
  const requiringPull = Object.keys(serverRevisions).filter(key => localRevisions[key] !== serverRevisions[key]);

  // A bucket the client still tracks but the server no longer lists was removed or revoked; re-materializing drops it.
  requiringPull.push(...Object.keys(localRevisions).filter(key => !(key in serverRevisions)));

  return requiringPull;
}

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
 * Every data bucket's last-known server revision, keyed by {@link bucketRevisionKey}; empty when nothing has been pulled yet.
 */
export async function getBucketRevisions(): Promise<Record<string, number>> {
  return ((await storage.getItem(StorageKeys.VAULT_BUCKET_REVISIONS)) as Record<string, number> | null) ?? {};
}

/**
 * Replace with new data (from a pull snapshot), so the buckets of a manifest that is gone drop out with it.
 * @param revisions - the full set of bucket revisions from the snapshot
 */
export async function replaceBucketRevisions(revisions: Record<string, number>): Promise<void> {
  await storage.setItem(StorageKeys.VAULT_BUCKET_REVISIONS, revisions);
}

/**
 * Merge new revisions into the stored map, used after a write where only the buckets actually written advanced.
 * @param revisions - the bucket revisions to record
 */
export async function recordBucketRevisions(revisions: Record<string, number>): Promise<void> {
  await replaceBucketRevisions({ ...await getBucketRevisions(), ...revisions });
}

/**
 * The id of this vault's own (personal) manifest, as reported by the server on the last pull.
 */
export async function getPersonalManifestId(): Promise<string | null> {
  return (await storage.getItem(StorageKeys.VAULT_PERSONAL_MANIFEST_ID)) as string | null;
}
