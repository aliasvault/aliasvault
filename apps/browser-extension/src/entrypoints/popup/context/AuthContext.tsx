import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { sendMessage } from 'webext-bridge/popup';

import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';

import { VAULT_LOCKED_DISMISS_UNTIL_KEY } from '@/utils/Constants';

import { storage } from '#imports';

type AuthContextType = {
  isLoggedIn: boolean;
  isInitialized: boolean;
  username: string | null;
  initializeAuth: () => Promise<{ isLoggedIn: boolean }>;
  setAuthTokens: (username: string, accessToken: string, refreshToken: string) => Promise<void>;
  login: () => Promise<void>;
  logout: (errorMessage?: string) => Promise<void>;
  globalMessage: string | null;
  clearGlobalMessage: () => void;
}

/**
 * Auth context.
 */
const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * AuthProvider to provide the authentication state to the app that components can use.
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [globalMessage, setGlobalMessage] = useState<string | null>(null);
  const dbContext = useDb();
  const webApi = useWebApi();

  /**
   * Initialize the authentication state.
   *
   * @returns object containing whether the user is logged in.
   */
  const initializeAuth = useCallback(async () : Promise<{ isLoggedIn: boolean }> => {
    let isLoggedIn = false;

    const accessToken = await storage.getItem('local:accessToken') as string;
    const refreshToken = await storage.getItem('local:refreshToken') as string;
    const username = await storage.getItem('local:username') as string;
    if (accessToken && refreshToken && username) {
      setUsername(username);
      setIsLoggedIn(true);
      isLoggedIn = true;
    }
    setIsInitialized(true);

    return { isLoggedIn };
  }, [setUsername, setIsLoggedIn]);

  /**
   * Check for tokens in browser local storage on initial load when this context is mounted.
   */
  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  /**
   * Set auth tokens in browser local storage as part of the login process. After db is initialized, the login method should be called as well.
   */
  const setAuthTokens = useCallback(async (username: string, accessToken: string, refreshToken: string) : Promise<void> => {
    await storage.setItem('local:username', username);
    await storage.setItem('local:accessToken', accessToken);
    await storage.setItem('local:refreshToken', refreshToken);

    setUsername(username);
  }, []);

  /**
   * Set logged in status to true which refreshes the app.
   */
  const login = useCallback(async () : Promise<void> => {
    setIsLoggedIn(true);

    // Clear dismiss until (which can be enabled after user has dimissed vault is locked popup) to ensure popup is shown.
    await storage.setItem(VAULT_LOCKED_DISMISS_UNTIL_KEY, 0);
  }, []);

  /**
   * Logout the user and clear the auth tokens from chrome storage.
   */
  const logout = useCallback(async (errorMessage?: string) : Promise<void> => {
    // Logout and revoke tokens via WebApi.
    await webApi.revokeTokens();

    // Clear vault from background worker and remove local storage tokens.
    await sendMessage('CLEAR_VAULT', {}, 'background');
    await storage.removeItems(['local:username', 'local:accessToken', 'local:refreshToken']);
    dbContext?.clearDatabase();

    // Set local storage global message that will be shown on the login page.
    if (errorMessage) {
      setGlobalMessage(errorMessage);
    }

    setUsername(null);
    setIsLoggedIn(false);
  }, [dbContext, webApi]);

  /**
   * Clear global message (called after displaying the message).
   */
  const clearGlobalMessage = useCallback(() : void => {
    setGlobalMessage(null);
  }, []);

  const contextValue = useMemo(() => ({
    isLoggedIn,
    isInitialized,
    username,
    initializeAuth,
    setAuthTokens,
    login,
    logout,
    globalMessage,
    clearGlobalMessage,
  }), [isLoggedIn, isInitialized, username, initializeAuth, globalMessage, setAuthTokens, login, logout, clearGlobalMessage]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

/**
 * Hook to use the AuthContext
 */
export const useAuth = () : AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};