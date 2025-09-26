import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { sendMessage } from 'webext-bridge/popup';

import { useDb } from '@/entrypoints/popup/context/DbContext';

import { VAULT_LOCKED_DISMISS_UNTIL_KEY } from '@/utils/Constants';

import { storage } from '#imports';

type AuthContextType = {
  isInitialized: boolean;
  username: string | null;
  initializeAuth: () => Promise<boolean>;
  setAuthTokens: (username: string, accessToken: string, refreshToken: string) => Promise<void>;
  clearAuth: (errorMessage?: string) => Promise<void>;
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
  const [isInitialized, setIsInitialized] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [globalMessage, setGlobalMessage] = useState<string | null>(null);
  const dbContext = useDb();

  /**
   * Initialize the authentication state.
   *
   * @returns boolean indicating whether the user is logged in.
   */
  const initializeAuth = useCallback(async () : Promise<boolean> => {
    const accessToken = await storage.getItem('local:accessToken') as string;
    const refreshToken = await storage.getItem('local:refreshToken') as string;
    const username = await storage.getItem('local:username') as string;
    setIsInitialized(true);
    if (accessToken && refreshToken && username) {
      setUsername(username);
      return true;
    }

    return false;
  }, [setUsername]);

  /**
   * Set auth tokens in browser local storage as part of the login process. After db is initialized, the login method should be called as well.
   */
  const setAuthTokens = useCallback(async (username: string, accessToken: string, refreshToken: string) : Promise<void> => {
    await storage.setItem('local:username', username);
    await storage.setItem('local:accessToken', accessToken);
    await storage.setItem('local:refreshToken', refreshToken);

    // Clear dismiss until (which can be enabled after user has dimissed vault is locked popup) to ensure popup is shown.
    await storage.setItem(VAULT_LOCKED_DISMISS_UNTIL_KEY, 0);

    setUsername(username);
  }, []);

  /**
   * Clear authentication data and tokens from storage.
   * This is called by AppContext after revoking tokens on the server.
   */
  const clearAuth = useCallback(async (errorMessage?: string) : Promise<void> => {
    // Clear vault from background worker and remove local storage tokens.
    await sendMessage('CLEAR_VAULT', {}, 'background');
    await storage.removeItems(['local:username', 'local:accessToken', 'local:refreshToken']);
    dbContext?.clearDatabase();

    // Set local storage global message that will be shown on the login page.
    if (errorMessage) {
      setGlobalMessage(errorMessage);
    }

    setUsername(null);
  }, [dbContext]);

  /**
   * Clear global message (called after displaying the message).
   */
  const clearGlobalMessage = useCallback(() : void => {
    setGlobalMessage(null);
  }, []);

  const contextValue = useMemo(() => ({
    isInitialized,
    username,
    initializeAuth,
    setAuthTokens,
    clearAuth,
    globalMessage,
    clearGlobalMessage,
  }), [isInitialized, username, initializeAuth, globalMessage, setAuthTokens, clearAuth, clearGlobalMessage]);

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