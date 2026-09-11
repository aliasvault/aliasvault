/* eslint-disable @typescript-eslint/no-explicit-any */

import { ApiRequestError } from '@aliasvault/client/api/errors/ApiRequestError';
import { AppErrorCode, formatErrorWithCode } from '@aliasvault/client/api/errors/AppErrorCodes';
import { VaultVersionIncompatibleError } from '@aliasvault/client/api/errors/VaultVersionIncompatibleError';
import { WebApiService } from '@aliasvault/client/api/WebApiService';
import { MasterPasswordService } from '@aliasvault/client/auth/MasterPasswordService';
import { VaultKeyService } from '@aliasvault/client/auth/VaultKeyService';
import { EncryptionUtility } from '@aliasvault/client/crypto/EncryptionUtility';
import { decryptVaultBlob, encryptVaultBlob } from '@aliasvault/client/crypto/VaultBlob';
import { SqliteClient } from '@aliasvault/client/database/SqliteClient';
import { generateTotpCode } from '@aliasvault/client/items/TotpUtility';
import { filterItems, AutofillMatchingMode, extractRootDomain, isUrlAlreadyLinked, generatePassword } from '@aliasvault/client/rust/RustCore';
import { multiManifestRendering } from '@aliasvault/client/sharing/MultiManifestRendering';
import { SharingService } from '@aliasvault/client/sharing/SharingService';
import { recordManifestRevisions } from '@aliasvault/client/sync/ManifestRevisions';
import { clearDirtyScopes, getDirtyScopes } from '@aliasvault/client/sync/VaultDirtyState';
import { vaultRequiresManifestMigration, VaultMigrationKind, type VaultMigrationStatus } from '@aliasvault/client/sync/VaultManifestMigration';
import { type VaultMutationScope, DEFAULT_VAULT_MUTATION_SCOPE, hasUserVisibleScope } from '@aliasvault/client/sync/VaultMutationScope';
import { runFullVaultSync, runVaultManifestMigration, runVaultMigrationStatus, type IVaultSyncEngineHost, type VaultSyncOptions, type VaultSyncPhase as EngineSyncPhase, type VaultSyncStoreOutcome, type VaultSyncStoreRequest } from '@aliasvault/client/sync/VaultSyncEngine';
import { getVaultSyncHoldReason } from '@aliasvault/client/sync/VaultSyncHold';
import { base64ToBytes, bytesToBase64 } from '@aliasvault/client/utilities/Base64';
import { FieldKey, ItemTypes, VaultDataBucketCategory, createSystemField, type Item, type PasswordSettings } from '@aliasvault/models/vault';
import { VaultKeyAlgorithm } from '@aliasvault/models/webapi';
import { storage } from 'wxt/utils/storage';

import { clearAllSavePromptState } from '@/entrypoints/background/SavePromptStateHandler';
import { handleClearTwoFactorState } from '@/entrypoints/background/TwoFactorStateHandler';
import { syncResult, toFullVaultSyncResult, toSyncErrorDetail } from '@/entrypoints/background/VaultSyncResultMapper';

import { AUTH_STORAGE_KEYS, dirtyScopeStorageKey, SESSION_STORAGE_KEYS, StorageKeys, vaultDataStorageKeys, VAULT_LOCK_STORAGE_KEYS } from '@/utils/constants/storageKeys';
import { devError, devLog, devWarn } from '@/utils/devLogger/DevLogger';
import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import { sendMessage, type TotpSecret } from '@/utils/messaging/ExtensionMessaging';
import { RecentlySelectedItemService } from '@/utils/RecentlySelectedItemService';
import { ServiceDetectionUtility } from '@/utils/serviceDetection/ServiceDetectionUtility';
import { getStorageItem } from '@/utils/StorageUtility';
import { hasSyncError } from '@/utils/SyncError';
import type { BoolResponse as messageBoolResponse } from '@/utils/types/messaging/BoolResponse';
import type { DuplicateCheckResponse } from '@/utils/types/messaging/DuplicateCheckResponse';
import type { FullVaultSyncRequest } from '@/utils/types/messaging/FullVaultSyncRequest';
import type { FullVaultSyncResult } from '@/utils/types/messaging/FullVaultSyncResult';
import type { IdentitySettingsResponse } from '@/utils/types/messaging/IdentitySettingsResponse';
import type { ItemsResponse as messageItemsResponse } from '@/utils/types/messaging/ItemsResponse';
import type { PasswordSettingsResponse as messagePasswordSettingsResponse } from '@/utils/types/messaging/PasswordSettingsResponse';
import type { SaveLoginResponse } from '@/utils/types/messaging/SaveLoginResponse';
import type { StringResponse as stringResponse } from '@/utils/types/messaging/StringResponse';
import type { VaultManifestMigrationResult } from '@/utils/types/messaging/VaultManifestMigrationResult';
import type { VaultResponse as messageVaultResponse } from '@/utils/types/messaging/VaultResponse';
import type { VaultSyncPhase } from '@/utils/types/messaging/VaultSyncPhase';
import type { VaultSyncState } from '@/utils/types/messaging/VaultSyncState';

import { t } from '@/i18n/StandaloneI18n';

import type { ItemUsageAction } from '@aliasvault/client/database';
import type { DraftItem } from '@aliasvault/client/database/ItemRef';
import type { ISqliteDatabase, ISqliteStatement, SqliteValue } from '@aliasvault/client/platform';
import type { EncryptionKeyDerivationParams } from '@aliasvault/models/metadata';

/**
 * Cache for the SqliteClient to avoid repeated decryption and initialization.
 * The cached instance is the single source of truth for the in-memory vault.
 *
 * Cache Strategy:
 * - Local mutations (createCredential, etc.): Work directly on cachedSqliteClient, no cache clearing
 * - New vault from remote (login, sync): Clear cache by setting both to null, WITHOUT closing — an in-flight
 *   flow (e.g. a push holding the client across an HTTP await, or persistLocalVaultMutation re-adopting the
 *   client it just stored) may legitimately still use the detached instance.
 * - Lock/logout/clear vault: clearInMemoryVaultState().
 */
let cachedSqliteClient: SqliteClient | null = null;
let cachedVaultBlob: string | null = null;

/**
 * Global sync queue state.
 * Prevents multiple simultaneous sync operations and ensures pending changes are synced.
 */
let isSyncInProgress = false;
let hasPendingSync = false;

/**
 * Define Rust sync engine host interface to bridge the engine to the extension.
 */
const syncEngineHost: IVaultSyncEngineHost = {
  /**
   * The open vault. A store clears the cache, so the next call re-opens the blob just stored.
   */
  localDatabase: async (): Promise<ISqliteDatabase> => {
    const sqliteClient = await createVaultSqliteClient();
    const db = sqliteClient.getDb();
    if (!db) {
      throw new Error('Vault database not initialized');
    }
    return {
      /** Run a statement. */
      run: (sql: string, params?: SqliteValue[]): number => db.run(sql, params),
      /** Run a query. */
      query: <T,>(sql: string, params?: SqliteValue[]): T[] => db.query<T>(sql, params),
      /** Run raw SQL. */
      exec: (sql: string): void => db.exec(sql),
      /** Compile a statement. */
      prepare: (sql: string): ISqliteStatement => db.prepare(sql),
      /** Export through the client so it can compact the file first. */
      export: (): Uint8Array => sqliteClient.exportToBytes(),
      /** The cached client owns the database's lifetime. */
      close: (): void => {},
    };
  },
  /**
   * The stored vault blob.
   */
  loadVault: (): Promise<string | null> => handleGetEncryptedVault(),
  /**
   * Persist a vault blob the engine produced (pulled, merged, reconciled, migrated or re-keyed).
   */
  storeVault: (request: VaultSyncStoreRequest): Promise<VaultSyncStoreOutcome> =>
    handleStoreEncryptedVault({ vaultBlob: request.encryptedBlob, markDirty: request.markDirty, expectedMutationSeq: request.expectedMutationSeq }),
  /**
   * Clear the dirty flag unless a mutation raced the sync.
   */
  markClean: async (mutationSeqAtStart: number): Promise<boolean> => (await handleMarkVaultClean({ mutationSeqAtStart })).cleared,
  /**
   * Drop an in-memory vault holding changes no store persisted; the next reader reopens the stored blob.
   */
  discardLocalDatabase: (): void => {
    cachedSqliteClient = null;
    cachedVaultBlob = null;
  },
  /**
   * Show the popup what the sync is doing.
   */
  onPhase: (phase: EngineSyncPhase): void => {
    if (phase === 'pull') {
      broadcastSyncPhase('pull');
      return;
    }
    void getDirtyScopes().then(scopes => {
      if (hasUserVisibleScope(scopes)) {
        broadcastSyncPhase('push');
      }
    });
  },
};

