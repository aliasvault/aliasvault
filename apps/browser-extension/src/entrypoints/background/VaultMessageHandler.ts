/* eslint-disable @typescript-eslint/no-explicit-any */

import { ApiRequestError } from '@aliasvault/client/api/errors/ApiRequestError';
import { AppErrorCode, formatErrorWithCode } from '@aliasvault/client/api/errors/AppErrorCodes';
import { VaultVersionIncompatibleError } from '@aliasvault/client/api/errors/VaultVersionIncompatibleError';
import { WebApiService } from '@aliasvault/client/api/WebApiService';
import { MasterPasswordService } from '@aliasvault/client/auth/MasterPasswordService';
import { VaultKeyService } from '@aliasvault/client/auth/VaultKeyService';
import { EncryptionUtility } from '@aliasvault/client/crypto/EncryptionUtility';
import { decryptVaultBlob, encryptVaultBlob } from '@aliasvault/client/crypto/VaultBlob';
import { isSameItem, manifestForItemIn, scopedKey, type ItemRef } from '@aliasvault/client/database/ItemRef';
import { SqliteClient } from '@aliasvault/client/database/SqliteClient';
import { FaviconService } from '@aliasvault/client/items/FaviconService';
import { applySearchFilter } from '@aliasvault/client/items/ItemFilters';
import { generateTotpCode } from '@aliasvault/client/items/TotpUtility';
import { getOrCreateDeviceId } from '@aliasvault/client/platform/DeviceId';
import { filterItems, AutofillMatchingMode, extractRootDomain, isUrlAlreadyLinked } from '@aliasvault/client/rust/RustCore';
import { familySharingText } from '@aliasvault/client/sharing/FamilySharingView';
import { SharingService } from '@aliasvault/client/sharing/SharingService';
import { clearDirtyScopes, getDirtyScopes } from '@aliasvault/client/sync/VaultDirtyState';
import { vaultRequiresManifestMigration, VaultMigrationKind } from '@aliasvault/client/sync/VaultManifestMigration';
import { type VaultMutationScope, DEFAULT_VAULT_MUTATION_SCOPE, hasUserVisibleScope } from '@aliasvault/client/sync/VaultMutationScope';
import { hasSyncError, syncResult, VaultSync, type FullVaultSyncResult, type SharedManifestDetails, type SharingOperationResult, type VaultManifestMigrationResult } from '@aliasvault/client/sync/VaultSync';
import { type IVaultSyncEngineHost, type VaultSyncOptions, type VaultSyncPhase as EngineSyncPhase, type VaultSyncStoreOutcome, type VaultSyncStoreRequest } from '@aliasvault/client/sync/VaultSyncEngine';
import { getVaultSyncHoldReason } from '@aliasvault/client/sync/VaultSyncHold';
import { FieldKey, ItemTypes, createSystemField, getFieldValue, itemToCredential, normalizeTotpPeriod, type Credential, type Item } from '@aliasvault/models/vault';

import { clearAllSavePromptState, handleGetLastAutofilled, handleStoreLastAutofilled, isRelatedDomain } from '@/entrypoints/background/SavePromptStateHandler';
import { handleClearTwoFactorState } from '@/entrypoints/background/TwoFactorStateHandler';

