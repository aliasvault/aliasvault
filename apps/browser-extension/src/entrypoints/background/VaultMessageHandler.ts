/* eslint-disable @typescript-eslint/no-explicit-any */
import * as OTPAuth from 'otpauth';
import { storage } from 'wxt/utils/storage';

import { TRASH_RETENTION_DAYS } from '@/utils/constants/vault';
import { devError, devLog, devWarn } from '@/utils/devLogger/DevLogger';
import type { EncryptionKeyDerivationParams } from '@/utils/dist/core/models/metadata';
import { FieldKey, ItemTypes, createSystemField, type Item, type PasswordSettings } from '@/utils/dist/core/models/vault';
import type { VaultResponse, VaultPostResponse } from '@/utils/dist/core/models/webapi';
import { EncryptionUtility } from '@/utils/EncryptionUtility';
import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import { RecentlySelectedItemService } from '@/utils/RecentlySelectedItemService';
import { filterItems, AutofillMatchingMode, extractRootDomain, isUrlAlreadyLinked, generatePassword, vaultCodecExtractBucket, vaultCodecBucketLayout } from '@/utils/RustCore';
import { ServiceDetectionUtility } from '@/utils/serviceDetection/ServiceDetectionUtility';
import { SqliteClient } from '@/utils/SqliteClient';
import { getItemWithFallback } from '@/utils/StorageUtility';
import { ApiAuthError } from '@/utils/types/errors/ApiAuthError';
import { ApiRequestError } from '@/utils/types/errors/ApiRequestError';
import { AppErrorCode, formatErrorWithCode } from '@/utils/types/errors/AppErrorCodes';
import { NetworkError } from '@/utils/types/errors/NetworkError';
import { PayloadTooLargeError } from '@/utils/types/errors/PayloadTooLargeError';
import { RequestTimeoutError } from '@/utils/types/errors/RequestTimeoutError';
import { ServerUpdateRequiredError } from '@/utils/types/errors/ServerUpdateRequiredError';
import { VaultVersionIncompatibleError } from '@/utils/types/errors/VaultVersionIncompatibleError';
import { BoolResponse as messageBoolResponse } from '@/utils/types/messaging/BoolResponse';
import type { DuplicateCheckResponse } from '@/utils/types/messaging/DuplicateCheckResponse';
import { IdentitySettingsResponse } from '@/utils/types/messaging/IdentitySettingsResponse';
import { ItemsResponse as messageItemsResponse } from '@/utils/types/messaging/ItemsResponse';
import { PasswordSettingsResponse as messagePasswordSettingsResponse } from '@/utils/types/messaging/PasswordSettingsResponse';
import type { SaveLoginResponse } from '@/utils/types/messaging/SaveLoginResponse';
import { StringResponse as stringResponse } from '@/utils/types/messaging/StringResponse';
import { VaultResponse as messageVaultResponse } from '@/utils/types/messaging/VaultResponse';
import { VaultUploadResponse as messageVaultUploadResponse } from '@/utils/types/messaging/VaultUploadResponse';
import { type VaultMutationScope, ALL_VAULT_MUTATION_SCOPES, DEFAULT_VAULT_MUTATION_SCOPE, dirtyScopeStorageKey, isManifestScope } from '@/utils/types/VaultMutationScope';
import { VaultCodec } from '@/utils/VaultCodec';
import { vaultMergeService } from '@/utils/VaultMergeService';
import { vaultRetrievalService } from '@/utils/VaultRetrievalService';
import { vaultV2SyncService } from '@/utils/VaultV2SyncService';
import { WebApiService } from '@/utils/WebApiService';

import { t } from '@/i18n/StandaloneI18n';

/**
 * Cache for the SqliteClient to avoid repeated decryption and initialization.
 * The cached instance is the single source of truth for the in-memory vault.
 *
 * Cache Strategy:
 * - Local mutations (createCredential, etc.): Work directly on cachedSqliteClient, no cache clearing
 * - New vault from remote (login, sync): Clear cache by setting both to null
 * - Logout/clear vault: Clear cache by setting both to null
 *
 * The cache is cleared by setting cachedSqliteClient and cachedVaultBlob to null directly
 * in the functions that receive new vault data from external sources.
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
 * Check if the user is logged in and if the vault is locked, and also check for pending migrations.
 */
export async function handleCheckAuthStatus() : Promise<{ isLoggedIn: boolean, isVaultLocked: boolean, hasPendingMigrations: boolean, error?: string }> {
  const username = await storage.getItem('local:username');
  const accessToken = await storage.getItem('local:accessToken');
  const vaultData = await storage.getItem('local:encryptedVault');
  const encryptionKey = await handleGetEncryptionKey();

  const isLoggedIn = username !== null && accessToken !== null;
  const isVaultLocked = isLoggedIn && (vaultData === null || encryptionKey === null);

  // If vault is locked, we can't check for pending migrations
  if (isVaultLocked) {
    return {
      isLoggedIn,
      isVaultLocked,
      hasPendingMigrations: false
    };
  }

  // If not logged in, no need to check migrations
  if (!isLoggedIn) {
    return {
      isLoggedIn,
      isVaultLocked,
      hasPendingMigrations: false
    };
  }

  // Vault is unlocked, check for pending migrations
  try {
    const sqliteClient = await createVaultSqliteClient();
    const hasPendingMigrations = await sqliteClient.hasPendingMigrations();
    return {
      isLoggedIn,
      isVaultLocked,
      hasPendingMigrations
    };
  } catch (error) {
    // If it's a version incompatibility error, we need to handle it specially
    if (error instanceof VaultVersionIncompatibleError) {
      // Return the error so the UI can handle it appropriately (logout user)
      return {
        isLoggedIn,
        isVaultLocked,
        hasPendingMigrations: false,
        error: error.message
      };
    }

    return {
      isLoggedIn,
      isVaultLocked,
      hasPendingMigrations: false,
      error: error instanceof Error ? error.message : await t('common.errors.unknownError')
    };
  }
}

/**
 * Store vault metadata (email domains) in browser storage.
 * This is used during login/sync when receiving vault data from the server.
 */