/**
 * Cleanup the cached decrypted vault database and drop the cache.
 */
function cleanupCachedSqliteClient(): void {
  cachedSqliteClient?.close();
  cachedSqliteClient = null;
  cachedVaultBlob = null;
}

/**
 * Drop all plaintext state the background script holds in memory, on lock, logout and vault clear.
 */
function clearInMemoryVaultState(): void {
  cleanupCachedSqliteClient();
  clearAllSavePromptState();
  handleClearTwoFactorState();
}

/**
 * Check if the user is logged in and if the vault is locked, and also check for both kinds of pending vault.
 */
export async function handleCheckAuthStatus() : Promise<{ isLoggedIn: boolean, isVaultLocked: boolean, requiresLegacySqliteBlobMigration: boolean, requiresManifestMigration: boolean, error?: string }> {
  const [username, accessToken, vaultData, encryptionKey] = await Promise.all([storage.getItem(StorageKeys.USERNAME), storage.getItem(StorageKeys.ACCESS_TOKEN), storage.getItem(StorageKeys.ENCRYPTED_VAULT), handleGetEncryptionKey()]);

  const isLoggedIn = username !== null && accessToken !== null;
  const isVaultLocked = isLoggedIn && (vaultData === null || encryptionKey === null);

  // A locked or logged-out vault can't be opened, so neither upgrade state can be determined.
  if (isVaultLocked || !isLoggedIn) {
    return { isLoggedIn, isVaultLocked, requiresLegacySqliteBlobMigration: false, requiresManifestMigration: false };
  }

  // Vault is unlocked, check for pending migrations
  try {
    const sqliteClient = await createVaultSqliteClient();
    const requiresLegacySqliteBlobMigration = await sqliteClient.requiresLegacySqliteBlobMigration();
    const requiresManifestMigration = await vaultRequiresManifestMigration(sqliteClient);
    return { isLoggedIn, isVaultLocked, requiresLegacySqliteBlobMigration, requiresManifestMigration };
  } catch (error) {
    // If it's a version incompatibility error, we need to handle it specially
    if (error instanceof VaultVersionIncompatibleError) {
      // Return the error so the UI can handle it appropriately (logout user)
      return { isLoggedIn, isVaultLocked, requiresLegacySqliteBlobMigration: false, requiresManifestMigration: false, error: error.message };
    }

    return {
      isLoggedIn,
      isVaultLocked,
      requiresLegacySqliteBlobMigration: false,
      requiresManifestMigration: false,
      error: error instanceof Error ? error.message : await t('common.errors.unknownError')
    };
  }
}

/**
 * Store the encryption key (derived key) in browser storage.
 */
export async function handleStoreEncryptionKey(
  encryptionKey: string,
) : Promise<messageBoolResponse> {
  try {
    await storage.setItem(StorageKeys.ENCRYPTION_KEY, encryptionKey);
    return { success: true };
  } catch (error) {
    console.error('Failed to store encryption key:', error);
    // E-602: Storage write failed during encryption key store
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownErrorTryAgain'), AppErrorCode.STORAGE_WRITE_FAILED) };
  }
}

/**
 * Store the encryption key derivation parameters in browser storage.
 * These are stored in local: storage to enable offline unlock after browser restart.
 */
export async function handleStoreEncryptionKeyDerivationParams(
  params: EncryptionKeyDerivationParams,
) : Promise<messageBoolResponse> {
  try {
    await storage.setItem(StorageKeys.ENCRYPTION_KEY_DERIVATION_PARAMS, params);
    return { success: true };
  } catch (error) {
    console.error('Failed to store encryption key derivation params:', error);
    // E-602: Storage write failed during derivation params store
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownErrorTryAgain'), AppErrorCode.STORAGE_WRITE_FAILED) };
  }
}

/**
 * Get the vault from browser storage (local: for persistence).
 */
export async function handleGetVault(
) : Promise<messageVaultResponse> {
  try {
    const encryptionKey = await handleGetEncryptionKey();

    const encryptedVault = await storage.getItem(StorageKeys.ENCRYPTED_VAULT) as string;
    // TODO: the fallback mechanism can be removed some period of time after 0.27.0 is released.
    const publicEmailDomains = await getStorageItem<string[]>(StorageKeys.PUBLIC_EMAIL_DOMAINS);
    const privateEmailDomains = await getStorageItem<string[]>(StorageKeys.PRIVATE_EMAIL_DOMAINS);
    const hiddenPrivateEmailDomains = await getStorageItem<string[]>(StorageKeys.HIDDEN_PRIVATE_EMAIL_DOMAINS) ?? [];

    if (!encryptedVault) {
      console.error('Vault not available');
      // E-201: No encrypted vault in storage
      return { success: false, error: formatErrorWithCode(await t('common.errors.vaultNotAvailable'), AppErrorCode.VAULT_NOT_FOUND) };
    }

    if (!encryptionKey) {
      console.info('Encryption key not available (vault locked)');
      // E-202: No encryption key available (vault is locked)
      return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
    }

    // The popup receives the database as base64: messages carry strings, not bytes.
    const decryptedVault = bytesToBase64(await decryptVaultBlob(encryptedVault, encryptionKey));

    return {
      success: true,
      vault: decryptedVault,
      publicEmailDomains: publicEmailDomains ?? [],
      privateEmailDomains: privateEmailDomains ?? [],
      hiddenPrivateEmailDomains: hiddenPrivateEmailDomains ?? []
    };
  } catch (error) {
    console.error('Failed to get vault:', error);
    // E-203: Vault decryption failed during get
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.VAULT_DECRYPT_FAILED) };
  }
}

/**
 * Lock the vault by clearing only session data.
 * This preserves local vault data so user can unlock again without server.
 */
export async function handleLockVault(): Promise<messageBoolResponse> {
  await storage.removeItems([...VAULT_LOCK_STORAGE_KEYS]);
  clearInMemoryVaultState();

  return { success: true };
}

/**
 * Clear session data: tokens, ephemeral data and the vault itself.
 */
export async function handleClearSession(): Promise<messageBoolResponse> {
  // Clear auth tokens and last sync error
  await storage.removeItems([...AUTH_STORAGE_KEYS]);

  // Clear session-only data (security: encryption key must not persist)
  await storage.removeItems([...SESSION_STORAGE_KEYS]);

  // Clear the vault and every piece of state derived from it (sync bookkeeping, dirty flags, blob cache).
  await storage.removeItems(vaultDataStorageKeys());

  // Reset password unlock failed attempts counter on logout
  await LocalPreferencesService.resetPasswordUnlockFailedAttempts();

  // Cleanup cached sqlite client
  clearInMemoryVaultState();

  return { success: true };
}

/**
 * Clear vault data and username.
 * This removes all persistent vault storage and local preferences.
 */
