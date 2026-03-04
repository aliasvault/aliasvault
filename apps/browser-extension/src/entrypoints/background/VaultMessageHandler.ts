/* eslint-disable @typescript-eslint/no-explicit-any */
import { storage } from 'wxt/utils/storage';

import type { EncryptionKeyDerivationParams } from '@/utils/dist/shared/models/metadata';
import type { VaultResponse } from '@/utils/dist/shared/models/webapi';
import { VaultCidStore } from '@/services/VaultCidStore';
import { PinataBrowserProvider } from '@/services/PinataBrowserProvider';
import { MidnightContractService } from '@/services/MidnightContractService';
import { BrowserVaultSyncProvider } from '@/services/BrowserVaultSyncProvider';
import { VaultSyncService, VaultSyncError, VaultSyncErrorCodes, base64ToUint8Array, uint8ArrayToBase64, hexToUint8Array } from '@/utils/dist/shared/vault-sync';
import { BrowserVaultLoadProvider } from '@/services/BrowserVaultLoadProvider';
import type { VaultLoadResponse } from '@/utils/types/messaging/VaultLoadResponse';
import { EncryptionUtility } from '@/utils/EncryptionUtility';
import { VaultStore } from '@/utils/dist/shared/vault-types';
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
 * Cache for the VaultStore to avoid repeated decryption and initialization.
 * The cached instance is the single source of truth for the in-memory vault.
 *
 * Cache Strategy:
 * - Local mutations (createCredential, etc.): Work directly on cachedVaultStore, no cache clearing
 * - New vault from remote (login, sync): Clear cache by setting both to null
 * - Logout/clear vault: Clear cache by setting both to null
 *
 * The cache is cleared by setting cachedVaultStore and cachedVaultBlob to null directly
 * in the functions that receive new vault data from external sources.
 */
let cachedVaultStore: VaultStore | null = null;
let cachedVaultBlob: string | null = null;

/**
 * Check if the user is logged in and if the vault is locked.
 */
export async function handleCheckAuthStatus() : Promise<{ isLoggedIn: boolean, isVaultLocked: boolean, hasPendingMigrations: boolean, error?: string }> {
  const username = await storage.getItem('local:username');
  const accessToken = await storage.getItem('local:accessToken');
  const vaultData = await storage.getItem('session:encryptedVault');
  const encryptionKey = await handleGetEncryptionKey();

  const isLoggedIn = username !== null && accessToken !== null;
  const isVaultLocked = isLoggedIn && (vaultData === null || encryptionKey === null);

  return {
    isLoggedIn,
    isVaultLocked,
    hasPendingMigrations: false
  };
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

    // Clear cached client since we received a new vault blob from external source
    cachedVaultStore = null;
    cachedVaultBlob = null;

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

    if (vaultRequest.hiddenPrivateEmailDomainList) {
      await storage.setItem('session:hiddenPrivateEmailDomains', vaultRequest.hiddenPrivateEmailDomainList);
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
    return { success: false, error: await t('common.errors.unknownErrorTryAgain') };
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
    return { success: false, error: await t('common.errors.unknownErrorTryAgain') };
  }
}

/**
 * Sync the vault with the server to check if a newer vault is available. If so, the vault will be updated.
 * @deprecated No active callers — replaced by handleLoadVaultFromBlockchain(). Kept for safety.
 */
