/**
 * All browser storage keys used by the extension.
 */

import {
  AUTH_STORAGE_KEYS as CORE_AUTH_STORAGE_KEYS,
  StorageKeys as CoreStorageKeys,
  VAULT_LOCK_STORAGE_KEYS as CORE_VAULT_LOCK_STORAGE_KEYS,
  type StorageKey,
  vaultDataStorageKeys as coreVaultDataStorageKeys,
} from '@aliasvault/client/constants/StorageKeys';

import { LEGACY_VAULT_DATA_STORAGE_KEYS } from '@/utils/constants/legacyStorageKeys';

export { bucketRevisionKey, dirtyScopeStorageKey, type StorageKey } from '@aliasvault/client/constants/StorageKeys';

export const StorageKeys = {
  ...CoreStorageKeys,

  /*
   * -- Session state (cleared when the vault locks) --
   */

  /** Encrypted form values persisted while the popup is closed. */
  PERSISTED_FORM_VALUES: 'session:persistedFormValues',
  /** Route the popup was on when it was last closed. */
  LAST_VISITED_PAGE: 'session:lastVisitedPage',
  /** Timestamp of the last popup navigation, used to expire the restored route. */
  LAST_VISITED_TIME: 'session:lastVisitedTime',
  /** Popup navigation history, used to restore the back stack. */
  NAVIGATION_HISTORY: 'session:navigationHistory',
  /** URL of the tab the popup was opened from. */
  LAST_TAB_URL: 'session:lastTabUrl',
  /** The item that was most recently autofilled, used to prioritize it in the list. */
  RECENTLY_SELECTED_ITEM: 'session:aliasvault_recently_selected_item',

  /*
   * -- App preferences --
   */

  /** Selected UI theme. */
  THEME: 'local:theme',
  /** Selected UI language. */
  LANGUAGE: 'local:language',
  /** True when the extension runs under the E2E test harness (opens shadow roots). */
  E2E_TEST_MODE: 'local:e2eTestMode',

  /*
   * -- Local preferences (cleared as a group by LocalPreferencesService.clearAll) --
   */

  /** Sites where autofill is permanently disabled. */
  DISABLED_SITES: 'local:aliasvault_disabled_sites',
  /** Sites where autofill is disabled for the current session. */
  TEMPORARY_DISABLED_SITES: 'local:aliasvault_temporary_disabled_sites',
  /** Sites where the passkey provider is disabled. */
  PASSKEY_DISABLED_SITES: 'local:aliasvault_passkey_disabled_sites',
  /** Whether the autofill popup is enabled globally. */
  CREDENTIAL_AUTOFILL_POPUP_ENABLED: 'local:aliasvault_global_autofill_popup_enabled',
  /** Whether the context menu integration is enabled globally. */
  GLOBAL_CONTEXT_MENU_ENABLED: 'local:aliasvault_global_context_menu_enabled',
  /** Whether the passkey provider is enabled globally. */
  PASSKEY_PROVIDER_ENABLED: 'local:aliasvault_passkey_provider_enabled',
  /** Seconds after which a copied value is cleared from the clipboard. */
  CLIPBOARD_CLEAR_TIMEOUT: 'local:aliasvault_clipboard_clear_timeout',
  /** Minutes of inactivity after which the vault locks. */
  AUTO_LOCK_TIMEOUT: 'local:aliasvault_auto_lock_timeout',
  /** Timestamp until which the "vault locked" banner stays dismissed. */
  VAULT_LOCKED_DISMISS_UNTIL: 'local:aliasvault_vault_locked_dismiss_until',
  /** Whether TOTP codes are autofilled. */
  TOTP_AUTOFILL_ENABLED: 'local:aliasvault_totp_autofill_enabled',
  /** Whether the TOTP code is copied to the clipboard on autofill. */
  AUTO_COPY_TOTP_ON_AUTOFILL: 'local:aliasvault_auto_copy_totp_on_autofill',
  /** How item URLs are matched against the current page. */
  AUTOFILL_MATCHING_MODE: 'local:aliasvault_autofill_matching_mode',
  /** Recently used custom email addresses. */
  CUSTOM_EMAIL_HISTORY: 'local:aliasvault_custom_email_history',
  /** Recently used custom usernames. */
  CUSTOM_USERNAME_HISTORY: 'local:aliasvault_custom_username_history',
  /** Whether the item list is grouped by folder. */
  SHOW_FOLDERS: 'local:aliasvault_show_folders',
  /** Whether the popup closes automatically after unlocking. */
  AUTO_CLOSE_UNLOCK_POPUP: 'local:aliasvault_auto_close_unlock_popup',
  /** Unlock method used last, preselected on the unlock screen. */
  LAST_USED_UNLOCK_METHOD: 'local:aliasvault_last_used_unlock_method',
  /** Whether the save-login prompt is enabled. */
  LOGIN_SAVE_ENABLED: 'local:loginSaveEnabled',
  /** Seconds after which the save-login prompt dismisses itself. */
  LOGIN_SAVE_AUTO_DISMISS_SECONDS: 'local:loginSaveAutoDismissSeconds',
  /** Domains for which the save-login prompt is suppressed. */
  LOGIN_SAVE_BLOCKED_DOMAINS: 'local:loginSaveBlockedDomains',
  /** URL to redirect to after a passkey flow completes. */
  PENDING_REDIRECT_URL: 'session:pendingRedirectUrl',
  /** Whether the next form restore should be skipped. */
  SKIP_FORM_RESTORE: 'local:aliasvault_skip_form_restore',
  /** Failed password unlock attempts, used for brute force protection. */
  PASSWORD_UNLOCK_FAILED_ATTEMPTS: 'local:password_unlock_failed_attempts',

  /*
   * -- PIN unlock (managed by PinUnlockService) --
   */

  /** Whether PIN unlock is enabled. */
  PIN_ENABLED: 'local:aliasvault_pin_enabled',
  /** The vault encryption key, encrypted with the PIN derived key. */
  PIN_ENCRYPTED_KEY: 'local:aliasvault_pin_encrypted_key',
  /** Salt used to derive the PIN key. */
  PIN_SALT: 'local:aliasvault_pin_salt',
  /** Length of the configured PIN. */
  PIN_LENGTH: 'local:aliasvault_pin_length',
  /** Failed PIN attempts, used for brute force protection. */
  PIN_FAILED_ATTEMPTS: 'local:aliasvault_pin_failed_attempts',
} as const satisfies Record<string, StorageKey>;

