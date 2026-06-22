import React, { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import useCurrentTabMatching from '@/entrypoints/popup/hooks/useCurrentTabMatching';
import { consumePendingRedirectUrl } from '@/entrypoints/popup/hooks/useVaultLockRedirect';
import { useVaultSync } from '@/entrypoints/popup/hooks/useVaultSync';

import { sendMessage } from '@/utils/messaging/ExtensionMessaging';

import { storage } from '#imports';

const LAST_VISITED_PAGE_KEY = 'session:lastVisitedPage';
const LAST_VISITED_TIME_KEY = 'session:lastVisitedTime';
const NAVIGATION_HISTORY_KEY = 'session:navigationHistory';
const LAST_TAB_URL_KEY = 'session:lastTabUrl';
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
  const location = useLocation();
  const { setIsInitialLoading } = useLoading();
  const { syncVault } = useVaultSync();
  const { matchCurrentTab } = useCurrentTabMatching();
  const hasInitialized = useRef(false);

  // Auth and DB state
  const { isInitialized: authInitialized, isLoggedIn } = useApp();
  const { dbInitialized, dbAvailable, refreshSyncState, hasPendingMigrations } = useDb();

  // Derived state
  const isFullyInitialized = authInitialized && dbInitialized;
  const requiresAuth = isFullyInitialized && (!isLoggedIn || !dbAvailable);

  /**
   * Navigate to the items index when the popup opens with a fresh (non-restored) state.
   */
  const navigateToIndex = useCallback((): void => {
    navigate('/items', { replace: true });
  }, [navigate]);

  /**
   * Restore the last visited page and navigation history if it was visited within the memory duration.
   * Compares with URL matching result: if user navigated away from matched page, restore their navigation.
   */
  const restoreLastPage = useCallback(async (): Promise<void> => {
    /*
     * Run URL matching so we can detect tab changes (used to decide between
     * restoring the last page vs. showing a fresh index).
     */
    const matchResult = await matchCurrentTab();

    const [lastPage, lastVisitTime, savedHistory, lastTabUrl] = await Promise.all([
      storage.getItem(LAST_VISITED_PAGE_KEY) as Promise<string>,
      storage.getItem(LAST_VISITED_TIME_KEY) as Promise<number>,
      storage.getItem(NAVIGATION_HISTORY_KEY) as Promise<NavigationHistoryEntry[]>,
      storage.getItem(LAST_TAB_URL_KEY) as Promise<string>,
    ]);

    // Check if user switched to a different tab (different URL)
    const currentTabUrl = matchResult?.currentUrl;
    const hasTabChanged = currentTabUrl && lastTabUrl && currentTabUrl !== lastTabUrl;

    if (lastPage && lastVisitTime) {
      const timeSinceLastVisit = Date.now() - lastVisitTime;
      if (timeSinceLastVisit <= PAGE_MEMORY_DURATION) {
        /*
         * Show a fresh items index if:
         * - Tab URL has changed (user switched tabs), or
         * - lastPage is the default index (/items, no search query) - the "home" state.
         *
         * Otherwise restore the user's navigation, since they had navigated to a
         * specific page (settings, add/edit forms, a particular item, folder view,
         * search queries, etc.) that we want to bring them back to.
         */
        const lastHistoryEntry = savedHistory?.[savedHistory.length - 1];
        const hasSearchQuery = lastHistoryEntry?.search && lastHistoryEntry.search.length > 0;
        const isOnDefaultIndexPage = lastPage === '/items' && !hasSearchQuery;
        const shouldUseFreshMatch = hasTabChanged || isOnDefaultIndexPage;

        if (!shouldUseFreshMatch) {
          // Restore user's navigation since they navigated away from auto-matched page
          if (savedHistory?.length > 1) {
            // Navigate to the base route first
            const firstEntry = savedHistory[0];
            const firstPath = firstEntry.pathname + (firstEntry.search || '');
            navigate(firstPath, { replace: true });
            // Then navigate to the final destination with search params
            const finalPath = lastPage + (lastHistoryEntry?.search || '');
            navigate(finalPath, { replace: false });
          } else {
            // Simple navigation for non-nested routes
            const fullPath = lastPage + (lastHistoryEntry?.search || '');
            navigate(fullPath, { replace: true });
          }
          return;
        }
      }
    }

    // Clear stored navigation data since we're using fresh URL matching
    await Promise.all([
      storage.removeItem(LAST_VISITED_PAGE_KEY),
      storage.removeItem(LAST_VISITED_TIME_KEY),
      storage.removeItem(NAVIGATION_HISTORY_KEY),
      sendMessage('CLEAR_PERSISTED_FORM_VALUES'),
    ]);

    // Save current tab URL for future tab-switch detection
    if (currentTabUrl) {
      await storage.setItem(LAST_TAB_URL_KEY, currentTabUrl);
    }

    // Navigate to the items index: any current-site match is shown as a suggestion there.
    navigateToIndex();
  }, [navigate, matchCurrentTab, navigateToIndex]);

  /**
   * Run sync in background. If server has newer vault, useVaultSync will:
   * 1. Download and merge (if needed)
   * 2. Call dbContext.loadDatabase() which updates sqliteClient
   * 3. ItemsList reacts to sqliteClient changes and auto-refreshes
   *
   * Note: onSuccess triggers refreshSyncState to ensure any UI components
   * watching sync state will re-render with the updated vault data.
   */
  const runBackgroundSync = useCallback((): void => {
    if (hasInitialized.current) {
      return;
    }
    hasInitialized.current = true;

    syncVault({
      /**
       * Handle successful sync - refresh sync state to trigger UI updates.
       * @param _hasNewVault Whether a new vault was downloaded
       */
      onSuccess: async (_hasNewVault) => {
        await refreshSyncState();
      },
      /**
       * Handle upgrade required - redirect to upgrade page.
       */
      onUpgradeRequired: () => {
        navigate('/upgrade', { replace: true });
      },
      /**
       * Handle sync errors silently - user already has local vault.
       * @param error Error message
       */
      onError: (error) => {
        console.error('Background vault sync error:', error);
      }
    });
  }, [syncVault, refreshSyncState, navigate]);

  /**
   * Note: by depending on `location.key`, this effect re-runs navigation logic if `/reinitialize` is visited again
   * without remounting (e.g. after unlock or login). This prevents the user from getting stuck on a blank page.
   */
  useEffect(() => {
    /**
     * Handle initialization and redirect logic
     */
    const handleInitialization = async (): Promise<void> => {
      // Check for inline unlock mode
      const urlParams = new URLSearchParams(window.location.search);
      const inlineUnlock = urlParams.get('mode') === 'inline_unlock';

      if (!isFullyInitialized) {
        return;
      }

      if (requiresAuth) {
        setIsInitialLoading(false);

        // Determine which auth page to show
        if (!isLoggedIn) {
          navigate('/login', { replace: true });
        } else if (!dbAvailable) {
          navigate('/unlock', { replace: true });
        }
        return;
      }

      // Check for pending migrations before navigating
      if (await hasPendingMigrations()) {
        setIsInitialLoading(false);
        navigate('/upgrade', { replace: true });
        return;
      }

      /**
       * Navigate immediately using local vault without waiting for sync. 
       * This ensures the UI is responsive even if server is slow to respond.
       * All branches below are idempotent so this can safely run more than once (see the `location.key` note above).
       */
      setIsInitialLoading(false);
      if (inlineUnlock) {
        navigate('/unlock-success', { replace: true });
      } else {
        // Check for pending redirect URL in storage (set by useVaultLockRedirect hook)
        const pendingRedirectUrl = await consumePendingRedirectUrl();
        if (pendingRedirectUrl) {
          navigate(pendingRedirectUrl, { replace: true });
        } else {
          await restoreLastPage();
        }
      }

      // Run the background sync once.
      runBackgroundSync();
    };

    handleInitialization();
  }, [isFullyInitialized, requiresAuth, isLoggedIn, dbAvailable, location.key, navigate, setIsInitialLoading, restoreLastPage, hasPendingMigrations, runBackgroundSync]);

  // This component doesn't render anything visible, it only handles initialization logic.
  return null;
};

export default Reinitialize;
