import { useCallback } from 'react';

import { AppInfo } from '@/utils/AppInfo';
import type { VaultResponse } from '@/utils/dist/shared/models/webapi';
import { VaultAuthenticationError } from '@/utils/types/errors/VaultAuthenticationError';

import { useTranslation } from '@/hooks/useTranslation';

import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';
import NativeVaultManager from '@/specs/NativeVaultManager';
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
  onOffline?: () => void;
  onUpgradeRequired?: () => void;
}

/**
 * Hook to sync the vault with the server.
 * Now delegates core sync logic to native layer while keeping UI orchestration in React Native.
 */
export const useVaultSync = () : {
  syncVault: (options?: VaultSyncOptions) => Promise<boolean>;
} => {
  const { t } = useTranslation();
  const app = useApp();
  const dbContext = useDb();

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

      // Update status
      onStatus?.(t('vault.checkingVaultUpdates'));

      // Add artificial delay for initial sync UX
      if (enableDelay) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      // Call native syncVault which handles:
      // - Calling Auth/status endpoint
      // - Comparing vault revisions
      // - Downloading vault if needed
      // - Storing encrypted vault
      // - Updating revision number
      // - Setting offline mode
      let hasNewVault = false;

      try {
        onStatus?.(t('vault.syncingUpdatedVault'));
        hasNewVault = await NativeVaultManager.syncVault();

        console.log(`VaultSync: syncVault completed, hasNewVault=${hasNewVault}`);

        // Add artificial delay for initial sync UX
        if (enableDelay && hasNewVault) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : t('common.errors.unknownError');

        // Check for authentication failure (401) - logout user
        if (errorMessage.includes('Authentication failed') || errorMessage.includes('please login again')) {
          await app.logout('Your session has expired. Please login again.');
          return false;
        }

        // Check for specific error conditions from native layer
        if (errorMessage.includes('Server not available')) {
          onOffline?.();
          return false;
        }

        if (errorMessage.includes('Client version not supported')) {
          onError?.(t('vault.errors.versionNotSupported'));
          return false;
        }

        if (errorMessage.includes('Password has changed')) {
          await app.logout(t('vault.errors.passwordChanged'));
          return false;
        }

        // Network error - go offline but don't fail
        if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
          await NativeVaultManager.setOfflineMode(true);
          return true;
        }

        throw err;
      }

      try {
        // We always re-unlock the vault to force reload of database connection
        // This ensures React Native's SQLite connection sees changes made by native layer
        console.log('VaultSync: Re-unlocking vault to refresh database connection');
        await NativeVaultManager.unlockVault();

        // Check if the vault needs migration
        if (await dbContext.hasPendingMigrations()) {
          onUpgradeRequired?.();
          return false;
        }

        // Add artificial delay for initial sync UX
        if (enableDelay) {
          await new Promise(resolve => setTimeout(resolve, hasNewVault ? 1000 : 300));
        }

        onSuccess?.(hasNewVault);

        // Register credential identities after sync
        try {
          await NativeVaultManager.registerCredentialIdentities();
          console.log('Vault sync: Successfully registered credential identities');
        } catch (error) {
          console.warn('Vault sync: Failed to register credential identities:', error);
          // Don't fail the sync if credential registration fails
        }

        return hasNewVault;
      } catch (err) {
        if (err instanceof VaultVersionIncompatibleError) {
          await app.logout(t(err.message));
          return false;
        }

        // Vault could not be unlocked
        throw new Error(t('vault.errors.vaultDecryptFailed'));
      }
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
        await NativeVaultManager.setOfflineMode(true);
        return true;
      }

      onError?.(errorMessage);
      return false;
    }
  }, [app, dbContext, t]);

  return { syncVault };
};