export async function handleClearVaultData(): Promise<messageBoolResponse> {
  /*
   * Clear vault data and every piece of state derived from it (sync bookkeeping, dirty flags, bucket revisions),
   * plus the username, which a forced logout keeps for the login prefill and a user-initiated logout drops.
   */
  await storage.removeItems([...vaultDataStorageKeys(), StorageKeys.USERNAME]);

  // Clear all local preferences (site settings, login save settings, etc.)
  await LocalPreferencesService.clearAll();

  // Free the decrypted vault held in service-worker memory alongside the persisted data it came from.
  clearInMemoryVaultState();

  return { success: true };
}

/**
 * Filter items by URL matching.
 *
 * @param items - The items to filter
 * @param currentUrl - The current URL of the page
 * @param pageTitle - The title of the page
 * @param matchingModeStr - The matching mode to use (default: DEFAULT)
 * @returns The filtered items
 */
function filterItemsByUrl(items: Item[], currentUrl: string, pageTitle: string, matchingModeStr?: string): Promise<Item[]> {
  const matchingMode = matchingModeStr ? (matchingModeStr as typeof AutofillMatchingMode[keyof typeof AutofillMatchingMode]) : AutofillMatchingMode.DEFAULT;
  return filterItems(items, currentUrl, pageTitle, matchingMode);
}

/**
 * Prioritize recently selected item in the filtered items list.
 * If a recently selected item exists and is valid, ensure it's at the front of the array.
 * If the item is not in the filtered results, fetch it from the vault and add it.
 *
 * @param items - The filtered items array
 * @param rootDomain - The current root domain for recently selected item validation
 * @param allItems - All items from the vault (to fetch recently selected if not in filtered)
 * @returns The items (with recently selected prioritized) and the matched id, if any
 */
async function prioritizeRecentlySelectedItem(
  items: Item[],
  rootDomain: string,
  allItems: Item[]
): Promise<{ items: Item[], recentlySelectedId: string | null }> {
  const recentlySelectedId = await RecentlySelectedItemService.getRecentlySelected(rootDomain);

  if (!recentlySelectedId) {
    return { items, recentlySelectedId: null };
  }

  // Find the recently selected item in the filtered results
  const recentlySelectedIndex = items.findIndex(item => item.Id === recentlySelectedId);

  if (recentlySelectedIndex !== -1) {
    // Item is already in filtered results - move it to the front
    const recentlySelectedItem = items[recentlySelectedIndex];
    const reorderedItems = [
      recentlySelectedItem,
      ...items.slice(0, recentlySelectedIndex),
      ...items.slice(recentlySelectedIndex + 1)
    ];
    return { items: reorderedItems, recentlySelectedId };
  }

  // Item is not in filtered results - fetch it from all items and prepend it
  const recentlySelectedItem = allItems.find(item => item.Id === recentlySelectedId);

  if (!recentlySelectedItem) {
    // Item not found in vault (might have been deleted)
    return { items, recentlySelectedId: null };
  }

  // Prepend the recently selected item to the filtered results
  return { items: [recentlySelectedItem, ...items], recentlySelectedId };
}

/**
 * Extract the root domain from a URL for recently-selected item scoping.
 * Uses root domain (e.g. `example.com` for both `accounts.example.com` and `login.example.com`)
 * so multi-step login flows that span subdomains still match.
 * @param url - The full URL
 * @returns The root domain, or the original URL if parsing fails
 */
async function extractRootDomainFromUrl(url: string): Promise<string> {
  try {
    const urlObj = new URL(url);
    return await extractRootDomain(urlObj.hostname);
  } catch {
    return url;
  }
}

/**
 * Filter items by search term.
 * Splits search into words and matches items where ALL words appear in searchable fields.
 * Word order doesn't matter - matching behavior consistent with popup search.
 *
 * @param items - The items to filter
 * @param searchTerm - The search term to use
 * @returns The filtered items
 */
function filterItemsBySearchTerm(items: Item[], searchTerm: string): Item[] {
  if (!searchTerm || searchTerm.trim() === '') {
    return [];
  }

  const searchLower = searchTerm.toLowerCase().trim();

  // Split search query into individual words (same as popup search)
  const searchWords = searchLower.split(/\s+/).filter(word => word.length > 0);

  const searchableFieldKeys = [
    FieldKey.LoginUsername,
    FieldKey.LoginEmail,
    FieldKey.LoginUrl,
    FieldKey.AliasFirstName,
    FieldKey.AliasLastName
  ];

  return items.filter((item: Item) => {
    // Build searchable fields array
    const searchableFields: string[] = [
      item.Name?.toLowerCase() || ''
    ];

    // Add field values to searchable fields
    item.Fields?.forEach((field: { FieldKey: string; Value: string | string[]; Label: string }) => {
      if ((searchableFieldKeys as string[]).includes(field.FieldKey)) {
        const value = Array.isArray(field.Value) ? field.Value.join(' ') : field.Value;
        searchableFields.push(value?.toLowerCase() || '');
        searchableFields.push(field.Label.toLowerCase());
      }
    });

    // Every word must appear in at least one searchable field (order doesn't matter)
    return searchWords.every(word =>
      searchableFields.some(field => field.includes(word))
    );
  }).sort((a: Item, b: Item) => (a.Name ?? '').localeCompare(b.Name ?? ''));
}

/**
 * Get items filtered by URL matching (for autofill).
 * Filters items in the background script before sending to reduce message payload size.
 *
 * @param message - Filtering parameters: currentUrl, pageTitle, matchingMode, skipRecentlySelected
 */
export async function handleGetFilteredItems(
  message: { currentUrl: string, pageTitle: string, matchingMode?: string, includeRecentlySelected?: boolean }
) : Promise<messageItemsResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    // E-202: Vault is locked
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const allItems = sqliteClient.items.getAll();
    const filteredItems = await filterItemsByUrl(allItems, message.currentUrl, message.pageTitle, message.matchingMode);

    // Prioritize recently selected item for multi-step login flows (opt-in only)
    if (message.includeRecentlySelected) {
      const rootDomain = await extractRootDomainFromUrl(message.currentUrl);
      const prioritized = await prioritizeRecentlySelectedItem(filteredItems, rootDomain, allItems);
      return { success: true, items: prioritized.items, recentlySelectedId: prioritized.recentlySelectedId };
    }

    return { success: true, items: filteredItems };
  } catch (error) {
    console.error('Error getting filtered items:', error);
    // E-304: Item read failed
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Get items filtered by text search query.
 * Searches across entire vault (name, fields) and returns matches.
 *
 * @param message - Search parameters: searchTerm
 */
export async function handleGetSearchItems(
  message: { searchTerm: string }
) : Promise<messageItemsResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    // E-202: Vault is locked
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const allItems = sqliteClient.items.getAll();
    const searchResults = filterItemsBySearchTerm(allItems, message.searchTerm);

    return { success: true, items: searchResults };
  } catch (error) {
    console.error('Error searching items:', error);
    // E-304: Item read failed during search
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Get default email domain for a vault.
 * Falls back to first private or public domain if no default is configured.
 */
export function handleGetDefaultEmailDomain(): Promise<stringResponse> {
  return (async (): Promise<stringResponse> => {
    try {
      const sqliteClient = await createVaultSqliteClient();
      let domain = sqliteClient.settings.getDefaultEmailDomain();

      // If no default domain is configured, fall back to first private or public domain
      if (!domain) {
        const privateEmailDomains = await getStorageItem<string[]>(StorageKeys.PRIVATE_EMAIL_DOMAINS) ?? [];
        const publicEmailDomains = await getStorageItem<string[]>(StorageKeys.PUBLIC_EMAIL_DOMAINS) ?? [];
        domain = privateEmailDomains[0] || publicEmailDomains[0] || '';
      }

      return { success: true, value: domain || undefined };
    } catch (error) {
      console.error('Error getting default email domain:', error);
      // E-601: Storage read failed
      return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.STORAGE_READ_FAILED) };
    }
  })();
}

