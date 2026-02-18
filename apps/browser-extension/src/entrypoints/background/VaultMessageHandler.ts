/* eslint-disable @typescript-eslint/no-explicit-any */
import * as OTPAuth from 'otpauth';
import { storage } from 'wxt/utils/storage';

import type { EncryptionKeyDerivationParams } from '@/utils/dist/core/models/metadata';
import { FieldKey, ItemTypes, createSystemField, type Item } from '@/utils/dist/core/models/vault';
import type { Vault, VaultResponse, VaultPostResponse } from '@/utils/dist/core/models/webapi';
import { EncryptionUtility } from '@/utils/EncryptionUtility';
import { filterItems, AutofillMatchingMode } from '@/utils/itemMatcher/ItemMatcher';
import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import { SqliteClient } from '@/utils/SqliteClient';
import { getItemWithFallback } from '@/utils/StorageUtility';
import { ApiAuthError } from '@/utils/types/errors/ApiAuthError';
import { AppErrorCode, formatErrorWithCode } from '@/utils/types/errors/AppErrorCodes';
import { NetworkError } from '@/utils/types/errors/NetworkError';
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
import { vaultMergeService } from '@/utils/VaultMergeService';
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
    // Retrieve the latest vault from the server.
    const vaultResponse = await webApi.get<VaultResponse>('Vault');

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
      console.error('Encryption key not available');
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
export function handleLockVault(): messageBoolResponse {
  // Clear session-only data (locks the vault)
  storage.removeItems([
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
  // Clear auth tokens
  await storage.removeItems([
    'local:accessToken',
    'local:refreshToken',
  ]);

  // Clear session-only data (security: encryption key must not persist)
  await storage.removeItems([
    'session:encryptionKey',
    'session:persistedFormValues',
  ]);

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
 * Create a new item in the vault.
 * Uses the native Item type with field-based structure.
 */
export async function handleCreateItem(
  message: any,
) : Promise<messageBoolResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    // E-202: Vault is locked
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();

    // Add the new item to the vault/database.
    await sqliteClient.items.create(message.item, message.attachments || [], message.totpCodes || []);

    // Upload the new vault to the server.
    await uploadNewVaultToServer(sqliteClient);

    return { success: true };
  } catch (error) {
    console.error('Failed to create item:', error);
    // E-301: Item create failed
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_CREATE_FAILED) };
  }
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
 * Filter items by search term.
 *
 * @param items - The items to filter
 * @param searchTerm - The search term to use
 * @returns The filtered items
 */
function filterItemsBySearchTerm(items: Item[], searchTerm: string): Item[] {
  if (!searchTerm || searchTerm.trim() === '') {
    return [];
  }

  const normalizedTerm = searchTerm.toLowerCase().trim();

  const searchableFieldKeys = [
    FieldKey.LoginUsername,
    FieldKey.LoginEmail,
    FieldKey.LoginUrl,
    FieldKey.AliasFirstName,
    FieldKey.AliasLastName
  ];

  return items.filter((item: Item) => {
    // Search in item name
    if (item.Name?.toLowerCase().includes(normalizedTerm)) {
      return true;
    }

    // Search in field values
    return item.Fields?.some((field: { FieldKey: string; Value: string | string[] }) => {
      if ((searchableFieldKeys as string[]).includes(field.FieldKey)) {
        const value = Array.isArray(field.Value) ? field.Value.join(' ') : field.Value;
        return value?.toLowerCase().includes(normalizedTerm);
      }
      return false;
    });
  }).sort((a: Item, b: Item) => (a.Name ?? '').localeCompare(b.Name ?? ''));
}

/**
 * Get items filtered by URL matching (for autofill).
 * Filters items in the background script before sending to reduce message payload size.
 *
 * @param message - Filtering parameters: currentUrl, pageTitle, matchingMode
 */
export async function handleGetFilteredItems(
  message: { currentUrl: string, pageTitle: string, matchingMode?: string }
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
 * Upload the currently stored vault to the server.
 * Returns the upload status and captures the mutation sequence at start for race detection.
 */
export async function handleUploadVault(
) : Promise<messageVaultUploadResponse> {
  try {
    // Capture mutation sequence at start of upload for race detection
    const mutationSeqAtStart = await storage.getItem('local:mutationSequence') as number | null ?? 0;

    // Create sqlite client from the already-stored vault blob.
    const sqliteClient = await createVaultSqliteClient();

    // Upload the vault to the server.
    const response = await uploadNewVaultToServer(sqliteClient);

    return {
      success: true,
      status: response.status,
      newRevisionNumber: response.newRevisionNumber,
      mutationSeqAtStart
    };
  } catch (error) {
    console.error('Failed to upload vault:', error);
    // E-801: Upload failed
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.UPLOAD_FAILED) };
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
 * Prunes expired trash items (older than 30 days) before uploading.
 */
async function uploadNewVaultToServer(sqliteClient: SqliteClient) : Promise<VaultPostResponse> {
  let updatedVaultData = sqliteClient.exportToBase64();
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    // E-202: Vault is locked
    throw new Error(formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED));
  }

  /**
   * Prune expired items from trash before uploading.
   * Items that have been in trash (DeletedAt set) for more than 30 days
   * are permanently deleted (IsDeleted = true) as part of the sync process.
   */
  try {
    const pruneResult = await vaultMergeService.prune(updatedVaultData, 30);
    if (pruneResult.success && pruneResult.statementCount > 0) {
      console.info(`[VaultSync] Pruned expired items from trash (${pruneResult.statementCount} statements)`);
      updatedVaultData = pruneResult.prunedVaultBase64;

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

  const encryptedVault = await EncryptionUtility.symmetricEncrypt(
    updatedVaultData,
    encryptionKey
  );

  // Store in local: storage for persistence
  await storage.setItem('local:encryptedVault', encryptedVault);

  // Get server revision for API
  const serverRevision = await storage.getItem('local:serverRevision') as number | null ?? 0;

  // Upload new encrypted vault to server.
  const username = await storage.getItem('local:username') as string;
  const emailAddresses = await getEmailAddressesForVault(sqliteClient);

  const newVault: Vault = {
    blob: encryptedVault,
    createdAt: new Date().toISOString(),
    credentialsCount: sqliteClient.items.getAll().length,
    currentRevisionNumber: serverRevision,
    emailAddressList: emailAddresses,
    updatedAt: new Date().toISOString(),
    username: username,
    version: (await sqliteClient.getDatabaseVersion()).version,
    // TODO: add public RSA encryption key to payload when implementing vault creation from browser extension. Currently only web app does this.
    encryptionPublicKey: '',
  };

  const webApi = new WebApiService();
  const response = await webApi.post<Vault, VaultPostResponse>('Vault', newVault);

  // Check if response is successful (.status === 0)
  if (response.status === 0) {
    // Upload succeeded - update server revision
    await storage.setItem('local:serverRevision', response.newRevisionNumber);
  } else if (response.status === 2) {
    // Outdated - server has newer version
    throw new Error(formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.UPLOAD_OUTDATED));
  } else {
    // Upload failed
    throw new Error(formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.UPLOAD_FAILED));
  }

  return response;
}

