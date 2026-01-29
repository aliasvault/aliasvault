import { useCallback, useRef } from 'react';

import { VaultAuthenticationError } from '@/utils/types/errors/VaultAuthenticationError';
import { useTranslation } from '@/hooks/useTranslation';

import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';
import NativeVaultManager from '@/specs/NativeVaultManager';
import { VaultVersionIncompatibleError } from '@/utils/types/errors/VaultVersionIncompatibleError';
import { VaultSyncErrorCode, getVaultSyncErrorCode } from '@/utils/types/errors/VaultSyncErrorCodes';

/**
 * Sync state tracking for race detection and offline support.
 */
export type SyncState = {
  isDirty: boolean;
  mutationSequence: number;
  serverRevision: number;
  isSyncing: boolean;
};

type VaultSyncOptions = {
  onSuccess?: (hasNewVault: boolean) => void;
  onError?: (error: string) => void;
  onStatus?: (message: string) => void;
  onOffline?: () => void;
  onUpgradeRequired?: () => void;
  abortSignal?: AbortSignal;
};

/**
 * Hook to sync the vault with the server.
 *
 * This hook delegates all sync logic to native code via syncVaultWithServer().
 * The native layer handles:
 * 1. Check isDirty before overwriting local vault
 * 2. Upload pending changes
 * 3. Race detection using mutation sequence
 * 4. Retry logic for race conditions
 * 5. Merge using LWW strategy (via Rust core)
 */
