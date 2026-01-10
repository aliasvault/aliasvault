import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { sendMessage } from 'webext-bridge/popup';

import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';

import type { EncryptionKeyDerivationParams } from '@/utils/dist/core/models/metadata';
import type { VaultResponse } from '@/utils/dist/core/models/webapi';
import { EncryptionUtility } from '@/utils/EncryptionUtility';
import { ApiAuthError } from '@/utils/types/errors/ApiAuthError';
import { NetworkError } from '@/utils/types/errors/NetworkError';
import { VaultVersionIncompatibleError } from '@/utils/types/errors/VaultVersionIncompatibleError';
import type { VaultUploadResponse } from '@/utils/types/messaging/VaultUploadResponse';
import { vaultMergeService } from '@/utils/VaultMergeService';

type VaultSyncOptions = {
  onSuccess?: (hasNewVault: boolean) => void;
  onError?: (error: string) => void;
  onStatus?: (message: string) => void;
  onOffline?: () => void;
  onUpgradeRequired?: () => void;
}

/**
 * Hook to sync the vault with the server.
 * Supports offline mode: if server is unavailable, continues with local vault.
 *
 * Sync logic:
 * - If server has newer vault AND we have local changes (isDirty) → merge then upload
 * - If server has newer vault AND no local changes → just download
 * - If server has same revision AND we have local changes → upload
 * - If offline → keep local changes, sync later
 *
 * Race detection:
 * - Upload captures mutationSequence at start
 * - After upload, only clears isDirty if sequence unchanged
 * - If sequence changed during upload, stays dirty for next sync
 */
