import { storage } from 'wxt/utils/storage';

import type { StorageKey } from '@/utils/constants/storageKeys';
import { readLegacyStorageFallback } from '@/utils/legacy/LegacyStorageKeyFallbacks';

/**
 * Read a storage item, including legacy fallback for keys that have ever lived somewhere else.
 * @param key - the storage key to read
 */
export async function getStorageItem<T>(key: StorageKey): Promise<T | null> {
  const value = await storage.getItem(key) as T | null;
  if (value !== null) {
    return value;
  }

  // LEGACY: delete this line later together with `@/utils/legacy/LegacyStorageKeyFallbacks`.
  return readLegacyStorageFallback<T>(key);
}
