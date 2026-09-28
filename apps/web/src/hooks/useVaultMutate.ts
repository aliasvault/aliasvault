import { encryptVaultBlob } from '@aliasvault/client/crypto/VaultBlob';
import { syncErrorMessage } from '@aliasvault/client/sync/SyncErrorMessage';
import { hasUserVisibleScope, type VaultMutationScope } from '@aliasvault/client/sync/VaultMutationScope';
import { hasSyncError, type FullVaultSyncResult } from '@aliasvault/client/sync/VaultSync';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';
import { useNotifications } from '@/context/NotificationContext';
import { devLog } from '@/utils/DevLogger';
import { vaultStore } from '@/vault/VaultStore';

/**
 * Server push failed.
 */
export class VaultPushFailedError extends Error {
  /**
   * Create the error.
   */
  public constructor() {
    super('The vault change could not be pushed to the server');
    this.name = 'VaultPushFailedError';
  }
}

/**
 * Whether a sync failed to bring the local changes to the server.
 */
const pushFailed = (result: FullVaultSyncResult): boolean => !result.success || result.wasOffline || result.requiresLogout || result.sqliteBlobUpgradeRequired || result.manifestMigrationRequired === true;

/**
 * Hook to execute a vault mutation.
 *
 * Flow:
 * 1. Execute the mutation on the in-memory database
 * 2. Save the encrypted vault locally and mark it dirty (bumps the mutation sequence)
 * 3. Sync, which handles upload, merge if needed; the sync drives the upload indicator
 *
 * The web app has no offline mode so a save the user asked for (executeVaultMutationAsync) blocks until the push is
 * done. Changes the user does not wait on (settings, usage stats) push in the background and stay stored locally for 
 * the next sync and error is indicated by the sync indicator icon in the top bar.
 */
export function useVaultMutate(): {
  executeVaultMutationAsync: (operation: () => Promise<void>) => Promise<void>;
  executeVaultMutationInBackground: (operation: () => Promise<void>) => Promise<void>;
  executeVaultMutationLocally: (operation: () => Promise<void>) => Promise<void>;
  } {
  const { t } = useTranslation();
  const auth = useAuth();
  const dbContext = useDb();
  const notifications = useNotifications();

  /**
   * Execute the operation and save the result locally, marking the vault dirty with the scopes it wrote into.
   * @returns The scopes the operation wrote into
   */
  const saveLocally = useCallback(async (operation: () => Promise<void>): Promise<VaultMutationScope[]> => {
    await operation();

    const sqliteClient = dbContext.sqliteClient;
    if (!sqliteClient) {
      throw new Error('Vault is locked');
    }
    const scopes = sqliteClient.takeMutationScopes();

    try {
      const encryptionKey = await vaultStore.getEncryptionKey();
      if (!encryptionKey) {
        throw new Error('Vault is locked');
      }
      const encryptedVaultBlob = await encryptVaultBlob(sqliteClient.exportToBytes(), encryptionKey);
      await vaultStore.storeEncryptedVault({ vaultBlob: encryptedVaultBlob, markDirty: true, scopes });
    } catch (error) {
      // The write is still in the local database, so put the scopes back for whichever store carries it next.
      scopes.forEach(scope => sqliteClient.recordMutationScope(scope));
      throw error;
    }
    return scopes;
  }, [dbContext]);

  /**
   * Sync the stored mutation to the server.
   * @param notifyFailure - whether a failure is reported to the user
   * @returns Whether the push succeeded
   */
  const pushMutation = useCallback(async (notifyFailure: boolean): Promise<boolean> => {
    let result: FullVaultSyncResult;
    try {
      result = await vaultStore.fullVaultSync({ waitForRunningSync: notifyFailure, reportErrorToPopup: notifyFailure });
    } catch (error) {
      console.error('[VaultMutate] Sync after mutation failed:', error);
      if (notifyFailure) {
        notifications.addErrorMessage(t('common.vaultSaveError'), true);
      }
      return false;
    }

    if (result.hasNewVault) {
      await dbContext.loadStoredDatabase();
    }
    if (!pushFailed(result)) {
      return true;
    }

    devLog('[VaultMutate] Sync after mutation did not push', result);
    if (result.requiresLogout) {
      await auth.logout({ errorMessage: syncErrorMessage(result, t) });
    } else if (notifyFailure && (result.wasOffline || !hasSyncError(result))) {
      // A sync error with details already shows in the sync error dialog (see VaultStore.fullVaultSync).
      notifications.addErrorMessage(t(result.wasOffline ? 'common.errors.serverNotAvailable' : 'common.vaultSaveError'), true);
    }
    return false;
  }, [auth, dbContext, notifications, t]);

  /**
   * Execute a vault mutation, persist it and wait for the push. Throws VaultPushFailedError when the push failed, after
   * rolling the change back.
   */
  const executeVaultMutationAsync = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    const snapshot = await vaultStore.snapshotLocalVault();
    await saveLocally(operation);
    if (await pushMutation(true)) {
      return;
    }

    // Roll back the change the server did not get.
    const { isLoggedIn } = await vaultStore.checkAuthStatus();
    if (isLoggedIn) {
      await vaultStore.restoreLocalVault(snapshot);
      await dbContext.loadStoredDatabase();
    }
    throw new VaultPushFailedError();
  }, [dbContext, saveLocally, pushMutation]);

  /**
   * Execute a vault mutation and persist it, then push it without waiting. A failed push of a change the user
   * sees is reported; one of silent data (usage stats) is not.
   */
  const executeVaultMutationInBackground = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    const scopes = await saveLocally(operation);
    void pushMutation(hasUserVisibleScope(scopes));
  }, [saveLocally, pushMutation]);

  /**
   * Execute a vault mutation and persist it without syncing, for a caller whose next step pushes it itself.
   */
  const executeVaultMutationLocally = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    await saveLocally(operation);
  }, [saveLocally]);

  return { executeVaultMutationAsync, executeVaultMutationInBackground, executeVaultMutationLocally };
}
