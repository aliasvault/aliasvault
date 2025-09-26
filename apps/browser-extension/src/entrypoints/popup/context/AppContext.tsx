import React, { createContext, useContext, useMemo, useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/entrypoints/popup/context/AuthContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';

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
 * AppProvider that coordinates between auth, db, and webApi contexts.
 */
export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth();
  const webApi = useWebApi();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  /**
   * Logout the user by revoking tokens and clearing the auth tokens from storage.
   */
  const logout = useCallback(async (errorMessage?: string): Promise<void> => {
    await webApi.revokeTokens();
    await auth.clearAuth(errorMessage);
  }, [auth, webApi]);

  /**
   * Initialize the authentication state.
   *
   * @returns boolean indicating whether the user is logged in.
   */
  const initializeAuth = useCallback(async () : Promise<boolean> => {
    console.log('initializeAuth');
    const isLoggedIn = await auth.initializeAuth();
    console.log('isLoggedIn', isLoggedIn);
    setIsLoggedIn(isLoggedIn);
    return isLoggedIn;
  }, [auth]);

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
  }), [
    auth.isInitialized,
    auth.username,
    auth.globalMessage,
    auth.setAuthTokens,
    auth.clearGlobalMessage,
    logout,
    initializeAuth,
    isLoggedIn,
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