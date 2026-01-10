import { storage } from 'wxt/utils/storage';

type StorageKey = `local:${string}` | `session:${string}`;

/**
 * Storage keys that were migrated from session: to local: storage in v0.26.0 for offline mode support.
 * This mapping enables backward compatibility for users upgrading from older versions where data
 * was stored in session: storage. The fallback can be removed in v0.27.0+.
 *
 * Format: local key -> session fallback key
 */
const MIGRATED_STORAGE_KEYS: Record<string, StorageKey> = {
  'local:publicEmailDomains': 'session:publicEmailDomains',
  'local:privateEmailDomains': 'session:privateEmailDomains',
  'local:hiddenPrivateEmailDomains': 'session:hiddenPrivateEmailDomains',
  'local:encryptionKeyDerivationParams': 'session:encryptionKeyDerivationParams',
};

/**
 * Get a storage item with fallback to the legacy session: storage location.
 * This is used for keys that were migrated from session: to local: storage in v0.26.0.
 *
 * @param key The local: storage key to retrieve
 * @returns The value from local: storage, or from session: storage as fallback, or null if not found
 *
 * @example
 * // Instead of:
 * const domains = await storage.getItem('local:publicEmailDomains');
 *
 * // Use:
 * const domains = await getItemWithFallback('local:publicEmailDomains');
 *
 * @note This fallback can be removed in v0.27.0+ after users have had time to upgrade
 */
export async function getItemWithFallback<T>(key: StorageKey): Promise<T | null> {
  // Try the current (local:) key first
  let value = await storage.getItem(key) as T | null;

  // If not found and this is a migrated key, try the fallback
  if (value === null && key in MIGRATED_STORAGE_KEYS) {
    const fallbackKey = MIGRATED_STORAGE_KEYS[key];
    value = await storage.getItem(fallbackKey) as T | null;

    // If found in fallback, migrate to new location for future use
    if (value !== null) {
      await storage.setItem(key, value);
      // Remove the fallback key
      await storage.removeItem(fallbackKey);
    }
  }

  return value;
}
