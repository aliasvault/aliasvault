import { useCallback } from 'react';

import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useVaultSync } from '@/entrypoints/popup/hooks/useVaultSync';

import { logFailure } from '@/utils/Diagnostics';

/** Minimum time the full screen spinner stays up, so a fast refresh still visibly does something. */
const MIN_SPINNER_MS = 150;

/**
 * Manual "refresh" action: syncs the vault with the server. Pages reload their data when the (new) sqlite client is set.
 */
export const useVaultRefresh = (): (() => Promise<void>) => {
  const dbContext = useDb();
  const app = useApp();
  const { showLoading, hideLoading } = useLoading();
  const { syncVault } = useVaultSync();

  return useCallback(async (): Promise<void> => {
    if (!dbContext?.sqliteClient) {
      return;
    }

    const startedAt = Date.now();
    showLoading();
    try {
      await syncVault({
        /**
         * On error.
         */
        onError: (error) => {
          logFailure('Error syncing vault', error);
        },
      });
    } catch (err) {
      logFailure('Error refreshing vault', err);
      await app.logout('Error while syncing vault, please re-authenticate.');
    } finally {
      const remaining = MIN_SPINNER_MS - (Date.now() - startedAt);
      if (remaining > 0) {
        await new Promise(resolve => setTimeout(resolve, remaining));
      }
      hideLoading();
    }
  }, [dbContext, app, syncVault, showLoading, hideLoading]);
};