import { AUTH_STORAGE_KEYS, dirtyScopeStorageKey, SESSION_STORAGE_KEYS, StorageKeys, vaultDataStorageKeys, VAULT_LOCK_STORAGE_KEYS } from '@/utils/constants/storageKeys';
import { devLog } from '@/utils/devLogger/DevLogger';
import { logFailure } from '@/utils/Diagnostics';
import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import { sendMessage, type TotpCodePreview, type VaultBlobStoreOptions } from '@/utils/messaging/ExtensionMessaging';
import { RecentlySelectedItemService } from '@/utils/RecentlySelectedItemService';
import { ServiceDetectionUtility } from '@/utils/serviceDetection/ServiceDetectionUtility';
import type { BoolResponse as messageBoolResponse } from '@/utils/types/messaging/BoolResponse';
import type { DuplicateCheckResponse } from '@/utils/types/messaging/DuplicateCheckResponse';
import type { FullVaultSyncRequest } from '@/utils/types/messaging/FullVaultSyncRequest';
import type { AutofillItemSummary, ItemsResponse as messageItemsResponse } from '@/utils/types/messaging/ItemsResponse';
import type { PasswordSettingsResponse as messagePasswordSettingsResponse } from '@/utils/types/messaging/PasswordSettingsResponse';
import type { SaveLoginResponse } from '@/utils/types/messaging/SaveLoginResponse';
import type { VaultSyncPhase } from '@/utils/types/messaging/VaultSyncPhase';
import type { VaultSyncState } from '@/utils/types/messaging/VaultSyncState';

import { t } from '@/i18n/StandaloneI18n';

import type { ItemUsageAction } from '@aliasvault/client/database';
import type { ISqliteDatabase, SqliteValue } from '@aliasvault/client/platform';
import type { UnlockKeyDerivationParams } from '@aliasvault/models/metadata';

import { storage } from '#imports';

/**
 * Cache for the SqliteClient to avoid repeated decryption and initialization.
 * The cached instance is the single source of truth for the in-memory vault.
 *
 * Cache Strategy:
 * - Local mutations (createCredential, etc.): Work directly on cachedSqliteClient, no cache clearing
 * - New vault from remote (login, sync): Clear cache by setting both to null, WITHOUT closing: an in-flight
 *   flow (e.g. a push holding the client across an HTTP await, or persistLocalVaultMutation reusing the
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
 * The sync operations on the background's vault.
 */
const vaultSync = new VaultSync(syncEngineHost, createVaultSqliteClient);

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
 * Store the session's key in session storage. It is the one secret the session holds: the vault encryption key and the
 * account private key are derived from it and the cached key chain on demand.
 */
export async function handleStoreAccountKey(
  accountKey: string,
) : Promise<messageBoolResponse> {
  try {
    await storage.setItem(StorageKeys.ACCOUNT_KEY, accountKey);
    return { success: true };
  } catch (error) {
    logFailure('Failed to store Account Key', error);
    // E-602: Storage write failed during Account Key store
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownErrorTryAgain'), AppErrorCode.STORAGE_WRITE_FAILED) };
  }
}

/**
 * Store the encryption key derivation parameters in browser storage.
 * These are stored in local: storage to enable offline unlock after browser restart.
 */
