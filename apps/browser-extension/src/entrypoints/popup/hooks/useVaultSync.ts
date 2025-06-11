import { useCallback } from 'react';
import { sendMessage } from 'webext-bridge/popup';

import { useAuth } from '@/entrypoints/popup/context/AuthContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';

import type { VaultResponse } from '@/utils/dist/shared/models/webapi';

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
}

/**
 * Hook to sync the vault with the server.
 */
export const useVaultSync = () : {
  syncVault: (options?: VaultSyncOptions) => Promise<boolean>;
} => {
  const authContext = useAuth();
  const dbContext = useDb();
  const webApi = useWebApi();

  const syncVault = useCallback(async (options: VaultSyncOptions = {}) => {
    const { initialSync = false, onSuccess, onError, onStatus, _onOffline } = options;

    // For the initial sync, we add an artifical delay to various steps which makes it feel more fluid.
    const enableDelay = initialSync;

    try {
      const { isLoggedIn } = await authContext.initializeAuth();

      if (!isLoggedIn) {
        // Not authenticated, return false immediately
        return false;
      }

      // Check app status and vault revision
      onStatus?.('Checking vault updates');
      const statusResponse = await withMinimumDelay(() => webApi.getStatus(), 300, enableDelay);

      // Check if server is actually available, 0.0.0 indicates connection error which triggers offline mode.
      if (statusResponse.serverVersion === '0.0.0') {
        // Offline mode is not implemented for browser extension yet, let it fail below due to the validateStatusResponse check.
      }

      const statusError = webApi.validateStatusResponse(statusResponse);
      if (statusError) {
        onError?.(statusError);
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
        onStatus?.('Syncing updated vault');
        const vaultResponseJson = await withMinimumDelay(() => webApi.get<VaultResponse>('Vault'), 1000, enableDelay);

        const vaultError = webApi.validateVaultResponse(vaultResponseJson as VaultResponse);
        if (vaultError) {
          // Only logout if it's an authentication error, not a network error
          if (vaultError.includes('authentication') || vaultError.includes('unauthorized')) {
            await webApi.logout(vaultError);
            onError?.(vaultError);
            return false;
          }

          /*
           *  TODO: browser extension does not support offline mode yet.
           *  For other errors, go into offline mode
           * authContext.setOfflineMode(true);
           */

          return false;
        }

        try {
          // Get derived key from background worker
          const passwordHashBase64 = await sendMessage('GET_DERIVED_KEY', {}, 'background') as string;
          await dbContext.initializeDatabase(vaultResponseJson as VaultResponse, passwordHashBase64);
          onSuccess?.(true);
          return true;
        } catch {
          // Vault could not be decrypted, throw an error
          throw new Error('Vault could not be decrypted, if problem persists please logout and login again.');
        }
      }

      await withMinimumDelay(() => Promise.resolve(onSuccess?.(false)), 300, enableDelay);
      return false;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error during vault sync';
      console.error('Vault sync error:', err);

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
  }, [authContext, dbContext, webApi]);

  return { syncVault };
};