export const useVaultSync = (): { syncVault: (options?: VaultSyncOptions) => Promise<boolean>; } => {
  const { t } = useTranslation();
  const app = useApp();
  const dbContext = useDb();
  const webApi = useWebApi();

  /**
   * Check for pending migrations and trigger upgrade if needed.
   * @returns True if upgrade is required (caller should return), false otherwise.
   */
  const checkAndHandleUpgrade = useCallback(async (onUpgradeRequired?: () => void): Promise<boolean> => {
    if (await dbContext.hasPendingMigrations()) {
      onUpgradeRequired?.();
      return true;
    }
    return false;
  }, [dbContext]);

  /**
   * Handle entering offline mode.
   * @returns True to indicate success (caller should return true).
   */
  const enterOfflineMode = useCallback(async (onStatus?: (message: string) => void, onOffline?: () => void, onSuccess?: (hasNewVault: boolean) => void): Promise<boolean> => {
    await dbContext.setIsOffline(true);
    onStatus?.(t('common.offlineMode'));
    onOffline?.();
    onSuccess?.(false);
    return true;
  }, [dbContext, t]);

  const syncVault = useCallback(async (options: VaultSyncOptions = {}) => {
    const { onSuccess, onError, onStatus, onOffline, onUpgradeRequired } = options;

    try {
      const isLoggedIn = await app.initializeAuth();

      if (!isLoggedIn) {
        // Not authenticated, return false immediately
        return false;
      }

      // Check app status and vault revision
      onStatus?.(t('common.checkingVaultUpdates'));
      const statusResponse = await webApi.getStatus();

      // Get current sync state to check if server has newer vault
      const syncState = await sendMessage('GET_SYNC_STATE', {}, 'background') as {
        isDirty: boolean;
        mutationSequence: number;
        serverRevision: number;
      };

      // Set syncing indicator if server has newer vault (actual sync will happen)
      if (statusResponse.vaultRevision > syncState.serverRevision) {
        dbContext.setIsSyncing(true);
      }

      // Check if server is actually available, 0.0.0 indicates connection error which triggers offline mode.
      if (statusResponse.serverVersion === '0.0.0') {
        // Server is unavailable - enter offline mode if we have a local vault
        if (dbContext.dbAvailable) {
          return enterOfflineMode(onStatus, onOffline, onSuccess);
        } else {
          // No local vault available, can't operate offline
          onError?.(t('common.errors.serverNotAvailable'));
          return false;
        }
      }

      const statusError = webApi.validateStatusResponse(statusResponse);
      if (statusError) {
        onError?.(t('common.errors.' + statusError));
        return false;
      }

      // Check if the SRP salt has changed compared to locally stored encryption key derivation params
      const storedEncryptionParams = await sendMessage('GET_ENCRYPTION_KEY_DERIVATION_PARAMS', {}, 'background') as EncryptionKeyDerivationParams | null;
      if (storedEncryptionParams && statusResponse.srpSalt && statusResponse.srpSalt !== storedEncryptionParams.salt) {
        /**
         * Server SRP salt has changed compared to locally stored value, which means the user has changed
         * their password since the last time they logged in. This means that the local encryption key is no
         * longer valid and the user needs to re-authenticate. We trigger a logout but do not revoke tokens
         * as these were already revoked by the server upon password change.
         */
        await app.logout(t('common.errors.passwordChanged'));
        return false;
      }

      // We have a valid connection to the server - exit offline mode if we were in it
      if (dbContext.isOffline) {
        await dbContext.setIsOffline(false);
      }

      if (statusResponse.vaultRevision > syncState.serverRevision) {
        /*
         * Server has a newer vault.
         */
        onStatus?.(t('common.syncingUpdatedVault'));
        const vaultResponseJson = await webApi.get<VaultResponse>('Vault');

        try {
          const encryptionKey = await sendMessage('GET_ENCRYPTION_KEY', {}, 'background') as string;

          if (syncState.isDirty) {
            /*
             * We have local changes AND server has newer vault.
             * Merge local vault with server vault, then upload the merged result.
             */
            onStatus?.(t('common.mergingVaultChanges'));
            const localEncryptedVault = await sendMessage('GET_ENCRYPTED_VAULT', {}, 'background') as string | null;

            if (localEncryptedVault) {
              const localDecrypted = await EncryptionUtility.symmetricDecrypt(localEncryptedVault, encryptionKey);
              const serverDecrypted = await EncryptionUtility.symmetricDecrypt(vaultResponseJson.vault.blob, encryptionKey);

              const mergeResult = await vaultMergeService.merge(localDecrypted, serverDecrypted);

              if (mergeResult.success) {
                console.info('Vault merge during sync completed:', mergeResult.stats);

                const mergedEncryptedVault = await EncryptionUtility.symmetricEncrypt(
                  mergeResult.mergedVaultBase64,
                  encryptionKey
                );

                /*
                 * Store merged vault. Use expectedMutationSeq to detect if a local mutation
                 * happened during merge - if so, reject and re-sync.
                 */
                const storeResult = await sendMessage('STORE_ENCRYPTED_VAULT', {
                  vaultBlob: mergedEncryptedVault,
                  serverRevision: vaultResponseJson.vault.currentRevisionNumber,
                  expectedMutationSeq: syncState.mutationSequence
                }, 'background') as { success: boolean; mutationSequence: number };

                if (!storeResult.success) {
                  console.info('Mutation detected during merge, re-syncing...');
                  return syncVault(options);
                }

                // Upload merged vault to server
                onStatus?.(t('common.uploadingVault'));
                const uploadResponse = await sendMessage('UPLOAD_VAULT', {}, 'background') as VaultUploadResponse;

                if (uploadResponse.success && uploadResponse.status === 0) {
                  await sendMessage('MARK_VAULT_CLEAN', {
                    mutationSeqAtStart: uploadResponse.mutationSeqAtStart,
                    newServerRevision: uploadResponse.newRevisionNumber
                  }, 'background');
                } else if (uploadResponse.status === 2) {
                  // Server returned Outdated - another device uploaded. Re-sync.
                  return syncVault(options);
                } else {
                  console.error('Failed to upload merged vault:', uploadResponse.error);
                }

                // Store metadata and load merged vault into memory
                await sendMessage('STORE_VAULT_METADATA', {
                  publicEmailDomainList: vaultResponseJson.vault.publicEmailDomainList,
                  privateEmailDomainList: vaultResponseJson.vault.privateEmailDomainList,
                  hiddenPrivateEmailDomainList: vaultResponseJson.vault.hiddenPrivateEmailDomainList,
                }, 'background');

                await dbContext.loadDatabase(mergeResult.mergedVaultBase64);
                await dbContext.refreshSyncState();

                if (await checkAndHandleUpgrade(onUpgradeRequired)) {
                  return false;
                }

                onSuccess?.(true);
                return true;
              } else {
                console.error('Vault merge failed during sync, using server vault');
                // Fall through to use server vault
              }
            }
          }

          /*
           * No local changes (or merge failed) - just use server vault.
           * Use expectedMutationSeq to detect concurrent mutations.
           */
          const storeResult = await sendMessage('STORE_ENCRYPTED_VAULT', {
            vaultBlob: vaultResponseJson.vault.blob,
            serverRevision: vaultResponseJson.vault.currentRevisionNumber,
            expectedMutationSeq: syncState.mutationSequence
          }, 'background') as { success: boolean; mutationSequence: number };

          if (!storeResult.success) {
            console.info('Mutation detected during sync, re-syncing...');
            return syncVault(options);
          }

          await sendMessage('STORE_VAULT_METADATA', {
            publicEmailDomainList: vaultResponseJson.vault.publicEmailDomainList,
            privateEmailDomainList: vaultResponseJson.vault.privateEmailDomainList,
            hiddenPrivateEmailDomainList: vaultResponseJson.vault.hiddenPrivateEmailDomainList,
          }, 'background');

          const decryptedVault = await EncryptionUtility.symmetricDecrypt(vaultResponseJson.vault.blob, encryptionKey);
          await dbContext.loadDatabase(decryptedVault);
          await dbContext.refreshSyncState();

          if (await checkAndHandleUpgrade(onUpgradeRequired)) {
            return false;
          }

          onSuccess?.(true);
          return true;
        } catch (error) {
          if (error instanceof VaultVersionIncompatibleError) {
            await app.logout(error.message);
            return false;
          }
          throw new Error('Vault could not be decrypted, if the problem persists please logout and login again.');
        }
      } else if (statusResponse.vaultRevision === syncState.serverRevision) {
        /**
         * Server and local vault are at the same revision.
         * If we have pending local changes, upload them now.
         */
        if (syncState.isDirty) {
          onStatus?.(t('common.uploadingVault'));

          // Vault is already stored locally, just upload it
          const uploadResponse = await sendMessage('UPLOAD_VAULT', {}, 'background') as VaultUploadResponse;
          if (uploadResponse.success && uploadResponse.status === 0) {
            // Upload succeeded - try to clear dirty flag
            await sendMessage('MARK_VAULT_CLEAN', {
              mutationSeqAtStart: uploadResponse.mutationSeqAtStart,
              newServerRevision: uploadResponse.newRevisionNumber
            }, 'background');
            await dbContext.refreshSyncState();
          } else if (uploadResponse.status === 2) {
            /**
             * Server returned Outdated - another device uploaded first.
             * Recursively call syncVault to fetch, merge, and retry.
             */
            return syncVault(options);
          } else {
            console.error('Failed to upload pending vault:', uploadResponse.error);
          }

          onSuccess?.(false);
          return true;
        }
      }

      // Check if upgrade is required (for paths that didn't initialize a new database)
      if (await checkAndHandleUpgrade(onUpgradeRequired)) {
        return false;
      }

      onSuccess?.(false);
      return false;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error during vault sync';
      console.error('Vault sync error:', err);

      // Check if it's a version-related error (app needs to be updated)
      if (err instanceof VaultVersionIncompatibleError) {
        await app.logout(errorMessage);
        return false;
      }

      // Check if it's an auth error (session expired) - logout is already triggered by WebApiService
      if (err instanceof ApiAuthError) {
        return false;
      }

      // Check if it's a network error - enter offline mode if we have a local vault
      if (err instanceof NetworkError) {
        if (dbContext.dbAvailable) {
          return enterOfflineMode(onStatus, onOffline, onSuccess);
        }
      }

      onError?.(errorMessage);
      return false;
    } finally {
      // Always clear syncing state when done
      dbContext.setIsSyncing(false);
    }
  }, [app, dbContext, webApi, t, checkAndHandleUpgrade, enterOfflineMode]);

  return { syncVault };
};
