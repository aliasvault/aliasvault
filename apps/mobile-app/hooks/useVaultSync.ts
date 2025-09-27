import { useCallback } from 'react';

import { AppInfo } from '@/utils/AppInfo';
import type { VaultResponse } from '@/utils/dist/shared/models/webapi';
import { VaultAuthenticationError } from '@/utils/types/errors/VaultAuthenticationError';

import { useTranslation } from '@/hooks/useTranslation';

import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';
import NativeVaultManager from '@/specs/NativeVaultManager';
import { VaultVersionIncompatibleError } from '@/utils/types/errors/VaultVersionError';

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
  onOffline?: () => void;
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
    const { initialSync = false, onSuccess, onError, onStatus, onOffline, onUpgradeRequired } = options;

    // For the initial sync, we add an artifical delay to various steps which makes it feel more fluid.
    const enableDelay = initialSync;

    try {
      const { isLoggedIn } = await app.initializeAuth();

      if (!isLoggedIn) {
        // Not authenticated, return false immediately
        return false;
      }

      // Check app status and vault revision
      onStatus?.(t('vault.checkingVaultUpdates'));
      const statusResponse = await withMinimumDelay(() => webApi.getStatus(), 300, enableDelay);

      if (statusResponse.serverVersion === '0.0.0') {
        // Server is not available, go into offline mode
        onOffline?.();
        return false;
      }

      if (!statusResponse.clientVersionSupported) {
        const statusError = t('vault.errors.versionNotSupported');
        onError?.(statusError);
        return false;
      }

      if (!AppInfo.isServerVersionSupported(statusResponse.serverVersion)) {
        const statusError = t('vault.errors.serverNeedsUpdate');
        onError?.(statusError);
        return false;
      }

      // Check if the SRP salt has changed compared to locally stored encryption key derivation params
      const keyDerivationParams = await app.getEncryptionKeyDerivationParams();
      if (keyDerivationParams && statusResponse.srpSalt && statusResponse.srpSalt !== keyDerivationParams.salt) {
        /**
         * Server SRP salt has changed compared to locally stored value, which means the user has changed
         * their password since the last time they logged in. This means that the local encryption key is no
         * longer valid and the user needs to re-authenticate. We trigger a logout but do not revoke tokens
         * as these were already revoked by the server upon password change.
         */
        await app.logout(t('vault.errors.passwordChanged'));
        return false;
      }

      // If we get here, it means we have a valid connection to the server.
      app.setOfflineMode(false);

      // Compare vault revisions
      const vaultMetadata = await dbContext.getVaultMetadata();
      const vaultRevisionNumber = vaultMetadata?.vaultRevisionNumber ?? 0;

      if (statusResponse.vaultRevision > vaultRevisionNumber) {
        onStatus?.(t('vault.syncingUpdatedVault'));
        const vaultResponseJson = await withMinimumDelay(() => webApi.get<VaultResponse>('Vault'), 1000, enableDelay);

        const vaultError = webApi.validateVaultResponse(vaultResponseJson as VaultResponse);
        if (vaultError) {
          // Throw authentication error which will be caught and handled
          throw new VaultAuthenticationError(vaultError);
        }

        try {
          await dbContext.initializeDatabase(vaultResponseJson as VaultResponse);

          // Check if the current vault version is known and up to date, if not known trigger an exception, if not up to date redirect to the upgrade page.
          if (await NativeVaultManager.isVaultUnlocked() && await dbContext.hasPendingMigrations()) {
            onUpgradeRequired?.();
            return false;
          }

          onSuccess?.(true);
          return true;
        } catch (err) {
          if (err instanceof VaultVersionIncompatibleError) {
            await app.logout(t(err.message));
            return false;
          }

          // Vault could not be decrypted, throw an error
          throw new Error(t('vault.errors.vaultDecryptFailed'));
        }
      }

      // Check if the vault is up to date, if not, redirect to the upgrade page.
      if (await NativeVaultManager.isVaultUnlocked() && await dbContext.hasPendingMigrations()) {
        onUpgradeRequired?.();
        return false;
      }

      await withMinimumDelay(() => Promise.resolve(onSuccess?.(false)), 300, enableDelay);
      return false;
    } catch (err) {
      console.error('Vault sync error:', err);

      // Handle authentication errors
      if (err instanceof VaultAuthenticationError) {
        await app.logout(err.message);
        return false;
      }

      if (err instanceof VaultVersionIncompatibleError) {
        await app.logout(t(err.message));
        return false;
      }

      const errorMessage = err instanceof Error ? err.message : t('common.errors.unknownError');

      // Check if it's a network error
      if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
        app.setOfflineMode(true);
        return true;
      }

      onError?.(errorMessage);
      return false;
    }
  }, [app, dbContext, webApi, t]);

  return { syncVault };
};