/**
 * Get the default identity settings.
 * Returns the effective language (with smart UI language matching if no explicit override is set).
 */
export async function handleGetDefaultIdentitySettings(
) : Promise<IdentitySettingsResponse> {
  try {
    const sqliteClient = await createVaultSqliteClient();
    const language = await sqliteClient.settings.getEffectiveIdentityLanguage();
    const gender = sqliteClient.settings.getDefaultIdentityGender();

    return {
      success: true,
      settings: {
        language,
        gender
      }
    };
  } catch (error) {
    console.error('Error getting default identity settings:', error);
    // E-601: Storage read failed
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.STORAGE_READ_FAILED) };
  }
}

/**
 * Get the password settings.
 */
export async function handleGetPasswordSettings(
) : Promise<messagePasswordSettingsResponse> {
  try {
    const sqliteClient = await createVaultSqliteClient();
    const passwordSettings = sqliteClient.settings.getPasswordSettings();

    return { success: true, settings: passwordSettings };
  } catch (error) {
    console.error('Error getting password settings:', error);
    // E-601: Storage read failed
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.STORAGE_READ_FAILED) };
  }
}

/**
 * Generate a password or passphrase from the given settings using the Rust core.
 */
export async function handleGeneratePassword(
  settings: PasswordSettings
): Promise<{ success: boolean; password?: string; error?: string }> {
  try {
    const password = await generatePassword(settings);
    return { success: true, password };
  } catch (error) {
    console.error('Error generating password:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.UNKNOWN_ERROR) };
  }
}

/**
 * Get the encryption key for the encrypted vault.
 */
export async function handleGetEncryptionKey(
) : Promise<string | null> {
  return await storage.getItem(StorageKeys.ENCRYPTION_KEY) as string | null;
}

/**
 * Get the encryption key derivation parameters for password change detection and offline mode.
 * These are stored in local: storage to enable offline unlock after browser restart.
 */
export async function handleGetEncryptionKeyDerivationParams(
) : Promise<EncryptionKeyDerivationParams | null> {
  return MasterPasswordService.getStoredDerivationParams();
}

/**
 * Handle persisting form values to storage.
 * Data is encrypted using the derived key for additional security.
 */
export async function handlePersistFormValues(data: any): Promise<void> {
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptionKey) {
    // E-504: Encryption key not found
    throw new Error(formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ENCRYPTION_KEY_NOT_FOUND));
  }

  // Always stringify the data properly
  const serializedData = JSON.stringify(data);
  const encryptedData = await EncryptionUtility.symmetricEncrypt(
    serializedData,
    encryptionKey
  );
  await storage.setItem(StorageKeys.PERSISTED_FORM_VALUES, encryptedData);
}

/**
 * Handle retrieving persisted form values from storage.
 * Data is decrypted using the derived key.
 */
export async function handleGetPersistedFormValues(): Promise<any | null> {
  const encryptionKey = await handleGetEncryptionKey();
  const encryptedData = await storage.getItem(StorageKeys.PERSISTED_FORM_VALUES) as string | null;

  if (!encryptedData || !encryptionKey) {
    return null;
  }

  try {
    const decryptedData = await EncryptionUtility.symmetricDecrypt(
      encryptedData,
      encryptionKey
    );
    return JSON.parse(decryptedData);
  } catch (error) {
    console.error('Failed to decrypt or parse persisted form values:', error);
    return null;
  }
}

/**
 * Handle clearing persisted form values from storage.
 */
export async function handleClearPersistedFormValues(): Promise<void> {
  await storage.removeItem(StorageKeys.PERSISTED_FORM_VALUES);
}

/**
 * Persist a locally-mutated vault and attempt to sync it to the server in the background.
 *
 * This is tolerant to server being offline (in which case the vault state will be stored locally for next sync).
 * @param sqliteClient - the mutated vault
 * @param encryptionKey - the key the local blob is stored under
 * @param scope - what the mutation touched; bucket-scoped mutations (e.g. 'Stats') let the sync push just
 *   that data bucket instead of the whole manifest. Defaults to a full manifest push.
 */
async function persistLocalVaultMutation(sqliteClient: SqliteClient, encryptionKey: string, scope?: VaultMutationScope) : Promise<void> {
  const encryptedVault = await encryptVaultBlob(sqliteClient.exportToBytes(), encryptionKey);
  await handleStoreEncryptedVault({ vaultBlob: encryptedVault, markDirty: true, scope });

  /*
   * The stored blob is exactly this client's content, so re-adopt the pair as the cache (the store just cleared
   * it): the sync that follows can then read the vault without another decrypt + sql.js load.
   */
  cachedSqliteClient = sqliteClient;
  cachedVaultBlob = encryptedVault;

  void handleFullVaultSync().catch(error => {
    console.error('Background sync after local vault mutation failed:', error);
  });
}

/**
 * Create a new sqlite client for the stored vault.
 * Uses a cache to avoid repeated decryption and initialization for read operations.
 * Throws when the vault is missing or locked.
 */
export async function createVaultSqliteClient() : Promise<SqliteClient> {
  // Read from local: storage for persistent vault access
  const encryptedVault = await storage.getItem(StorageKeys.ENCRYPTED_VAULT) as string;
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptedVault) {
    // E-201: Vault not found in storage
    throw new Error(formatErrorWithCode(await t('common.errors.vaultNotAvailable'), AppErrorCode.VAULT_NOT_FOUND));
  }
  if (!encryptionKey) {
    // E-202: Vault is locked
    throw new Error(formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED));
  }

  // Check if we have a valid cached client
  if (cachedSqliteClient && cachedVaultBlob === encryptedVault) {
    return cachedSqliteClient;
  }

  // Decrypt the vault
  const decryptedVault = await decryptVaultBlob(encryptedVault, encryptionKey);

  // Initialize the SQLite client with the decrypted vault
  const sqliteClient = new SqliteClient();
  await sqliteClient.initializeFromBytes(decryptedVault);

  // Cache the client and vault blob
  cachedSqliteClient = sqliteClient;
  cachedVaultBlob = encryptedVault;

  return sqliteClient;
}

/**
 * Get the encrypted vault blob directly (for merge operations).
 */
export async function handleGetEncryptedVault(): Promise<string | null> {
  return await storage.getItem(StorageKeys.ENCRYPTED_VAULT) as string | null;
}

/**
 * Store the encrypted vault blob.
 *
 * Two modes:
 * 1. Local mutation (markDirty=true): Always succeeds, increments mutation sequence
 * 2. Sync operation (expectedMutationSeq provided): Only succeeds if no mutations happened
 *    since sync started. This prevents sync from overwriting concurrent local changes.
 *
 * @param request Object with:
 *   - vaultBlob: The encrypted vault data
 *   - markDirty: If true, marks vault as dirty and increments mutation sequence (for local mutations)
 *   - expectedMutationSeq: If provided, only store if current sequence matches (for sync operations)
 * @returns { success, mutationSequence } - success=false if expectedMutationSeq didn't match
 */
