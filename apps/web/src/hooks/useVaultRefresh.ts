import { useCallback } from 'react';

import { useLoading } from '@/context/LoadingContext';
import { useVaultSync } from '@/hooks/useVaultSync';

/** Minimum time the full screen spinner stays up for UX purposes. */
const MIN_SPINNER_MS = 150;

/**
 * Manual "refresh" action: syncs the vault with the server, then calls `reload` so the page shows the synced data.
 * @param reload - reloads the page's data from the local vault
 */
export const useVaultRefresh = (reload: () => void): (() => Promise<void>) => {
  const { showLoading, hideLoading } = useLoading();
  const { syncVault } = useVaultSync();

  return useCallback(async (): Promise<void> => {
    const startedAt = Date.now();
    showLoading();
    try {
      await syncVault({ onSuccess: reload });
    } finally {
      const remaining = MIN_SPINNER_MS - (Date.now() - startedAt);
      if (remaining > 0) {
        await new Promise(resolve => setTimeout(resolve, remaining));
      }
      hideLoading();
    }
  }, [reload, syncVault, showLoading, hideLoading]);
};