export async function handleStoreUnlockKeyDerivationParams(
  params: UnlockKeyDerivationParams,
) : Promise<messageBoolResponse> {
  try {
    await storage.setItem(StorageKeys.UNLOCK_KEY_DERIVATION_PARAMS, params);
    return { success: true };
  } catch (error) {
    logFailure('Failed to store encryption key derivation params', error);
    // E-602: Storage write failed during derivation params store
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownErrorTryAgain'), AppErrorCode.STORAGE_WRITE_FAILED) };
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
 * Where an autofill message came from, as reported by the browser.
 */
export type AutofillSender = {
  tabId?: number;
  pageUrl: string | null;
};

/**
 * Reduce an item to what the in-page popup shows before the user picks it.
 */
function toAutofillSummary(item: Item): AutofillItemSummary {
  const firstName = getFieldValue(item, FieldKey.AliasFirstName);
  const lastName = getFieldValue(item, FieldKey.AliasLastName);
  const login = getFieldValue(item, FieldKey.LoginUsername) || getFieldValue(item, FieldKey.LoginEmail);

  const details: string[] = [];
  if (firstName && lastName) {
    details.push(`${firstName} ${lastName}`);
  }
  if (login) {
    details.push(login);
  }

  return { Id: item.Id, ManifestId: item.ManifestId, Name: item.Name ?? '', Logo: item.Logo, Details: details.join(' · ') };
}

/**
 * Whether an item carries a username, email or password, so it can fill a login form.
 */
function hasFillableLoginField(item: Item): boolean {
  return [FieldKey.LoginUsername, FieldKey.LoginEmail, FieldKey.LoginPassword].some((key) => (getFieldValue(item, key) ?? '').trim() !== '');
}

/**
 * Whether `url` is an http(s) URL on the sender's page (same host or same root domain).
 */
async function isUrlOnSenderPage(url: string, sender: AutofillSender): Promise<boolean> {
  if (!sender.pageUrl) {
    return false;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    return await isRelatedDomain(parsed.hostname.toLowerCase(), new URL(sender.pageUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Whether the item is the one the background last handed out for autofill in the sender's tab, and `url` is on the sender's page.
 */
async function isLastAutofilledOnSenderPage(item: ItemRef, url: string, sender: AutofillSender): Promise<boolean> {
  if (sender.tabId === undefined || !await isUrlOnSenderPage(url, sender)) {
    return false;
  }
  const last = handleGetLastAutofilled({ tabId: sender.tabId }).credential;
  return last !== null && last.itemId === item.Id && last.manifestId === item.ManifestId;
}

/**
 * Remember an item the user picked on the sender's page (recently selected for its root domain) and record the use.
 */
async function recordAutofill(item: ItemRef, sender: AutofillSender): Promise<void> {
  if (sender.pageUrl) {
    await RecentlySelectedItemService.setRecentlySelected({ Id: item.Id, ManifestId: item.ManifestId }, await extractRootDomainFromUrl(sender.pageUrl));
  }
  void handleRecordItemUsage({ itemId: item.Id, manifestId: item.ManifestId, action: 'autofill' });
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
 * @returns The items (with recently selected prioritized) and the matched item, if any
 */
async function prioritizeRecentlySelectedItem(
  items: Item[],
  rootDomain: string,
  allItems: Item[]
): Promise<{ items: Item[], recentlySelected: ItemRef | null }> {
  const recentlySelected = await RecentlySelectedItemService.getRecentlySelected(rootDomain);

  if (!recentlySelected) {
    return { items, recentlySelected: null };
  }

  // Find the recently selected item in the filtered results
  const recentlySelectedIndex = items.findIndex(item => isSameItem(item, recentlySelected));

  if (recentlySelectedIndex !== -1) {
    // Item is already in filtered results - move it to the front
    const recentlySelectedItem = items[recentlySelectedIndex];
    const reorderedItems = [
      recentlySelectedItem,
      ...items.slice(0, recentlySelectedIndex),
      ...items.slice(recentlySelectedIndex + 1)
    ];
    return { items: reorderedItems, recentlySelected };
  }

  // Item is not in filtered results - fetch it from all items and prepend it
  const recentlySelectedItem = allItems.find(item => isSameItem(item, recentlySelected));

  if (!recentlySelectedItem) {
    // Item not found in vault (might have been deleted)
    return { items, recentlySelected: null };
  }

  // Prepend the recently selected item to the filtered results
  return { items: [recentlySelectedItem, ...items], recentlySelected };
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
 * Filter items by search term for the in-page autofill popup, with the same matching as the popup and web app search
 * (core/client applySearchFilter). An empty term matches nothing, and results are sorted by name.
 *
 * @param items - The items to filter
 * @param searchTerm - The search term to use
 * @returns The filtered items
 */
function filterItemsBySearchTerm(items: Item[], searchTerm: string): Item[] {
  if (!searchTerm || searchTerm.trim() === '') {
    return [];
  }
  return applySearchFilter(items, searchTerm).sort((a: Item, b: Item) => (a.Name ?? '').localeCompare(b.Name ?? ''));
}

/**
 * Get the fillable items matching the sender's page (for autofill), as summaries.
 *
 * @param message - Filtering parameters: pageTitle, matchingMode, includeRecentlySelected
 * @param sender - The sending frame; its URL is what items are matched against.
 */
export async function handleGetFilteredItems(
  message: { pageTitle: string, matchingMode?: string, includeRecentlySelected?: boolean },
  sender: AutofillSender
) : Promise<messageItemsResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    // E-202: Vault is locked
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    if (!sender.pageUrl) {
      return { success: true, items: [] };
    }

    const sqliteClient = await createVaultSqliteClient();
    const allItems = sqliteClient.items.getAll().filter(hasFillableLoginField);
    const filteredItems = await filterItemsByUrl(allItems, sender.pageUrl, message.pageTitle, message.matchingMode);

    // Prioritize recently selected item for multi-step login flows (opt-in only)
    if (message.includeRecentlySelected) {
      const rootDomain = await extractRootDomainFromUrl(sender.pageUrl);
      const prioritized = await prioritizeRecentlySelectedItem(filteredItems, rootDomain, allItems);
      return { success: true, items: prioritized.items.map(toAutofillSummary), recentlySelected: prioritized.recentlySelected };
    }

    return { success: true, items: filteredItems.map(toAutofillSummary) };
  } catch (error) {
    logFailure('Error getting filtered items', error);
    // E-304: Item read failed
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Search the fillable items of the entire vault (name, fields), as summaries.
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
    const allItems = sqliteClient.items.getAll().filter(hasFillableLoginField);
    const searchResults = filterItemsBySearchTerm(allItems, message.searchTerm);

    return { success: true, items: searchResults.map(toAutofillSummary) };
  } catch (error) {
    logFailure('Error searching items', error);
    // E-304: Item read failed during search
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
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
    logFailure('Error getting password settings', error);
    // E-601: Storage read failed
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.STORAGE_READ_FAILED) };
  }
}

/**
 * Get the encryption key for the encrypted vault: derived from the Account Key and the cached key chain,
 * null while the vault is locked.
 */
export async function handleGetEncryptionKey(
) : Promise<string | null> {
  return VaultKeyService.getSessionVaultEncryptionKey();
}

/**
 * Get the encryption key derivation parameters for password change detection and offline mode.
 * These are stored in local: storage to enable offline unlock after browser restart.
 */
export async function handleGetUnlockKeyDerivationParams(
) : Promise<UnlockKeyDerivationParams | null> {
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
    logFailure('Failed to decrypt or parse persisted form values', error);
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
 */
async function persistLocalVaultMutation(sqliteClient: SqliteClient, encryptionKey: string) : Promise<void> {
  const encryptedVault = await encryptVaultBlob(sqliteClient.exportToBytes(), encryptionKey);
  const scopes = sqliteClient.takeMutationScopes();
  try {
    await handleStoreEncryptedVault({ vaultBlob: encryptedVault, markDirty: true, scopes });
  } catch (error) {
    // The write is still in the local database, so put the scopes back for whichever persist carries it next.
    scopes.forEach(scope => sqliteClient.recordMutationScope(scope));
    throw error;
  }
  cachedSqliteClient = sqliteClient;
  cachedVaultBlob = encryptedVault;

  void handleFullVaultSync().catch(error => {
    logFailure('Background sync after local vault mutation failed', error);
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
 * Encrypted vault blobs an extension page is sending in chunks, by transfer id (see VaultBlobTransfer).
 */
const pendingVaultBlobTransfers = new Map<string, { chunks: string[]; startedAt: number }>();

/**
 * How long an unfinished transfer is kept, so the chunks of a popup that closed during a save do not stay in memory.
 */
const VAULT_BLOB_TRANSFER_EXPIRY_MS = 60_000;

/**
 * Receive one chunk of an encrypted vault blob an extension page is sending. The last chunk carries the store options:
 * the joined blob is then stored via {@link handleStoreEncryptedVault}, whose result is returned. Earlier chunks return null.
 */
export async function handleStoreEncryptedVaultChunk(request: {
  transferId: string;
  index: number;
  chunk: string;
  commit?: VaultBlobStoreOptions;
}): Promise<{ success: boolean; mutationSequence: number } | null> {
  const now = Date.now();
  for (const [transferId, pending] of pendingVaultBlobTransfers) {
    if (now - pending.startedAt > VAULT_BLOB_TRANSFER_EXPIRY_MS) {
      pendingVaultBlobTransfers.delete(transferId);
    }
  }

  const transfer = pendingVaultBlobTransfers.get(request.transferId) ?? { chunks: [], startedAt: now };
  if (transfer.chunks.length !== request.index) {
    // E-602: earlier chunks are gone, e.g. the service worker restarted or the transfer expired
    pendingVaultBlobTransfers.delete(request.transferId);
    throw new Error(formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.STORAGE_WRITE_FAILED));
  }
  transfer.chunks.push(request.chunk);
  if (!request.commit) {
    pendingVaultBlobTransfers.set(request.transferId, transfer);
    return null;
  }

  pendingVaultBlobTransfers.delete(request.transferId);
  return handleStoreEncryptedVault({ ...request.commit, vaultBlob: transfer.chunks.join('') });
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
  scopes?: VaultMutationScope[];
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

  /*
   * Track what changed so the next sync can choose a cheap bucket-only push (e.g. a settings toggle) over a
   * full manifest push. A store that names no scope changed something the repositories do not account for
   * (a raw statement, a migration, a merged vault), which only a full manifest push covers.
   */
  const dirtyScopes = request.scopes?.length ? request.scopes : [DEFAULT_VAULT_MUTATION_SCOPE];

  // Build items to store.
  if (request.markDirty) {
    await storage.setItems([
      { key: StorageKeys.ENCRYPTED_VAULT, value: request.vaultBlob },
      { key: StorageKeys.MUTATION_SEQUENCE, value: mutationSequence },
      { key: StorageKeys.IS_DIRTY, value: true },
      ...dirtyScopes.map(scope => ({ key: dirtyScopeStorageKey(scope), value: true }))
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
export function handleGetVaultMigrationStatus(): Promise<VaultMigrationKind> {
  return vaultSync.getVaultMigrationStatus();
}

/**
 * Upgrade local manifest-v1 storage model to the current schema (if needed) and push it.
 */
export function handleMigrateVaultManifest(): Promise<VaultManifestMigrationResult> {
  return vaultSync.migrateVaultManifest();
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
    await storage.setItem(StorageKeys.LAST_SYNC_ERROR, { logoutReason: result.logoutReason, errorCode: result.errorCode, error: result.error });
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
    return await vaultSync.syncVaultWithServer(options);
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
        logFailure('[VaultSync] Follow-up sync failed', err);
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
  message: { domain: string; username: string },
  sender: AutofillSender
): Promise<DuplicateCheckResponse> {
  if (!sender.pageUrl || !await isRelatedDomain(message.domain.toLowerCase(), new URL(sender.pageUrl).hostname.toLowerCase())) {
    return { success: false, isDuplicate: false };
  }

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
    const currentRootDomain = await extractRootDomain(normalizedDomain);

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

        // Same host, or the same root domain per the Public Suffix List
        if (itemDomain === normalizedDomain || await extractRootDomain(itemDomain) === currentRootDomain) {
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
        return { success: true, isDuplicate: true };
      }
    }

    return { success: true, isDuplicate: false };
  } catch (error) {
    logFailure('Error checking for duplicate login', error);
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
  },
  sender: AutofillSender
): Promise<SaveLoginResponse> {
  if (!await isUrlOnSenderPage(message.url, sender)) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_CREATE_FAILED) };
  }

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

    // The logo comes from the server's favicon extraction.
    const newItem = await FaviconService.fetchAndAttachFavicon({
      Id: '', // Will be generated
      ManifestId: manifestForItemIn(null, sqliteClient.getPersonalManifestId()),
      Name: message.serviceName || message.domain,
      ItemType: ItemTypes.Login,
      Fields: fields,
      CreatedAt: currentDateTime,
      UpdatedAt: currentDateTime
    }, message.url, sqliteClient.logos, new WebApiService());

    // Add the item to the vault
    const created = await sqliteClient.items.create(newItem, [], []);

    // Persist locally and sync in the background (doesn't block when server is offline).
    await persistLocalVaultMutation(sqliteClient, encryptionKey);

    return { success: true, itemId: created.Id, manifestId: created.ManifestId };
  } catch (error) {
    logFailure('Failed to save login credential', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_CREATE_FAILED) };
  }
}

/**
 * Add a URL to an existing credential in the vault.
 * This is used when a user autofills from an existing credential on a new site
 * and wants to add that URL to the credential instead of creating a new one.
 * Only the item last autofilled in the sender's tab can be changed, and only with a URL on the sender's page.
 *
 * @param message - The item ID and URL to add.
 * @param sender - The sending frame.
 * @returns Success status.
 */
export async function handleAddUrlToCredential(message: { itemId: string; manifestId: string; url: string }, sender: AutofillSender): Promise<{ success: boolean; error?: string }> {
  if (!await isLastAutofilledOnSenderPage({ Id: message.itemId, ManifestId: message.manifestId }, message.url, sender)) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_UPDATE_FAILED) };
  }

  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const url = ServiceDetectionUtility.sanitizeUrl(message.url) || message.url;

    // Get the existing item
    const item = sqliteClient.items.getById({ Id: message.itemId, ManifestId: message.manifestId });
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
    await sqliteClient.items.update({ Id: item.Id, ManifestId: item.ManifestId }, item, [], [], [], []);

    // Persist locally and sync in the background (doesn't block when server is offline).
    await persistLocalVaultMutation(sqliteClient, encryptionKey);

    return { success: true };
  } catch (error) {
    logFailure('Failed to add URL to credential', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_UPDATE_FAILED) };
  }
}