export async function handleSyncVault(
) : Promise<messageBoolResponse> {
  const webApi = new WebApiService();
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
      { key: 'session:hiddenPrivateEmailDomains', value: vaultResponse.vault.hiddenPrivateEmailDomainList },
      { key: 'session:vaultRevisionNumber', value: vaultResponse.vault.currentRevisionNumber }
    ]);

    // Clear cached client since we received a new vault blob from server
    cachedVaultStore = null;
    cachedVaultBlob = null;
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
    const hiddenPrivateEmailDomains = await storage.getItem('session:hiddenPrivateEmailDomains') as string[] ?? [];
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
      hiddenPrivateEmailDomains: hiddenPrivateEmailDomains ?? [],
      vaultRevisionNumber: vaultRevisionNumber ?? 0
    };
  } catch (error) {
    console.error('Failed to get vault:', error);
    return { success: false, error: await t('common.errors.unknownError') };
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
    'session:hiddenPrivateEmailDomains',
    'session:vaultRevisionNumber'
  ]);

  // Clear blockchain-related CID and secret key cache on logout.
  VaultCidStore.clear();

  // Clear cached client and contract service since vault was cleared.
  // Contract service must be re-joined with the new secretKey on next login.
  cachedVaultStore = null;
  cachedVaultBlob = null;
  cachedContractService = null;

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
    const vaultStore = await createVaultStore();
    const credentials = vaultStore.getAllCredentials();
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
    const vaultStore = await createVaultStore();
    const allCredentials = vaultStore.getAllCredentials();

    const { filterCredentials, AutofillMatchingMode } = await import('@/utils/credentialMatcher/CredentialMatcher');

    // Parse matching mode from string
    let matchingMode = AutofillMatchingMode.DEFAULT;
    if (message.matchingMode) {
      matchingMode = message.matchingMode as typeof AutofillMatchingMode[keyof typeof AutofillMatchingMode];
    }

    // Filter credentials in background to reduce payload size (~95% reduction)
    const filteredCredentials = filterCredentials(
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
    const vaultStore = await createVaultStore();
    const allCredentials = vaultStore.getAllCredentials();

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
    const vaultStore = await createVaultStore();

    // Add the new credential to the vault.
    await vaultStore.createCredential(message.credential, message.attachments || []);

    // Encrypt and upload via blockchain (same pattern as handleUploadVault)
    const vaultJson = vaultStore.toJson();
    const encryptedVault = await EncryptionUtility.symmetricEncrypt(vaultJson, encryptionKey);
    await storage.setItems([{ key: 'session:encryptedVault', value: encryptedVault }]);
    cachedVaultBlob = encryptedVault;

    await handleUploadVaultToBlockchain(encryptedVault);

    return { success: true };
  } catch (error) {
    console.error('Failed to create identity:', error);
    const errorMessage = error instanceof Error ? error.message : await t('common.errors.unknownError');
    return { success: false, error: errorMessage };
  }
}

/**
 * Get the email addresses for a vault.
 */
