import { logoutEventEmitter } from '@aliasvault/client/api/LogoutEventEmitter';
import { getPlatform } from '@aliasvault/client/platform';
import React, { createContext, useContext, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';
import { StorageKeys } from '@/utils/StorageKeys';
import { vaultStore } from '@/vault/VaultStore';

/**
 * How a logout ends the session.
 */
type LogoutOptions = {
  userInitiated?: boolean;
  errorMessage?: string;
};

type AuthContextType = {
  isInitialized: boolean;
  isLoggedIn: boolean;
  username: string | null;
  initializeAuth: () => Promise<boolean>;
  setAuthTokens: (username: string, accessToken: string, refreshToken: string) => Promise<void>;
  logout: (options?: LogoutOptions) => Promise<void>;
  globalMessage: string | null;
  clearGlobalMessage: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * AuthProvider: the login state, the auth tokens and logout.
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const webApi = useWebApi();
  const { clearDatabase } = useDb();
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [globalMessage, setGlobalMessage] = useState<string | null>(null);
  const isLoggingOutRef = useRef(false);

  /**
   * Initialize the authentication state from the stored tokens.
   * @returns Whether the user is logged in.
   */
  const initializeAuth = useCallback(async (): Promise<boolean> => {
    const storage = getPlatform().storage;
    const [accessToken, refreshToken, storedUsername] = await Promise.all([
      storage.get<string>(StorageKeys.ACCESS_TOKEN),
      storage.get<string>(StorageKeys.REFRESH_TOKEN),
      storage.get<string>(StorageKeys.USERNAME),
    ]);
    const loggedIn = Boolean(accessToken && refreshToken && storedUsername);
    if (loggedIn) {
      setUsername(storedUsername);
    }
    setIsLoggedIn(loggedIn);
    setIsInitialized(true);
    return loggedIn;
  }, []);

  /**
   * Store the auth tokens as part of the login process.
   */
  const setAuthTokens = useCallback(async (newUsername: string, accessToken: string, refreshToken: string): Promise<void> => {
    await getPlatform().storage.setMany([
      { key: StorageKeys.USERNAME, value: newUsername },
      { key: StorageKeys.ACCESS_TOKEN, value: accessToken },
      { key: StorageKeys.REFRESH_TOKEN, value: refreshToken },
    ]);
    setUsername(newUsername);
    setIsLoggedIn(true);
  }, []);

  /**
   * Drop this tab's in-memory session: the decrypted vault and the logged-in state.
   */
  const endSession = useCallback((): void => {
    clearDatabase();
    setIsLoggedIn(false);
  }, [clearDatabase]);

  /**
   * Revoke the tokens and clear the tokens, session keys and vault. A forced logout (401, token revocation, password
   * change) keeps the username so the login page can prefill it.
   */
  const logout = useCallback(async (options: LogoutOptions = {}): Promise<void> => {
    if (isLoggingOutRef.current) {
      return;
    }

    try {
      isLoggingOutRef.current = true;
      try {
        await webApi.revokeTokens();
      } catch (error) {
        console.error('Error revoking tokens during logout:', error);
      }
      if (options.userInitiated) {
        await vaultStore.clearVaultData();
        setUsername(null);
      }
      await vaultStore.clearSession();
      if (options.errorMessage) {
        setGlobalMessage(options.errorMessage);
      }
    } catch (error) {
      console.error('Error during logout:', error);
    } finally {
      endSession();
      isLoggingOutRef.current = false;
    }
  }, [webApi, endSession]);

  /**
   * Clear the global message (called after displaying it).
   */
  const clearGlobalMessage = useCallback((): void => {
    setGlobalMessage(null);
  }, []);

  /**
   * Log out when the API reports the session is gone.
   */
  useEffect(() => {
    return logoutEventEmitter.subscribe(async (errorKey: string) => {
      await logout({ errorMessage: t(errorKey) });
    });
  }, [logout, t]);

  /**
   * Check for tokens in storage on initial load.
   */
  useEffect(() => {
    void initializeAuth();
  }, [initializeAuth]);

  /*
   * Reflect a logout from any tab: the access token is shared by every tab, but another tab cannot clear this tab's
   * in-memory unlock key and decrypted vault, so drop them here too.
   */
  useEffect(() => {
    return getPlatform().storage.watch<string | null>(StorageKeys.ACCESS_TOKEN, (newValue) => {
      if (!newValue) {
        endSession();
        void vaultStore.lockVault();
      }
    });
  }, [endSession]);

  const contextValue = useMemo(() => ({
    isInitialized,
    isLoggedIn,
    username,
    initializeAuth,
    setAuthTokens,
    logout,
    globalMessage,
    clearGlobalMessage,
  }), [isInitialized, isLoggedIn, username, initializeAuth, setAuthTokens, logout, globalMessage, clearGlobalMessage]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

/**
 * Hook to use the AuthContext.
 */
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
