/* eslint-disable @typescript-eslint/no-explicit-any */
import { storage } from 'wxt/utils/storage';

import type { EncryptionKeyDerivationParams } from '@/utils/dist/shared/models/metadata';
import type { Vault, VaultResponse, VaultPostResponse } from '@/utils/dist/shared/models/webapi';
import { EncryptionUtility } from '@/utils/EncryptionUtility';
import { VaultVersionIncompatibleError } from '@/utils/errors/VaultVersionError';
import { SqliteClient } from '@/utils/SqliteClient';
import { BoolResponse as messageBoolResponse } from '@/utils/types/messaging/BoolResponse';
import { CredentialsResponse as messageCredentialsResponse } from '@/utils/types/messaging/CredentialsResponse';
import { IdentitySettingsResponse } from '@/utils/types/messaging/IdentitySettingsResponse';
import { PasswordSettingsResponse as messagePasswordSettingsResponse } from '@/utils/types/messaging/PasswordSettingsResponse';
import { StoreVaultRequest } from '@/utils/types/messaging/StoreVaultRequest';
import { StringResponse as stringResponse } from '@/utils/types/messaging/StringResponse';
import { VaultResponse as messageVaultResponse } from '@/utils/types/messaging/VaultResponse';
import { VaultUploadResponse as messageVaultUploadResponse } from '@/utils/types/messaging/VaultUploadResponse';
import { WebApiService } from '@/utils/WebApiService';

import { t } from '@/i18n/StandaloneI18n';

/**
 * Check if the user is logged in and if the vault is locked, and also check for pending migrations.
 */
export async function handleCheckAuthStatus() : Promise<{ isLoggedIn: boolean, isVaultLocked: boolean, hasPendingMigrations: boolean, error?: string }> {
  const username = await storage.getItem('local:username');
  const accessToken = await storage.getItem('local:accessToken');
  const vaultData = await storage.getItem('session:encryptedVault');

  const isLoggedIn = username !== null && accessToken !== null;
  const isVaultLocked = isLoggedIn && vaultData === null;

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
    console.error('Error checking pending migrations:', error);

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
 * Store the vault in browser storage.
 */
export async function handleStoreVault(
  message: any,
) : Promise<messageBoolResponse> {
  try {
    const vaultRequest = message as StoreVaultRequest;

    // Store new encrypted vault in session storage.
    await storage.setItem('session:encryptedVault', vaultRequest.vaultBlob);

    /*
     * For all other values, check if they have a value and store them in session storage if they do.
     * Some updates, e.g. when mutating local database, these values will not be set.
     */

    if (vaultRequest.publicEmailDomainList) {
      await storage.setItem('session:publicEmailDomains', vaultRequest.publicEmailDomainList);
    }

    if (vaultRequest.privateEmailDomainList) {
      await storage.setItem('session:privateEmailDomains', vaultRequest.privateEmailDomainList);
    }

    if (vaultRequest.vaultRevisionNumber) {
      await storage.setItem('session:vaultRevisionNumber', vaultRequest.vaultRevisionNumber);
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to store vault:', error);
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
    return { success: false, error: await t('common.errors.failedToStoreEncryptionKey') };
  }
}

/**
 * Store the encryption key derivation parameters in browser storage.
 */
export async function handleStoreEncryptionKeyDerivationParams(
  params: EncryptionKeyDerivationParams,
) : Promise<messageBoolResponse> {
  try {
    await storage.setItem('session:encryptionKeyDerivationParams', params);
    return { success: true };
  } catch (error) {
    console.error('Failed to store encryption key derivation params:', error);
    return { success: false, error: await t('common.errors.failedToStoreEncryptionParams') };
  }
}

/**
 * Sync the vault with the server to check if a newer vault is available. If so, the vault will be updated.
 */
export async function handleSyncVault(
) : Promise<messageBoolResponse> {
  const webApi = new WebApiService(() => {});
  const statusResponse = await webApi.getStatus();
  const statusError = webApi.validateStatusResponse(statusResponse);
  if (statusError !== null) {
    return { success: false, error: await t('common.errors.' + statusError) };
  }

  const vaultRevisionNumber = await storage.getItem('session:vaultRevisionNumber') as number;

  if (statusResponse.vaultRevision > vaultRevisionNumber) {
    // Retrieve the latest vault from the server.
    const vaultResponse = await webApi.get<VaultResponse>('Vault');

    await storage.setItems([
      { key: 'session:encryptedVault', value: vaultResponse.vault.blob },
      { key: 'session:publicEmailDomains', value: vaultResponse.vault.publicEmailDomainList },
      { key: 'session:privateEmailDomains', value: vaultResponse.vault.privateEmailDomainList },
      { key: 'session:vaultRevisionNumber', value: vaultResponse.vault.currentRevisionNumber }
    ]);
  }

  return { success: true };
}

/**
 * Get the vault from browser storage.
 */
export async function handleGetVault(
) : Promise<messageVaultResponse> {
  try {
    const encryptionKey = await handleGetEncryptionKey();

    const encryptedVault = await storage.getItem('session:encryptedVault') as string;
    const publicEmailDomains = await storage.getItem('session:publicEmailDomains') as string[];
    const privateEmailDomains = await storage.getItem('session:privateEmailDomains') as string[];
    const vaultRevisionNumber = await storage.getItem('session:vaultRevisionNumber') as number;

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
      vaultRevisionNumber: vaultRevisionNumber ?? 0
    };
  } catch (error) {
    console.error('Failed to get vault:', error);
    return { success: false, error: await t('common.errors.failedToRetrieveData') };
  }
}

/**
 * Clear the vault from browser storage.
 */
export function handleClearVault(
) : messageBoolResponse {
  storage.removeItems([
    'session:encryptedVault',
    'session:encryptionKey',
    // TODO: the derivedKey clear can be removed some period of time after 0.22.0 is released.
    'session:derivedKey',
    'session:encryptionKeyDerivationParams',
    'session:publicEmailDomains',
    'session:privateEmailDomains',
    'session:vaultRevisionNumber'
  ]);

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
    return { success: false, error: await t('common.errors.failedToRetrieveData') };
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

  // Get metadata from storage
  const privateEmailDomains = await storage.getItem('session:privateEmailDomains') as string[];

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
      const privateEmailDomains = await storage.getItem('session:privateEmailDomains') as string[];
      const publicEmailDomains = await storage.getItem('session:publicEmailDomains') as string[];

      const sqliteClient = await createVaultSqliteClient();
      const defaultEmailDomain = sqliteClient.getDefaultEmailDomain(privateEmailDomains, publicEmailDomains);

      return { success: true, value: defaultEmailDomain ?? undefined };
    } catch (error) {
      console.error('Error getting default email domain:', error);
      return { success: false, error: await t('common.errors.failedToRetrieveData') };
    }
  })();
}

