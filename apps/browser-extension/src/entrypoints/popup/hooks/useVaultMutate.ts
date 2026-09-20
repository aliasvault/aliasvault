import { encryptVaultBlob } from '@aliasvault/client/crypto/VaultBlob';
import { hasUserVisibleScope, type VaultMutationScope } from '@aliasvault/client/sync/VaultMutationScope';
import { hasSyncError } from '@aliasvault/client/sync/VaultSync';
import { useCallback, useRef } from 'react';

import { useDb } from '@/entrypoints/popup/context/DbContext';

import { devLog } from '@/utils/devLogger/DevLogger';
import { logFailure } from '@/utils/Diagnostics';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';

/** How many unanswered sync-state polls in a row before the poll gives up on the background context. */
const MAX_POLL_FAILURES = 10;

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
   * @returns The scopes the operation wrote into
   */
  const saveLocally = useCallback(async (operation: () => Promise<void>): Promise<VaultMutationScope[]> => {
    // Execute the provided operation (e.g. create/update/delete credential)
    await operation();

    /*
     * Take what the operation wrote into, as recorded by the repositories it ran through. A mutation that
     * only touched a bucket-scoped repository (e.g. 'Settings') lets the background sync push just that data
     * bucket instead of the full vault manifest.
     */
    const scopes = dbContext.sqliteClient!.takeMutationScopes();

    try {
      // Export and encrypt the updated vault
      const encryptionKey = await sendMessage('GET_ENCRYPTION_KEY') as string;
      const encryptedVaultBlob = await encryptVaultBlob(dbContext.sqliteClient!.exportToBytes(), encryptionKey);

      // Store the updated vault locally, mark dirty, increment mutation sequence.
      await sendMessage('STORE_ENCRYPTED_VAULT', {
        vaultBlob: encryptedVaultBlob,
        markDirty: true,
        scopes
      });
    } catch (error) {
      /*
       * Storing failed, but the write itself is still in the local database and the next mutation that does
       * reach storage carries it along. Put the scopes back, or that mutation could store the change under a
       * bucket scope alone and a bucket-only push would leave it behind.
       */
      scopes.forEach(scope => dbContext.sqliteClient!.recordMutationScope(scope));
      throw error;
    }

    // Refresh the sync state in React
    await dbContext.refreshSyncState();
    return scopes;
  }, [dbContext]);

  /**
   * Start polling to detect when background sync completes.
   * Polls isDirty flag AND background sync state every 200ms.
   * Only clears indicator when vault is clean AND background has no sync in progress.
   */
  const startPollingForCompletion = useCallback((): void => {
    /* Clear any existing poll interval */
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    devLog('[VaultMutate] Starting to poll for sync completion');

    /** How many consecutive poll failures before giving up. */
    let consecutiveFailures = 0;

    pollIntervalRef.current = setInterval(async () => {
      try {
        /*
         * Get sync state from background - includes both isDirty flag
         * and isSyncInProgress status from the background script
         */
        const syncState = await sendMessage('GET_SYNC_STATE');
        consecutiveFailures = 0;

        /*
         * Only clear uploading indicator when:
         * 1. Vault is not dirty (no pending changes)
         * 2. Background has no sync in progress (no queued syncs running)
         *
         * This prevents clearing the indicator between queued syncs.
         */
        if (!syncState.isDirty && !syncState.isSyncInProgress) {
          devLog('[VaultMutate] Sync completed (isDirty=false, isSyncInProgress=false), clearing uploading indicator');
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
        consecutiveFailures++;
        if (consecutiveFailures === 1) {
          logFailure('[VaultMutate] Reading the sync state failed', error);
        }
        if (consecutiveFailures >= MAX_POLL_FAILURES && pollIntervalRef.current) {
          devLog('[VaultMutate] Giving up on the sync completion poll, the background is not answering');
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          dbContext.setIsUploading(false);
          dbContext.setIsSyncing(false);
        }
      }
    }, 200); /* Poll every 200ms */
  }, [dbContext]);

  /**
   * Trigger a sync in the background script.
   * This is fire-and-forget - the sync runs entirely in the background context
   * and continues even if the popup closes.
   *
   * Always polls to detect completion since background sync may queue additional
   * syncs that we cannot directly observe from the popup context. A mutation that
   * only wrote into silent scopes (e.g. item usage statistics) syncs the same way but
   * shows no indicator: the user did not ask for that write and expects no feedback on it.
   * @param scopes - what the mutation wrote into
   */
  const triggerBackgroundSync = useCallback((scopes: VaultMutationScope[]): void => {
    const silent = !hasUserVisibleScope(scopes);

    if (!silent) {
      dbContext.setIsUploading(true);
    }

    /*
     * Fire-and-forget: send message to background without awaiting.
     * The background script will handle the full sync orchestration
     * and will re-sync if mutations happened during the sync.
     *
     * After sending message, we start polling to detect completion.
     */
    void sendMessage('FULL_VAULT_SYNC', {}).then(async (syncResult) => {
      if (!silent && !syncResult.success && hasSyncError(syncResult)) {
        /*
         * Permanent failure (e.g. HTTP 413 vault too large). Stop polling and clear the upload
         * spinner. Skipped for a silent scope: it owns neither the poll nor the spinner, both of
         * which may belong to a visible mutation still in flight.
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
      logFailure('Background sync error', error);
    });

    // Start polling for completion (nothing to clear when no indicator was shown)
    if (!silent) {
      startPollingForCompletion();
    }
  }, [dbContext, startPollingForCompletion]);

  /**
   * Execute a vault mutation asynchronously: save locally immediately, then
   * trigger sync in background. This doesn't block the UI.
   * What the mutation touched follows from the repositories it wrote through, so a mutation that only writes
   * bucket-scoped data (e.g. through `settings`) syncs as a bucket push without saying so here.
   */
  const executeVaultMutationAsync = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    // 1. Execute mutation and save locally (fast, doesn't block)
    const scopes = await saveLocally(operation);

    // 2. Trigger sync in background (fire-and-forget, continues even if popup closes)
    triggerBackgroundSync(scopes);
  }, [saveLocally, triggerBackgroundSync]);

  return {
    executeVaultMutationAsync,
  };
}
