import { useCallback, useRef } from 'react';
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
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
   * Start polling to detect when background sync completes.
   * Polls isDirty flag AND background sync state every 500ms.
   * Only clears indicator when vault is clean AND background has no sync in progress.
   */
  const startPollingForCompletion = useCallback((): void => {
    /* Clear any existing poll interval */
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    console.info('[VaultMutate] Starting to poll for sync completion');

    pollIntervalRef.current = setInterval(async () => {
      try {
        /*
         * Get sync state from background - includes both isDirty flag
         * and isSyncInProgress status from the background script
         */
        const syncState = await sendMessage('GET_SYNC_STATE', {}, 'background') as {
          isDirty: boolean;
          isSyncInProgress: boolean;
          mutationSequence: number;
          serverRevision: number;
        };

        /*
         * Only clear uploading indicator when:
         * 1. Vault is not dirty (no pending changes)
         * 2. Background has no sync in progress (no queued syncs running)
         *
         * This prevents clearing the indicator between queued syncs.
         */
        if (!syncState.isDirty && !syncState.isSyncInProgress) {
          console.info('[VaultMutate] Sync completed (isDirty=false, isSyncInProgress=false), clearing uploading indicator');
          dbContext.setIsUploading(false);
          dbContext.setIsSyncing(false);

          /* Refresh React state to match storage */
          await dbContext.refreshSyncState();

          /* Stop polling */
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
      } catch (error) {
        console.error('[VaultMutate] Error polling sync state:', error);
      }
    }, 500); /* Poll every 500ms */
  }, [dbContext]);

  /**
   * Trigger a sync in the background script.
   * This is fire-and-forget - the sync runs entirely in the background context
   * and continues even if the popup closes.
   *
   * Always polls to detect completion since background sync may queue additional
   * syncs that we cannot directly observe from the popup context.
   */
  const triggerBackgroundSync = useCallback((): void => {
    dbContext.setIsUploading(true);

    /*
     * Fire-and-forget: send message to background without awaiting.
     * The background script will handle the full sync orchestration
     * and will re-sync if mutations happened during the sync.
     *
     * After sending message, we start polling to detect completion.
     */
    void sendMessage('FULL_VAULT_SYNC', {}, 'background').then(async (result) => {
      const syncResult = result as FullVaultSyncResult;
      if (!syncResult.success && (syncResult.error || syncResult.errorKey)) {
        /*
         * Permanent failure (e.g. HTTP 413 vault too large). Stop polling and clear the upload
         * spinner.
         */
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        dbContext.setIsUploading(false);
        return;
      }
      if (syncResult.hasNewVault) {
        await dbContext.loadStoredDatabase();
      }
    }).catch((error) => {
      console.error('Background sync error:', error);
    });

    // Start polling for completion
    startPollingForCompletion();
  }, [dbContext, startPollingForCompletion]);

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
