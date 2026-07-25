/**
 * All browser storage keys used by the extension. Use these instead of hardcoding strings, so we can easily
 * change the key names without breaking the code and track shared storage keys in one place.
 */

import { ALL_VAULT_BUCKET_SCOPES, ALL_VAULT_MUTATION_SCOPES, type VaultMutationScope } from '@/utils/types/VaultMutationScope';

/** A WXT storage key, scoped to either the persisted (local) or the memory-only (session) area. */
export type StorageKey = `local:${string}` | `session:${string}`;

export const StorageKeys = {
  /*
   * -- Auth and server connection --
   */

  /** JWT access token for the API. */
  ACCESS_TOKEN: 'local:accessToken',
  /** JWT refresh token for the API. */
  REFRESH_TOKEN: 'local:refreshToken',
  /** Username of the logged in user. */
  USERNAME: 'local:username',
  /** Base URL of the API the extension talks to. */
  API_URL: 'local:apiUrl',
  /** Base URL of the web client, used for deep links. */
  CLIENT_URL: 'local:clientUrl',
  /** Version reported by the server on the last status call. */
  SERVER_VERSION: 'local:serverVersion',

  /*
   * -- Vault data (local cache) --
   */

  /** The encrypted vault blob. */
  ENCRYPTED_VAULT: 'local:encryptedVault',
  /** Revision number of the root manifest as known by the server. */
  SERVER_REVISION: 'local:serverRevision',
  /** Legacy (pre-v0.20) revision key, only read during migration to {@link StorageKeys.SERVER_REVISION}. */
  LEGACY_VAULT_REVISION_NUMBER: 'local:vaultRevisionNumber',
  /** Public email domains supported by the server. */
  PUBLIC_EMAIL_DOMAINS: 'local:publicEmailDomains',
  /** Private email domains supported by the server. */
  PRIVATE_EMAIL_DOMAINS: 'local:privateEmailDomains',
  /** Private email domains that are hidden from the domain picker. */
  HIDDEN_PRIVATE_EMAIL_DOMAINS: 'local:hiddenPrivateEmailDomains',
  /** Argon2 parameters used to derive the KEK from the master password. */
  ENCRYPTION_KEY_DERIVATION_PARAMS: 'local:encryptionKeyDerivationParams',
  /** The VEK wrapped with the KEK, as returned by the server. */
  WRAPPED_VEK: 'local:wrappedVek',

  /*
   * -- Sync state --
   */

  /** True when the local vault has changes that are not pushed to the server yet. */
  IS_DIRTY: 'local:isDirty',
  /** Monotonic counter used to detect mutations that happened during an in-flight sync. */
  MUTATION_SEQUENCE: 'local:mutationSequence',
  /** True when the extension operates against the local vault only. */
  IS_OFFLINE_MODE: 'local:isOfflineMode',
  /** Message of the last failed sync attempt, shown in the UI. */
  LAST_SYNC_ERROR: 'local:lastSyncError',
  /** The client's last known revision per non-root (shared folder) manifest. */
  SERVER_MANIFEST_REVISIONS: 'local:serverManifestRevisions',
  /** Per-user salt used to canonicalize the vault into the manifest-v1 format. */
  VAULT_V2_USER_SALT: 'local:vaultV2UserSalt',
  /** Content fingerprints of the last pushed manifests and buckets, used for changed-only writes. */
  VAULT_V2_CONTENT_FINGERPRINTS: 'local:vaultV2ContentFingerprints',
  /** Local cache of encrypted blobs (hash to base64 AES-GCM ciphertext). Never stores plaintext at rest. */
  VAULT_V2_BLOB_CIPHER_CACHE: 'local:vaultV2BlobCipherCache',
  /** Blob hashes the server has stored (refreshed on every pull/push). */
  VAULT_V2_SERVER_BLOB_HASHES: 'local:vaultV2ServerBlobHashes',

  /*
   * -- Session state (cleared when the vault locks) --
   */

  /** The decrypted vault encryption key. Session-only: it must never persist to disk. */
  ENCRYPTION_KEY: 'session:encryptionKey',
  /** Legacy (pre-v0.19) encryption key location, only read as a fallback. */
  LEGACY_DERIVED_KEY: 'session:derivedKey',
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
  /** Shared folder records from the last pull, needed to push shared manifests back. */
  SHARED_FOLDERS: 'session:sharedFolders',
  /** The item that was most recently autofilled, used to prioritize it in the list. */
  RECENTLY_SELECTED_ITEM: 'session:aliasvault_recently_selected_item',

  /*
   * -- Legacy session locations, migrated to local: in v0.26.0 (see StorageUtility) --
   */

  /** @deprecated Fallback for {@link StorageKeys.PUBLIC_EMAIL_DOMAINS}, removable in v0.27.0+. */
  LEGACY_SESSION_PUBLIC_EMAIL_DOMAINS: 'session:publicEmailDomains',
  /** @deprecated Fallback for {@link StorageKeys.PRIVATE_EMAIL_DOMAINS}, removable in v0.27.0+. */
  LEGACY_SESSION_PRIVATE_EMAIL_DOMAINS: 'session:privateEmailDomains',
  /** @deprecated Fallback for {@link StorageKeys.HIDDEN_PRIVATE_EMAIL_DOMAINS}, removable in v0.27.0+. */
  LEGACY_SESSION_HIDDEN_PRIVATE_EMAIL_DOMAINS: 'session:hiddenPrivateEmailDomains',
  /** @deprecated Fallback for {@link StorageKeys.ENCRYPTION_KEY_DERIVATION_PARAMS}, removable in v0.27.0+. */
  LEGACY_SESSION_ENCRYPTION_KEY_DERIVATION_PARAMS: 'session:encryptionKeyDerivationParams',

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

/**
 * Storage key holding the dirty flag for a single mutation scope. Each scope gets its OWN boolean key so a
 * mutation marks exactly its scope dirty via an idempotent write.
 * @param scope - the mutation scope
 */
export const dirtyScopeStorageKey = (scope: VaultMutationScope): `local:${string}` => `local:dirtyScope:${scope}`;

/**
 * Storage key holding the local revision number of a single data bucket.
 * @param category - the data bucket category
 */
export const bucketRevisionStorageKey = (category: string): `local:${string}` => `local:vaultV2BucketRev:${category}`;

/**
 * Keys that hold auth tokens and ephemeral error state. Cleared on logout; safe to clear during a forced
 * logout because no vault data is lost.
 */
export const AUTH_STORAGE_KEYS: readonly StorageKey[] = [
  StorageKeys.ACCESS_TOKEN,
  StorageKeys.REFRESH_TOKEN,
  StorageKeys.LAST_SYNC_ERROR,
];

/** Keys that must not survive a vault lock: the encryption key plus anything derived from decrypted data. */
export const VAULT_LOCK_STORAGE_KEYS: readonly StorageKey[] = [
  StorageKeys.ENCRYPTION_KEY,
  StorageKeys.PERSISTED_FORM_VALUES,
];

/** Session keys cleared on logout: everything from a lock, plus the popup navigation state. */
export const SESSION_STORAGE_KEYS: readonly StorageKey[] = [
  ...VAULT_LOCK_STORAGE_KEYS,
  StorageKeys.LAST_VISITED_PAGE,
  StorageKeys.LAST_VISITED_TIME,
  StorageKeys.NAVIGATION_HISTORY,
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
 * Every key holding vault data or state derived from it, including the per-scope dynamic keys. Cleared when
 * the vault itself is cleared (logout), so no state from the previous account can leak into the next one.
 */
export const allVaultDataStorageKeys = (): StorageKey[] => [
  StorageKeys.ENCRYPTED_VAULT,
  StorageKeys.PUBLIC_EMAIL_DOMAINS,
  StorageKeys.PRIVATE_EMAIL_DOMAINS,
  StorageKeys.HIDDEN_PRIVATE_EMAIL_DOMAINS,
  StorageKeys.SERVER_REVISION,
  StorageKeys.LEGACY_VAULT_REVISION_NUMBER,
  StorageKeys.SERVER_MANIFEST_REVISIONS,
  StorageKeys.VAULT_V2_USER_SALT,
  StorageKeys.VAULT_V2_CONTENT_FINGERPRINTS,
  StorageKeys.VAULT_V2_BLOB_CIPHER_CACHE,
  StorageKeys.VAULT_V2_SERVER_BLOB_HASHES,
  StorageKeys.IS_DIRTY,
  StorageKeys.MUTATION_SEQUENCE,
  StorageKeys.IS_OFFLINE_MODE,
  StorageKeys.ENCRYPTION_KEY_DERIVATION_PARAMS,
  StorageKeys.WRAPPED_VEK,
  StorageKeys.USERNAME,
  ...ALL_VAULT_MUTATION_SCOPES.map(scope => dirtyScopeStorageKey(scope)),
  ...ALL_VAULT_BUCKET_SCOPES.map(category => bucketRevisionStorageKey(category)),
];
