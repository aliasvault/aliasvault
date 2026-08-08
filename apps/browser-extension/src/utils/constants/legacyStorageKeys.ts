/**
 * Storage keys that ONLY exist to read state written by an older extension version. Nothing writes them any
 * more: every one of them is read once, migrated onto its current {@link StorageKeys} counterpart, and then
 * dropped. They live apart from `storageKeys.ts` so the current key set stays readable at a glance.
 *
 * Deleting this file is the whole cleanup for these one-time reads: the compiler then points at every
 * remaining reader (all of which live in `@/utils/legacy/LegacyStorageKeyFallbacks`).
 */

import type { StorageKey } from '@/utils/constants/storageKeys';

export const LegacyStorageKeys = {
  /** Pre-v0.20 revision key, in the string format `"250"` or `"250+1"`; migrated to `StorageKeys.SERVER_REVISION`. */
  VAULT_REVISION_NUMBER: 'local:vaultRevisionNumber',
  /** Pre-v0.22 encryption key location; read as a fallback for `StorageKeys.ENCRYPTION_KEY`. */
  DERIVED_KEY: 'session:derivedKey',

  /*
   * -- Session locations migrated to local: in v0.26.0, removable in v0.27.0+ (see readLegacyStorageFallback) --
   */

  /** Fallback for `StorageKeys.PUBLIC_EMAIL_DOMAINS`. */
  SESSION_PUBLIC_EMAIL_DOMAINS: 'session:publicEmailDomains',
  /** Fallback for `StorageKeys.PRIVATE_EMAIL_DOMAINS`. */
  SESSION_PRIVATE_EMAIL_DOMAINS: 'session:privateEmailDomains',
  /** Fallback for `StorageKeys.HIDDEN_PRIVATE_EMAIL_DOMAINS`. */
  SESSION_HIDDEN_PRIVATE_EMAIL_DOMAINS: 'session:hiddenPrivateEmailDomains',
  /** Fallback for `StorageKeys.ENCRYPTION_KEY_DERIVATION_PARAMS`. */
  SESSION_ENCRYPTION_KEY_DERIVATION_PARAMS: 'session:encryptionKeyDerivationParams',
} as const satisfies Record<string, StorageKey>;

/**
 * Legacy keys holding vault data or state derived from it, spread into `allVaultDataStorageKeys()` so a logout
 * clears them alongside the current ones.
 */
export const LEGACY_VAULT_DATA_STORAGE_KEYS: readonly StorageKey[] = [
  LegacyStorageKeys.VAULT_REVISION_NUMBER,
];
