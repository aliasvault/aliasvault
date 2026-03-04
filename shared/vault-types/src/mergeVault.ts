import type { VaultJson, MergeResult, MergeSummary } from './types';

/**
 * Merge two decrypted vaults using credential-level last-write-wins strategy.
 * Pure function — no side effects, no dependencies outside this package.
 *
 * NOTE: The merged vault's credentials share object references with the input
 * vaults for performance (avoids deep-cloning large attachment blobs). Callers
 * should not mutate the inputs after merging.
 *
 * Rules:
 * - Remote-only credential → added
 * - Local-only credential → kept
 * - Both exist → higher updatedAt wins (tie → local wins)
 * - Settings: remote wins per key (spread)
 * - EncryptionKeys: union by id (deduplicate)
 * - Version: Math.max(local, remote)
 * - lastModified: Date.now()
 */
export function resolveVaultConflict(
  local: VaultJson,
  remote: VaultJson,
): MergeResult {
  const merged: Record<string, VaultJson['credentials'][string]> = {};
  const summary: MergeSummary = { added: [], updated: [], deleted: [], kept: [] };

  const allIds = new Set([
    ...Object.keys(local.credentials),
    ...Object.keys(remote.credentials),
  ]);

  for (const id of allIds) {
    const localCred = local.credentials[id];
    const remoteCred = remote.credentials[id];

    if (!localCred) {
      // Remote-only
      merged[id] = remoteCred;
      summary.added.push(id);
    } else if (!remoteCred) {
      // Local-only
      merged[id] = localCred;
      summary.kept.push(id);
    } else {
      // Both exist — last-write-wins (tie → local)
      if (remoteCred.updatedAt > localCred.updatedAt) {
        merged[id] = remoteCred;
        summary.updated.push(id);
      } else {
        merged[id] = localCred;
        summary.kept.push(id);
      }
    }
  }

  // Post-merge: reclassify deleted credentials that exist on both sides
  const deletedBothSides = new Set<string>();
  for (const id of allIds) {
    const inBoth = local.credentials[id] && remote.credentials[id];
    if (inBoth && merged[id].isDeleted) {
      deletedBothSides.add(id);
    }
  }
  if (deletedBothSides.size > 0) {
    summary.updated = summary.updated.filter((x) => !deletedBothSides.has(x));
    summary.kept = summary.kept.filter((x) => !deletedBothSides.has(x));
    for (const id of deletedBothSides) {
      summary.deleted.push(id);
    }
  }

  // Settings: remote wins per key
  const mergedSettings = { ...local.settings, ...remote.settings };

  // Encryption keys: union by id
  const keyMap = new Map(local.encryptionKeys.map((k) => [k.id, k]));
  for (const rk of remote.encryptionKeys) {
    keyMap.set(rk.id, rk);
  }

  return {
    merged: {
      version: Math.max(local.version, remote.version),
      credentials: merged,
      settings: mergedSettings,
      encryptionKeys: [...keyMap.values()],
      lastModified: Date.now(),
    },
    summary,
  };
}