/** Keys that hold auth tokens, ephemeral error state and account-scoped server state. Cleared on any logout. */
export const AUTH_STORAGE_KEYS: readonly StorageKey[] = CORE_AUTH_STORAGE_KEYS;

/** Keys holding the PIN unlock material: the PIN-wrapped vault key and the parameters that unwrap it. */
export const PIN_STORAGE_KEYS: readonly StorageKey[] = [
  StorageKeys.PIN_ENABLED,
  StorageKeys.PIN_ENCRYPTED_KEY,
  StorageKeys.PIN_SALT,
  StorageKeys.PIN_LENGTH,
  StorageKeys.PIN_FAILED_ATTEMPTS,
];

/** Keys that must not survive a vault lock: the encryption key plus anything derived from decrypted data. */
export const VAULT_LOCK_STORAGE_KEYS: readonly StorageKey[] = [
  ...CORE_VAULT_LOCK_STORAGE_KEYS,
  StorageKeys.PERSISTED_FORM_VALUES,
  StorageKeys.RECENTLY_SELECTED_ITEM,
];

/** Session keys cleared on logout. */
export const SESSION_STORAGE_KEYS: readonly StorageKey[] = [
  ...VAULT_LOCK_STORAGE_KEYS,
  StorageKeys.LAST_VISITED_PAGE,
  StorageKeys.LAST_VISITED_TIME,
  StorageKeys.NAVIGATION_HISTORY,
  StorageKeys.VAULT_SYNC_HOLD,
];

/** Keys managed by LocalPreferencesService and cleared as a group by its clearAll(). */
export const LOCAL_PREFERENCE_STORAGE_KEYS: readonly StorageKey[] = [
  StorageKeys.DISABLED_SITES,
  StorageKeys.TEMPORARY_DISABLED_SITES,
  StorageKeys.PASSKEY_DISABLED_SITES,
  StorageKeys.CREDENTIAL_AUTOFILL_POPUP_ENABLED,
  StorageKeys.GLOBAL_CONTEXT_MENU_ENABLED,
  StorageKeys.PASSKEY_PROVIDER_ENABLED,
  StorageKeys.CLIPBOARD_CLEAR_TIMEOUT,
  StorageKeys.AUTO_LOCK_TIMEOUT,
  StorageKeys.VAULT_LOCKED_DISMISS_UNTIL,
  StorageKeys.TOTP_AUTOFILL_ENABLED,
  StorageKeys.AUTO_COPY_TOTP_ON_AUTOFILL,
  StorageKeys.AUTOFILL_MATCHING_MODE,
  StorageKeys.CUSTOM_EMAIL_HISTORY,
  StorageKeys.CUSTOM_USERNAME_HISTORY,
  StorageKeys.SHOW_FOLDERS,
  StorageKeys.AUTO_CLOSE_UNLOCK_POPUP,
  StorageKeys.LAST_USED_UNLOCK_METHOD,
  StorageKeys.LOGIN_SAVE_ENABLED,
  StorageKeys.LOGIN_SAVE_AUTO_DISMISS_SECONDS,
  StorageKeys.LOGIN_SAVE_BLOCKED_DOMAINS,
  StorageKeys.PENDING_REDIRECT_URL,
  StorageKeys.SKIP_FORM_RESTORE,
  StorageKeys.PASSWORD_UNLOCK_FAILED_ATTEMPTS,
];

/**
 * Every key holding vault data or state derived from it, including the per-scope dynamic keys and the PIN
 * unlock material. Cleared on logout.
 */
export const vaultDataStorageKeys = (): StorageKey[] => [
  ...coreVaultDataStorageKeys(),
  ...PIN_STORAGE_KEYS,
  ...LEGACY_VAULT_DATA_STORAGE_KEYS,
];