export async function handleStoreEncryptedVault(request: {
  vaultBlob: string;
  markDirty?: boolean;
  expectedMutationSeq?: number;
  scope?: VaultMutationScope;
}): Promise<{ success: boolean; mutationSequence: number }> {
  let mutationSequence = await storage.getItem(StorageKeys.MUTATION_SEQUENCE) as number | null ?? 0;

  /*
   * If expectedMutationSeq is provided, this is a sync operation.
   * Reject if mutations happened during sync to avoid overwriting local changes.
   */
  if (request.expectedMutationSeq !== undefined && request.expectedMutationSeq !== mutationSequence) {
    return { success: false, mutationSequence };
  }

  if (request.markDirty) {
    // Increment mutation sequence and mark as dirty.
    mutationSequence++;
  }

  // Track what changed so the next sync can choose a cheap bucket-only push (e.g. a settings toggle) over a full manifest push.
  const dirtyScopeKey = dirtyScopeStorageKey(request.scope ?? DEFAULT_VAULT_MUTATION_SCOPE);

  // Build items to store.
  if (request.markDirty) {
    await storage.setItems([
      { key: StorageKeys.ENCRYPTED_VAULT, value: request.vaultBlob },
      { key: StorageKeys.MUTATION_SEQUENCE, value: mutationSequence },
      { key: StorageKeys.IS_DIRTY, value: true },
      { key: dirtyScopeKey, value: true }
    ]);
  } else {
    await storage.setItem(StorageKeys.ENCRYPTED_VAULT, request.vaultBlob);
  }

  // Clear cache since vault blob changed
  cachedSqliteClient = null;
  cachedVaultBlob = null;

  return { success: true, mutationSequence };
}

/**
 * Classify the pending migration status.
 */
export async function handleGetVaultMigrationStatus(): Promise<VaultMigrationStatus> {
  try {
    const result = await runVaultMigrationStatus(syncEngineHost);
    return { kind: result.kind as VaultMigrationKind, serverConfirmed: result.serverConfirmed };
  } catch (error) {
    devWarn('[ManifestMigration] Could not classify the pending migration, assuming it crosses the storage format:', error);
    return { kind: VaultMigrationKind.StorageFormatUpgrade, serverConfirmed: false };
  }
}

/**
 * Upgrade local manifest-v1 storage model to the current schema (if needed) and push it.
 */
export async function handleMigrateVaultManifest(): Promise<VaultManifestMigrationResult> {
  try {
    const encryptionKey = await handleGetEncryptionKey();
    if (!encryptionKey) {
      return { success: false, pushed: false, errorCode: AppErrorCode.VAULT_LOCKED };
    }

    const sqliteClient = await createVaultSqliteClient();
    if (await sqliteClient.requiresLegacySqliteBlobMigration()) {
      // The sqlite-blob upgrade chain has to bring the vault to 2.0.0 first; the codec cannot canonicalize what came before.
      return { success: false, pushed: false, error: await t('content.vaultUpgradeRequired') };
    }

    const result = await runVaultManifestMigration(syncEngineHost);
    if (result.success) {
      devLog(result.pushed ? '[ManifestMigration] Migration pushed to the server.' : '[ManifestMigration] Migration stored locally; the vault stays dirty for the next sync.');
    }
    return { success: result.success, pushed: result.pushed, ...toSyncErrorDetail(result) };
  } catch (error) {
    devError('[ManifestMigration] Manifest migration failed:', error);
    return { success: false, pushed: false, error: error instanceof Error ? error.message : undefined };
  }
}

/**
 * Mark the vault as clean after successful sync.
 * Only clears dirty flag if no mutations happened during sync.
 *
 * @param mutationSeqAtStart - The mutation sequence when sync started
 * @returns Whether the dirty flag was cleared
 */
export async function handleMarkVaultClean(request: {
  mutationSeqAtStart: number;
}): Promise<{ cleared: boolean; currentMutationSeq: number }> {
  const currentMutationSeq = await storage.getItem(StorageKeys.MUTATION_SEQUENCE) as number | null ?? 0;

  if (currentMutationSeq === request.mutationSeqAtStart) {
    // No mutations during sync - safe to mark as clean
    await storage.setItem(StorageKeys.IS_DIRTY, false);
    await clearDirtyScopes();
    return { cleared: true, currentMutationSeq };
  }

  return { cleared: false, currentMutationSeq };
}

/**
 * Get the current sync state.
 */
export async function handleGetSyncState(): Promise<VaultSyncState> {
  const [isDirty, mutationSequence] = await Promise.all([
    storage.getItem(StorageKeys.IS_DIRTY) as Promise<boolean | null>,
    storage.getItem(StorageKeys.MUTATION_SEQUENCE) as Promise<number | null>
  ]);

  return {
    isDirty: isDirty ?? false,
    mutationSequence: mutationSequence ?? 0,
    isSyncInProgress
  };
}

/**
 * Tell any open popup what the current sync is doing. Fire-and-forget: with no popup open there is no
 * receiver and runtime messaging rejects, which is expected and ignored.
 * @param phase - the phase to broadcast
 */
function broadcastSyncPhase(phase: VaultSyncPhase): void {
  sendMessage('VAULT_SYNC_PHASE', { phase }).catch(() => {});
}

/**
 * Persists a sync error message to local storage so the popup can surface it
 * even when the failing sync was triggered from the background (e.g. follow-up
 * syncs after pending mutations). Any other result clears the stored message, so a stale
 * error cannot keep re-opening the dialog after it stopped applying.
 */
async function persistSyncErrorState(result: FullVaultSyncResult): Promise<void> {
  // requiresLogout and wasOffline have dedicated UX: the forced re-login flow and the offline indicator.
  const dedicatedError = result.requiresLogout || result.wasOffline;

  if (hasSyncError(result) && !dedicatedError) {
    await storage.setItem(StorageKeys.LAST_SYNC_ERROR, { errorKey: result.errorKey, errorCode: result.errorCode, error: result.error });
  } else {
    await storage.removeItem(StorageKeys.LAST_SYNC_ERROR);
  }
}

/**
 * Full vault sync orchestration that runs entirely in background context.
 * Wraps the internal implementation with sync-error persistence so the popup
 * can show a targeted alert for failures even if it wasn't open at the time.
 * @param options - what the caller asks of the sync beyond what the revisions decide
 */
export async function handleFullVaultSync(options?: FullVaultSyncRequest): Promise<FullVaultSyncResult> {
  const result = await handleFullVaultSyncInternal(options);
  if (options?.reportErrorToPopup !== false) {
    await persistSyncErrorState(result);
  }
  return result;
}

/**
 * Full vault sync which does both push and pull based on revision counters.
 * @param options - what the caller asks of the sync beyond what the revisions decide
 */
