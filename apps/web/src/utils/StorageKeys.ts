/**
 * All platform storage keys used by the web app: the client core's keys plus the web app's own.
 */

import {
  AUTH_STORAGE_KEYS as CORE_AUTH_STORAGE_KEYS,
  StorageKeys as CoreStorageKeys,
  VAULT_LOCK_STORAGE_KEYS as CORE_VAULT_LOCK_STORAGE_KEYS,
  type StorageKey,
  vaultDataStorageKeys as coreVaultDataStorageKeys,
} from '@aliasvault/client/constants/StorageKeys';

export { dirtyScopeStorageKey, type StorageKey } from '@aliasvault/client/constants/StorageKeys';

export const StorageKeys = {
  ...CoreStorageKeys,
} as const satisfies Record<string, StorageKey>;

/** Keys that hold auth tokens, ephemeral error state and account-scoped server state. Cleared on any logout. */
export const AUTH_STORAGE_KEYS: readonly StorageKey[] = CORE_AUTH_STORAGE_KEYS;

/** Keys that must not survive a vault lock: the decrypted keys. */
export const VAULT_LOCK_STORAGE_KEYS: readonly StorageKey[] = [...CORE_VAULT_LOCK_STORAGE_KEYS];

/** Session keys cleared on logout. */
export const SESSION_STORAGE_KEYS: readonly StorageKey[] = [...VAULT_LOCK_STORAGE_KEYS, StorageKeys.VAULT_SYNC_HOLD];

/** Every key holding vault data or state derived from it. Cleared on logout. */
export const vaultDataStorageKeys = (): StorageKey[] => [...coreVaultDataStorageKeys()];

/**
 * Browser localStorage keys for UI preferences. The names are the ones the previous web client used, so an existing
 * preference carries over to this app.
 */
export const LocalPreferenceKeys = {
  /** 'dark' | 'light'; unset means follow the system preference. */
  COLOR_THEME: 'color-theme',
  /** The UI language chosen before login. */
  APP_LANGUAGE: 'AppLanguage',
  /** Where to go after the vault is loaded. */
  RETURN_URL: 'returnUrl',
  /** Whether the items page groups items by folder. */
  ITEMS_SHOW_FOLDERS: 'items-show-folders',
} as const;
