import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { sendMessage } from 'webext-bridge/popup';

import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';

import type { EncryptionKeyDerivationParams } from '@/utils/dist/shared/models/metadata';
import type { VaultResponse } from '@/utils/dist/shared/models/webapi';
import { VaultVersionIncompatibleError } from '@/utils/types/errors/VaultVersionIncompatibleError';

/**
 * Utility function to ensure a minimum time has elapsed for an operation
 */
const withMinimumDelay = async <T>(
  operation: () => Promise<T>,
  minDelayMs: number,
  enableDelay: boolean = true
): Promise<T> => {
  if (!enableDelay) {
    // If delay is disabled, return the result immediately.
    return operation();
  }

  const startTime = Date.now();
  const result = await operation();
  const elapsedTime = Date.now() - startTime;

  if (elapsedTime < minDelayMs) {
    await new Promise(resolve => setTimeout(resolve, minDelayMs - elapsedTime));
  }

  return result;
};

type VaultSyncOptions = {
  initialSync?: boolean;
  onSuccess?: (hasNewVault: boolean) => void;
  onError?: (error: string) => void;
  onStatus?: (message: string) => void;
  _onOffline?: () => void;
  onUpgradeRequired?: () => void;
}

/**
 * Hook to sync the vault with the server.
 */
export const useVaultSync = () : {
  syncVault: (options?: VaultSyncOptions) => Promise<boolean>;
} => {
  const { t } = useTranslation();
  const app = useApp();
  const dbContext = useDb();
  const webApi = useWebApi();

  const syncVault = useCallback(async (options: VaultSyncOptions = {}) => {
    const { initialSync = false, onSuccess, onError, onStatus, _onOffline, onUpgradeRequired } = options;

    // For the initial sync, we add an artifical delay to various steps which makes it feel more fluid.
    const enableDelay = initialSync;

    try {
      const isLoggedIn = await app.initializeAuth();

      if (!isLoggedIn) {
        // Not authenticated, return false immediately
        return false;
      }

      // Check app status and vault revision
      onStatus?.(t('common.checkingVaultUpdates'));
      const statusResponse = await withMinimumDelay(() => webApi.getStatus(), 300, enableDelay);

      // Check if server is actually available, 0.0.0 indicates connection error which triggers offline mode.
      if (statusResponse.serverVersion === '0.0.0') {
        // Offline mode is not implemented for browser extension yet, so logout the user.
        onError?.(t('common.errors.serverNotAvailable'));
        return false;
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

      /*
       *  If we get here, it means we have a valid connection to the server.
       *  TODO: browser extension does not support offline mode yet.
       * authContext.setOfflineMode(false);
       */

      // Compare vault revisions
      const vaultMetadata = await dbContext.getVaultMetadata();
      const vaultRevisionNumber = vaultMetadata?.vaultRevisionNumber ?? 0;

      if (statusResponse.vaultRevision > vaultRevisionNumber) {
        onStatus?.(t('common.syncingUpdatedVault'));
        const vaultResponseJson = await withMinimumDelay(() => webApi.get<VaultResponse>('Vault'), 1000, enableDelay);

        try {
          // Get encryption key from background worker
          const encryptionKey = await sendMessage('GET_ENCRYPTION_KEY', {}, 'background') as string;
          const sqliteClient = await dbContext.initializeDatabase(vaultResponseJson as VaultResponse, encryptionKey);

          // Check if the current vault version is known and up to date, if not known trigger an exception, if not up to date redirect to the upgrade page.
          if (await sqliteClient.hasPendingMigrations()) {
            onUpgradeRequired?.();
            return false;
          }

          onSuccess?.(true);
          return true;
        } catch (error) {
          // Check if it's a version-related error (app needs to be updated)
          if (error instanceof VaultVersionIncompatibleError) {
            await app.logout(error.message);
            return false;
          }
          // Vault could not be decrypted, throw an error
          throw new Error('Vault could not be decrypted, if the problem persists please logout and login again.');
        }
      }

      // Check if the vault is up to date, if not, redirect to the upgrade page.
      if (await dbContext.hasPendingMigrations()) {
        onUpgradeRequired?.();
        return false;
      }

      await withMinimumDelay(() => Promise.resolve(onSuccess?.(false)), 300, enableDelay);
      return false;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error during vault sync';
      console.error('Vault sync error:', err);

      // Check if it's a version-related error (app needs to be updated)
      if (err instanceof VaultVersionIncompatibleError) {
        await app.logout(errorMessage);
        return false;
      }

      /*
       * Check if it's a network error
       * TODO: browser extension does not support offline mode yet.
       */
      /*
       * if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
       *authContext.setOfflineMode(true);
       *return true;
       *}
       */

      onError?.(errorMessage);
      return false;
    }
  }, [app, dbContext, webApi, t]);

  return { syncVault };
};