async function handleFullVaultSyncInternal(options?: VaultSyncOptions): Promise<FullVaultSyncResult> {
  if (await syncIsOnHold()) {
    return syncResult({ success: false });
  }

  // Check if sync is already in progress
  if (isSyncInProgress) {
    // Mark that we need to sync again after current sync completes
    hasPendingSync = true;
    devLog('[VaultSync] Sync already in progress, queued for retry after completion');
    return syncResult();
  }

  // Mark sync as in progress
  isSyncInProgress = true;
  hasPendingSync = false;

  try {
    const [username, accessToken, encryptionKey] = await Promise.all([storage.getItem(StorageKeys.USERNAME), storage.getItem(StorageKeys.ACCESS_TOKEN), handleGetEncryptionKey()]);
    if (username === null || accessToken === null) {
      return syncResult({ success: false });
    }
    if (!encryptionKey) {
      return syncResult({ success: false, errorCode: AppErrorCode.VAULT_LOCKED });
    }
    return toFullVaultSyncResult(await runFullVaultSync(syncEngineHost, options));
  } catch (err) {
    console.error('Vault sync error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error during vault sync';
    return syncResult({ success: false, error: /E-\d{3}/.test(message) ? message : formatErrorWithCode(message, AppErrorCode.UNKNOWN_ERROR) });
  } finally {
    // Reset sync in progress flag
    isSyncInProgress = false;

    // Clear the popup's sync indicator; a follow-up sync below re-announces its own phase.
    broadcastSyncPhase('idle');

    // Check if another sync is needed (mutations happened during this sync).
    if (hasPendingSync) {
      devLog('[VaultSync] Pending mutations detected, triggering follow-up sync');
      hasPendingSync = false;

      handleFullVaultSync().catch(err => {
        console.error('[VaultSync] Follow-up sync failed:', err);
      });
    }
  }
}

/**
 * Whether a sync has to yield to a held sync hold (see VaultSyncHold), logging what it yields to when it does.
 */
async function syncIsOnHold(): Promise<boolean> {
  const reason = await getVaultSyncHoldReason();
  if (reason) {
    devLog(`[VaultSync] Sync refused: on hold for ${reason}.`);
  }
  return reason !== null;
}

/**
 * Check if a login credential already exists in the vault.
 * Used by the save prompt to avoid offering to save duplicates.
 *
 * @param message - The domain and username to check.
 * @returns Whether a duplicate exists and the matching item info if found.
 */
export async function handleCheckLoginDuplicate(
  message: { domain: string; username: string }
): Promise<DuplicateCheckResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, isDuplicate: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const allItems = sqliteClient.items.getAll();

    // Find items with matching domain and username
    const normalizedDomain = message.domain.toLowerCase();
    const normalizedUsername = message.username.toLowerCase();

    for (const item of allItems) {
      // Check LoginUrl field for domain match (supports multi-value URLs)
      const urlField = item.Fields?.find((f: { FieldKey: string }) => f.FieldKey === FieldKey.LoginUrl);
      const urlValue = urlField?.Value;
      if (!urlValue) {
        continue;
      }

      // Normalize URL value to array for consistent handling
      const urls = Array.isArray(urlValue) ? urlValue : [urlValue];

      // Check if any URL matches the domain
      let domainsMatch = false;
      for (const singleUrl of urls) {
        if (typeof singleUrl !== 'string') {
          continue;
        }

        // Extract domain from URL
        let itemDomain: string;
        try {
          const url = new URL(singleUrl.startsWith('http') ? singleUrl : `https://${singleUrl}`);
          itemDomain = url.hostname.toLowerCase();
        } catch {
          // If URL parsing fails, try direct comparison
          itemDomain = singleUrl.toLowerCase();
        }

        // Check if domains match (including subdomains)
        if (itemDomain === normalizedDomain || itemDomain.endsWith(`.${normalizedDomain}`) || normalizedDomain.endsWith(`.${itemDomain}`)) {
          domainsMatch = true;
          break;
        }
      }

      if (!domainsMatch) {
        continue;
      }

      // Check LoginUsername or LoginEmail field for username match
      const usernameField = item.Fields?.find((f: { FieldKey: string }) => f.FieldKey === FieldKey.LoginUsername);
      const emailField = item.Fields?.find((f: { FieldKey: string }) => f.FieldKey === FieldKey.LoginEmail);

      const usernameValue = usernameField?.Value;
      const emailValue = emailField?.Value;

      const itemUsername = (typeof usernameValue === 'string' ? usernameValue : '').toLowerCase();
      const itemEmail = (typeof emailValue === 'string' ? emailValue : '').toLowerCase();

      if (itemUsername === normalizedUsername || itemEmail === normalizedUsername) {
        return {
          success: true,
          isDuplicate: true,
          matchingItemId: item.Id,
          matchingItemName: item.Name ?? undefined
        };
      }
    }

    return { success: true, isDuplicate: false };
  } catch (error) {
    console.error('Error checking for duplicate login:', error);
    return { success: false, isDuplicate: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Save a captured login credential to the vault.
 * Creates a new Login item with the provided credentials.
 *
 * @param message - The login details to save.
 * @returns Success status and the new item ID if created.
 */
export async function handleSaveLoginCredential(
  message: {
    serviceName: string;
    username: string;
    password: string;
    url: string;
    domain: string;
    logoBase64?: string;
    faviconUrl?: string;
  }
): Promise<SaveLoginResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const currentDateTime = new Date().toISOString();

    // Build fields for the new item
    const fields = [];

    // Add URL field
    if (message.url) {
      fields.push(createSystemField(FieldKey.LoginUrl, { value: message.url }));
    }

    // Add username field
    if (message.username) {
      // Check if username looks like an email
      if (message.username.includes('@')) {
        fields.push(createSystemField(FieldKey.LoginEmail, { value: message.username }));
      } else {
        fields.push(createSystemField(FieldKey.LoginUsername, { value: message.username }));
      }
    }

    // Add password field
    if (message.password) {
      fields.push(createSystemField(FieldKey.LoginPassword, { value: message.password }));
    }

    // Get logo from base64, favicon URL, or undefined
    let logo: Uint8Array | undefined;

    // First try direct base64 if provided
    if (message.logoBase64) {
      try {
        logo = base64ToBytes(message.logoBase64);
      } catch {
        // Logo decode failed, continue without logo
      }
    }

    // If no direct logo, try fetching from favicon URL
    if (!logo && message.faviconUrl) {
      logo = await fetchFaviconAsBytes(message.faviconUrl);
    }

    // Create the new item
    const newItem: DraftItem = {
      Id: '', // Will be generated by SQLite
      Name: message.serviceName || message.domain,
      ItemType: ItemTypes.Login,
      Logo: logo,
      Fields: fields,
      CreatedAt: currentDateTime,
      UpdatedAt: currentDateTime
    };

    // Add the item to the vault
    await sqliteClient.items.create(newItem, [], []);

    // Persist locally and sync in the background (doesn't block when server is offline).
    await persistLocalVaultMutation(sqliteClient, encryptionKey);

    return { success: true, itemId: newItem.Id };
  } catch (error) {
    console.error('Failed to save login credential:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_CREATE_FAILED) };
  }
}

/**
 * Add a URL to an existing credential in the vault.
 * This is used when a user autofills from an existing credential on a new site
 * and wants to add that URL to the credential instead of creating a new one.
 *
 * @param message - The item ID and URL to add.
 * @returns Success status.
 */
export async function handleAddUrlToCredential(message: { itemId: string; url: string }): Promise<{ success: boolean; error?: string }> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const url = ServiceDetectionUtility.sanitizeUrl(message.url) || message.url;

    // Get the existing item
    const item = sqliteClient.items.getById(message.itemId);
    if (!item) {
      return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
    }

    // Find the existing URL field
    const urlFieldIndex = item.Fields?.findIndex(f => f.FieldKey === FieldKey.LoginUrl);

    if (urlFieldIndex !== undefined && urlFieldIndex >= 0) {
      const existingField = item.Fields![urlFieldIndex];
      const existingUrls = Array.isArray(existingField.Value) ? existingField.Value : (existingField.Value ? [existingField.Value] : []);

      /*
       * Compare on host only (subdomain + domain) so trailing slashes, paths,
       * query strings, fragments, `www.`, and http/https differences don't
       * cause us to store a near-duplicate URL on the credential.
       */
      if (await isUrlAlreadyLinked(existingUrls as string[], url)) {
        return { success: true };
      }

      // Add the new URL
      item.Fields![urlFieldIndex].Value = [...existingUrls, url];
    } else {
      // No URL field exists - create one
      const newUrlField = createSystemField(FieldKey.LoginUrl, { value: url });
      if (!item.Fields) {
        item.Fields = [];
      }
      item.Fields.push(newUrlField);
    }

    // Update the item's timestamp
    item.UpdatedAt = new Date().toISOString();

    // Update the item in the vault
    await sqliteClient.items.update(item, [], [], [], []);

    // Persist locally and sync in the background (doesn't block when server is offline).
    await persistLocalVaultMutation(sqliteClient, encryptionKey);

    return { success: true };
  } catch (error) {
    console.error('Failed to add URL to credential:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_UPDATE_FAILED) };
  }
}

/**
 * Check whether a URL is already linked (host-equivalent) to a credential.
 */
