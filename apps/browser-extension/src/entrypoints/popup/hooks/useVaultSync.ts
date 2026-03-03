import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { sendMessage } from 'webext-bridge/popup';

import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';

import type { VaultLoadResponse } from '@/utils/types/messaging/VaultLoadResponse';


/**
 * Utility function to ensure a minimum time has elapsed for an operation
 */
const withMinimumDelay = async <T>(
  operation: () => Promise<T>,
  minDelayMs: number,
  enableDelay: boolean = true
): Promise<T> => {
  if (!enableDelay) {
    return operation();
  }

  const startTime = Date.now();
  const result = await operation();
  const elapsedTime = Date.now() - startTime;

  if (elapsedTime < minDelayMs) {
    await new Promise(resolve => setTimeout(resolve, minDelayMs - elapsedTime));
  }

  return result;
};

type VaultSyncOptions = {
  initialSync?: boolean;
  onSuccess?: (hasNewVault: boolean) => void;
  onError?: (error: string) => void;
  onStatus?: (message: string) => void;
}

/**
 * Hook to sync the vault with the blockchain (IPFS + Midnight).
 * Replaces the centralized .NET API vault sync with decentralized flow.
 *
 * Flow:
 * 1. sendMessage('LOAD_VAULT_FROM_BLOCKCHAIN') → background handler
 * 2. Background reads on-chain cidHash, compares with local, downloads from IPFS if needed
 * 3. If new vault: decrypt blob, initialize VaultStore, extract secretKey on first load (ADR-006)
 */
export const useVaultSync = () : {
  syncVault: (options?: VaultSyncOptions) => Promise<boolean>;
} => {
  const { t } = useTranslation();
  const app = useApp();
  const dbContext = useDb();

  const syncVault = useCallback(async (options: VaultSyncOptions = {}) => {
    const { initialSync = false, onSuccess, onError, onStatus } = options;

    // For the initial sync, we add an artificial delay to various steps which makes it feel more fluid.
    const enableDelay = initialSync;

    try {
      const isLoggedIn = await app.initializeAuth();

      if (!isLoggedIn) {
        return false;
      }

      // Step 1: Check on-chain vault state via background handler
      onStatus?.(t('common.checkingBlockchain'));
      const loadResponse = await withMinimumDelay(
        () => sendMessage('LOAD_VAULT_FROM_BLOCKCHAIN', {}, 'background') as Promise<VaultLoadResponse>,
        300,
        enableDelay,
      );

      if (!loadResponse.success) {
        onError?.(loadResponse.error ?? t('common.errors.unknownError'));
        return false;
      }

      // Handle "not registered" case (new user — no vault on-chain)
      if (loadResponse.notRegistered) {
        onStatus?.(t('common.noVaultFound'));
        onSuccess?.(false);
        return false;
      }

      // Handle "vault is up to date" case
      if (loadResponse.upToDate) {
        onStatus?.(t('common.vaultUpToDate'));

        await withMinimumDelay(() => Promise.resolve(onSuccess?.(false)), 300, enableDelay);
        return false;
      }

      // Step 2: New vault available — decrypt and load
      if (!loadResponse.encryptedBlob) {
        onError?.(t('common.errors.unknownError'));
        return false;
      }

      onStatus?.(t('common.decryptingVault'));

      try {
        // Get encryption key from background worker
        const encryptionKey = await sendMessage('GET_ENCRYPTION_KEY', {}, 'background') as string;
        const vaultStore = await withMinimumDelay(
          () => dbContext.initializeDatabaseFromBlob(loadResponse.encryptedBlob!, encryptionKey),
          1000,
          enableDelay,
        );

        // Extract secretKey from vault on first load (ADR-006).
        // The secretKey is stored in the vault settings and travels with the encrypted vault.
        // On a new device, we need to extract it and cache it locally for future saves.
        await dbContext.extractAndCacheSecretKey(vaultStore);

        onSuccess?.(true);
        return true;
      } catch (error) {
        throw new Error('Vault could not be decrypted, if the problem persists please logout and login again.');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error during vault sync';
      console.error('Vault sync error:', err);

      onError?.(errorMessage);
      return false;
    }
  }, [app, dbContext, t]);

  return { syncVault };
};