/**
 * Create a new sqlite client for the stored vault.
 * Uses a cache to avoid repeated decryption and initialization for read operations.
 */
async function createVaultSqliteClient() : Promise<SqliteClient> {
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
    // Increment mutation sequence and mark dirty
    mutationSequence++;
  }

  // Build items to store - use explicit typing for storage.setItems
  if (request.markDirty && request.serverRevision !== undefined) {
    await storage.setItems([
      { key: 'local:encryptedVault', value: request.vaultBlob },
      { key: 'local:mutationSequence', value: mutationSequence },
      { key: 'local:isDirty', value: true },
      { key: 'local:serverRevision', value: request.serverRevision }
    ]);
  } else if (request.markDirty) {
    await storage.setItems([
      { key: 'local:encryptedVault', value: request.vaultBlob },
      { key: 'local:mutationSequence', value: mutationSequence },
      { key: 'local:isDirty', value: true }
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
}> {
  const [isDirty, mutationSequence, serverRevision] = await Promise.all([
    storage.getItem('local:isDirty') as Promise<boolean | null>,
    storage.getItem('local:mutationSequence') as Promise<number | null>,
    storage.getItem('local:serverRevision') as Promise<number | null>
  ]);

  return {
    isDirty: isDirty ?? false,
    mutationSequence: mutationSequence ?? 0,
    serverRevision: serverRevision ?? 0
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
 * Full vault sync orchestration that runs entirely in background context.
 * This ensures sync completes even if popup closes mid-operation.
 *
 * Sync logic:
 * - If server has newer vault AND we have local changes (isDirty) → merge then upload
 * - If server has newer vault AND no local changes → just download
 * - If server has same revision AND we have local changes → upload
 * - If offline → keep local changes, sync later
 *
 * Race detection:
 * - Upload captures mutationSequence at start
 * - After upload, only clears isDirty if sequence unchanged
 * - If sequence changed during upload, stays dirty for next sync
 */
export async function handleFullVaultSync(): Promise<FullVaultSyncResult> {
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
      const vaultResponseJson = await webApi.get<VaultResponse>('Vault');

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
              console.info('Vault merge during sync completed:', mergeResult.stats);

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
                console.info('Mutation detected during merge, re-syncing...');
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
          console.info('Mutation detected during sync, re-syncing...');
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

        return { success: true, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: false };
      } else if (uploadResponse.status === 2) {
        // Another client recovered first
        console.info('Another client recovered server first, re-syncing...');
        return handleFullVaultSync();
      } else {
        console.error('Server recovery failed:', uploadResponse.error);
        // E-801: Upload failed during server recovery
        return { success: false, hasNewVault: false, wasOffline: false, upgradeRequired: false, requiresLogout: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.UPLOAD_FAILED) };
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
      // Check LoginUrl field for domain match
      const urlField = item.Fields?.find((f: { FieldKey: string }) => f.FieldKey === FieldKey.LoginUrl);
      const urlValue = urlField?.Value;
      if (!urlValue || typeof urlValue !== 'string') {
        continue;
      }

      // Extract domain from URL
      let itemDomain: string;
      try {
        const url = new URL(urlValue.startsWith('http') ? urlValue : `https://${urlValue}`);
        itemDomain = url.hostname.toLowerCase();
      } catch {
        // If URL parsing fails, try direct comparison
        itemDomain = urlValue.toLowerCase();
      }

      // Check if domains match (including subdomains)
      const domainsMatch = itemDomain === normalizedDomain ||
        itemDomain.endsWith(`.${normalizedDomain}`) ||
        normalizedDomain.endsWith(`.${itemDomain}`);

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

    // Upload the updated vault to the server
    await uploadNewVaultToServer(sqliteClient);

    return { success: true, itemId: newItem.Id };
  } catch (error) {
    console.error('Failed to save login credential:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_CREATE_FAILED) };
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
    // Default to disabled (feature flag - can enable once tested)
    const enabled = await storage.getItem('local:loginSaveEnabled') ?? false;
    const autoDismissSeconds = await storage.getItem('local:loginSaveAutoDismissSeconds') ?? 15;

    return {
      success: true,
      enabled: enabled as boolean,
      autoDismissSeconds: autoDismissSeconds as number
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
    await storage.setItem('local:loginSaveEnabled', enabled);
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

    return { success: true, items: filteredItems };
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