export async function handleIsUrlLinkedToCredential(message: { itemId: string; url: string }): Promise<{ linked: boolean }> {
  try {
    const encryptionKey = await handleGetEncryptionKey();
    if (!encryptionKey) {
      return { linked: false };
    }
    const sqliteClient = await createVaultSqliteClient();
    const item = sqliteClient.items.getById(message.itemId);
    if (!item) {
      return { linked: false };
    }
    const urlField = item.Fields?.find(f => f.FieldKey === FieldKey.LoginUrl);
    const existingUrls = urlField
      ? (Array.isArray(urlField.Value) ? urlField.Value : (urlField.Value ? [urlField.Value] : []))
      : [];
    const linked = await isUrlAlreadyLinked(existingUrls as string[], message.url);
    return { linked };
  } catch {
    return { linked: false };
  }
}

/**
 * Fetch a favicon from a URL and return it as a Uint8Array.
 * Returns undefined if the fetch fails or returns an invalid response.
 */
async function fetchFaviconAsBytes(url: string): Promise<Uint8Array | undefined> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'force-cache',
    });

    if (!response.ok) {
      return undefined;
    }

    // Check content type - should be an image
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.startsWith('image/')) {
      return undefined;
    }

    const arrayBuffer = await response.arrayBuffer();

    // Sanity check: favicon should be reasonably sized (< 1MB)
    if (arrayBuffer.byteLength > 1024 * 1024) {
      return undefined;
    }

    // Minimum size check - valid images should have some content
    if (arrayBuffer.byteLength < 10) {
      return undefined;
    }

    return new Uint8Array(arrayBuffer);
  } catch {
    // Fetch failed (network error, CORS, etc.)
    return undefined;
  }
}

/**
 * Get the login save feature settings.
 * Returns whether the feature is enabled and auto-dismiss timeout.
 */
export async function handleGetLoginSaveSettings(): Promise<{
  success: boolean;
  enabled: boolean;
  autoDismissSeconds: number;
  error?: string;
}> {
  try {
    const enabled = await LocalPreferencesService.getLoginSaveEnabled();
    const autoDismissSeconds = await LocalPreferencesService.getLoginSaveAutoDismissSeconds();

    return {
      success: true,
      enabled,
      autoDismissSeconds
    };
  } catch (error) {
    console.error('Error getting login save settings:', error);
    return { success: false, enabled: false, autoDismissSeconds: 15, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.STORAGE_READ_FAILED) };
  }
}

/**
 * Set the login save feature enabled state.
 *
 * @param enabled - Whether the feature should be enabled.
 */