/**
 * Check whether a URL is already linked (host-equivalent) to a credential.
 */
export async function handleIsUrlLinkedToCredential(message: { itemId: string; manifestId: string; url: string }, sender: AutofillSender): Promise<{ linked: boolean }> {
  try {
    if (!await isLastAutofilledOnSenderPage({ Id: message.itemId, ManifestId: message.manifestId }, message.url, sender)) {
      return { linked: false };
    }
    const encryptionKey = await handleGetEncryptionKey();
    if (!encryptionKey) {
      return { linked: false };
    }
    const sqliteClient = await createVaultSqliteClient();
    const item = sqliteClient.items.getById({ Id: message.itemId, ManifestId: message.manifestId });
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
    logFailure('Error getting login save settings', error);
    return { success: false, enabled: false, autoDismissSeconds: 15, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.STORAGE_READ_FAILED) };
  }
}

/**
 * Get items that have TOTP codes and match the sender's page, as summaries.
 * Used for TOTP autofill popup to show only items with 2FA codes.
 *
 * @param message - Filtering parameters: pageTitle, matchingMode
 * @param sender - The sending frame; its URL is what items are matched against.
 */
export async function handleGetItemsWithTotp(
  message: { pageTitle: string, matchingMode?: string },
  sender: AutofillSender
): Promise<messageItemsResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    if (!sender.pageUrl) {
      return { success: true, items: [] };
    }

    const sqliteClient = await createVaultSqliteClient();
    const allItems = sqliteClient.items.getAll();

    // Filter to only items with TOTP codes
    const itemsWithTotp = allItems.filter((item: Item) => item.HasTotp === true);

    // Then filter by URL matching using shared logic
    const filteredItems = await filterItemsByUrl(itemsWithTotp, sender.pageUrl, message.pageTitle, message.matchingMode);

    // Prioritize recently selected item for multi-step login flows
    const rootDomain = await extractRootDomainFromUrl(sender.pageUrl);
    const prioritized = await prioritizeRecentlySelectedItem(filteredItems, rootDomain, itemsWithTotp);

    return { success: true, items: prioritized.items.map(toAutofillSummary), recentlySelected: prioritized.recentlySelected };
  } catch (error) {
    logFailure('Error getting items with TOTP', error);
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

    return { success: true, items: searchResults.map(toAutofillSummary) };
  } catch (error) {
    logFailure('Error searching items with TOTP', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Generate the current TOTP code for each item, for the in-page live preview. The secrets stay in the background.
 *
 * @param message - The items to generate codes for; the result is keyed by `scopedKey(ManifestId, Id)`
 */
export async function handleGetTotpCodes(
  message: { items: ItemRef[] }
): Promise<{ success: boolean; codes?: Record<string, TotpCodePreview>; error?: string }> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const codes: Record<string, TotpCodePreview> = {};

    for (const item of message.items) {
      const totpCode = sqliteClient.items.getTotpCodesForItem(item)[0];
      const code = totpCode ? await generateTotpCode(totpCode.SecretKey, totpCode) : null;
      if (code) {
        codes[scopedKey(item.ManifestId, item.Id)] = { Code: code, Period: normalizeTotpPeriod(totpCode.Period) };
      }
    }

    return { success: true, codes };
  } catch (error) {
    logFailure('Error generating TOTP codes', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Generate a TOTP code for a specific item.
 * Used by content script to fill TOTP fields; with `autofill` the pick is recorded for the sender's page.
 *
 * @param message - The item ID to generate TOTP code for
 * @param sender - The sending frame.
 */
export async function handleGenerateTotpCode(
  message: { itemId: string; manifestId: string; autofill?: boolean },
  sender: AutofillSender
): Promise<{ success: boolean; code?: string; error?: string }> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const totpCodes = sqliteClient.items.getTotpCodesForItem({ Id: message.itemId, ManifestId: message.manifestId });

    if (totpCodes.length === 0) {
      return { success: false, error: 'No TOTP codes found for this item' };
    }

    const code = await generateTotpCode(totpCodes[0].SecretKey, totpCodes[0]);
    if (!code) {
      return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
    }

    if (message.autofill) {
      await recordAutofill({ Id: message.itemId, ManifestId: message.manifestId }, sender);
    }

    return { success: true, code };
  } catch (error) {
    logFailure('Error generating TOTP code', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Record one use of an item: when it was last used, and how often.
 * @param message - The item that was used and what was done with it.
 */
export async function handleRecordItemUsage(
  message: { itemId: string; manifestId: string; action: ItemUsageAction }
): Promise<{ success: boolean }> {
  try {
    const encryptionKey = await handleGetEncryptionKey();
    if (!encryptionKey) {
      return { success: false };
    }

    const sqliteClient = await createVaultSqliteClient();
    if (!sqliteClient.itemStats.recordUsage({ Id: message.itemId, ManifestId: message.manifestId }, message.action, await getOrCreateDeviceId())) {
      // No such item (deleted between use and record); nothing to attribute the use to.
      return { success: false };
    }

    await persistLocalVaultMutation(sqliteClient, encryptionKey);
    return { success: true };
  } catch (error) {
    logFailure('Failed to record item usage', error);
    return { success: false };
  }
}

/**
 * Hand out the fill data of the one item the user picked in the in-page popup, and remember the pick for the sender's tab.
 *
 * @param message - The item to fill.
 * @param sender - The sending frame.
 */
export async function handleGetAutofillCredential(
  message: { itemId: string; manifestId: string },
  sender: AutofillSender
): Promise<{ success: boolean; credential?: Credential; error?: string }> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const item = sqliteClient.items.getById({ Id: message.itemId, ManifestId: message.manifestId });
    if (!item || !sender.pageUrl) {
      return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
    }

    const { Id, ServiceName, Username, Password, Alias } = itemToCredential(item);

    if (sender.tabId !== undefined) {
      handleStoreLastAutofilled({
        tabId: sender.tabId,
        credential: {
          itemId: item.Id,
          manifestId: item.ManifestId,
          itemName: ServiceName,
          username: Username || Alias.Email || '',
          domain: new URL(sender.pageUrl).hostname,
          timestamp: Date.now(),
          faviconUrl: SqliteClient.imgSrcFromBytes(item.Logo) ?? undefined,
        },
      });
    }
    await recordAutofill(item, sender);

    return { success: true, credential: { Id, ServiceName, Username, Password, Alias } };
  } catch (error) {
    logFailure('Error getting autofill credential', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * What a sharing action reports back to the page that asked for it.
 */
type SharingActionResponse = { success: boolean; error?: string; apiErrorCode?: string };

/**
 * Put the outcome of a sharing engine operation into the words the family sharing page shows.
 * @param result - what the sync engine reported.
 * @param failureMessage - the message for a failure without a more specific reason.
 */
async function sharingActionResponse(result: SharingOperationResult, failureMessage: string): Promise<SharingActionResponse> {
  if (result.success) {
    return { success: true };
  }

  if (result.apiErrorCode) {
    return { success: false, apiErrorCode: result.apiErrorCode };
  }

  if (result.vaultUpgradeRequired) {
    return { success: false, error: familySharingText.errors.vaultUpgradeRequired };
  }

  if (result.errorCode === AppErrorCode.VAULT_LOCKED) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  /*
   * Everything else this can fail on (a vault that will not open, a key that will not import, a server that refuses
   * without a code) collapses into the same sentence otherwise, which leaves nothing to act on. The cause is
   * appended the way the upload path does it.
   */
  const detail = result.error && result.error.length > 0 ? ` [${result.error}]` : '';
  return { success: false, error: `${failureMessage}${detail}` };
}

/**
 * Create another shared manifest for a family, with this account as its first member. The sync engine does the work,
 * so every client creates one the same way.
 *
 * @param message - the family to create the vault for and the name to give it.
 */
export async function handleGroupCreateVault(message: { groupId: string; name: string }): Promise<SharingActionResponse> {
  const result = await vaultSync.createSharedManifest(message.groupId, message.name);
  if (result.success) {
    // The engine left the new folder and keypair in a dirty vault; this pushes them.
    void handleFullVaultSync().catch(error => logFailure('Background sync after creating a shared manifest failed', error));
  }

  return sharingActionResponse(result, familySharingText.errors.createVaultFailed);
}

/**
 * Change the details of one of a family's shared manifests. The server only accepts it from an administrator of the
 * family.
 *
 * @param message - the family, the manifest, and the details to change.
 */
export async function handleGroupUpdateVault(message: { groupId: string; manifestId: string; details: SharedManifestDetails }): Promise<SharingActionResponse> {
  return sharingActionResponse(await vaultSync.updateSharedManifest(message.groupId, message.manifestId, message.details), await t('common.errors.unknownErrorTryAgain'));
}

/**
 * Invite a member of a family to one of its shared manifests, handing them the manifest's key encrypted to their
 * account keypair. The sync engine does the work, so every client invites the same way.
 *
 * @param message - the family, the manifest, and the member being invited.
 */
export async function handleGroupInviteMember(message: { groupId: string; manifestId: string; userId: string }): Promise<SharingActionResponse> {
  return sharingActionResponse(await vaultSync.inviteToSharedManifest(message.groupId, message.manifestId, message.userId), familySharingText.errors.inviteFailed);
}

/**
 * Take a member's access to one shared manifest away, or hand back one's own.
 *
 * @param message - the family, the vault, and the member losing access.
 */
export async function handleGroupRevokeAccess(message: { groupId: string; manifestId: string; userId: string }): Promise<SharingActionResponse> {
  try {
    const webApi = new WebApiService();
    await SharingService.revokeAccess(webApi, message.groupId, message.manifestId, message.userId);

    devLog(`[Sharing] Revoked ${message.userId}'s access to vault ${message.manifestId}; syncing to pick up whatever the server left for this client to finish.`);
    void handleFullVaultSync().catch(error => logFailure('Background sync after a vault access change failed', error));

    return { success: true };
  } catch (error) {
    if (error instanceof ApiRequestError && error.apiErrorCode) {
      return { success: false, apiErrorCode: error.apiErrorCode };
    }

    logFailure('Failed to revoke shared manifest access', error);
    return { success: false, error: familySharingText.errors.revokeAccessFailed };
  }
}
