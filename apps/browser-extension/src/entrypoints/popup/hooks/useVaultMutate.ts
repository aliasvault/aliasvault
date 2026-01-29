import { useCallback, useRef } from 'react';
import { sendMessage } from 'webext-bridge/popup';

import { useDb } from '@/entrypoints/popup/context/DbContext';

import { EncryptionUtility } from '@/utils/EncryptionUtility';

import { useVaultSync } from './useVaultSync';

/**
 * Hook to execute a vault mutation.
 *
 * Flow:
 * 1. Execute the mutation on local database
 * 2. Save encrypted vault locally and mark as dirty (increments mutation sequence)
 * 3. Trigger sync in background which handles: upload, merge if needed, offline mode
 *
 * The mutation sequence is used for race detection:
 * - Each mutation increments the sequence
 * - Sync captures sequence at start, only clears dirty if sequence unchanged
 * - This ensures we never lose local changes during concurrent operations
 */
export function useVaultMutate(): {
    executeVaultMutationAsync: (operation: () => Promise<void>) => Promise<void>;
    } {
  const dbContext = useDb();
  const { syncVault } = useVaultSync();

  // Track if a sync is currently in progress
  const isSyncingRef = useRef(false);

  /**
   * Execute the provided operation and save locally.
   * Atomically increments mutation sequence and marks dirty.
   */
  const saveLocally = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    // Execute the provided operation (e.g. create/update/delete credential)
    await operation();

    // Export and encrypt the updated vault
    const base64Vault = dbContext.sqliteClient!.exportToBase64();
    const encryptionKey = await sendMessage('GET_ENCRYPTION_KEY', {}, 'background') as string;
    const encryptedVaultBlob = await EncryptionUtility.symmetricEncrypt(
      base64Vault,
      encryptionKey
    );

    // Store the updated vault locally, mark dirty, increment mutation sequence
    await sendMessage('STORE_ENCRYPTED_VAULT', {
      vaultBlob: encryptedVaultBlob,
      markDirty: true
    }, 'background');

    // Refresh the sync state in React
    await dbContext.refreshSyncState();
  }, [dbContext]);

  /**
   * Trigger a sync cycle. If sync is already in progress, it will be queued.
   * After sync completes, checks if more mutations happened and re-syncs if needed.
   */
  const triggerSync = useCallback(async (): Promise<void> => {
    if (isSyncingRef.current) {
      // Sync already in progress - it will re-sync if dirty when done
      return;
    }

    isSyncingRef.current = true;

    try {
      await syncVault({
        /**
         * Handle successful sync completion.
         */
        onSuccess: async () => {
          await dbContext.refreshSyncState();

          // Skip re-sync if offline - vault stays dirty until server is reachable
          if (!dbContext.getIsOffline()) {
            const syncState = await sendMessage('GET_SYNC_STATE', {}, 'background') as { isDirty: boolean };
            if (syncState.isDirty) {
              isSyncingRef.current = false;
              await triggerSync();
            }
          }
        },
        /**
         * Offline mode - no re-sync needed, vault stays dirty until online.
         */
        onOffline: () => {},
        /**
         * Handle sync errors.
         * @param error - Error message from sync
         */
        onError: (error) => {
          console.error('Background sync error:', error);
        }
      });
    } catch (error) {
      console.error('Error during background sync:', error);
    } finally {
      isSyncingRef.current = false;
    }
  }, [dbContext, syncVault]);

  /**
   * Execute a vault mutation asynchronously: save locally immediately, then
   * trigger sync in background. This doesn't block the UI.
   */
  const executeVaultMutationAsync = useCallback(async (
    operation: () => Promise<void>
  ): Promise<void> => {
    // 1. Execute mutation and save locally (fast, doesn't block)
    await saveLocally(operation);

    // 2. Trigger sync in background
    void triggerSync();
  }, [saveLocally, triggerSync]);

  return {
    executeVaultMutationAsync,
  };
}
