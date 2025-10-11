import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useDb } from '@/entrypoints/popup/context/DbContext';

import { PENDING_REDIRECT_URL_KEY } from '@/utils/Constants';

import { storage } from '#imports';

/**
 * Hook to handle vault lock redirects.
 * Automatically redirects to unlock page if vault is locked,
 * preserving the current URL for restoration after unlock.
 */
export function useVaultLockRedirect(options: { enabled?: boolean } = {}): { isLocked: boolean } {
  const { enabled = true } = options;
  const location = useLocation();
  const navigate = useNavigate();
  const { dbInitialized, dbAvailable } = useDb();

  useEffect(() => {
    if (!enabled || !dbInitialized) {
      return;
    }

    // Check if vault is locked
    if (!dbAvailable) {
      // Store the full current URL (pathname + search) for restoration after unlock
      const currentUrl = `${location.pathname}${location.search}`;
      storage.setItem(PENDING_REDIRECT_URL_KEY, currentUrl);

      // Navigate to unlock without redirect in URL - we use storage instead
      navigate('/unlock');
    }
  }, [enabled, dbInitialized, dbAvailable, location, navigate]);

  return {
    isLocked: dbInitialized && !dbAvailable
  };
}

/**
 * Get and clear the pending redirect URL from storage.
 * Used by Reinitialize page to restore user's intended destination after unlock.
 *
 * @returns The pending redirect URL, or null if none exists
 */
export async function consumePendingRedirectUrl(): Promise<string | null> {
  const url = await storage.getItem<string>(PENDING_REDIRECT_URL_KEY);
  if (url) {
    await storage.removeItem(PENDING_REDIRECT_URL_KEY);
  }
  return url;
}

/**
 * Clear the pending redirect URL from storage.
 * Used when popup is opened without a specific hash path to clear stale redirects.
 */
export async function clearPendingRedirectUrl(): Promise<void> {
  await storage.removeItem(PENDING_REDIRECT_URL_KEY);
}