/**
 * Get the default identity settings.
 */
export async function handleGetDefaultIdentitySettings(
) : Promise<IdentitySettingsResponse> {
  try {
    const sqliteClient = await createVaultSqliteClient();
    const language = sqliteClient.getDefaultIdentityLanguage();
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
    return { success: false, error: await t('common.errors.failedToRetrieveData') };
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
    return { success: false, error: await t('common.errors.failedToRetrieveData') };
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
 */
export async function handleGetEncryptionKeyDerivationParams(
) : Promise<EncryptionKeyDerivationParams | null> {
  const params = await storage.getItem('session:encryptionKeyDerivationParams') as EncryptionKeyDerivationParams | null;
  return params;
}

/**
 * Upload the vault to the server.
 */
export async function handleUploadVault(
  message: any
) : Promise<messageVaultUploadResponse> {
  try {
    // Store the new vault blob in session storage.
    await storage.setItem('session:encryptedVault', message.vaultBlob);

    // Create new sqlite client which will use the new vault blob.
    const sqliteClient = await createVaultSqliteClient();

    // Upload the new vault to the server.
    const response = await uploadNewVaultToServer(sqliteClient);
    return { success: true, status: response.status, newRevisionNumber: response.newRevisionNumber };
  } catch (error) {
    console.error('Failed to upload vault:', error);
    return { success: false, error: await t('common.errors.failedToUploadVault') };
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

  await storage.setItems([
    { key: 'session:encryptedVault', value: encryptedVault }
  ]);

  // Get metadata from storage
  const vaultRevisionNumber = await storage.getItem('session:vaultRevisionNumber') as number;

  // Upload new encrypted vault to server.
  const username = await storage.getItem('local:username') as string;
  const emailAddresses = await getEmailAddressesForVault(sqliteClient);

  const newVault: Vault = {
    blob: encryptedVault,
    createdAt: new Date().toISOString(),
    credentialsCount: sqliteClient.getAllCredentials().length,
    currentRevisionNumber: vaultRevisionNumber,
    emailAddressList: emailAddresses,
    privateEmailDomainList: [], // Empty on purpose, API will not use this for vault updates.
    publicEmailDomainList: [], // Empty on purpose, API will not use this for vault updates.
    encryptionPublicKey: '', // Empty on purpose, only required if new public/private key pair is generated.
    client: '', // Empty on purpose, API will not use this for vault updates.
    updatedAt: new Date().toISOString(),
    username: username,
    version: (await sqliteClient.getDatabaseVersion()).version
  };

  const webApi = new WebApiService(() => {});
  const response = await webApi.post<Vault, VaultPostResponse>('Vault', newVault);

  // Check if response is successful (.status === 0)
  if (response.status === 0) {
    await storage.setItem('session:vaultRevisionNumber', response.newRevisionNumber);
  } else {
    throw new Error(await t('common.errors.failedToUploadVault'));
  }

  return response;
}

/**
 * Create a new sqlite client for the stored vault.
 */
async function createVaultSqliteClient() : Promise<SqliteClient> {
  const encryptedVault = await storage.getItem('session:encryptedVault') as string;
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptedVault || !encryptionKey) {
    throw new Error(await t('common.errors.unknownError'));
  }

  // Decrypt the vault.
  const decryptedVault = await EncryptionUtility.symmetricDecrypt(
    encryptedVault,
    encryptionKey
  );

  // Initialize the SQLite client with the decrypted vault.
  const sqliteClient = new SqliteClient();
  await sqliteClient.initializeFromBase64(decryptedVault);

  return sqliteClient;
}
