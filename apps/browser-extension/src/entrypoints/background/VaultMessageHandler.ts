/* eslint-disable @typescript-eslint/no-explicit-any */
import { storage } from 'wxt/utils/storage';

import type { EncryptionKeyDerivationParams } from '@/utils/dist/core/models/metadata';
import type { Vault, VaultResponse, VaultPostResponse } from '@/utils/dist/core/models/webapi';
import { EncryptionUtility } from '@/utils/EncryptionUtility';
import { SqliteClient } from '@/utils/SqliteClient';
import { VaultVersionIncompatibleError } from '@/utils/types/errors/VaultVersionIncompatibleError';
import { BoolResponse as messageBoolResponse } from '@/utils/types/messaging/BoolResponse';
import { CredentialsResponse as messageCredentialsResponse } from '@/utils/types/messaging/CredentialsResponse';
import { IdentitySettingsResponse } from '@/utils/types/messaging/IdentitySettingsResponse';
import { PasswordSettingsResponse as messagePasswordSettingsResponse } from '@/utils/types/messaging/PasswordSettingsResponse';
import { StringResponse as stringResponse } from '@/utils/types/messaging/StringResponse';
import { VaultResponse as messageVaultResponse } from '@/utils/types/messaging/VaultResponse';
import { VaultUploadResponse as messageVaultUploadResponse } from '@/utils/types/messaging/VaultUploadResponse';
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
  // Check local: storage for persistent vault (survives browser close)
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
    return { success: false, error: await t('common.errors.unknownError') };
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
    return { success: false, error: await t('common.errors.unknownErrorTryAgain') };
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
    return { success: false, error: await t('common.errors.unknownErrorTryAgain') };
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

    // Read from local: storage for persistent vault access
    const encryptedVault = await storage.getItem('local:encryptedVault') as string;
    const publicEmailDomains = await storage.getItem('local:publicEmailDomains') as string[];
    const privateEmailDomains = await storage.getItem('local:privateEmailDomains') as string[];
    const hiddenPrivateEmailDomains = await storage.getItem('local:hiddenPrivateEmailDomains') as string[] ?? [];
    const serverRevision = await storage.getItem('local:serverRevision') as number | null;

    if (!encryptedVault) {
      console.error('Vault not available');
      return { success: false, error: await t('common.errors.vaultNotAvailable') };
    }

    if (!encryptionKey) {
      console.error('Encryption key not available');
      return { success: false, error: await t('common.errors.vaultIsLocked') };
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
    return { success: false, error: await t('common.errors.unknownError') };
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
 * Clear the vault completely from browser storage (both local: and session:).
 * This is used for full logout - removes all vault data.
 */
export function handleClearVault(): messageBoolResponse {
  // Clear persistent vault data from local: storage
  storage.removeItems([
    'local:encryptedVault',
    'local:publicEmailDomains',
    'local:privateEmailDomains',
    'local:hiddenPrivateEmailDomains',
    'local:serverRevision',
    'local:isDirty',
    'local:mutationSequence',
    'local:isOfflineMode',
    'local:encryptionKeyDerivationParams',
  ]);

  // Clear session-only data
  storage.removeItems([
    'session:encryptionKey',
    'session:persistedFormValues',
  ]);

  // Clear cached client since vault was cleared
  cachedSqliteClient = null;
  cachedVaultBlob = null;

  return { success: true };
}

/**
 * Get all credentials.
 */
export async function handleGetCredentials(
) : Promise<messageCredentialsResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: await t('common.errors.vaultIsLocked') };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const credentials = sqliteClient.getAllCredentials();
    return { success: true, credentials: credentials };
  } catch (error) {
    console.error('Error getting credentials:', error);
    return { success: false, error: await t('common.errors.unknownError') };
  }
}

/**
 * Get credentials filtered by URL and page title for autofill performance optimization.
 * Filters credentials in the background script before sending to reduce message payload size.
 * Critical for large vaults (1000+ credentials) to avoid multi-second delays.
 *
 * @param message - Filtering parameters: currentUrl, pageTitle, matchingMode
 */
export async function handleGetFilteredCredentials(
  message: { currentUrl: string, pageTitle: string, matchingMode?: string }
) : Promise<messageCredentialsResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: await t('common.errors.vaultIsLocked') };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const allCredentials = sqliteClient.getAllCredentials();

    const { filterCredentials, AutofillMatchingMode } = await import('@/utils/credentialMatcher/CredentialMatcher');

    // Parse matching mode from string
    let matchingMode = AutofillMatchingMode.DEFAULT;
    if (message.matchingMode) {
      matchingMode = message.matchingMode as typeof AutofillMatchingMode[keyof typeof AutofillMatchingMode];
    }

    // Filter credentials in background to reduce payload size (~95% reduction)
    const filteredCredentials = await filterCredentials(
      allCredentials,
      message.currentUrl,
      message.pageTitle,
      matchingMode
    );

    return { success: true, credentials: filteredCredentials };
  } catch (error) {
    console.error('Error getting filtered credentials:', error);
    return { success: false, error: await t('common.errors.unknownError') };
  }
}

/**
 * Get credentials filtered by text search query.
 * Searches across entire vault (service name, username, email, URL) and returns matches.
 *
 * @param message - Search parameters: searchTerm
 */
