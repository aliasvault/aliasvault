/**
 * Storage keys that ONLY exist because an older extension version wrote them. Nothing writes them any more:
 * each is either read once and migrated onto its current {@link StorageKeys} counterpart, or kept purely so a
 * logout still purges the value an upgrade left behind. They live apart from `storageKeys.ts` so the current key
 * set stays readable at a glance.
 *
 * Deleting this file is the whole cleanup for these one-time reads: the compiler then points at every
 * remaining reader (all of which live in `@/utils/legacy/LegacyStorageKeyFallbacks`).
 */

import type { StorageKey } from '@/utils/constants/storageKeys';

export const LegacyStorageKeys = {
  /** Pre-v0.22 encryption key location; read as a fallback for `StorageKeys.ENCRYPTION_KEY`. */
  DERIVED_KEY: 'session:derivedKey',

  /** Pre-v0.26 Session locations migrated to local (see readLegacyStorageFallback) */
  SESSION_PUBLIC_EMAIL_DOMAINS: 'session:publicEmailDomains',
  SESSION_PRIVATE_EMAIL_DOMAINS: 'session:privateEmailDomains',
  SESSION_HIDDEN_PRIVATE_EMAIL_DOMAINS: 'session:hiddenPrivateEmailDomains',
  SESSION_ENCRYPTION_KEY_DERIVATION_PARAMS: 'session:encryptionKeyDerivationParams',

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