export async function handleStoreVaultMetadata(
  message: {
    publicEmailDomainList?: string[];
    privateEmailDomainList?: string[];
    hiddenPrivateEmailDomainList?: string[];
  },
) : Promise<messageBoolResponse> {
  try {
    if (message.publicEmailDomainList) {
      await storage.setItem('local:publicEmailDomains', message.publicEmailDomainList);
    }

    if (message.privateEmailDomainList) {
      await storage.setItem('local:privateEmailDomains', message.privateEmailDomainList);
    }

    if (message.hiddenPrivateEmailDomainList) {
      await storage.setItem('local:hiddenPrivateEmailDomains', message.hiddenPrivateEmailDomainList);
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to store vault metadata:', error);
    // E-602: Storage write failed during metadata store
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.STORAGE_WRITE_FAILED) };
  }
}

/**
 * Store the encryption key (derived key) in browser storage.
 */
export async function handleStoreEncryptionKey(
  encryptionKey: string,
) : Promise<messageBoolResponse> {
  try {
    await storage.setItem('session:encryptionKey', encryptionKey);
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
    await storage.setItem('local:encryptionKeyDerivationParams', params);
    return { success: true };
  } catch (error) {
    console.error('Failed to store encryption key derivation params:', error);
    // E-602: Storage write failed during derivation params store
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownErrorTryAgain'), AppErrorCode.STORAGE_WRITE_FAILED) };
  }
}

/**
 * Fetch the latest vault from the server as a VaultResponse, via the v2-only {@link VaultRetrievalService}.
 *
 * GET /v2/Vault returns either the manifest model (materialized locally into a SQLite blob) or, for a
 * not-yet-migrated user, the legacy SQLite blob as-is, so a migrated user never hits the legacy API's 426
 * guard from the sync paths. There is no legacy-API fallback: a server without the v2 API surfaces E-903
 * (update your server).
 */
async function fetchLatestVaultFromServer(): Promise<VaultResponse> {
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptionKey) {
    throw new Error(formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED));
  }

  try {
    return await vaultRetrievalService.retrieveVault(encryptionKey);
  } catch (error) {
    if (error instanceof ServerUpdateRequiredError) {
      throw new Error(formatErrorWithCode(await t('common.errors.serverVersionNotSupported'), AppErrorCode.SERVER_UPDATE_REQUIRED));
    }
    throw error;
  }
}

/**
 * Upload the current SQLite via the v2 storage format.
 * @param sqliteClient - the in-memory SQLite client to upload
 */
async function uploadVaultV2(sqliteClient: SqliteClient): Promise<VaultPostResponse> {
  // Surfaces ServerUpdateRequiredError for servers that do not support the v2 API before we attempt the push.
  await vaultV2SyncService.checkStatus();

  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptionKey) {
    throw new Error(formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED));
  }

  const username = (await storage.getItem('local:username')) as string;
  const emailAddresses = await getEmailAddressesForVault(sqliteClient);

  const result = await vaultV2SyncService.pushVault(sqliteClient, encryptionKey, username, emailAddresses);

  if (result.status === 'ok') {
    return { status: 0, newRevisionNumber: result.newManifestRevision ?? 0 };
  }

  if (result.status === 'outdated') {
    return { status: 2, newRevisionNumber: result.newManifestRevision ?? 0 };
  }

  if (result.status === 'rejected') {
    // Structural validation tripped — surface the reasons rather than silently uploading garbage.
    const reason = (result.reasons ?? ['Integrity check failed']).join('; ');
    devError('[V2Sync] Refusing to upload corrupt vault:', reason);
    throw new Error(formatErrorWithCode(`Vault integrity check failed: ${reason}`, AppErrorCode.UPLOAD_FAILED));
  }

  /*
   * missing-blobs: pushVault already re-uploaded the blob bytes the server asked for and retried once; landing
   * here means the server still reports gaps, a genuine server-side problem, not a transient race.
   */
  throw new Error(formatErrorWithCode('Server reported missing blobs; please retry', AppErrorCode.UPLOAD_FAILED));
}

/**
 * Sync the vault with the server to check if a newer vault is available. If so, the vault will be updated.
 */
export async function handleSyncVault(
) : Promise<messageBoolResponse> {
  const webApi = new WebApiService();
  const statusResponse = await webApi.getStatus();
  const statusError = webApi.validateStatusResponse(statusResponse);
  if (statusError !== null) {
    return { success: false, error: await t('common.errors.' + statusError) };
  }

  const localServerRevision = await storage.getItem('local:serverRevision') as number | null ?? 0;

  if (statusResponse.vaultRevision > localServerRevision) {
    /*
     * Retrieve the latest vault from the server.
     */
    const vaultResponse = await fetchLatestVaultFromServer();

    // Store in local: storage for persistence (fresh from server, not dirty)
    await storage.setItems([
      { key: 'local:encryptedVault', value: vaultResponse.vault.blob },
      { key: 'local:publicEmailDomains', value: vaultResponse.vault.publicEmailDomainList },
      { key: 'local:privateEmailDomains', value: vaultResponse.vault.privateEmailDomainList },
      { key: 'local:hiddenPrivateEmailDomains', value: vaultResponse.vault.hiddenPrivateEmailDomainList },
      { key: 'local:serverRevision', value: vaultResponse.vault.currentRevisionNumber },
      { key: 'local:isDirty', value: false }
    ]);

    // Clear cached client since we received a new vault blob from server
    cachedSqliteClient = null;
    cachedVaultBlob = null;
  }

  return { success: true };
}

/**
 * Get the vault from browser storage (local: for persistence).
 */