export async function handleSetLoginSaveEnabled(
  enabled: boolean
): Promise<messageBoolResponse> {
  try {
    await LocalPreferencesService.setLoginSaveEnabled(enabled);
    return { success: true };
  } catch (error) {
    console.error('Error setting login save enabled:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.STORAGE_WRITE_FAILED) };
  }
}

/**
 * Get items that have TOTP codes, filtered by URL matching.
 * Used for TOTP autofill popup to show only items with 2FA codes.
 *
 * @param message - Filtering parameters: currentUrl, pageTitle, matchingMode
 */
export async function handleGetItemsWithTotp(
  message: { currentUrl: string, pageTitle: string, matchingMode?: string }
): Promise<messageItemsResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const allItems = sqliteClient.items.getAll();

    // Filter to only items with TOTP codes
    const itemsWithTotp = allItems.filter((item: Item) => item.HasTotp === true);

    // Then filter by URL matching using shared logic
    const filteredItems = await filterItemsByUrl(itemsWithTotp, message.currentUrl, message.pageTitle, message.matchingMode);

    // Prioritize recently selected item for multi-step login flows
    const rootDomain = await extractRootDomainFromUrl(message.currentUrl);
    const prioritized = await prioritizeRecentlySelectedItem(filteredItems, rootDomain, itemsWithTotp);

    return { success: true, items: prioritized.items, recentlySelectedId: prioritized.recentlySelectedId };
  } catch (error) {
    console.error('Error getting items with TOTP:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Search items that have TOTP codes by search term.
 * Used for TOTP autofill popup search functionality.
 *
 * @param message - Search parameters: searchTerm
 */
export async function handleSearchItemsWithTotp(
  message: { searchTerm: string }
): Promise<messageItemsResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const allItems = sqliteClient.items.getAll();

    // Filter to only items with TOTP codes
    const itemsWithTotp = allItems.filter((item: Item) => item.HasTotp === true);

    // Then search using shared logic
    const searchResults = filterItemsBySearchTerm(itemsWithTotp, message.searchTerm);

    return { success: true, items: searchResults };
  } catch (error) {
    console.error('Error searching items with TOTP:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Get TOTP secret keys for items.
 * Used by content script to generate codes locally for live preview.
 *
 * @param message - Array of item IDs to get TOTP secrets for
 */
export async function handleGetTotpSecrets(
  message: { itemIds: string[] }
): Promise<{ success: boolean; secrets?: Record<string, TotpSecret>; error?: string }> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const secrets: Record<string, TotpSecret> = {};

    for (const itemId of message.itemIds) {
      const totpCodes = sqliteClient.items.getTotpCodesForItem(itemId);
      if (totpCodes.length > 0) {
        const totpCode = totpCodes[0];
        secrets[itemId] = {
          SecretKey: totpCode.SecretKey,
          Algorithm: totpCode.Algorithm,
          Digits: totpCode.Digits,
          Period: totpCode.Period
        };
      }
    }

    return { success: true, secrets };
  } catch (error) {
    console.error('Error getting TOTP secrets:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Generate a TOTP code for a specific item.
 * Used by content script to fill TOTP fields.
 *
 * @param message - The item ID to generate TOTP code for
 */
export async function handleGenerateTotpCode(
  message: { itemId: string }
): Promise<{ success: boolean; code?: string; error?: string }> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const totpCodes = sqliteClient.items.getTotpCodesForItem(message.itemId);

    if (totpCodes.length === 0) {
      return { success: false, error: 'No TOTP codes found for this item' };
    }

    const code = generateTotpCode(totpCodes[0].SecretKey, totpCodes[0]);
    if (!code) {
      return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
    }

    return { success: true, code };
  } catch (error) {
    console.error('Error generating TOTP code:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Record one use of an item: when it was last used, and how often.
 * @param message - The item that was used and what was done with it.
 */
export async function handleRecordItemUsage(
  message: { itemId: string; action: ItemUsageAction }
): Promise<{ success: boolean }> {
  try {
    const encryptionKey = await handleGetEncryptionKey();
    if (!encryptionKey) {
      return { success: false };
    }

    const sqliteClient = await createVaultSqliteClient();
    if (!sqliteClient.itemStats.recordUsage(message.itemId, message.action)) {
      // No such item (deleted between use and record); nothing to attribute the use to.
      return { success: false };
    }

    await persistLocalVaultMutation(sqliteClient, encryptionKey, VaultDataBucketCategory.Stats);
    return { success: true };
  } catch (error) {
    console.error('Failed to record item usage:', error);
    return { success: false };
  }
}

/**
 * Set recently selected item for smart autofill.
 */
export async function handleSetRecentlySelected(
  message: { itemId: string; domain: string }
): Promise<{ success: boolean }> {
  try {
    const rootDomain = await extractRootDomain(message.domain);
    await RecentlySelectedItemService.setRecentlySelected(message.itemId, rootDomain);
    return { success: true };
  } catch (error) {
    console.error('Error setting recently selected item:', error);
    return { success: false };
  }
}

/**
 * Get recently selected item for smart autofill.
 */
export async function handleGetRecentlySelected(
  message: { domain: string }
): Promise<{ success: boolean; itemId?: string | null }> {
  try {
    const rootDomain = await extractRootDomain(message.domain);
    const itemId = await RecentlySelectedItemService.getRecentlySelected(rootDomain);
    return { success: true, itemId };
  } catch (error) {
    console.error('Error getting recently selected item:', error);
    return { success: false, itemId: null };
  }
}

/**
 * Create another shared manifest for a family, with this account as its first member.
 *
 * @param message - the family to create the vault for and the name to give it.
 */
export async function handleGroupCreateVault(message: { groupId: string; name: string }): Promise<{ success: boolean; error?: string; apiErrorCode?: string }> {
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  const name = message.name.trim();
  if (name.length === 0) {
    return { success: false, error: await t('sharing.family.errors.createVaultFailed') };
  }

  try {
    const webApi = new WebApiService();
    const overview = await SharingService.getOverview(webApi);
    const group = overview.groups.find(candidate => candidate.groupId.toLowerCase() === message.groupId.toLowerCase());

    if (!group || group.role === 'Member') {
      console.error(`Failed to create shared manifest: group ${message.groupId} is not one this account administers.`);
      return { success: false, error: await t('sharing.family.errors.createVaultFailed') };
    }

    // The new vault's VEK is encrypted for this client's own account public key.
    const selfPublicKey = await VaultKeyService.getAccountPublicKey();
    if (!selfPublicKey) {
      return { success: false, error: await t('sharing.family.errors.vaultUpgradeRequired') };
    }

    const sqliteClient = await createVaultSqliteClient();
    if (await vaultRequiresManifestMigration(sqliteClient)) {
      return { success: false, error: await t('sharing.family.errors.vaultUpgradeRequired') };
    }

    // The name stays on this device: it rides into the vault below, never into the create request.
    const mapping = await SharingService.createSharedManifest(webApi, {
      groupId: group.groupId,
      selfPublicKey,
    }, crypto.randomUUID());

    await SharingService.addSharedManifestRecord({
      manifestId: mapping.manifestId,
      encryptedVek: mapping.encryptedVek,
      encryptionPublicKey: mapping.encryptionPublicKey,
      algorithm: mapping.algorithm,
      salt: mapping.salt,
      name,
      canAdminister: true,
    }, encryptionKey);

    await recordManifestRevisions({ [mapping.manifestId]: mapping.revision });
    await multiManifestRendering.render(sqliteClient, mapping.manifestId, name);

    // Mail to an alias in this vault is encrypted with the vault's own keypair, which is what makes it readable by every member.
    await SharingService.rotateManifestEncryptionKey(sqliteClient, mapping.manifestId);
    await persistLocalVaultMutation(sqliteClient, encryptionKey);

    devLog(`[Sharing] Created shared manifest ${mapping.manifestId} ("${name}") for group ${group.groupId}.`);
    return { success: true };
  } catch (error) {
    console.error('Failed to create shared manifest:', error);
    if (error instanceof ApiRequestError && error.apiErrorCode) {
      return { success: false, apiErrorCode: error.apiErrorCode };
    }

    /*
     * Everything this can fail on (a vault that will not open, a key that will not import, a server that refuses
     * without a code) collapses into the same sentence otherwise, which leaves nothing to act on. The cause is
     * appended the way the upload path does it.
     */
    const detail = error instanceof Error && error.message.length > 0 ? ` [${error.message}]` : '';
    return { success: false, error: `${await t('sharing.family.errors.createVaultFailed')}${detail}` };
  }
}

/**
 * Invite a member of a family to one of its shared manifests, handing them the manifest's key sealed for them.
 *
 * The recipient is picked off the family's own roster, so this never names an account outside the family.
 * @param message - the family, the manifest, and the member being invited.
 */
export async function handleGroupInviteMember(message: { groupId: string; manifestId: string; userId: string }): Promise<{ success: boolean; error?: string; apiErrorCode?: string }> {
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  /**
   * Fail the invite with a reason.
   * @param reason - what was missing.
   */
  const failed = async (reason: string): Promise<{ success: boolean; error: string }> => {
    devWarn(`[Sharing] Could not invite ${message.userId} to vault ${message.manifestId}: ${reason}.`);
    return { success: false, error: `${await t('sharing.family.errors.inviteFailed')} [${reason}]` };
  };

  try {
    const webApi = new WebApiService();
    const overview = await SharingService.getOverview(webApi);
    const group = overview.groups.find(candidate => candidate.groupId.toLowerCase() === message.groupId.toLowerCase());
    const manifest = group?.manifests.find(candidate => candidate.manifestId.toLowerCase() === message.manifestId.toLowerCase());
    const member = group?.members.find(candidate => candidate.userId === message.userId);

    if (!group || group.role === 'Member') {
      return failed('not an administrator of the group');
    }

    if (!manifest) {
      return failed('the vault does not belong to the group');
    }

    if (!member) {
      return failed('the recipient is not a member of the group');
    }

    if (!member.publicKey) {
      return { success: false, apiErrorCode: 'INVITE_RECIPIENT_NOT_READY' };
    }

    // Find this account's own grant on the vault: a key that was never handed to this account cannot be passed on.
    let record = await SharingService.getSharedManifestRecord(manifest.manifestId);
    if (!record) {
      // Backstop: the records persist next to the vault, so a missing one means a desync only a pull repairs.
      devWarn(`[Sharing] No key record stored for vault ${manifest.manifestId}; pulling to re-record it before inviting.`);
      await handleFullVaultSync({ forcePull: true });
      record = await SharingService.getSharedManifestRecord(manifest.manifestId);
    }

    if (!record) {
      return failed('this account holds no key for the vault');
    }

    const sqliteClient = await createVaultSqliteClient();
    const manifestVek = await SharingService.openSharedManifestVek(sqliteClient, record);
    if (!manifestVek) {
      return failed('the key of the vault did not open');
    }

    const vaultName = multiManifestRendering.displayNames(sqliteClient)[manifest.manifestId.toLowerCase()] ?? record.name ?? null;
    const grant = await SharingService.encryptVekFor(manifestVek, member, vaultName);
    if (!grant) {
      return { success: false, apiErrorCode: 'INVITE_RECIPIENT_NOT_READY' };
    }

    await SharingService.inviteMember(webApi, group.groupId, manifest.manifestId, member.userId, grant, VaultKeyAlgorithm.RsaOaepSha256);

    devLog(`[Sharing] Invited ${member.userId} to vault ${manifest.manifestId} with its key encrypted for them.`);
    return { success: true };
  } catch (error) {
    if (error instanceof ApiRequestError && error.apiErrorCode) {
      return { success: false, apiErrorCode: error.apiErrorCode };
    }

    console.error('Failed to invite member to shared manifest:', error);
    return { success: false, error: await t('sharing.family.errors.inviteFailed') };
  }
}

/**
 * Take a member's access to one shared manifest away, or hand back one's own.
 *
 * @param message - the family, the vault, and the member losing access.
 */
export async function handleGroupRevokeAccess(message: { groupId: string; manifestId: string; userId: string }): Promise<{ success: boolean; error?: string; apiErrorCode?: string }> {
  try {
    const webApi = new WebApiService();
    await SharingService.revokeAccess(webApi, message.groupId, message.manifestId, message.userId);

    devLog(`[Sharing] Revoked ${message.userId}'s access to vault ${message.manifestId}; syncing to pick up whatever the server left for this client to finish.`);
    void handleFullVaultSync().catch(error => console.error('Background sync after a vault access change failed:', error));

    return { success: true };
  } catch (error) {
    if (error instanceof ApiRequestError && error.apiErrorCode) {
      return { success: false, apiErrorCode: error.apiErrorCode };
    }

    console.error('Failed to revoke shared manifest access:', error);
    return { success: false, error: await t('sharing.family.errors.revokeAccessFailed') };
  }
}
