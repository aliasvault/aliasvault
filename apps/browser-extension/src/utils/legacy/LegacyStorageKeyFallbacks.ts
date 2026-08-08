/**
 * One-time reads of browser storage written by an OLDER extension version. Each function reads a
 * {@link LegacyStorageKeys} entry, migrates the value onto its current {@link StorageKeys} counterpart and
 * drops the old one; nothing here is written by the current code.
 *
 * TODO: delete this file (plus `@/utils/constants/legacyStorageKeys`) once every install has upgraded past the
 * versions listed per function.
 */

import { storage } from 'wxt/utils/storage';

import { LegacyStorageKeys } from '@/utils/constants/legacyStorageKeys';
import { type StorageKey, StorageKeys } from '@/utils/constants/storageKeys';

/**
 * Storage keys that moved from session: to local: storage in v0.26.0 for offline mode support, as
 * `current local key -> legacy session key`. Removable in v0.27.0+.
 */
const MIGRATED_STORAGE_KEYS: Record<string, StorageKey> = {
  [StorageKeys.PUBLIC_EMAIL_DOMAINS]: LegacyStorageKeys.SESSION_PUBLIC_EMAIL_DOMAINS,
  [StorageKeys.PRIVATE_EMAIL_DOMAINS]: LegacyStorageKeys.SESSION_PRIVATE_EMAIL_DOMAINS,
  [StorageKeys.HIDDEN_PRIVATE_EMAIL_DOMAINS]: LegacyStorageKeys.SESSION_HIDDEN_PRIVATE_EMAIL_DOMAINS,
  [StorageKeys.ENCRYPTION_KEY_DERIVATION_PARAMS]: LegacyStorageKeys.SESSION_ENCRYPTION_KEY_DERIVATION_PARAMS,
};

/**
 * The value a key held at its pre-v0.26.0 session: location, migrated across to its current location on the way
 * out so this fallback is only ever paid once. Reached from {@link getStorageItem} after the current location
 * came up empty.
 * @param key - the current local: storage key that came up empty
 * @returns The migrated value, or null when this key never lived elsewhere or the old location is empty too
 */
export async function readLegacyStorageFallback<T>(key: StorageKey): Promise<T | null> {
  if (!(key in MIGRATED_STORAGE_KEYS)) {
    return null;
  }

  const fallbackKey = MIGRATED_STORAGE_KEYS[key];
  const legacyValue = await storage.getItem(fallbackKey) as T | null;
  if (legacyValue !== null) {
    await storage.setItem(key, legacyValue);
    await storage.removeItem(fallbackKey);
  }

  return legacyValue;
}

/**
 * The session encryption key as stored before v0.22.0, when it lived under a different key name. Read only
 * after {@link StorageKeys.ENCRYPTION_KEY} came up empty.
 */
export async function readLegacySessionEncryptionKey(): Promise<string | null> {
  return await storage.getItem(LegacyStorageKeys.DERIVED_KEY) as string | null;
}

/**
 * The server revision as stored before v0.20, where it was a string in the `"250"` or `"250+1"` format (server
 * revision plus local edit count). Migrates whatever it finds onto {@link StorageKeys.SERVER_REVISION}. Read
 * only after that key came up empty.
 * @returns The migrated server revision, or null when no legacy value exists
 */
export async function readLegacyServerRevision(): Promise<number | null> {
  const legacyRevision = await storage.getItem(LegacyStorageKeys.VAULT_REVISION_NUMBER) as string | number | null;
  if (legacyRevision === null) {
    return null;
  }

  // Only the server part before the '+' is the server revision; the suffix counted unpushed local edits.
  const revision = typeof legacyRevision === 'number' ? legacyRevision : parseInt(legacyRevision.split('+')[0], 10) || 0;
  await storage.setItem(StorageKeys.SERVER_REVISION, revision);
  return revision;
}
