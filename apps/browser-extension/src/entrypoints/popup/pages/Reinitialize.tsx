import React, { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { sendMessage } from 'webext-bridge/popup';

import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { consumePendingRedirectUrl } from '@/entrypoints/popup/hooks/useVaultLockRedirect';
import { useVaultSync } from '@/entrypoints/popup/hooks/useVaultSync';

import { storage } from '#imports';

const LAST_VISITED_PAGE_KEY = 'session:lastVisitedPage';
const LAST_VISITED_TIME_KEY = 'session:lastVisitedTime';
const NAVIGATION_HISTORY_KEY = 'session:navigationHistory';
const PAGE_MEMORY_DURATION = 120 * 1000; // 2 minutes in milliseconds

type NavigationHistoryEntry = {
  pathname: string;
  search: string;
  hash: string;
};

/**
 * Initialize component that handles initial application setup, authentication checks,
 * vault synchronization, and state restoration.
 */
const Reinitialize: React.FC = () => {
  const navigate = useNavigate();
  const { setIsInitialLoading } = useLoading();
  const { syncVault } = useVaultSync();
  const hasInitialized = useRef(false);

  // Auth and DB state
  const { isInitialized: authInitialized, isLoggedIn } = useApp();
  const { dbInitialized, dbAvailable } = useDb();

  // Derived state
  const isFullyInitialized = authInitialized && dbInitialized;
  const requiresAuth = isFullyInitialized && (!isLoggedIn || !dbAvailable);

  /**
   * Restore the last visited page and navigation history if it was visited within the memory duration.
   */
  const restoreLastPage = useCallback(async (): Promise<void> => {
    const [lastPage, lastVisitTime, savedHistory] = await Promise.all([
      storage.getItem(LAST_VISITED_PAGE_KEY) as Promise<string>,
      storage.getItem(LAST_VISITED_TIME_KEY) as Promise<number>,
      storage.getItem(NAVIGATION_HISTORY_KEY) as Promise<NavigationHistoryEntry[]>,
    ]);

    if (lastPage && lastVisitTime) {
      const timeSinceLastVisit = Date.now() - lastVisitTime;
      if (timeSinceLastVisit <= PAGE_MEMORY_DURATION) {
        // For nested routes, build up the navigation history properly
        if (savedHistory?.length > 1) {
          // Navigate to the base route first
          navigate(savedHistory[0].pathname, { replace: true });
          // Then navigate to the final destination
          navigate(lastPage, { replace: false });
        } else {
          // Simple navigation for non-nested routes
          navigate(lastPage, { replace: true });
        }
        return;
      }
    }

    // Duration has expired, clear all stored navigation data
    await Promise.all([
      storage.removeItem(LAST_VISITED_PAGE_KEY),
      storage.removeItem(LAST_VISITED_TIME_KEY),
      storage.removeItem(NAVIGATION_HISTORY_KEY),
      sendMessage('CLEAR_PERSISTED_FORM_VALUES', null, 'background'),
    ]);

    // Navigate to the credentials page as default entry page
    navigate('/credentials', { replace: true });
  }, [navigate]);

  useEffect(() => {
    /**
     * Handle initialization and redirect logic
     */
    const handleInitialization = async (): Promise<void> => {
      // Check for inline unlock mode
      const urlParams = new URLSearchParams(window.location.search);
      const inlineUnlock = urlParams.get('mode') === 'inline_unlock';

      // Check for pending redirect URL in storage (set by useVaultLockRedirect hook)
      const pendingRedirectUrl = await consumePendingRedirectUrl();

      if (!isFullyInitialized) {
        return;
      }
      // Prevent multiple vault syncs (only run sync once)
      const shouldRunSync = !hasInitialized.current;

      if (requiresAuth) {
        setIsInitialLoading(false);

        // Determine which auth page to show
        if (!isLoggedIn) {
          navigate('/login', { replace: true });
        } else if (!dbAvailable) {
          // Navigate to unified unlock page (handles both PIN and password)
          navigate('/unlock', { replace: true });
        }
      } else if (shouldRunSync) {
        // Only perform vault sync once during initialization
        hasInitialized.current = true;

        // Perform vault sync and restore state
        syncVault({
          initialSync: false,
          /**
           * Handle successful vault sync.
           */
          onSuccess: async () => {
            // After successful sync, try to restore last page or go to credentials
            if (inlineUnlock) {
              setIsInitialLoading(false);
              navigate('/unlock-success', { replace: true });
            } else if (pendingRedirectUrl) {
              // If there's a pending redirect URL in storage, use it (most reliable)
              setIsInitialLoading(false);
              navigate(pendingRedirectUrl, { replace: true });
            } else {
              await restoreLastPage();
            }
          },
          /**
           * Handle vault sync error.
           * @param error Error message
           */
          onError: (error) => {
            console.error('Vault sync error during initialization:', error);
            // Even if sync fails, continue with initialization
            restoreLastPage().then(() => {
              setIsInitialLoading(false);
            });
          },
          /**
           * Handle upgrade required.
           */
          onUpgradeRequired: () => {
            navigate('/upgrade', { replace: true });
            setIsInitialLoading(false);
          }
        });
      } else {
        // User is logged in and db is available, navigate to appropriate page
        setIsInitialLoading(false);
        restoreLastPage();
      }
    };

    handleInitialization();
  }, [isFullyInitialized, requiresAuth, isLoggedIn, dbAvailable, navigate, setIsInitialLoading, syncVault, restoreLastPage]);

  // This component doesn't render anything visible - it just handles initialization
  return null;
};

export default Reinitialize;
