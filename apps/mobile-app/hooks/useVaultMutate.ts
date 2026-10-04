import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';

import type { UnlockKeyDerivationParams } from '@aliasvault/models/metadata';
import type { PasswordChangeInitiateResponse, PasswordChangeRequest } from '@aliasvault/models/webapi';
import { MasterPasswordService, PasswordChangedElsewhereError } from '@aliasvault/client/auth/MasterPasswordService';
import { SrpAuthService } from '@aliasvault/client/auth/SrpAuthService';

import { useVaultSync } from '@/hooks/useVaultSync';

import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

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
  executeVaultPasswordChange: (currentUnlockKeyBase64: string, newPasswordPlainText: string) => Promise<void>;
  isLoading: boolean;
  syncStatus: string;
  } {
  const [isLoading, setIsLoading] = useState(false);
  const { t } = useTranslation();
  const [syncStatus, setSyncStatus] = useState(t('vault.syncingVault'));
  const authContext = useApp();
  const dbContext = useDb();
  const webApi = useWebApi();
  const { syncVault } = useVaultSync();
  const syncInProgressRef = useRef(false);
  const syncQueuedRef = useRef(false);

  /**
   * Trigger background sync without blocking the UI.
   * This is fire-and-forget - the ServerSyncIndicator shows progress.
   */
  const triggerBackgroundSync = useCallback(async (options: VaultMutationOptions): Promise<void> => {
    // If sync already in progress, queue this request
    if (syncInProgressRef.current) {
      syncQueuedRef.current = true;
      console.log('[useVaultMutate] Sync already in progress, queuing sync request');
      return;
    }

    syncInProgressRef.current = true;

    try {
      await syncVault({
        onSuccess: async () => {
          // Register credential identities after successful sync
          try {
            await NativeVaultManager.registerCredentialIdentities();
          } catch (error) {
            console.warn('VaultMutate: Failed to register credential identities:', error);
          }
          options.onSuccess?.();
        },
        onError: async (error) => {
          console.warn('Background sync failed:', error);
          /*
           * Surface the error to the user.
           */
          Toast.show({
            type: 'error',
            text1: t('common.error'),
            text2: error,
            position: 'bottom',
          });
          options.onError?.(new Error(error));
        },
        onOffline: async () => {
          options.onSuccess?.();
        }
      });
    } finally {
      syncInProgressRef.current = false;

      // Process queued sync if one was requested while we were syncing
      if (syncQueuedRef.current) {
        syncQueuedRef.current = false;
        console.log('[useVaultMutate] Processing queued sync request');
        // Small delay to avoid rapid-fire syncs
        setTimeout(() => {
          void triggerBackgroundSync(options);
        }, 100);
      } else {
        // Only refresh state and clear uploading if no queued sync
        await dbContext.refreshSyncState();
        dbContext.setIsUploading(false);
      }
    }
  }, [syncVault, dbContext]);

  /**
   * Execute the provided operation (e.g. create/update/delete credential)
   */
  const executeMutateOperation = useCallback(async (
    operation: () => Promise<void>,
    options: VaultMutationOptions
  ): Promise<void> => {
    await operation();

    // Set uploading state before refreshing sync state to prevent "pending" flash
    dbContext.setIsUploading(true);

    // Refresh sync state to update isDirty flag
    await dbContext.refreshSyncState();

    // Trigger background sync - fire-and-forget, don't await
    // The ServerSyncIndicator will show syncing/pending/offline state
    void triggerBackgroundSync(options);
  }, [dbContext, triggerBackgroundSync]);

  /**
   * Change the master password: prove the current one, re-encrypt the Account Key with the new password's KEK, commit
   * on the server, then refresh the local key chain and derivation params. The vault itself is not re-encrypted.
   */
  const executePasswordChangeOperation = useCallback(async (currentUnlockKeyBase64: string, newPasswordPlainText: string): Promise<void> => {
    const chainJson = await NativeVaultManager.getAccountKeyChain();
    const encryptedAccountKey = chainJson ? (JSON.parse(chainJson) as { encryptedAccountKey?: string }).encryptedAccountKey : undefined;
    const storedParams = await NativeVaultManager.getUnlockKeyDerivationParams();
    if (!encryptedAccountKey || !storedParams) {
      throw new Error('Password change requires an unlocked account-key vault');
    }

    const challenge = await webApi.authFetch<PasswordChangeInitiateResponse>('Auth/change-password/initiate');
    if (challenge.salt !== (JSON.parse(storedParams) as UnlockKeyDerivationParams).salt) {
      throw new PasswordChangedElsewhereError();
    }

    /**
     * Use srpIdentity from server response if available, otherwise fall back to username.
     * Note: the fallback can be removed in the future after 0.26.0+ is deployed.
     */
    const srpIdentity = challenge.srpIdentity ?? SrpAuthService.normalizeUsername(authContext.username ?? '');
    const currentPasswordHashString = await SrpAuthService.srpPasswordHash(currentUnlockKeyBase64, challenge.encryptionType);
    const currentProof = await SrpAuthService.deriveClientProof(challenge.salt, srpIdentity, currentPasswordHashString, challenge.serverEphemeral);
    const next = await SrpAuthService.prepareNewPassword(newPasswordPlainText, srpIdentity);
    const { newEncryptedAccountKey } = await MasterPasswordService.reencryptAccountKey(encryptedAccountKey, currentUnlockKeyBase64, next.unlockKeyBase64);

    await webApi.post<PasswordChangeRequest, void>('Auth/change-password', {
      currentClientPublicEphemeral: currentProof.clientPublicEphemeral,
      currentClientSessionProof: currentProof.clientSessionProof,
      newPasswordSalt: next.salt,
      newPasswordVerifier: next.verifier,
      newEncryptedAccountKey,
      newEncryptionType: next.encryptionType,
      newEncryptionSettings: next.encryptionSettings,
    }, false);

    // Like a login: new params first (the sync compares the salt), then cache the server's new chain and reopen the session.
    await dbContext.storeUnlockKeyDerivationParams({ salt: next.salt, encryptionType: next.encryptionType, encryptionSettings: next.encryptionSettings });
    await NativeVaultManager.resolveVaultKey(next.unlockKeyBase64);
  }, [dbContext, authContext, webApi]);

  /**
   * Hook to execute a vault mutation which uploads a new encrypted vault to the server.
   */
  const executeVaultMutation = useCallback(async (
    operation: () => Promise<void>,
    options: VaultMutationOptions = {}
  ) => {
    try {
      await executeMutateOperation(operation, options);
    } catch (error) {
      console.error('Error during vault mutation:', error);
      Toast.show({
        type: 'error',
        text1: t('common.errors.unknownError'),
        position: 'bottom'
      });
      options.onError?.(error instanceof Error ? error : new Error(t('common.errors.unknownError')));
    }
  }, [executeMutateOperation, t]);

  /**
   * Change the master password, then sync in the background.
   * @throws {IncorrectPasswordError} when the current password does not open the Account Key.
   * @throws {PasswordChangedElsewhereError} when the password was already changed on another device.
   * @throws {ApiRequestError} when the server rejects the change.
   */
  const executeVaultPasswordChange = useCallback(async (currentUnlockKeyBase64: string, newPasswordPlainText: string): Promise<void> => {
    try {
      setIsLoading(true);
      setSyncStatus(t('settings.securitySettings.changePassword.initiatingChange'));
      await executePasswordChangeOperation(currentUnlockKeyBase64, newPasswordPlainText);
    } finally {
      setIsLoading(false);
      setSyncStatus('');
    }
    void triggerBackgroundSync({});
  }, [executePasswordChangeOperation, triggerBackgroundSync, t]);

  return {
    executeVaultMutation,
    executeVaultPasswordChange,
    isLoading,
    syncStatus
  };
}
