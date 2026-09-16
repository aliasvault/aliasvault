import { logoutEventEmitter } from '@aliasvault/client/api/LogoutEventEmitter';
import React, { createContext, useContext, useMemo, useCallback, useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/context/AuthContext';
import { useWebApi } from '@/context/WebApiContext';
import { vaultStateEvents } from '@/events/VaultStateEvents';

type AppContextType = {
  isLoggedIn: boolean;
  isInitialized: boolean;
  username: string | null;
  logout: (errorMessage?: string) => Promise<void>;
  initializeAuth: () => Promise<boolean>;
  setAuthTokens: (username: string, accessToken: string, refreshToken: string) => Promise<void>;
  globalMessage: string | null;
  clearGlobalMessage: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

/**
 * AppProvider that coordinates between the auth, db and webApi contexts.
 */
export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth();
  const webApi = useWebApi();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const isLoggingOutRef = useRef(false);
  const { t } = useTranslation();

  /**
   * Forced logout: revoke the tokens and clear the session. User-initiated logout goes through the logout page.
   */
  const logout = useCallback(async (errorMessage?: string): Promise<void> => {
    if (isLoggingOutRef.current) {
      return;
    }

    try {
      isLoggingOutRef.current = true;
      await webApi.revokeTokens();
      await auth.clearAuthForced(errorMessage);
    } catch (error) {
      console.error('Error during logout:', error);
    } finally {
      isLoggingOutRef.current = false;
      setIsLoggedIn(false);
    }
  }, [auth, webApi]);

  /**
   * Initialize the authentication state.
   * @returns Whether the user is logged in.
   */
  const initializeAuth = useCallback(async (): Promise<boolean> => {
    const loggedIn = await auth.initializeAuth();
    setIsLoggedIn(loggedIn);
    return loggedIn;
  }, [auth]);

  /**
   * Set auth tokens and update the logged in state.
   */
  const setAuthTokens = useCallback(async (username: string, accessToken: string, refreshToken: string): Promise<void> => {
    await auth.setAuthTokens(username, accessToken, refreshToken);
    setIsLoggedIn(true);
  }, [auth]);

  /**
   * Subscribe to logout events from the WebApiService.
   */
  useEffect(() => {
    return logoutEventEmitter.subscribe(async (errorKey: string) => {
      await logout(t(errorKey));
    });
  }, [logout, t]);

  /**
   * Check for tokens in storage on initial load.
   */
  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  // Reflect logouts from other tabs.
  useEffect(() => {
    return vaultStateEvents.onLoggedOut(() => {
      setIsLoggedIn(false);
    });
  }, []);

  const contextValue = useMemo(() => ({
    isInitialized: auth.isInitialized,
    username: auth.username,
    globalMessage: auth.globalMessage,
    logout,
    initializeAuth,
    setAuthTokens,
    clearGlobalMessage: auth.clearGlobalMessage,
    isLoggedIn,
  }), [auth.isInitialized, auth.username, auth.globalMessage, auth.clearGlobalMessage, logout, initializeAuth, setAuthTokens, isLoggedIn]);

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
