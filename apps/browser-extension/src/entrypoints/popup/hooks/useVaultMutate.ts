import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sendMessage } from 'webext-bridge/popup';

import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useVaultSync } from '@/entrypoints/popup/hooks/useVaultSync';

import { EncryptionUtility } from '@/utils/EncryptionUtility';
import { UploadVaultRequest } from '@/utils/types/messaging/UploadVaultRequest';
import { VaultUploadResponse as messageVaultUploadResponse } from '@/utils/types/messaging/VaultUploadResponse';

type VaultMutationOptions = {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  skipSyncCheck?: boolean;
}

/**
 * Hook to execute a vault mutation.
 */
export function useVaultMutate() : {
  executeVaultMutation: (operation: () => Promise<void>, options?: VaultMutationOptions) => Promise<void>;
  isLoading: boolean;
  syncStatus: string;
  } {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState(t('common.syncingVault'));
  const dbContext = useDb();
  const { syncVault } = useVaultSync();

  /**
   * Execute the provided operation (e.g. create/update/delete credential)
   */
  const executeMutateOperation = useCallback(async (
    operation: () => Promise<void>,
    options: VaultMutationOptions
  ) : Promise<void> => {
    setSyncStatus(t('common.savingChangesToVault'));

    // Execute the provided operation (e.g. create/update/delete credential)
    await operation();

    setSyncStatus(t('common.uploadingVaultToServer'));

    try {
      // Upload the updated vault to the server.
      const base64Vault = dbContext.sqliteClient!.exportToBase64();

      // Get encryption key from background worker
      const encryptionKey = await sendMessage('GET_ENCRYPTION_KEY', {}, 'background') as string;

      // Encrypt the vault.
      const encryptedVaultBlob = await EncryptionUtility.symmetricEncrypt(
        base64Vault,
        encryptionKey
      );

      const request: UploadVaultRequest = {
        vaultBlob: encryptedVaultBlob,
      };

      const response = await sendMessage('UPLOAD_VAULT', request, 'background') as messageVaultUploadResponse;

      /*
       * If we get here, it means we have a valid connection to the server.
       * TODO: offline mode is not implemented for browser extension yet.
       * authContext.setOfflineMode(false);
       */

      if (response.status === 0 && response.newRevisionNumber) {
        await dbContext.setCurrentVaultRevisionNumber(response.newRevisionNumber);
        options.onSuccess?.();
      } else if (response.status === 1) {
        // Note: vault merge is no longer allowed by the API as of 0.20.0, updates with the same revision number are rejected. So this check can be removed later.
        throw new Error('Vault merge required. Please login via the web app to merge the multiple pending updates to your vault.');
      } else if (response.status === 2) {
        throw new Error('Your vault is outdated. Please login on the AliasVault website and follow the steps.');
      } else {
        throw new Error('Failed to upload vault to server. Please try again by re-opening the app.');
      }
    } catch (error) {
      // Check if it's a network error
      if (error instanceof Error && (error.message.includes('network') || error.message.includes('timeout'))) {
        /*
         * Network error, mark as offline and track pending changes
         * TODO: offline mode is not implemented for browser extension yet.
         * authContext.setOfflineMode(true);
         */
        options.onError?.(new Error('Network error'));
        return;
      }
      throw error;
    }
  }, [dbContext, t]);

  /**
   * Hook to execute a vault mutation which uploads a new encrypted vault to the server
   */
  const executeVaultMutation = useCallback(async (
    operation: () => Promise<void>,
    options: VaultMutationOptions = {}
  ) => {
    try {
      setIsLoading(true);
      setSyncStatus(t('common.checkingVaultUpdates'));

      // Skip sync check if requested (e.g., during upgrade operations)
      if (options.skipSyncCheck) {
        setSyncStatus(t('common.executingOperation'));
        await executeMutateOperation(operation, options);
        return;
      }

      await syncVault({
        /**
         * Handle the status update.
         */
        onStatus: (message) => setSyncStatus(message),
        /**
         * Handle successful vault sync and continue with vault mutation.
         */
        onSuccess: async (hasNewVault) => {
          if (hasNewVault) {
            // Vault was changed, but has now been reloaded so we can continue with the operation.
          }
          await executeMutateOperation(operation, options);
        },
        /**
         * Handle error during vault sync.
         */
        onError: (error) => {
          options.onError?.(new Error(error));
        }
      });
    } catch (error) {
      console.error('Error during vault mutation:', error);
      options.onError?.(error instanceof Error ? error : new Error('Unknown error'));
    } finally {
      setIsLoading(false);
      setSyncStatus('');
    }
  }, [syncVault, executeMutateOperation, t]);

  return {
    executeVaultMutation,
    isLoading,
    syncStatus,
  };
}