export async function getEmailAddressesForVault(
  vaultStore: VaultStore
): Promise<string[]> {
  // TODO: create separate query to only get email addresses to avoid loading all credentials.
  const credentials = vaultStore.getAllCredentials();

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
      const vaultStore = await createVaultStore();
      const defaultEmailDomain = await vaultStore.getDefaultEmailDomain();

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
    const vaultStore = await createVaultStore();
    const language = await vaultStore.getEffectiveIdentityLanguage();
    const gender = vaultStore.getDefaultIdentityGender();

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
    const vaultStore = await createVaultStore();
    const passwordSettings = vaultStore.getPasswordSettings();

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
    // Persist the current updated vault blob in session storage.
    await storage.setItem('session:encryptedVault', message.vaultBlob);

    // Upload to blockchain (IPFS + contract).
    const result = await handleUploadVaultToBlockchain(message.vaultBlob);
    return { success: true, status: 0, cid: result.cid, cidHash: result.cidHash };
  } catch (error) {
    console.error('Failed to upload vault:', error);
    // M2: Use structured VaultSyncError.retryable instead of string matching
    const syncError = error instanceof VaultSyncError ? error : null;
    const errorMessage = error instanceof Error ? error.message : await t('common.errors.unknownError');
    return {
      success: false,
      error: errorMessage,
      retryable: syncError?.retryable ?? false,
    };
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

// M4: Module-level cached MidnightContractService — join once, reuse across saves.
let cachedContractService: MidnightContractService | null = null;

/**
 * Create and validate PinataBrowserProvider from env credentials.
 * Shared by both save and load handlers (M1: single factory).
 * TODO: Move Pinata credentials to secure storage (future story)
 */
function createPinataProvider(): PinataBrowserProvider {
  const pinataJwt = import.meta.env.VITE_PINATA_JWT || '';
  const pinataGateway = import.meta.env.VITE_PINATA_GATEWAY || '';

  if (!pinataJwt || !pinataGateway) {
    throw new Error('Pinata credentials not configured. Set VITE_PINATA_JWT and VITE_PINATA_GATEWAY in .env');
  }

  return new PinataBrowserProvider({ pinataJwt, pinataGateway });
}

async function handleUploadVaultToBlockchain(
  encryptedVaultBase64: string,
): Promise<{ cid: string; cidHash: string }> {
  // Convert encrypted vault from base64 to Uint8Array for IPFS upload
  const encryptedBytes = base64ToUint8Array(encryptedVaultBase64);

  const pinataProvider = createPinataProvider();

  // Ensure contract service is joined (M4: cached, join once)
  if (!cachedContractService || !cachedContractService.isJoined()) {
    const secretKeyHex = await VaultCidStore.getSecretKey();
    if (!secretKeyHex) {
      throw new Error('Midnight secret key not available. Register vault first.');
    }
    cachedContractService = new MidnightContractService();
    await cachedContractService.joinVaultRegistry(hexToUint8Array(secretKeyHex));
  }

  // Use VaultSyncService with BrowserVaultSyncProvider (H1: shared business logic)
  const provider = new BrowserVaultSyncProvider(pinataProvider, cachedContractService);
  const syncService = new VaultSyncService(provider);
  return await syncService.saveVault(encryptedBytes);
}

/**
 * Load the latest vault from IPFS via blockchain CID hash verification.
 * Uses shared VaultSyncService (ADR-003) with BrowserVaultLoadProvider.
 *
 * Flow: readVaultCidHash → compare local → download from IPFS → return encrypted blob
 * Returns VaultLoadResponse for the popup to decrypt and load.
 */
export async function handleLoadVaultFromBlockchain(): Promise<VaultLoadResponse> {
  try {
    const pinataProvider = createPinataProvider();

    // Reuse cached contract service (same as save flow — M4: join once)
    if (!cachedContractService) {
      cachedContractService = new MidnightContractService();
    }

    const loadProvider = new BrowserVaultLoadProvider(pinataProvider, cachedContractService);

    // M3: loadVault() doesn't need a save provider — constructor is optional
    const syncService = new VaultSyncService();

    const result = await syncService.loadVault(loadProvider);

    if (result === null) {
      // Vault is up to date — no download needed
      return { success: true, upToDate: true };
    }

    // Convert encrypted bytes to base64 for message passing
    const encryptedBlob = uint8ArrayToBase64(result.encryptedBytes);

    return {
      success: true,
      upToDate: false,
      encryptedBlob,
      cid: result.cid,
      cidHash: result.cidHash,
    };
  } catch (error) {
    console.error('Failed to load vault from blockchain:', error);

    const syncError = error instanceof VaultSyncError ? error : null;

    // Check for "not registered" case (new user)
    if (syncError?.code === VaultSyncErrorCodes.VAULT_NOT_FOUND) {
      return { success: true, notRegistered: true };
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error loading vault';
    return {
      success: false,
      error: errorMessage,
      retryable: syncError?.retryable ?? false,
    };
  }
}

/**
 * Create a VaultStore for the stored vault.
 * Uses a cache to avoid repeated decryption and deserialization for read operations.
 */
async function createVaultStore() : Promise<VaultStore> {
  const encryptedVault = await storage.getItem('session:encryptedVault') as string;
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptedVault || !encryptionKey) {
    throw new Error(await t('common.errors.unknownError'));
  }

  // Check if we have a valid cached store
  if (cachedVaultStore && cachedVaultBlob === encryptedVault) {
    return cachedVaultStore;
  }

  // Decrypt the vault
  const decryptedJson = await EncryptionUtility.symmetricDecrypt(
    encryptedVault,
    encryptionKey
  );

  // Initialize the VaultStore from decrypted JSON
  const vaultStore = VaultStore.fromJson(decryptedJson);

  // Cache the store and vault blob
  cachedVaultStore = vaultStore;
  cachedVaultBlob = encryptedVault;

  return vaultStore;
}
