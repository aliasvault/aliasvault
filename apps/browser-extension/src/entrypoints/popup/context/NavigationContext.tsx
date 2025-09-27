import React, { createContext, useContext, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';

import { storage } from '#imports';

const LAST_VISITED_PAGE_KEY = 'session:lastVisitedPage';
const LAST_VISITED_TIME_KEY = 'session:lastVisitedTime';
const NAVIGATION_HISTORY_KEY = 'session:navigationHistory';

type NavigationHistoryEntry = {
  pathname: string;
  search: string;
  hash: string;
};

type NavigationContextType = {
  storeCurrentPage: () => Promise<void>;
  isFullyInitialized: boolean;
  requiresAuth: boolean;
};

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

/**
 * Navigation provider component that handles storing the last visited page.
 */
export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();

  // Auth and DB state
  const { isInitialized: authInitialized, isLoggedIn } = useApp();
  const { dbInitialized, dbAvailable } = useDb();

  // Derived state
  const isFullyInitialized = authInitialized && dbInitialized;
  const requiresAuth = isFullyInitialized && (!isLoggedIn || !dbAvailable);

  /**
   * Store the current page path, timestamp, and navigation history in storage.
   */
  const storeCurrentPage = useCallback(async (): Promise<void> => {
    // Pages that are not allowed to be stored as these are auth conditional pages.
    const notAllowedPaths = ['/', '/reinitialize', '/login', '/unlock', '/unlock-success', '/auth-settings', '/upgrade', '/logout'];

    // Only store the page if we're fully initialized and don't need auth
    if (isFullyInitialized && !requiresAuth && !notAllowedPaths.includes(location.pathname)) {
      // Split the path into segments and build up the history
      const segments = location.pathname.split('/').filter(Boolean);
      const historyEntries: NavigationHistoryEntry[] = [];

      // Build history entries for each segment
      let currentPath = '';
      for (let i = 0; i < segments.length; i++) {
        currentPath += '/' + segments[i];

        /*
         * For settings subpages, include both /settings and the subpage
         * For email details, include both /emails and the specific email
         */
        historyEntries.push({
          pathname: currentPath,
          search: location.search,
          hash: location.hash,
        });
      }

      await Promise.all([
        storage.setItem(LAST_VISITED_PAGE_KEY, location.pathname),
        storage.setItem(LAST_VISITED_TIME_KEY, Date.now()),
        storage.setItem(NAVIGATION_HISTORY_KEY, historyEntries),
      ]);
    }
  }, [location, isFullyInitialized, requiresAuth]);

  // Store the current page whenever it changes
  useEffect(() => {
    if (isFullyInitialized) {
      storeCurrentPage();
    }
  }, [location.pathname, location.search, location.hash, isFullyInitialized, storeCurrentPage]);

  // Listen on isloggedin state to redirect to login page if not logged in
  useEffect(() => {
    if (isFullyInitialized && !isLoggedIn) {
      navigate('/login', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullyInitialized, isLoggedIn]);

  // Return the context value
  const contextValue = useMemo(() => ({
    storeCurrentPage,
    isFullyInitialized,
    requiresAuth
  }), [storeCurrentPage, isFullyInitialized, requiresAuth]);

  return (
    <NavigationContext.Provider value={contextValue}>
      {children}
    </NavigationContext.Provider>
  );
};

/**
 * Hook to access the navigation context.
 * @returns The navigation context
 */
export const useNavigation = (): NavigationContextType => {
  const context = useContext(NavigationContext);
  if (context === undefined) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
};