export async function handleGetVault(
) : Promise<messageVaultResponse> {
  try {
    const encryptionKey = await handleGetEncryptionKey();

    const encryptedVault = await storage.getItem('local:encryptedVault') as string;
    // TODO: the fallback mechanism can be removed some period of time after 0.27.0 is released.
    const publicEmailDomains = await getItemWithFallback<string[]>('local:publicEmailDomains');
    const privateEmailDomains = await getItemWithFallback<string[]>('local:privateEmailDomains');
    const hiddenPrivateEmailDomains = await getItemWithFallback<string[]>('local:hiddenPrivateEmailDomains') ?? [];
    const serverRevision = await storage.getItem('local:serverRevision') as number | null;

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

    const decryptedVault = await EncryptionUtility.symmetricDecrypt(
      encryptedVault,
      encryptionKey
    );

    return {
      success: true,
      vault: decryptedVault,
      publicEmailDomains: publicEmailDomains ?? [],
      privateEmailDomains: privateEmailDomains ?? [],
      hiddenPrivateEmailDomains: hiddenPrivateEmailDomains ?? [],
      serverRevision: serverRevision ?? 0
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
  await storage.removeItems([
    'session:encryptionKey',
    'session:persistedFormValues',
  ]);

  return { success: true };
}

/**
 * Clear session data (tokens and ephemeral data).
 * This is safe to call during forced logout as it preserves vault data.
 */
export async function handleClearSession(): Promise<messageBoolResponse> {
  // Clear auth tokens and last sync error
  await storage.removeItems([
    'local:accessToken',
    'local:refreshToken',
    'local:lastSyncError',
  ]);

  // Clear session-only data (security: encryption key must not persist)
  await storage.removeItems([
    'session:encryptionKey',
    'session:persistedFormValues',
    'session:lastVisitedPage',
    'session:lastVisitedTime',
    'session:navigationHistory',
  ]);

  // Reset password unlock failed attempts counter on logout
  await LocalPreferencesService.resetPasswordUnlockFailedAttempts();

  // Clear cached client since session ended
  cachedSqliteClient = null;
  cachedVaultBlob = null;

  return { success: true };
}

/**
 * Clear vault data and username.
 * This removes all persistent vault storage and local preferences.
 */
export async function handleClearVaultData(): Promise<messageBoolResponse> {
  // Clear vault data
  await storage.removeItems([
    'local:encryptedVault',
    'local:publicEmailDomains',
    'local:privateEmailDomains',
    'local:hiddenPrivateEmailDomains',
    'local:serverRevision',
    'local:isDirty',
    ...ALL_VAULT_MUTATION_SCOPES.map(scope => dirtyScopeStorageKey(scope)),
    'local:mutationSequence',
    'local:isOfflineMode',
    'local:encryptionKeyDerivationParams',
    'local:username',
  ]);

  // Clear all local preferences (site settings, login save settings, etc.)
  await LocalPreferencesService.clearAll();

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
 * Get the email addresses for a vault.
 */
export async function getEmailAddressesForVault(
  sqliteClient: SqliteClient
): Promise<string[]> {
  const emailAddresses = sqliteClient.items.getAllEmailAddresses();

  // Get metadata from local: storage
  const privateEmailDomains = await getItemWithFallback<string[]>('local:privateEmailDomains') ?? [];

  return emailAddresses.filter(email => {
    const domain = email?.split('@')[1];
    return domain && privateEmailDomains.includes(domain);
  });
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
        const privateEmailDomains = await getItemWithFallback<string[]>('local:privateEmailDomains') ?? [];
        const publicEmailDomains = await getItemWithFallback<string[]>('local:publicEmailDomains') ?? [];
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
    const language = sqliteClient.settings.getEffectiveIdentityLanguage();
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
  // Try the current key name first (since 0.22.0)
  let encryptionKey = await storage.getItem('session:encryptionKey') as string | null;

  // Fall back to the legacy key name if not found
  if (!encryptionKey) {
    // TODO: this check can be removed some period of time after 0.22.0 is released.
    encryptionKey = await storage.getItem('session:derivedKey') as string | null;
  }

  return encryptionKey;
}

/**
 * Get the encryption key derivation parameters for password change detection and offline mode.
 * These are stored in local: storage to enable offline unlock after browser restart.
 */
export async function handleGetEncryptionKeyDerivationParams(
) : Promise<EncryptionKeyDerivationParams | null> {
  // Get metadata from storage
  return await getItemWithFallback<EncryptionKeyDerivationParams>('local:encryptionKeyDerivationParams');
}

/**
 * Read the set of currently-dirty mutation scopes from their independent per-scope flags. Each scope is a
 * separate idempotent boolean key (see {@link dirtyScopeStorageKey}), so concurrent mutations can never
 * clobber each other's scope the way pushing onto one shared array could. Returns the dirty scopes in the
 * stable {@link ALL_VAULT_MUTATION_SCOPES} order.
 */
async function getDirtyScopes(): Promise<VaultMutationScope[]> {
  const flags = await Promise.all(
    ALL_VAULT_MUTATION_SCOPES.map(async scope => ((await storage.getItem(dirtyScopeStorageKey(scope))) === true ? scope : null))
  );
  return flags.filter((s): s is VaultMutationScope => s !== null);
}

/**
 * Clear every per-scope dirty flag. Called once a sync has confirmed all pending changes are on the server
 * (guarded by the mutation-sequence check in {@link handleMarkVaultClean}).
 */
async function clearDirtyScopes(): Promise<void> {
  await storage.removeItems(ALL_VAULT_MUTATION_SCOPES.map(scope => dirtyScopeStorageKey(scope)));
}

/**
 * Push only the data buckets named by the dirty scopes, no manifest upload. Used when every pending local
 * mutation since the last sync is bucket-scoped (e.g. a settings toggle): the server's vault content manifest
 * is still current, so re-uploading it would be pure waste.
 *
 * Unknown categories fall back to a full vault upload, which always covers everything.
 * @param sqliteClient - the in-memory SQLite client to read bucket data from
 * @param scopes - the pending dirty scopes (bucket category names, deduplicated here)
 */
async function uploadDirtyBucketsOnly(sqliteClient: SqliteClient, scopes: VaultMutationScope[]): Promise<VaultPostResponse> {
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptionKey) {
    throw new Error(formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED));
  }

  /*
   * Which tables make up each bucket category is owned by the Rust layer.
   */
  const layout = await vaultCodecBucketLayout();

  for (const category of new Set(scopes)) {
    const spec = layout.find(entry => entry.category === category);
    if (!spec) {
      devWarn(`[V2Push] Unknown bucket scope "${category}", falling back to full vault upload.`);
      return (await uploadNewVaultToServer(sqliteClient)).response;
    }

    const tables = VaultCodec.readNamedTables(sqliteClient, spec.tables);
    const bucket = await vaultCodecExtractBucket(category, tables);
    const result = await vaultV2SyncService.pushDataBucketOnly(bucket, encryptionKey);
    if (result.status !== 'ok') {
      // Conflict persisted even after the rebase-retry, let the caller run a full re-sync (status 2).
      return { status: 2, newRevisionNumber: (await storage.getItem('local:serverRevision')) as number | null ?? 0 };
    }
    devLog(`[V2Push] Bucket-only push for "${category}" done (bucket revision ${result.revision}); manifest untouched.`);
  }

  // Manifest unchanged, so the content revision stays where it was.
  return { status: 0, newRevisionNumber: (await storage.getItem('local:serverRevision')) as number | null ?? 0 };
}

/**
 * Upload the currently stored vault to the server.
 * Returns the upload status and captures the mutation sequence at start for race detection.
 *
 * Bucket-aware: when every pending mutation is scoped to a data bucket (e.g. Settings), only those buckets
 * are pushed. A dirty 'manifest' scope (or a dirty state with no recorded scopes) triggers the full upload, 
 * which bundles all buckets as a safeguard too.
 */
export async function handleUploadVault(
) : Promise<messageVaultUploadResponse> {
  try {
    // Capture mutation sequence at start of upload for race detection
    const mutationSeqAtStart = await storage.getItem('local:mutationSequence') as number | null ?? 0;

    // Create sqlite client from the already-stored vault blob.
    const sqliteClient = await createVaultSqliteClient();

    // Upload to the server: bucket-only when possible, full vault otherwise.
    const dirtyScopes = await getDirtyScopes();
    const bucketOnly = dirtyScopes.length > 0 && !dirtyScopes.some(isManifestScope);
    if (bucketOnly) {
      devLog(`[V2Push] All pending mutations are bucket-scoped (${dirtyScopes.join(', ')}), skipping manifest upload.`);
    }
    let response: VaultPostResponse;
    let vaultPruned = false;
    if (bucketOnly) {
      // Bucket-only pushes never prune (settings buckets carry no trash items).
      response = await uploadDirtyBucketsOnly(sqliteClient, dirtyScopes);
    } else {
      ({ response, vaultPruned } = await uploadNewVaultToServer(sqliteClient));
    }

    return {
      success: true,
      status: response.status,
      newRevisionNumber: response.newRevisionNumber,
      mutationSeqAtStart,
      vaultPruned
    };
  } catch (error) {
    console.error('Failed to upload vault:', error);

    /*
     * E-805: Vault transfer timed out.
     */
    if (error instanceof RequestTimeoutError) {
      return { success: false, error: formatErrorWithCode(await t('common.errors.vaultSyncTimeout'), AppErrorCode.UPLOAD_TIMEOUT) };
    }

    /*
     * Let network and auth errors propagate.
     */
    if (error instanceof NetworkError || error instanceof ApiAuthError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : '';

    // Check if error is UPLOAD_OUTDATED (E-802) - server has newer vault
    if (errorMessage.includes('E-802')) {
      // Return status 2 (Outdated) so caller can handle merge
      return { success: false, status: 2, error: errorMessage };
    }

    /*
     * Pass through any error already tagged with an E-XXX code (e.g. E-804 for HTTP 413).
     * Stripping the targeted code and replacing it with E-801 would lose the actionable message.
     */
    if (/E-\d{3}/.test(errorMessage)) {
      return { success: false, error: errorMessage };
    }

    /*
     * E-801: Upload failed. Include the HTTP status and server error code (if any).
     */
    const detail = error instanceof ApiRequestError ? ` [${error.message}]` : '';
    return { success: false, error: formatErrorWithCode(`${await t('common.errors.unknownError')}${detail}`, AppErrorCode.UPLOAD_FAILED) };
  }
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
  await storage.setItem('session:persistedFormValues', encryptedData);
}

/**
 * Handle retrieving persisted form values from storage.
 * Data is decrypted using the derived key.
 */
export async function handleGetPersistedFormValues(): Promise<any | null> {
  const encryptionKey = await handleGetEncryptionKey();
  const encryptedData = await storage.getItem('session:persistedFormValues') as string | null;

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
  await storage.removeItem('session:persistedFormValues');
}

/**
 * Upload a new version of the vault to the server using the provided sqlite client.
 * Prunes expired trash items before uploading.
 */
async function uploadNewVaultToServer(sqliteClient: SqliteClient) : Promise<{ response: VaultPostResponse; vaultPruned: boolean }> {
  devLog('[VaultSync] Upload started');
  let updatedVaultData = sqliteClient.exportToBase64();
  let vaultPruned = false;
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    // E-202: Vault is locked
    throw new Error(formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED));
  }

  /**
   * Prune expired items from trash before uploading.
   * Items that have been in trash (DeletedAt set) longer than TRASH_RETENTION_DAYS
   * are permanently deleted (IsDeleted = true) as part of the sync process.
   */
  try {
    const pruneResult = await vaultMergeService.prune(updatedVaultData, TRASH_RETENTION_DAYS);
    if (pruneResult.success && pruneResult.statementCount > 0) {
      devLog(`[VaultSync] Pruned expired items from trash (${pruneResult.statementCount} statements)`);
      updatedVaultData = pruneResult.prunedVaultBase64;
      vaultPruned = true;

      /**
       * Reload the sqlite client with the pruned vault so the UI reflects the change.
       * Clear the cache to force re-initialization.
       */
      cachedSqliteClient = null;
      cachedVaultBlob = null;
      await sqliteClient.initializeFromBase64(updatedVaultData);
    }
  } catch (pruneError) {
    console.warn('[VaultSync] Failed to prune vault, continuing with upload:', pruneError);
  }

  let v2Response: VaultPostResponse;
  try {
    v2Response = await uploadVaultV2(sqliteClient);
  } catch (err) {
    if (err instanceof ServerUpdateRequiredError) {
      throw new Error(formatErrorWithCode(await t('common.errors.serverVersionNotSupported'), AppErrorCode.SERVER_UPDATE_REQUIRED));
    }
    if (err instanceof PayloadTooLargeError) {
      throw new Error(formatErrorWithCode(await t('common.errors.vaultTooLarge'), AppErrorCode.UPLOAD_TOO_LARGE));
    }
    throw err;
  }

  // Re-encrypt and persist locally so handleGetVault / readers continue to work without a re-sync.
  const reEncrypted = await EncryptionUtility.symmetricEncrypt(updatedVaultData, encryptionKey);
  await storage.setItem('local:encryptedVault', reEncrypted);
  if (v2Response.status === 0) {
    await storage.setItem('local:serverRevision', v2Response.newRevisionNumber);
  }

  return { response: v2Response, vaultPruned };
}

