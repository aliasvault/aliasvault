import React, { createContext, useContext, useMemo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/entrypoints/popup/context/AuthContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';

import { logoutEventEmitter } from '@/events/LogoutEventEmitter';

type AppContextType = {
  isLoggedIn: boolean;
  isInitialized: boolean;
  username: string | null;
  logout: (errorMessage?: string) => Promise<void>;
  initializeAuth: () => Promise<boolean>;
  setAuthTokens: (username: string, accessToken: string, refreshToken: string) => Promise<void>;
  globalMessage: string | null;
  clearGlobalMessage: () => void;
  isLoggingOut: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

/**
 * AppProvider that coordinates between auth, db, and webApi contexts.
 */
export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth();
  const webApi = useWebApi();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const { t } = useTranslation();

  /**
   * Logout the user by revoking tokens and clearing the auth tokens from storage.
   * Prevents recursive logout calls by tracking logout state.
   */
  const logout = useCallback(async (errorMessage?: string): Promise<void> => {
    // Prevent recursive logout calls
    if (isLoggingOut) {
      console.debug('Logout already in progress, ignoring duplicate call');
      return;
    }

    try {
      setIsLoggingOut(true);
      await webApi.revokeTokens();
      await auth.clearAuth(errorMessage);
      setIsLoggedIn(false);
    } catch (error) {
      console.error('Error during logout:', error);
    } finally {
      setIsLoggingOut(false);
    }
  }, [auth, webApi, isLoggingOut]);

  /**
   * Initialize the authentication state.
   *
   * @returns boolean indicating whether the user is logged in.
   */
  const initializeAuth = useCallback(async () : Promise<boolean> => {
    const isLoggedIn = await auth.initializeAuth();
    setIsLoggedIn(isLoggedIn);
    return isLoggedIn;
  }, [auth]);

  /**
   * Subscribe to logout events from WebApiService.
   */
  useEffect(() => {
    const unsubscribe = logoutEventEmitter.subscribe(async (errorKey: string) => {
      await logout(t(errorKey));
    });

    return unsubscribe;
  }, [logout, t]);

  /**
   * Check for tokens in browser local storage on initial load when this context is mounted.
   */
  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  const contextValue = useMemo(() => ({
    // Pass through auth state
    isInitialized: auth.isInitialized,
    username: auth.username,
    globalMessage: auth.globalMessage,
    // Wrap auth methods
    logout,
    initializeAuth,
    setAuthTokens: auth.setAuthTokens,
    clearGlobalMessage: auth.clearGlobalMessage,
    isLoggedIn: isLoggedIn,
    isLoggingOut: isLoggingOut,
  }), [
    auth.isInitialized,
    auth.username,
    auth.globalMessage,
    auth.setAuthTokens,
    auth.clearGlobalMessage,
    logout,
    initializeAuth,
    isLoggedIn,
    isLoggingOut,
  ]);

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
};

/**
 * Hook to use the AppContext.
 */
export const useApp = (): AppContextType => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};