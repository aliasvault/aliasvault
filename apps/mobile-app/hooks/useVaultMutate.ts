import { Buffer } from 'buffer';

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import srp from 'secure-remote-password/client';

import type { EncryptionKeyDerivationParams } from '@/utils/dist/core/models/metadata';
import type { PasswordChangeInitiateResponse, Vault, VaultPasswordChangeRequest } from '@/utils/dist/core/models/webapi';
import { FieldKey, getFieldValue } from '@/utils/dist/core/models/vault';
import EncryptionUtility from '@/utils/EncryptionUtility';

import { useVaultSync } from '@/hooks/useVaultSync';

import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

type VaultPostResponse = {
  status: number;
  newRevisionNumber: number;
}

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
  executeVaultPasswordChange: (currentPasswordHashBase64: string, newPasswordPlainText: string, options?: VaultMutationOptions) => Promise<void>;
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

  /**
   * Prepare vault for password change operation.
   */
  const prepareVaultForPasswordChange = useCallback(async (): Promise<Vault> => {
    const syncState = await NativeVaultManager.getSyncState();
    const currentRevision = syncState.serverRevision;
    const encryptedDb = await NativeVaultManager.getEncryptedDatabase();
    if (!encryptedDb) {
      throw new Error(t('vault.errors.failedToGetEncryptedDatabase'));
    }

    const privateEmailDomains = await dbContext.sqliteClient!.getPrivateEmailDomains();
    const items = await dbContext.sqliteClient!.items.getAll();
    const privateEmailAddresses = items
      .map(item => getFieldValue(item, FieldKey.LoginEmail))
      .filter((email): email is string => email != null && email !== '')
      .filter((email, index, self) => self.indexOf(email) === index)
      .filter(email => {
        return privateEmailDomains.some(domain => email.toLowerCase().endsWith(`@${domain.toLowerCase()}`));
      });

    const username = authContext.username;
    if (!username) {
      throw new Error(t('vault.errors.usernameNotFound'));
    }

    return {
      blob: encryptedDb,
      createdAt: new Date().toISOString(),
      credentialsCount: items.length,
      currentRevisionNumber: currentRevision,
      emailAddressList: privateEmailAddresses,
      privateEmailDomainList: [],
      hiddenPrivateEmailDomainList: [],
      publicEmailDomainList: [],
      encryptionPublicKey: '',
      updatedAt: new Date().toISOString(),
      username: username,
      version: (await dbContext.sqliteClient!.getDatabaseVersion())?.version ?? '0.0.0'
    };
  }, [dbContext, authContext, t]);

  /**
   * Trigger background sync without blocking the UI.
   * This is fire-and-forget - the ServerSyncIndicator shows progress.
   */
  const triggerBackgroundSync = useCallback(async (options: VaultMutationOptions): Promise<void> => {
    dbContext.setIsSyncing(true);

    try {
      await syncVault({
        onSuccess: async () => {
          // Register credential identities after successful sync
          try {
            await NativeVaultManager.registerCredentialIdentities();
          } catch (error) {
            console.warn('VaultMutate: Failed to register credential identities:', error);
          }
          await dbContext.refreshSyncState();
          options.onSuccess?.();
        },
        onError: async (error) => {
          await dbContext.refreshSyncState();
          // Don't show error toast - the indicator shows offline/pending state
          console.warn('Background sync failed:', error);
          options.onError?.(new Error(error));
        },
        onOffline: async () => {
          // Local change is saved and isDirty is set - will sync when back online
          await dbContext.refreshSyncState();
          options.onSuccess?.();
        }
      });
    } finally {
      dbContext.setIsSyncing(false);
      await dbContext.refreshSyncState();
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

    // Refresh sync state to show "Pending" indicator immediately
    await dbContext.refreshSyncState();

    // Trigger background sync - fire-and-forget, don't await
    // The ServerSyncIndicator will show syncing/pending/offline state
    void triggerBackgroundSync(options);
  }, [dbContext, triggerBackgroundSync]);

  /**
   * Execute the provided operation (e.g. create/update/delete credential)
   */
  const executePasswordChangeOperation = useCallback(async (
    currentPasswordHashBase64: string,
    newPasswordPlainText: string,
    options: VaultMutationOptions
  ) : Promise<void> => {
    setSyncStatus('Saving changes to vault');

    const data = await webApi.authFetch<PasswordChangeInitiateResponse>('Auth/change-password/initiate');
    const currentSalt = data.salt;
    const currentServerEphemeral = data.serverEphemeral;

    // Convert base64 string to hex string
    const currentPasswordHashString = Buffer.from(currentPasswordHashBase64, 'base64').toString('hex').toUpperCase();

    // Generate client ephemeral and session
    const newClientEphemeral = srp.generateEphemeral();
    // Get username from the auth context, always lowercase and trimmed which is required for the argon2id key derivation
    const username = authContext.username?.toLowerCase().trim();
    if (!username) {
      throw new Error(t('common.errors.unknownError'));
    }

    const privateKey = srp.derivePrivateKey(currentSalt, username, currentPasswordHashString);
    const newClientSession = srp.deriveSession(
      newClientEphemeral.secret,
      currentServerEphemeral,
      currentSalt,
      username,
      privateKey
    );

    // Generate salt and verifier for new password
    const newSalt = srp.generateSalt();
    const newPasswordHash = await EncryptionUtility.deriveKeyFromPassword(newPasswordPlainText, newSalt, data.encryptionType, data.encryptionSettings);
    const newPasswordHashString = Buffer.from(newPasswordHash).toString('hex').toUpperCase();

    // Store the new encryption key and derivation parameters locally
    try {
      const newEncryptionKeyDerivationParams : EncryptionKeyDerivationParams = {
        encryptionType: data.encryptionType,
        encryptionSettings: data.encryptionSettings,
        salt: newSalt,
      };

      await dbContext.storeEncryptionKey(Buffer.from(newPasswordHash).toString('base64'));
      await dbContext.storeEncryptionKeyDerivationParams(newEncryptionKeyDerivationParams);

      /**
       * Persist the new encrypted database with the new encryption key by starting and committing a transaction.
       * which simulates a vault mutation operation. As part of this operation, a new encrypted database is created
       * locally which can then be uploaded to the server.
       */
      await NativeVaultManager.beginTransaction();
      await NativeVaultManager.commitTransaction();

      // Unlock the newly persisted database to ensure it works and the new encryption key will be persisted in the keychain.
      await NativeVaultManager.unlockVault();
    } catch {
      // If any part of this fails, we need logout the user as the local vault and stored encryption key are now potentially corrupt.
      await authContext.logout(t('common.errors.unknownErrorTryAgain'));
    }

    // Generate SRP password change data
    const newPrivateKey = srp.derivePrivateKey(newSalt, username, newPasswordHashString);
    const newVerifier = srp.deriveVerifier(newPrivateKey);

    // Prepare vault for password change
    const vault = await prepareVaultForPasswordChange();
    setSyncStatus(t('vault.uploadingVaultToServer'));

    // Convert default vault object to password change vault object
    const passwordChangeVault : VaultPasswordChangeRequest = {
      ...vault,
      currentClientPublicEphemeral: newClientEphemeral.public,
      currentClientSessionProof: newClientSession.proof,
      newPasswordSalt: newSalt,
      newPasswordVerifier: newVerifier
    };

    try {
      // Capture mutation sequence before upload for atomic state update
      const syncState = await NativeVaultManager.getSyncState();

      // Upload to server
      const response = await webApi.post<typeof passwordChangeVault, VaultPostResponse>('Vault/change-password', passwordChangeVault);

      /**
       * Determine if the server responds with vault revision number, as API < 0.17.0 did not.
       * TODO: Remove this once we have a minimum required API version of 0.17.0.
       */
      const newRevisionNumber = response.newRevisionNumber ?? passwordChangeVault.currentRevisionNumber + 1;

      // If we get here, it means we have a valid connection to the server.
      await NativeVaultManager.setOfflineMode(false);

      // Update revision atomically with sync state (clears dirty flag if no mutations during upload)
      await NativeVaultManager.markVaultClean(syncState.mutationSequence, newRevisionNumber);
      options.onSuccess?.();
    } catch (error) {
      console.error('Error during password change operation:', error);
      throw error;
    }
  }, [dbContext, authContext, webApi, prepareVaultForPasswordChange, t]);

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
   * Hook to execute a password change which uploads a new encrypted vault to the server
   * with updated SRP verifier and salt.
   *
   * Unlike regular mutations, password change REQUIRES a pre-sync to ensure we're
   * re-encrypting the latest vault. Cannot proceed offline.
   */
  const executeVaultPasswordChange = useCallback(async (
    currentPasswordHashBase64: string,
    newPasswordPlainText: string,
    options: VaultMutationOptions = {}
  ) => {
    try {
      setIsLoading(true);
      setSyncStatus(t('vault.checkingForVaultUpdates'));

      // Password change requires online - must sync first to get latest vault before re-encryption
      const syncSuccess = await new Promise<boolean>((resolve) => {
        syncVault({
          onStatus: (message) => setSyncStatus(message),
          onSuccess: () => resolve(true),
          onError: (error) => {
            Toast.show({
              type: 'error',
              text1: t('common.error'),
              text2: error,
              position: 'bottom'
            });
            options.onError?.(new Error(error));
            resolve(false);
          },
          onOffline: () => {
            Toast.show({
              type: 'error',
              text1: t('common.error'),
              text2: t('vault.errors.passwordChangeRequiresOnline'),
              position: 'bottom'
            });
            options.onError?.(new Error(t('vault.errors.passwordChangeRequiresOnline')));
            resolve(false);
          }
        });
      });

      if (!syncSuccess) {
        return;
      }

      // Now execute the password change operation
      await executePasswordChangeOperation(currentPasswordHashBase64, newPasswordPlainText, options);
    } catch (error) {
      console.error('Error during password change:', error);
      Toast.show({
        type: 'error',
        text1: t('common.error'),
        text2: t('common.errors.unknownError'),
        position: 'bottom'
      });
      options.onError?.(error instanceof Error ? error : new Error(t('common.errors.unknownError')));
    } finally {
      setIsLoading(false);
      setSyncStatus('');
    }
  }, [syncVault, executePasswordChangeOperation, t]);

  return {
    executeVaultMutation,
    executeVaultPasswordChange,
    isLoading,
    syncStatus
  };
}
