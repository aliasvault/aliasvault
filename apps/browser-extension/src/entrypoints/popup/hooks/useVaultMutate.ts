import { useCallback, useRef, useState } from 'react';
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
  const mergeOccurredRef = useRef(false);

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

    setSyncStatus(t('common.encryptingVault'));

    // Encrypt vault locally before sending to background
    const vaultJson = dbContext.vaultStore!.toJson();
    const encryptionKey = await sendMessage('GET_ENCRYPTION_KEY', {}, 'background') as string;
    const encryptedVaultBlob = await EncryptionUtility.symmetricEncrypt(
      vaultJson,
      encryptionKey
    );

    const request: UploadVaultRequest = {
      vaultBlob: encryptedVaultBlob,
    };

    // Background handler does IPFS upload + contract update atomically
    setSyncStatus(t('common.syncingToBlockchain'));

    const response = await sendMessage('UPLOAD_VAULT', request, 'background') as messageVaultUploadResponse;

    if (response.success) {
      if (response.merged && response.mergeSummary) {
        setSyncStatus(t('common.vaultMerged', {
          added: response.mergeSummary.added,
          updated: response.mergeSummary.updated,
          deleted: response.mergeSummary.deleted,
        }));
        mergeOccurredRef.current = true;
      } else {
        setSyncStatus(t('common.vaultSynced'));
      }
      options.onSuccess?.();
    } else {
      throw new Error(response.error ?? t('common.errors.unknownError'));
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
      options.onError?.(error instanceof Error ? error : new Error(t('common.errors.unknownError')));
    } finally {
      if (mergeOccurredRef.current) {
        // Hold merge notification visible for 3 seconds so user can read it
        await new Promise(resolve => setTimeout(resolve, 3000));
        mergeOccurredRef.current = false;
      }
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