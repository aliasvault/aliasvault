import React, { createContext, useContext, useMemo, useCallback, useEffect, useRef } from 'react';
import { router } from 'expo-router';

import { useAuth } from '@/context/AuthContext';
import { useWebApi } from '@/context/WebApiContext';

import { logoutEventEmitter } from '@/events/LogoutEventEmitter';

import i18n from '@/i18n';

type AppContextType = {
  isLoggedIn: boolean;
  isInitialized: boolean;
  username: string | null;
  isOffline: boolean;
  logout: (errorMessage?: string) => Promise<void>;
  initializeAuth: () => Promise<{ isLoggedIn: boolean; enabledAuthMethods: AuthMethod[] }>;
  setAuthTokens: (username: string, accessToken: string, refreshToken: string) => Promise<void>;
  login: () => Promise<void>;
  // Auth methods from AuthContext
  setAuthMethods: (methods: AuthMethod[]) => Promise<void>;
  getAutoLockTimeout: () => Promise<number>;
  setAutoLockTimeout: (timeout: number) => Promise<void>;
  setOfflineMode: (isOffline: boolean) => void;
  verifyPassword: (password: string) => Promise<string | null>;
  getUnlockKeyDerivationParams: () => Promise<{ salt: string; encryptionType: string; encryptionSettings: string } | null>;
  // Autofill methods
  shouldShowAutofillReminder: boolean;
  markAutofillConfigured: () => Promise<void>;
}

export type AuthMethod = 'faceid' | 'password';

const AppContext = createContext<AppContextType | undefined>(undefined);

/**
 * AppProvider that coordinates between auth, db, and webApi contexts.
 */
export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth();
  const webApi = useWebApi();
  const isLoggingOutRef = useRef(false);

  /**
   * Logout the user (forced logout path - e.g., 401, token revocation).
   * Uses clearAuthForced to preserve vault data for potential RPO recovery.
   * Prevents recursive logout calls by tracking logout state.
   */
  const logout = useCallback(async (errorMessage?: string): Promise<void> => {
    // Prevent recursive logout calls
    if (isLoggingOutRef.current) {
      return;
    }

    try {
      isLoggingOutRef.current = true;
      await webApi.revokeTokens();
      // Use forced logout to preserve vault data for recovery
      await auth.clearAuthForced(errorMessage);
    } catch (error) {
      console.error('Error during logout:', error);
    } finally {
      isLoggingOutRef.current = false;
    }
  }, [auth, webApi]);

  /**
   * Subscribe to logout events from WebApiService.
   */
  useEffect(() => {
    const unsubscribe = logoutEventEmitter.subscribe(async (errorKey: string) => {
      await logout(i18n.t(errorKey));
    });

    return unsubscribe;
  }, [logout]);

  /**
   * Global authentication listener - redirect to login when user is logged out
   * This ensures that logout triggers redirect regardless of which route the user is on
   */
  useEffect(() => {
    if (auth.isInitialized && !auth.isLoggedIn) {
      // Small delay to ensure logout process is complete
      const timer = setTimeout(() => {
        router.replace('/login');
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [auth.isInitialized, auth.isLoggedIn]);

  const contextValue = useMemo(() => ({
    // Pass through auth state
    isInitialized: auth.isInitialized,
    isLoggedIn: auth.isLoggedIn,
    username: auth.username,
    isOffline: auth.isOffline,
    shouldShowAutofillReminder: auth.shouldShowAutofillReminder,
    // Wrap auth methods
    logout,
    initializeAuth: auth.initializeAuth,
    setAuthTokens: auth.setAuthTokens,
    login: auth.login,
    // Pass through other auth methods
    setAuthMethods: auth.setAuthMethods,
    getAutoLockTimeout: auth.getAutoLockTimeout,
    setAutoLockTimeout: auth.setAutoLockTimeout,
    setOfflineMode: auth.setOfflineMode,
    verifyPassword: auth.verifyPassword,
    getUnlockKeyDerivationParams: auth.getUnlockKeyDerivationParams,
    markAutofillConfigured: auth.markAutofillConfigured,
  }), [
    auth.isInitialized,
    auth.isLoggedIn,
    auth.username,
    auth.isOffline,
    auth.shouldShowAutofillReminder,
    auth.initializeAuth,
    auth.setAuthTokens,
    auth.login,
    auth.setAuthMethods,
    auth.getAutoLockTimeout,
    auth.setAutoLockTimeout,
    auth.setOfflineMode,
    auth.verifyPassword,
    auth.getUnlockKeyDerivationParams,
    auth.markAutofillConfigured,
    logout
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
