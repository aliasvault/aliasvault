/**
 * Storage keys that may exist because an older extension version wrote them. Nothing reads or writes them any
 * more; they are kept purely so a logout still purges the value an upgrade left behind. These are defined
 * in this separate file so the current key set stays compact and readable.
 */

import type { StorageKey } from '@/utils/constants/storageKeys';

export const LegacyStorageKeys = {
  /** Pre-v0.31 single server revision, superseded by the per-manifest `StorageKeys.SERVER_MANIFEST_REVISIONS`. */
  SERVER_REVISION: 'local:serverRevision',
} as const satisfies Record<string, StorageKey>;

/**
 * Legacy keys holding vault data or state derived from it, spread into `vaultDataStorageKeys()` so a logout
 * clears them alongside the current ones.
 */
export const LEGACY_VAULT_DATA_STORAGE_KEYS: readonly StorageKey[] = [
  LegacyStorageKeys.SERVER_REVISION,
];
