import { useCallback, useRef } from 'react';

import { VaultAuthenticationError } from '@/utils/types/errors/VaultAuthenticationError';
import { useTranslation } from '@/hooks/useTranslation';

import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';
import NativeVaultManager from '@/specs/NativeVaultManager';
import { VaultVersionIncompatibleError } from '@/utils/types/errors/VaultVersionIncompatibleError';
import {
  AppErrorCode,
  getAppErrorCode,
  extractErrorCode,
  formatErrorWithCode,
  getErrorTranslationKey,
} from '@/utils/types/errors/AppErrorCodes';

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
          const errorCode = extractErrorCode(result.error) ?? getAppErrorCode(result.error);
          if (errorCode) {
            return await handleSyncError(result.error, errorCode, app, dbContext, t, onError, onOffline);
          }
        }

        if (result.wasOffline) {
          await dbContext.setIsOffline(true);
          console.log('[useVaultSync] Set offline mode');
          onOffline?.();
          // Return true to continue with local vault
          return true;
        }

        // For unrecognized errors (no error code found), use translated fallback with error code
        // This ensures users always see a translated message with a code they can report
        const fallbackError = formatErrorWithCode(
          t('common.errors.unknownErrorTryAgain'),
          AppErrorCode.UNKNOWN_ERROR
        );
        onError?.(fallbackError);
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

        // Return true for successful sync (regardless of whether vault changed)
        return true;
      } catch (err) {
        if (err instanceof VaultVersionIncompatibleError) {
          await app.logout(t(err.message));
          return false;
        }

        // Extract the specific error code from native layer if available
        // This preserves detailed error info (E-501 to E-511) for debugging
        const nativeErrorCode = getAppErrorCode(err);
        const errorCode = nativeErrorCode ?? AppErrorCode.NATIVE_UNLOCK_FAILED;

        console.error(`Failed to unlock vault (${errorCode}):`, err);

        // Re-throw with the specific error code for proper handling
        throw new Error(formatErrorWithCode(
          t(getErrorTranslationKey(errorCode)),
          errorCode
        ));
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

      // Check if it's a vault sync error with error code (from error object or message)
      const errorCode = getAppErrorCode(err);
      if (errorCode) {
        return await handleSyncError(err, errorCode, app, dbContext, t, onError, onOffline);
      }

      // For unrecognized errors, always use translated message with error code
      // This ensures users never see raw English error messages from native layer
      const extractedCode = err instanceof Error ? extractErrorCode(err.message) : null;
      const fallbackCode = extractedCode ?? AppErrorCode.UNKNOWN_ERROR;
      const translationKey = getErrorTranslationKey(fallbackCode);
      const errorMessage = formatErrorWithCode(t(translationKey), fallbackCode);
      onError?.(errorMessage);
      return false;
    } finally {
      syncInProgressRef.current = false;
    }
  }, [app, dbContext, t]);

  return { syncVault, getSyncState };
};

/**
 * Handle sync errors by mapping error codes to appropriate actions.
 *
 * For critical errors requiring logout (auth, version), we ALWAYS use app.logout(message)
 * which shows a native Alert.alert that persists through navigation on both platforms.
 * The onError callback is only used for non-critical errors that don't require logout.
 *
 * Error codes are included in messages to help users report issues for debugging.
 */
async function handleSyncError(
  _err: unknown,
  errorCode: AppErrorCode,
  app: ReturnType<typeof useApp>,
  dbContext: ReturnType<typeof useDb>,
  t: (key: string) => string,
  onError?: (error: string) => void,
  onOffline?: () => void
): Promise<boolean> {
  // Get the translated message for this error code
  const translationKey = getErrorTranslationKey(errorCode);
  const translatedMessage = t(translationKey);

  // Format with error code for user reporting
  const messageWithCode = formatErrorWithCode(translatedMessage, errorCode);

  switch (errorCode) {
    // Authentication errors - logout with message (shows native alert)
    case AppErrorCode.SESSION_EXPIRED:
    case AppErrorCode.AUTHENTICATION_FAILED:
      await app.logout(messageWithCode);
      return false;

    case AppErrorCode.PASSWORD_CHANGED:
      await app.logout(messageWithCode);
      return false;

    // Version compatibility errors - logout with message (shows native alert)
    case AppErrorCode.CLIENT_VERSION_NOT_SUPPORTED:
    case AppErrorCode.SERVER_VERSION_NOT_SUPPORTED:
    case AppErrorCode.VAULT_VERSION_INCOMPATIBLE:
      await app.logout(messageWithCode);
      return false;

    // Network errors - set offline mode, don't logout
    case AppErrorCode.SERVER_UNAVAILABLE:
    case AppErrorCode.NETWORK_ERROR:
    case AppErrorCode.TIMEOUT:
      await dbContext.setIsOffline(true);
      onOffline?.();
      // Return true to continue with local vault
      return true;

    // All other errors - show error with code for debugging
    default:
      onError?.(messageWithCode);
      return false;
  }
}
