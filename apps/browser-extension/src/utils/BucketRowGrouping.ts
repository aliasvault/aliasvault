/**
 * Splitting a data bucket's rows across the manifests that own them.
 */

/** A bucket row as read out of SQLite. */
export type BucketRow = Record<string, unknown>;

/** A bucket category's tables and their rows. */
export type BucketTables = Record<string, BucketRow[]>;

/**
 * The `ManifestId` a row carries when it names no manifest.
 */
export const UNSTAMPED_MANIFEST_ID = '00000000-0000-0000-0000-000000000000';

/** True when a `ManifestId` value names no manifest (absent, empty, or the all-zero sentinel). */
export function isUnstampedManifestId(manifestId: string): boolean {
  return manifestId.length === 0 || manifestId.toLowerCase() === UNSTAMPED_MANIFEST_ID;
}

/**
 * Find `manifestId` among `candidates` case-insensitively, returning the candidate as it is spelled there.
 * @param candidates - The ids to match against
 * @param manifestId - The id to find
 * @returns The matching candidate, or undefined
 */
export function matchManifestId(candidates: Iterable<string>, manifestId: string): string | undefined {
  const lower = manifestId.toLowerCase();
  for (const candidate of candidates) {
    if (candidate.toLowerCase() === lower) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Look `manifestId` up in `map`, tolerating a casing difference the way {@link matchManifestId} does.
 * @param map - The map to search
 * @param manifestId - The id to find
 * @returns The matching entry's value, or undefined
 */
export function findByManifestId<T>(map: Map<string, T>, manifestId: string): T | undefined {
  const match = matchManifestId(map.keys(), manifestId);
  return match === undefined ? undefined : map.get(match);
}

/**
 * Split a bucket category's rows into one table set per owning manifest. Ownership is each row's own
 * `ManifestId` stamp — the writing manifest is no fallback: a row that names no manifest is a bug in
 * whatever wrote it, refused loudly here rather than silently homed somewhere plausible.
 * @param tableNames - The tables making up the category
 * @param tables - The rows read for those tables
 * @param writingManifestId - The manifest this vault writes from; its bucket is always declared, even empty
 * @param alsoInclude - Manifests that must be written even when they hold no rows
 * @returns Manifest id → that manifest's rows, per table
 */
export function groupBucketRowsByManifest(
  tableNames: string[],
  tables: BucketTables,
  writingManifestId: string,
  alsoInclude: string[] = []
): Map<string, BucketTables> {
  const grouped = new Map<string, BucketTables>([[writingManifestId, {}]]);

  for (const tableName of tableNames) {
    for (const row of tables[tableName] ?? []) {
      const stamp = typeof row.ManifestId === 'string' ? row.ManifestId : '';
      if (isUnstampedManifestId(stamp)) {
        throw new Error(`Bucket table ${tableName} holds a row that names no manifest; every row must carry the manifest it belongs to`);
      }
      const owner = matchManifestId(grouped.keys(), stamp) ?? stamp;

      const manifestTables = grouped.get(owner) ?? {};
      manifestTables[tableName] = [...(manifestTables[tableName] ?? []), row];
      grouped.set(owner, manifestTables);
    }
  }

  for (const manifestId of alsoInclude) {
    if (!matchManifestId(grouped.keys(), manifestId)) {
      grouped.set(manifestId, {});
    }
  }

  /*
   * Every manifest declares every table of the category, empty where it holds nothing. A table left out
   * entirely reads as "unchanged" rather than "emptied", so dropping the last row of one would otherwise
   * never reach the server.
   */
  for (const manifestTables of grouped.values()) {
    for (const tableName of tableNames) {
      manifestTables[tableName] ??= [];
    }
  }

  return grouped;
}