export async function handleGetSearchCredentials(
  message: { searchTerm: string }
) : Promise<messageCredentialsResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: await t('common.errors.vaultIsLocked') };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const allCredentials = sqliteClient.getAllCredentials();

    // If search term is empty, return empty array
    if (!message.searchTerm || message.searchTerm.trim() === '') {
      return { success: true, credentials: [] };
    }

    const searchTerm = message.searchTerm.toLowerCase().trim();

    // Filter credentials by search term across multiple fields
    const searchResults = allCredentials.filter(cred => {
      const searchableFields = [
        cred.ServiceName?.toLowerCase(),
        cred.Username?.toLowerCase(),
        cred.Alias?.Email?.toLowerCase(),
        cred.ServiceUrl?.toLowerCase()
      ];
      return searchableFields.some(field => field?.includes(searchTerm));
    }).sort((a, b) => {
      // Sort by service name, then username
      const serviceNameComparison = (a.ServiceName ?? '').localeCompare(b.ServiceName ?? '');
      if (serviceNameComparison !== 0) {
        return serviceNameComparison;
      }
      return (a.Username ?? '').localeCompare(b.Username ?? '');
    });

    return { success: true, credentials: searchResults };
  } catch (error) {
    console.error('Error searching credentials:', error);
    return { success: false, error: await t('common.errors.unknownError') };
  }
}

/**
 * Create an identity.
 */
export async function handleCreateIdentity(
  message: any,
) : Promise<messageBoolResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: await t('common.errors.vaultIsLocked') };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();

    // Add the new credential to the vault/database.
    await sqliteClient.createCredential(message.credential, message.attachments || []);

    // Upload the new vault to the server.
    await uploadNewVaultToServer(sqliteClient);

    return { success: true };
  } catch (error) {
    console.error('Failed to create identity:', error);
    return { success: false, error: await t('common.errors.unknownError') };
  }
}

/**
 * Get the email addresses for a vault.
 */
export async function getEmailAddressesForVault(
  sqliteClient: SqliteClient
): Promise<string[]> {
  // TODO: create separate query to only get email addresses to avoid loading all credentials.
  const credentials = sqliteClient.getAllCredentials();

  // Get metadata from local: storage
  const privateEmailDomains = await storage.getItem('local:privateEmailDomains') as string[];

  const emailAddresses = credentials
    .filter(cred => cred.Alias?.Email != null)
    .map(cred => cred.Alias.Email ?? '')
    .filter((email, index, self) => self.indexOf(email) === index);

  return emailAddresses.filter(email => {
    const domain = email?.split('@')[1];
    return domain && privateEmailDomains.includes(domain);
  });
}

/**
 * Get default email domain for a vault.
 */
export function handleGetDefaultEmailDomain(): Promise<stringResponse> {
  return (async (): Promise<stringResponse> => {
    try {
      const sqliteClient = await createVaultSqliteClient();
      const defaultEmailDomain = await sqliteClient.getDefaultEmailDomain();

      return { success: true, value: defaultEmailDomain ?? undefined };
    } catch (error) {
      console.error('Error getting default email domain:', error);
      return { success: false, error: await t('common.errors.unknownError') };
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
    const language = await sqliteClient.getEffectiveIdentityLanguage();
    const gender = sqliteClient.getDefaultIdentityGender();

    return {
      success: true,
      settings: {
        language,
        gender
      }
    };
  } catch (error) {
    console.error('Error getting default identity settings:', error);
    return { success: false, error: await t('common.errors.unknownError') };
  }
}

/**
 * Get the password settings.
 */
export async function handleGetPasswordSettings(
) : Promise<messagePasswordSettingsResponse> {
  try {
    const sqliteClient = await createVaultSqliteClient();
    const passwordSettings = sqliteClient.getPasswordSettings();

    return { success: true, settings: passwordSettings };
  } catch (error) {
    console.error('Error getting password settings:', error);
    return { success: false, error: await t('common.errors.unknownError') };
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
  // Try local: storage first (current location since offline support)
  let params = await storage.getItem('local:encryptionKeyDerivationParams') as EncryptionKeyDerivationParams | null;

  // Fall back to session: storage for backwards compatibility
  if (!params) {
    params = await storage.getItem('session:encryptionKeyDerivationParams') as EncryptionKeyDerivationParams | null;
  }

  return params;
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
    return { success: false, error: await t('common.errors.unknownError') };
  }
}

/**
 * Handle persisting form values to storage.
 * Data is encrypted using the derived key for additional security.
 */
export async function handlePersistFormValues(data: any): Promise<void> {
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptionKey) {
    throw new Error(await t('common.errors.unknownError'));
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
 */
async function uploadNewVaultToServer(sqliteClient: SqliteClient) : Promise<VaultPostResponse> {
  const updatedVaultData = sqliteClient.exportToBase64();
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    throw new Error(await t('common.errors.vaultIsLocked'));
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
    credentialsCount: sqliteClient.getAllCredentials().length,
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
  } else {
    // Upload failed
    throw new Error(await t('common.errors.unknownError'));
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
  if (!encryptedVault || !encryptionKey) {
    throw new Error(await t('common.errors.unknownError'));
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
