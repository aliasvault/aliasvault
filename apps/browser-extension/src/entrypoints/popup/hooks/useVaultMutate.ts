import { useCallback } from 'react';
import { sendMessage } from 'webext-bridge/popup';

import type { FullVaultSyncResult } from '@/entrypoints/background/VaultMessageHandler';
import { useDb } from '@/entrypoints/popup/context/DbContext';

import { EncryptionUtility } from '@/utils/EncryptionUtility';

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
 *
 * The sync is truly fire-and-forget: it runs in the background script and continues
 * even if the popup closes. This ensures vault changes are always synced to the server.
 */
export function useVaultMutate(): {
    executeVaultMutationAsync: (operation: () => Promise<void>) => Promise<void>;
    } {
  const dbContext = useDb();

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
   * Trigger a sync in the background script.
   * This is fire-and-forget - the sync runs entirely in the background context
   * and continues even if the popup closes.
   *
   * If a merge happened during sync (hasNewVault=true), reload the database
   * so the popup shows the merged data.
   */
  const triggerBackgroundSync = useCallback((): void => {
    dbContext.setIsUploading(true);

    /*
     * Fire-and-forget: send message to background without awaiting.
     * The background script will handle the full sync orchestration
     * and will re-sync if mutations happened during the sync.
     */
    sendMessage('FULL_VAULT_SYNC', {}, 'background').then(async (result: FullVaultSyncResult) => {
      // If a merge happened, reload the database to show merged data
      if (result.hasNewVault) {
        await dbContext.loadStoredDatabase();
      }
      // Refresh sync state if popup is still open
      await dbContext.refreshSyncState();
    }).catch((error) => {
      console.error('Background sync error:', error);
    }).finally(() => {
      dbContext.setIsUploading(false);
    });
  }, [dbContext]);

  /**
   * Execute a vault mutation asynchronously: save locally immediately, then
   * trigger sync in background. This doesn't block the UI.
   */
  const executeVaultMutationAsync = useCallback(async (
    operation: () => Promise<void>
  ): Promise<void> => {
    // 1. Execute mutation and save locally (fast, doesn't block)
    await saveLocally(operation);

    // 2. Trigger sync in background (fire-and-forget, continues even if popup closes)
    triggerBackgroundSync();
  }, [saveLocally, triggerBackgroundSync]);

  return {
    executeVaultMutationAsync,
  };
}