/**
 * Persist a locally-mutated vault and attempt to sync it to the server in the background.
 *
 * This is tolerant to server being offline (in which case the vault state will be stored locally for next sync).
 */
async function persistLocalVaultMutation(sqliteClient: SqliteClient, encryptionKey: string) : Promise<void> {
  const updatedVaultData = sqliteClient.exportToBase64();
  const encryptedVault = await EncryptionUtility.symmetricEncrypt(updatedVaultData, encryptionKey);
  await handleStoreEncryptedVault({ vaultBlob: encryptedVault, markDirty: true });

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
  const encryptedVault = await storage.getItem('local:encryptedVault') as string;
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
  const decryptedVault = await EncryptionUtility.symmetricDecrypt(
    encryptedVault,
    encryptionKey
  );

  // Initialize the SQLite client with the decrypted vault
  const sqliteClient = new SqliteClient();
  await sqliteClient.initializeFromBase64(decryptedVault);

  // Cache the client and vault blob
  cachedSqliteClient = sqliteClient;
  cachedVaultBlob = encryptedVault;

  return sqliteClient;
}

/**
 * Get the encrypted vault blob directly (for merge operations).
 */
export async function handleGetEncryptedVault(): Promise<string | null> {
  return await storage.getItem('local:encryptedVault') as string | null;
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
 *   - serverRevision: Optional explicit server revision (for sync operations)
 *   - expectedMutationSeq: If provided, only store if current sequence matches (for sync operations)
 * @returns { success, mutationSequence } - success=false if expectedMutationSeq didn't match
 */
export async function handleStoreEncryptedVault(request: {
  vaultBlob: string;
  markDirty?: boolean;
  serverRevision?: number;
  expectedMutationSeq?: number;
  scope?: VaultMutationScope;
}): Promise<{ success: boolean; mutationSequence: number }> {
  let mutationSequence = await storage.getItem('local:mutationSequence') as number | null ?? 0;

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
  if (request.markDirty && request.serverRevision !== undefined) {
    await storage.setItems([
      { key: 'local:encryptedVault', value: request.vaultBlob },
      { key: 'local:mutationSequence', value: mutationSequence },
      { key: 'local:isDirty', value: true },
      { key: 'local:serverRevision', value: request.serverRevision },
      { key: dirtyScopeKey, value: true }
    ]);
  } else if (request.markDirty) {
    await storage.setItems([
      { key: 'local:encryptedVault', value: request.vaultBlob },
      { key: 'local:mutationSequence', value: mutationSequence },
      { key: 'local:isDirty', value: true },
      { key: dirtyScopeKey, value: true }
    ]);
  } else if (request.serverRevision !== undefined) {
    await storage.setItems([
      { key: 'local:encryptedVault', value: request.vaultBlob },
      { key: 'local:serverRevision', value: request.serverRevision }
    ]);
  } else {
    await storage.setItem('local:encryptedVault', request.vaultBlob);
  }

  // Clear cache since vault blob changed
  cachedSqliteClient = null;
  cachedVaultBlob = null;

  return { success: true, mutationSequence };
}

/**
 * Mark the vault as clean after successful sync.
 * Only clears dirty flag if no mutations happened during sync.
 *
 * @param mutationSeqAtStart - The mutation sequence when sync started
 * @param newServerRevision - The new server revision after successful upload
 * @returns Whether the dirty flag was cleared
 */
export async function handleMarkVaultClean(request: {
  mutationSeqAtStart: number;
  newServerRevision: number;
}): Promise<{ cleared: boolean; currentMutationSeq: number }> {
  const currentMutationSeq = await storage.getItem('local:mutationSequence') as number | null ?? 0;

  if (currentMutationSeq === request.mutationSeqAtStart) {
    // No mutations during sync - safe to mark as clean
    await storage.setItems([
      { key: 'local:isDirty', value: false },
      { key: 'local:serverRevision', value: request.newServerRevision }
    ]);
    await clearDirtyScopes();
    return { cleared: true, currentMutationSeq };
  }

  // Mutations happened during sync - keep dirty, but still update server revision
  await storage.setItem('local:serverRevision', request.newServerRevision);
  return { cleared: false, currentMutationSeq };
}

/**
 * Get the current sync state.
 */
export async function handleGetSyncState(): Promise<{
  isDirty: boolean;
  mutationSequence: number;
  serverRevision: number;
  isSyncInProgress: boolean;
}> {
  const [isDirty, mutationSequence, serverRevision] = await Promise.all([
    storage.getItem('local:isDirty') as Promise<boolean | null>,
    storage.getItem('local:mutationSequence') as Promise<number | null>,
    storage.getItem('local:serverRevision') as Promise<number | null>
  ]);

  return {
    isDirty: isDirty ?? false,
    mutationSequence: mutationSequence ?? 0,
    serverRevision: serverRevision ?? 0,
    isSyncInProgress
  };
}

/**
 * Get the current server revision.
 */
export async function handleGetServerRevision(): Promise<number> {
  // First try new key, then fall back to legacy key
  let revision = await storage.getItem('local:serverRevision') as number | null;

  if (revision === null) {
    // Try legacy key - parse string format "250" or "250+1" to get server part
    const legacyRevision = await storage.getItem('local:vaultRevisionNumber') as string | number | null;
    if (legacyRevision !== null) {
      if (typeof legacyRevision === 'number') {
        revision = legacyRevision;
      } else {
        // Handle legacy "250+1" format - extract just the server part
        const parts = legacyRevision.split('+');
        revision = parseInt(parts[0], 10) || 0;
      }
      // Migrate to new key
      await storage.setItem('local:serverRevision', revision);
    }
  }

  return revision ?? 0;
}

/**
 * Result of a sync status check (without doing actual sync).
 */
export type SyncStatusCheckResult = {
  /** True if check succeeded */
  success: boolean;
  /** True if server has a newer vault to download */
  hasNewerVault: boolean;
  /** True if we have local changes to upload */
  hasDirtyChanges: boolean;
  /** True if offline (server unavailable) */
  isOffline: boolean;
  /** True if user needs to be logged out */
  requiresLogout: boolean;
  /** Error key for translation */
  errorKey?: string;
};

/**
 * Result of a full vault sync operation.
 */
export type FullVaultSyncResult = {
  success: boolean;
  /** True if a new vault was downloaded from server */
  hasNewVault: boolean;
  /** True if entered offline mode */
  wasOffline: boolean;
  /** True if vault upgrade is required */
  upgradeRequired: boolean;
  /** Error message if sync failed */
  error?: string;
  /** Error key for translation (e.g. 'clientVersionNotSupported') */
  errorKey?: string;
  /** True if user needs to be logged out */
  requiresLogout: boolean;
};

/**
 * Quick check if a sync is needed without doing the actual sync.
 * Used by popup to show syncing indicator before starting the actual sync.
 */
export async function handleCheckSyncStatus(): Promise<SyncStatusCheckResult> {
  const webApi = new WebApiService();

  try {
    // Check if user is logged in
    const authStatus = await handleCheckAuthStatus();
    if (!authStatus.isLoggedIn || authStatus.isVaultLocked) {
      return { success: false, hasNewerVault: false, hasDirtyChanges: false, isOffline: false, requiresLogout: false };
    }

    // Get current sync state
    const syncState = await handleGetSyncState();

    // Check app status and vault revision
    const statusResponse = await webApi.getStatus();

    // Check if server is unavailable
    if (statusResponse.serverVersion === '0.0.0') {
      return { success: true, hasNewerVault: false, hasDirtyChanges: syncState.isDirty, isOffline: true, requiresLogout: false };
    }

    // Validate status response
    const statusError = webApi.validateStatusResponse(statusResponse);
    if (statusError) {
      if (statusError === 'clientVersionNotSupported' || statusError === 'serverVersionNotSupported') {
        return { success: false, hasNewerVault: false, hasDirtyChanges: false, isOffline: false, requiresLogout: true, errorKey: statusError };
      }
      return { success: false, hasNewerVault: false, hasDirtyChanges: false, isOffline: false, requiresLogout: false, errorKey: statusError };
    }

    // Check if the SRP salt has changed (password change detection)
    const storedEncryptionParams = await handleGetEncryptionKeyDerivationParams();
    if (storedEncryptionParams && statusResponse.srpSalt && statusResponse.srpSalt !== storedEncryptionParams.salt) {
      return { success: false, hasNewerVault: false, hasDirtyChanges: false, isOffline: false, requiresLogout: true, errorKey: 'passwordChanged' };
    }

    return {
      success: true,
      hasNewerVault: statusResponse.vaultRevision > syncState.serverRevision,
      hasDirtyChanges: syncState.isDirty,
      isOffline: false,
      requiresLogout: false
    };
  } catch (err) {
    // Network error - treat as offline
    if (err instanceof NetworkError) {
      const syncState = await handleGetSyncState();
      return { success: true, hasNewerVault: false, hasDirtyChanges: syncState.isDirty, isOffline: true, requiresLogout: false };
    }

    return { success: false, hasNewerVault: false, hasDirtyChanges: false, isOffline: false, requiresLogout: false };
  }
}

/**
 * Persists a sync error message to local storage so the popup can surface it
 * even when the failing sync was triggered from the background (e.g. follow-up
 * syncs after pending mutations). Cleared on the next successful sync.
 *
 * Skips errors that already have dedicated UX:
 * - requiresLogout: handled by the forced re-login flow
 * - wasOffline: handled by the offline indicator
 */
async function persistSyncErrorState(result: FullVaultSyncResult): Promise<void> {
  if (result.requiresLogout || result.wasOffline) {
    return;
  }

  const errorMessage = result.errorKey
    ? await t('common.errors.' + result.errorKey)
    : result.error;

  if (errorMessage) {
    await storage.setItem('local:lastSyncError', errorMessage);
  } else if (result.success) {
    await storage.removeItem('local:lastSyncError');
  }
}

/**
 * Full vault sync orchestration that runs entirely in background context.
 * Wraps the internal implementation with sync-error persistence so the popup
 * can show a targeted alert for failures even if it wasn't open at the time.
 */
export async function handleFullVaultSync(): Promise<FullVaultSyncResult> {
  const result = await handleFullVaultSyncInternal();
  await persistSyncErrorState(result);
  return result;
}

/**
 * Internal implementation of the full vault sync. Wrapped by handleFullVaultSync
 * so the result can be persisted to local storage for the popup to surface.
 */
async function handleFullVaultSyncInternal(): Promise<FullVaultSyncResult> {
  // Check if sync is already in progress
  if (isSyncInProgress) {
    // Mark that we need to sync again after current sync completes
    hasPendingSync = true;
    devLog('[VaultSync] Sync already in progress, queued for retry after completion');
    return { success: true, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: false };
  }

  // Mark sync as in progress
  isSyncInProgress = true;
  hasPendingSync = false;

  devLog('[VaultSync] Sync started');

  const webApi = new WebApiService();

  try {
    // Check if user is logged in
    const authStatus = await handleCheckAuthStatus();
    if (!authStatus.isLoggedIn) {
      return { success: false, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: false };
    }

    if (authStatus.isVaultLocked) {
      // E-202: Vault is locked
      return { success: false, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
    }

    // Check app status and vault revision
    const statusResponse = await webApi.getStatus();

    // Get current sync state
    const syncState = await handleGetSyncState();

    devLog(`[VaultSync] Status received (server rev ${statusResponse.vaultRevision}, local rev ${syncState.serverRevision}, isDirty ${syncState.isDirty})`);

    // Check if server is actually available (0.0.0 indicates connection error)
    if (statusResponse.serverVersion === '0.0.0') {
      // Server is unavailable - enter offline mode if we have a local vault
      const encryptedVault = await storage.getItem('local:encryptedVault');
      if (encryptedVault) {
        await storage.setItem('local:isOfflineMode', true);
        return { success: true, hasNewVault: false, wasOffline: true, upgradeRequired: false, requiresLogout: false };
      } else {
        return { success: false, hasNewVault: false, wasOffline: true, upgradeRequired: false, requiresLogout: false, error: await t('common.errors.serverNotAvailable') };
      }
    }

    // Validate status response
    const statusError = webApi.validateStatusResponse(statusResponse);
    if (statusError) {
      if (statusError === 'clientVersionNotSupported' || statusError === 'serverVersionNotSupported') {
        return { success: false, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: true, errorKey: statusError };
      }
      return { success: false, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: false, errorKey: statusError };
    }

    // Check if the SRP salt has changed (password change detection)
    const storedEncryptionParams = await handleGetEncryptionKeyDerivationParams();
    if (storedEncryptionParams && statusResponse.srpSalt && statusResponse.srpSalt !== storedEncryptionParams.salt) {
      return { success: false, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: true, errorKey: 'passwordChanged' };
    }

    // Valid connection - exit offline mode if we were in it
    const isOffline = await storage.getItem('local:isOfflineMode') as boolean | null;
    if (isOffline) {
      await storage.setItem('local:isOfflineMode', false);
    }

    const encryptionKey = await handleGetEncryptionKey();
    if (!encryptionKey) {
      return { success: false, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: false, error: await t('common.errors.vaultIsLocked') };
    }

    if (statusResponse.vaultRevision > syncState.serverRevision) {
      /*
       * Server has a newer vault.
       */
      const vaultResponseJson = await fetchLatestVaultFromServer();

      try {
        if (syncState.isDirty) {
          /*
           * We have local changes AND server has newer vault.
           * Merge local vault with server vault, then upload the merged result.
           */
          const localEncryptedVault = await storage.getItem('local:encryptedVault') as string | null;

          if (localEncryptedVault) {
            const localDecrypted = await EncryptionUtility.symmetricDecrypt(localEncryptedVault, encryptionKey);
            const serverDecrypted = await EncryptionUtility.symmetricDecrypt(vaultResponseJson.vault.blob, encryptionKey);

            const mergeResult = await vaultMergeService.merge(localDecrypted, serverDecrypted);

            if (mergeResult.success) {
              devLog('[VaultSync] Vault merge during sync completed:', mergeResult.stats);

              const mergedEncryptedVault = await EncryptionUtility.symmetricEncrypt(
                mergeResult.mergedVaultBase64,
                encryptionKey
              );

              /*
               * Store merged vault. Use expectedMutationSeq to detect if a local mutation
               * happened during merge - if so, reject and re-sync.
               */
              const storeResult = await handleStoreEncryptedVault({
                vaultBlob: mergedEncryptedVault,
                serverRevision: vaultResponseJson.vault.currentRevisionNumber,
                expectedMutationSeq: syncState.mutationSequence
              });

              if (!storeResult.success) {
                devLog('[VaultSync] Mutation detected during merge, re-syncing...');
                return handleFullVaultSync();
              }

              // Upload merged vault to server
              const uploadResponse = await handleUploadVault();

              if (uploadResponse.success && uploadResponse.status === 0) {
                await handleMarkVaultClean({
                  mutationSeqAtStart: uploadResponse.mutationSeqAtStart!,
                  newServerRevision: uploadResponse.newRevisionNumber!
                });
              } else if (uploadResponse.status === 2) {
                // Server returned Outdated - another device uploaded. Re-sync.
                return handleFullVaultSync();
              } else {
                console.error('Failed to upload merged vault:', uploadResponse.error);
                return { success: false, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: false, error: uploadResponse.error };
              }

              // Store metadata
              await handleStoreVaultMetadata({
                publicEmailDomainList: vaultResponseJson.vault.publicEmailDomainList,
                privateEmailDomainList: vaultResponseJson.vault.privateEmailDomainList,
                hiddenPrivateEmailDomainList: vaultResponseJson.vault.hiddenPrivateEmailDomainList,
              });

              // Check for pending migrations
              const sqliteClient = await createVaultSqliteClient();
              const hasPendingMigrations = await sqliteClient.hasPendingMigrations();

              return { success: true, hasNewVault: true, wasOffline: false, upgradeRequired: hasPendingMigrations, requiresLogout: false };
            } else {
              console.error('Vault merge failed during sync, using server vault');
              // Fall through to use server vault
            }
          }
        }

        /*
         * No local changes (or merge failed) - just use server vault.
         * Use expectedMutationSeq to detect concurrent mutations.
         */
        const storeResult = await handleStoreEncryptedVault({
          vaultBlob: vaultResponseJson.vault.blob,
          serverRevision: vaultResponseJson.vault.currentRevisionNumber,
          expectedMutationSeq: syncState.mutationSequence
        });

        if (!storeResult.success) {
          devLog('[VaultSync] Mutation detected during sync, re-syncing...');
          return handleFullVaultSync();
        }

        await handleStoreVaultMetadata({
          publicEmailDomainList: vaultResponseJson.vault.publicEmailDomainList,
          privateEmailDomainList: vaultResponseJson.vault.privateEmailDomainList,
          hiddenPrivateEmailDomainList: vaultResponseJson.vault.hiddenPrivateEmailDomainList,
        });

        // Check for pending migrations
        const sqliteClient = await createVaultSqliteClient();
        const hasPendingMigrations = await sqliteClient.hasPendingMigrations();

        return { success: true, hasNewVault: true, wasOffline: false, upgradeRequired: hasPendingMigrations, requiresLogout: false };
      } catch (error) {
        if (error instanceof VaultVersionIncompatibleError) {
          return { success: false, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: true, error: error.message };
        }
        // E-501: Vault decryption failed
        throw new Error(formatErrorWithCode(
          'Vault could not be decrypted, if the problem persists please logout and login again.',
          AppErrorCode.VAULT_DECRYPT_FAILED
        ));
      }
    } else if (statusResponse.vaultRevision === syncState.serverRevision) {
      /**
       * Server and local vault are at the same revision.
       * If we have pending local changes, upload them now.
       */
      if (syncState.isDirty) {
        const uploadResponse = await handleUploadVault();
        if (uploadResponse.success && uploadResponse.status === 0) {
          await handleMarkVaultClean({
            mutationSeqAtStart: uploadResponse.mutationSeqAtStart!,
            newServerRevision: uploadResponse.newRevisionNumber!
          });

          /*
           * If expired trash items were pruned during upload, report the vault as new
           * so the popup reloads the pruned vault instead of resurrecting the items
           * from its stale in-memory copy on the next mutation.
           */
          return { success: true, hasNewVault: uploadResponse.vaultPruned === true, wasOffline: false, upgradeRequired: false, requiresLogout: false };
        } else if (uploadResponse.status === 2) {
          /**
           * Server returned Outdated - another device uploaded first.
           * Recursively call sync to fetch, merge, and retry.
           */
          return handleFullVaultSync();
        } else {
          console.error('Failed to upload pending vault:', uploadResponse.error);
          return { success: false, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: false, error: uploadResponse.error };
        }
      }

      return { success: true, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: false };
    } else if (statusResponse.vaultRevision < syncState.serverRevision) {
      /**
       * Server revision DECREASED - server data loss/rollback detected.
       * Client has more advanced revision - upload to recover server state.
       */
      console.warn(
        `Server data loss detected! Server at rev ${statusResponse.vaultRevision}, ` +
        `client at rev ${syncState.serverRevision}. Uploading to recover server state.`
      );

      const uploadResponse = await handleUploadVault();

      if (uploadResponse.success && uploadResponse.status === 0) {
        await handleMarkVaultClean({
          mutationSeqAtStart: uploadResponse.mutationSeqAtStart!,
          newServerRevision: uploadResponse.newRevisionNumber!
        });

        console.info(
          `Server recovery complete: rev ${statusResponse.vaultRevision} → ${uploadResponse.newRevisionNumber}`
        );

        return { success: true, hasNewVault: uploadResponse.vaultPruned === true, wasOffline: false, upgradeRequired: false, requiresLogout: false };
      } else if (uploadResponse.status === 2) {
        // Another client recovered first
        devLog('[VaultSync] Another client recovered server first, re-syncing...');
        return handleFullVaultSync();
      } else {
        console.error('Server recovery failed:', uploadResponse.error);
        // E-801: Upload failed during server recovery - preserve the upload error detail when available
        return { success: false, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: false, error: uploadResponse.error ?? formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.UPLOAD_FAILED) };
      }
    }

    // Check for pending migrations (for paths that didn't initialize a new database)
    try {
      const sqliteClient = await createVaultSqliteClient();
      const hasPendingMigrations = await sqliteClient.hasPendingMigrations();
      if (hasPendingMigrations) {
        return { success: true, hasNewVault: false, wasOffline: false, upgradeRequired: true, requiresLogout: false };
      }
    } catch {
      // Ignore errors checking migrations
    }

    return { success: true, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: false };
  } catch (err) {
    console.error('Vault sync error:', err);

    // Version incompatibility requires logout
    if (err instanceof VaultVersionIncompatibleError) {
      return { success: false, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: true, error: err.message };
    }

    // Auth error (session expired) - signal popup to trigger logout
    if (err instanceof ApiAuthError) {
      return { success: false, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: true, errorKey: 'sessionExpired' };
    }

    // E-805: Vault transfer timed out - show a targeted error instead of entering offline mode
    if (err instanceof RequestTimeoutError) {
      return { success: false, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: false, error: formatErrorWithCode(await t('common.errors.vaultSyncTimeout'), AppErrorCode.UPLOAD_TIMEOUT) };
    }

    // Network error - enter offline mode if we have a local vault
    if (err instanceof NetworkError) {
      const encryptedVault = await storage.getItem('local:encryptedVault');
      if (encryptedVault) {
        await storage.setItem('local:isOfflineMode', true);
        return { success: true, hasNewVault: false, wasOffline: true, upgradeRequired: false, requiresLogout: false };
      }
    }

    // For all other errors, include an error code so users can report it
    const baseMessage = err instanceof Error ? err.message : 'Unknown error during vault sync';
    // Check if message already has an error code (E-XXX format)
    const hasErrorCode = /E-\d{3}/.test(baseMessage);
    const errorMessage = hasErrorCode
      ? baseMessage
      : formatErrorWithCode(baseMessage, AppErrorCode.UNKNOWN_ERROR);
    return { success: false, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: false, error: errorMessage };
  } finally {
    // Reset sync in progress flag
    isSyncInProgress = false;

    devLog('[VaultSync] Sync finished');

    /*
     * Check if another sync is needed (mutations happened during this sync).
     * Trigger follow-up sync asynchronously (don't await to avoid blocking).
     * Popup will poll isDirty flag to detect when background sync completes.
     */
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
        const binaryString = atob(message.logoBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        logo = bytes;
      } catch {
        // Logo decode failed, continue without logo
      }
    }

    // If no direct logo, try fetching from favicon URL
    if (!logo && message.faviconUrl) {
      logo = await fetchFaviconAsBytes(message.faviconUrl);
    }

    // Create the new item
    const newItem: Item = {
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
): Promise<{ success: boolean; secrets?: Record<string, string>; error?: string }> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const secrets: Record<string, string> = {};

    for (const itemId of message.itemIds) {
      const totpCodes = sqliteClient.settings.getTotpCodesForItem(itemId);
      if (totpCodes.length > 0) {
        secrets[itemId] = totpCodes[0].SecretKey;
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
    const totpCodes = sqliteClient.settings.getTotpCodesForItem(message.itemId);

    if (totpCodes.length === 0) {
      return { success: false, error: 'No TOTP codes found for this item' };
    }

    const totp = new OTPAuth.TOTP({
      secret: totpCodes[0].SecretKey,
      algorithm: 'SHA1',
      digits: 6,
      period: 30
    });

    return { success: true, code: totp.generate() };
  } catch (error) {
    console.error('Error generating TOTP code:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
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
