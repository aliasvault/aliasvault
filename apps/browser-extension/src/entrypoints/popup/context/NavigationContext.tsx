import React, { createContext, useContext, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { AUTH_FLOW_PATHS } from '@/entrypoints/popup/utils/routes';

import type { NavigationStackState } from '@/utils/NavigationStack';
import { createNavigationStack, seedNavigationStack, trackNavigation } from '@/utils/NavigationStack';
import type { NavigationHistoryEntry } from '@/utils/NavigationStateService';
import { NavigationStateService } from '@/utils/NavigationStateService';

type NavigationContextType = {
  storeCurrentPage: () => Promise<void>;
  seedNavigationStack: (entries: NavigationHistoryEntry[]) => void;
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
  const navigationType = useNavigationType();

  // The pages visited in this popup, which is what a restore replays so back keeps working across popup opens.
  const navigationStack = useRef<NavigationStackState>(createNavigationStack());

  // Auth and DB state
  const { isInitialized: authInitialized, isLoggedIn } = useApp();
  const { dbInitialized, dbAvailable } = useDb();

  // Derived state
  const isFullyInitialized = authInitialized && dbInitialized;
  const requiresAuth = isFullyInitialized && (!isLoggedIn || !dbAvailable);

  /**
   * Adopt a restored navigation stack so it keeps growing from where the previous popup left off.
   * @param entries - The restored entries, oldest first
   */
  const seedStack = useCallback((entries: NavigationHistoryEntry[]): void => {
    navigationStack.current = seedNavigationStack(entries);
  }, []);

  /**
   * Track the current page in the navigation stack and persist it together with the visit time.
   */
  const storeCurrentPage = useCallback(async (): Promise<void> => {
    // Pages that are not allowed to be stored as these are auth conditional pages or dedicated popup pages.
    const notAllowedPaths = [
      ...AUTH_FLOW_PATHS,
      '/auth-settings',
      '/upgrade',
      '/passkeys/create',
      '/passkeys/authenticate'
    ];

    // Only store the page if we're fully initialized and don't need auth
    if (!isFullyInitialized || requiresAuth || notAllowedPaths.includes(location.pathname)) {
      return;
    }

    const entry: NavigationHistoryEntry = { pathname: location.pathname, search: location.search, hash: location.hash };
    navigationStack.current = trackNavigation(navigationStack.current, entry, navigationType);

    await NavigationStateService.storeNavigationState(location.pathname, navigationStack.current.stack);
  }, [location, navigationType, isFullyInitialized, requiresAuth]);

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

  /*
   * Redirect to /unlock when the vault becomes unavailable from another window
   * (e.g. lock triggered in the main popup while the popout is open). Reinitialize
   * handles the initial-load case, so skip the auth-flow paths.
   */
  useEffect(() => {
    if (isFullyInitialized && isLoggedIn && !dbAvailable && !AUTH_FLOW_PATHS.includes(location.pathname)) {
      navigate('/unlock', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullyInitialized, isLoggedIn, dbAvailable, location.pathname]);

  /*
   * If another window has logged in or unlocked the vault,
   * reload the page to reinitialize the app.
   */
  useEffect(() => {
    if (isFullyInitialized && isLoggedIn && dbAvailable && (location.pathname === '/login' || location.pathname === '/unlock')) {
      console.info('[NavigationContext] cross-window session active — leaving auth page', { from: location.pathname });
      navigate('/reinitialize', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullyInitialized, isLoggedIn, dbAvailable, location.pathname]);

  // Return the context value
  const contextValue = useMemo(() => ({
    storeCurrentPage,
    seedNavigationStack: seedStack,
    isFullyInitialized,
    requiresAuth
  }), [storeCurrentPage, seedStack, isFullyInitialized, requiresAuth]);

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
