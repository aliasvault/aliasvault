import React, { createContext, useContext, useMemo, useCallback, useEffect, useState } from 'react';
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
  isLoggingOut: boolean;
  // Auth methods from AuthContext
  getEnabledAuthMethods: () => Promise<AuthMethod[]>;
  isBiometricsEnabled: () => Promise<boolean>;
  setAuthMethods: (methods: AuthMethod[]) => Promise<void>;
  getAuthMethodDisplayKey: () => Promise<string>;
  getAutoLockTimeout: () => Promise<number>;
  setAutoLockTimeout: (timeout: number) => Promise<void>;
  getClipboardClearTimeout: () => Promise<number>;
  setClipboardClearTimeout: (timeout: number) => Promise<void>;
  getBiometricDisplayNameKey: () => Promise<string>;
  isBiometricsEnabledOnDevice: () => Promise<boolean>;
  setOfflineMode: (isOffline: boolean) => void;
  verifyPassword: (password: string) => Promise<string | null>;
  getEncryptionKeyDerivationParams: () => Promise<{ salt: string; encryptionType: string; encryptionSettings: string } | null>;
  // Autofill methods
  shouldShowAutofillReminder: boolean;
  markAutofillConfigured: () => Promise<void>;
  // Return URL methods
  returnUrl: { path: string; params?: object } | null;
  setReturnUrl: (url: { path: string; params?: object } | null) => void;
}

export type AuthMethod = 'faceid' | 'password';

const AppContext = createContext<AppContextType | undefined>(undefined);

/**
 * AppProvider that coordinates between auth, db, and webApi contexts.
 */
export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth();
  const webApi = useWebApi();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

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
    } catch (error) {
      console.error('Error during logout:', error);
    } finally {
      setIsLoggingOut(false);
    }
  }, [auth, webApi, isLoggingOut]);

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
    returnUrl: auth.returnUrl,
    // Wrap auth methods
    logout,
    initializeAuth: auth.initializeAuth,
    setAuthTokens: auth.setAuthTokens,
    login: auth.login,
    isLoggingOut,
    // Pass through other auth methods
    getEnabledAuthMethods: auth.getEnabledAuthMethods,
    isBiometricsEnabled: auth.isBiometricsEnabled,
    setAuthMethods: auth.setAuthMethods,
    getAuthMethodDisplayKey: auth.getAuthMethodDisplayKey,
    getAutoLockTimeout: auth.getAutoLockTimeout,
    setAutoLockTimeout: auth.setAutoLockTimeout,
    getClipboardClearTimeout: auth.getClipboardClearTimeout,
    setClipboardClearTimeout: auth.setClipboardClearTimeout,
    getBiometricDisplayNameKey: auth.getBiometricDisplayNameKey,
    isBiometricsEnabledOnDevice: auth.isBiometricsEnabledOnDevice,
    setOfflineMode: auth.setOfflineMode,
    verifyPassword: auth.verifyPassword,
    getEncryptionKeyDerivationParams: auth.getEncryptionKeyDerivationParams,
    markAutofillConfigured: auth.markAutofillConfigured,
    setReturnUrl: auth.setReturnUrl,
  }), [
    auth.isInitialized,
    auth.isLoggedIn,
    auth.username,
    auth.isOffline,
    auth.shouldShowAutofillReminder,
    auth.returnUrl,
    auth.initializeAuth,
    auth.setAuthTokens,
    auth.login,
    auth.getEnabledAuthMethods,
    auth.isBiometricsEnabled,
    auth.setAuthMethods,
    auth.getAuthMethodDisplayKey,
    auth.getAutoLockTimeout,
    auth.setAutoLockTimeout,
    auth.getClipboardClearTimeout,
    auth.setClipboardClearTimeout,
    auth.getBiometricDisplayNameKey,
    auth.isBiometricsEnabledOnDevice,
    auth.setOfflineMode,
    auth.verifyPassword,
    auth.getEncryptionKeyDerivationParams,
    auth.markAutofillConfigured,
    auth.setReturnUrl,
    logout,
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