export const useVaultSync = (): {
  syncVault: (options?: VaultSyncOptions) => Promise<boolean>;
  getSyncState: () => Promise<SyncState>;
} => {
  const { t } = useTranslation();
  const app = useApp();
  const dbContext = useDb();
  const syncInProgressRef = useRef(false);

  const getSyncState = useCallback(async (): Promise<SyncState> => {
    return await NativeVaultManager.getSyncState();
  }, []);

  const syncVault = useCallback(async (options: VaultSyncOptions = {}): Promise<boolean> => {
    const { onSuccess, onError, onStatus, onOffline, onUpgradeRequired, abortSignal } = options;

    // Prevent concurrent syncs
    if (syncInProgressRef.current) {
      console.log('[useVaultSync] Sync already in progress, skipping');
      return false;
    }

    syncInProgressRef.current = true;

    try {
      // Check if operation was aborted
      if (abortSignal?.aborted) {
        console.debug('VaultSync: Operation aborted before starting');
        return false;
      }

      const { isLoggedIn } = await app.initializeAuth();

      if (!isLoggedIn) {
        return false;
      }

      if (abortSignal?.aborted) {
        console.debug('VaultSync: Operation aborted after auth check');
        return false;
      }

      onStatus?.(t('vault.checkingVaultUpdates'));

      // Call the unified native sync method
      // This handles all sync scenarios: download, upload, merge, race detection
      const result = await NativeVaultManager.syncVaultWithServer();

      if (abortSignal?.aborted) {
        console.debug('VaultSync: Operation aborted after sync');
        return false;
      }

      // Handle sync result
      if (!result.success) {
        // Check for specific error conditions
        if (result.error) {
          const errorCode = getVaultSyncErrorCodeFromString(result.error);
          if (errorCode) {
            return await handleSyncError(result.error, errorCode, app, dbContext, t, onError, onOffline);
          }
        }

        if (result.wasOffline) {
          await dbContext.setIsOffline(true);
          onOffline?.();
          // Return true to continue with local vault
          return true;
        }

        onError?.(result.error ?? t('common.errors.unknownError'));
        return false;
      }

      // Sync succeeded - clear offline mode if it was set
      await dbContext.setIsOffline(false);

      // Update status based on action taken
      switch (result.action) {
        case 'uploaded':
          console.log('[useVaultSync] Successfully uploaded local changes');
          break;
        case 'downloaded':
          onStatus?.(t('vault.syncingUpdatedVault'));
          console.log('[useVaultSync] Downloaded new vault from server');
          break;
        case 'merged':
          onStatus?.(t('vault.mergingVault'));
          console.log('[useVaultSync] Merged local and server changes');
          break;
        case 'already_in_sync':
          console.log('[useVaultSync] Vault already in sync');
          break;
      }

      const hasNewVault = result.action === 'downloaded' || result.action === 'merged';

      // Unlock vault to refresh database connection
      try {
        await NativeVaultManager.unlockVault();

        // Check if the vault needs migration
        if (await dbContext.hasPendingMigrations()) {
          onUpgradeRequired?.();
          return false;
        }

        onSuccess?.(hasNewVault);

        // Register credential identities after sync
        try {
          await NativeVaultManager.registerCredentialIdentities();
        } catch (error) {
          console.warn('Vault sync: Failed to register credential identities:', error);
        }

        return hasNewVault;
      } catch (err) {
        if (err instanceof VaultVersionIncompatibleError) {
          await app.logout(t(err.message));
          return false;
        }

        console.error('Failed to unlock vault:', err);
        throw new Error(t('common.errors.unknownErrorTryAgain'));
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

      // Check if it's a vault sync error with error code
      const errorCode = getVaultSyncErrorCode(err);
      if (errorCode) {
        return await handleSyncError(err, errorCode, app, dbContext, t, onError, onOffline);
      }

      const errorMessage = err instanceof Error ? err.message : t('common.errors.unknownError');
      onError?.(errorMessage);
      return false;
    } finally {
      syncInProgressRef.current = false;
    }
  }, [app, dbContext, t]);

  return { syncVault, getSyncState };
};

/**
 * Map error string from native to VaultSyncErrorCode.
 */
function getVaultSyncErrorCodeFromString(error: string): VaultSyncErrorCode | null {
  switch (error) {
    case VaultSyncErrorCode.SESSION_EXPIRED:
      return VaultSyncErrorCode.SESSION_EXPIRED;
    case VaultSyncErrorCode.AUTHENTICATION_FAILED:
      return VaultSyncErrorCode.AUTHENTICATION_FAILED;
    case VaultSyncErrorCode.PASSWORD_CHANGED:
      return VaultSyncErrorCode.PASSWORD_CHANGED;
    case VaultSyncErrorCode.CLIENT_VERSION_NOT_SUPPORTED:
      return VaultSyncErrorCode.CLIENT_VERSION_NOT_SUPPORTED;
    case VaultSyncErrorCode.SERVER_VERSION_NOT_SUPPORTED:
      return VaultSyncErrorCode.SERVER_VERSION_NOT_SUPPORTED;
    case VaultSyncErrorCode.SERVER_UNAVAILABLE:
      return VaultSyncErrorCode.SERVER_UNAVAILABLE;
    case VaultSyncErrorCode.NETWORK_ERROR:
      return VaultSyncErrorCode.NETWORK_ERROR;
    case VaultSyncErrorCode.TIMEOUT:
      return VaultSyncErrorCode.TIMEOUT;
    default:
      return null;
  }
}

/**
 * Handle sync errors by mapping error codes to appropriate actions.
 */
async function handleSyncError(
  err: unknown,
  errorCode: VaultSyncErrorCode | null,
  app: ReturnType<typeof useApp>,
  dbContext: ReturnType<typeof useDb>,
  t: (key: string) => string,
  onError?: (error: string) => void,
  onOffline?: () => void
): Promise<boolean> {
  switch (errorCode) {
    case VaultSyncErrorCode.SESSION_EXPIRED:
    case VaultSyncErrorCode.AUTHENTICATION_FAILED:
      await app.logout('Your session has expired. Please login again.');
      return false;

    case VaultSyncErrorCode.PASSWORD_CHANGED:
      await app.logout(t('vault.errors.passwordChanged'));
      return false;

    case VaultSyncErrorCode.CLIENT_VERSION_NOT_SUPPORTED:
      onError?.(t('vault.errors.versionNotSupported'));
      return false;

    case VaultSyncErrorCode.SERVER_VERSION_NOT_SUPPORTED:
      await app.logout(t('vault.errors.serverVersionNotSupported'));
      return false;

    case VaultSyncErrorCode.SERVER_UNAVAILABLE:
    case VaultSyncErrorCode.NETWORK_ERROR:
    case VaultSyncErrorCode.TIMEOUT:
      await dbContext.setIsOffline(true);
      onOffline?.();
      // Return true to continue with local vault
      return true;

    default:
      // Unknown error
      const errorMessage = err instanceof Error ? err.message : t('common.errors.unknownError');
      onError?.(errorMessage);
      return false;
  }
}
