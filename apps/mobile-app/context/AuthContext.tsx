import { Buffer } from 'buffer';

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import EncryptionUtility from '@/utils/EncryptionUtility';
import type { AuthMethod } from '@/utils/AppUnlockUtility';

import { useDb } from '@/context/DbContext';
import { dialogEventEmitter } from '@/events/DialogEventEmitter';
import NativeVaultManager from '@/specs/NativeVaultManager';
import i18n from '@/i18n';
import { LocalPreferencesService } from '@/services/LocalPreferencesService';

export type { AuthMethod } from '@/utils/AppUnlockUtility';

type AuthContextType = {
  isLoggedIn: boolean;
  isInitialized: boolean;
  username: string | null;
  isOffline: boolean;
  setAuthTokens: (username: string, accessToken: string, refreshToken: string) => Promise<void>;
  initializeAuth: () => Promise<{ isLoggedIn: boolean; enabledAuthMethods: AuthMethod[] }>;
  login: () => Promise<void>;
  /**
   * Clear auth for user-initiated logout (e.g., user clicks logout button).
   * Clears ALL data including vault - user explicitly chose to logout.
   */
  clearAuthUserInitiated: (errorMessage?: string) => Promise<void>;
  /**
   * Clear auth for forced logout (e.g., 401 error, token revocation).
   * Preserves vault data for potential RPO recovery - user didn't choose to logout.
   */
  clearAuthForced: (errorMessage?: string) => Promise<void>;
  setAuthMethods: (methods: AuthMethod[]) => Promise<void>;
  getAutoLockTimeout: () => Promise<number>;
  setAutoLockTimeout: (timeout: number) => Promise<void>;
  setOfflineMode: (isOffline: boolean) => void;
  verifyPassword: (password: string) => Promise<string | null>;
  getEncryptionKeyDerivationParams: () => Promise<{ salt: string; encryptionType: string; encryptionSettings: string } | null>;
  // Autofill methods
  shouldShowAutofillReminder: boolean;
  markAutofillConfigured: () => Promise<void>;
}


/**
 * Auth context.
 */
const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * AuthProvider to provide the authentication state to the app that components can use.
 */
export const AuthProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [shouldShowAutofillReminder, setShouldShowAutofillReminder] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const dbContext = useDb();

  /**
   * Set auth tokens in storage as part of the login process. After db is initialized, the login method should be called as well.
   */
  const setAuthTokens = useCallback(async (username: string, accessToken: string, refreshToken: string): Promise<void> => {
    await NativeVaultManager.setUsername(username);
    await NativeVaultManager.setAuthTokens(accessToken, refreshToken);

    // Update React state
    setUsername(username);
  }, []);

  /**
   * Initialize the authentication state, called on initial load by _layout.tsx.
   * @returns object containing whether the user is logged in and enabled auth methods
   */
  const initializeAuth = useCallback(async (): Promise<{ isLoggedIn: boolean; enabledAuthMethods: AuthMethod[] }> => {
    let accessToken = await NativeVaultManager.getAccessToken();
    let username = await NativeVaultManager.getUsername();

    if (!accessToken || !username) {
    /** 
     * TODO: Remove syncLegacyConfigToNative entirely in version 0.25.0+ once enough
     * time has passed that all active users have migrated off AsyncStorage.
     */
      await syncLegacyConfigToNative();
      // Re-read in case the migration moved data into native
      accessToken = await NativeVaultManager.getAccessToken();
      username = await NativeVaultManager.getUsername();
    }

    let isAuthenticated = false;
    let methods: AuthMethod[] = ['password'];

    if (accessToken && username) {
      setUsername(username);
      setIsLoggedIn(true);
      isAuthenticated = true;
      const { AppUnlockUtility } = await import('@/utils/AppUnlockUtility');
      methods = await AppUnlockUtility.getEnabledAuthMethods();
    }

    const offline = await NativeVaultManager.getOfflineMode();

    setIsInitialized(true);
    setIsOffline(offline);
    return { isLoggedIn: isAuthenticated, enabledAuthMethods: methods };
  }, []);

  /**
   * Sync legacy config to native layer
   */
  const syncLegacyConfigToNative = useCallback(async (): Promise<void> => {
    // Migrate tokens from AsyncStorage to native on first launch, then remove to prevent repeated syncs
    const accessToken = await AsyncStorage.getItem('accessToken');
    const refreshToken = await AsyncStorage.getItem('refreshToken');

    if (accessToken && refreshToken) {
      await NativeVaultManager.setAuthTokens(accessToken, refreshToken);
      await AsyncStorage.multiRemove(['accessToken', 'refreshToken']);
    }

    const username = await AsyncStorage.getItem('username');
    if (username) {
      await NativeVaultManager.setUsername(username);
      await AsyncStorage.removeItem('username');
    }
  }, []);

  /**
   * Set logged in status to true which refreshes the app.
   */
  const login = useCallback(async (): Promise<void> => {
    setIsLoggedIn(true);
  }, []);

  /**
   * Clear authentication data for forced logout (e.g., 401 error, token revocation).
   * Preserves vault data for potential RPO recovery - user didn't choose to logout.
   * The vault will be recovered on next login if the password hasn't changed.
   *
   * This is the base logout function. clearAuthUserInitiated builds on top of this.
   */
  const clearAuthForced = useCallback(async (errorMessage?: string): Promise<void> => {
    // Clear credential identity store (password and passkey autofill metadata)
    try {
      await NativeVaultManager.removeCredentialIdentities();
    } catch (error) {
      console.error('Failed to remove credential identities:', error);
      // Non-fatal error - continue with logout
    }

    // Clear PIN unlock data (if any)
    try {
      await NativeVaultManager.removeAndDisablePin();
    } catch (error) {
      console.error('Failed to remove PIN data:', error);
      // Non-fatal error - continue with logout
    }

    // Clear auth tokens and session in native layer (preserves vault data)
    await NativeVaultManager.clearAuthTokens();
    await NativeVaultManager.clearSession();
    EncryptionUtility.clearRsaPrivateKeyCache();

    // Clear from AsyncStorage (for backward compatibility)
    // TODO: Remove AsyncStorage cleanup in future version 0.25.0+
    await AsyncStorage.multiRemove(['accessToken', 'refreshToken', 'authMethods']);

    if (errorMessage) {
      // Use event emitter to show dialog via DialogContext
      // This allows Android to use the custom styled dialog
      dialogEventEmitter.emitAlert(i18n.t('common.error'), errorMessage);
    }

    setIsLoggedIn(false);
  }, []);

  /**
   * Clear authentication data for user-initiated logout (e.g., user clicks logout button).
   * Clears ALL data including vault - user explicitly chose to logout.
   *
   * Builds on clearAuthForced by also clearing vault data and username.
   */
  const clearAuthUserInitiated = useCallback(async (errorMessage?: string): Promise<void> => {
    // First, perform the base forced logout (clears session, tokens, PIN, credentials)
    await clearAuthForced(errorMessage);

    // Additionally clear username (forced logout preserves it for login prefill)
    await NativeVaultManager.clearUsername();
    await AsyncStorage.removeItem('username'); // TODO: Remove in 0.25.0+

    // Clear ALL vault data - user explicitly chose to logout
    dbContext?.clearDatabase();

    setUsername(null);
  }, [dbContext, clearAuthForced]);

  /**
   * Set the authentication methods and save them to storage.
   * Delegates to AppUnlockUtility for consistent auth method management.
   */
  const setAuthMethods = useCallback(async (methods: AuthMethod[]): Promise<void> => {
    const { AppUnlockUtility } = await import('@/utils/AppUnlockUtility');
    await AppUnlockUtility.setAuthMethods(methods);
  }, []);

  /**
   * Get the auto-lock timeout from the iOS credentials manager
   */
  const getAutoLockTimeout = useCallback(async (): Promise<number> => {
    try {
      return await NativeVaultManager.getAutoLockTimeout();
    } catch (error) {
      console.error('Failed to get auto-lock timeout:', error);
      return 0;
    }
  }, []);

  /**
   * Set the auto-lock timeout in the iOS credentials manager
   */
  const setAutoLockTimeout = useCallback(async (timeout: number): Promise<void> => {
    try {
      await NativeVaultManager.setAutoLockTimeout(timeout);
    } catch (error) {
      console.error('Failed to update iOS auto-lock timeout:', error);
    }
  }, []);

  /**
   * Get the encryption key derivation parameters from native storage.
   * Returns parsed parameters or null if not available.
   */
  const getEncryptionKeyDerivationParams = useCallback(async (): Promise<{
    salt: string;
    encryptionType: string;
    encryptionSettings: string;
  } | null> => {
    try {
      const encryptionKeyDerivationParams = await NativeVaultManager.getEncryptionKeyDerivationParams();
      if (!encryptionKeyDerivationParams) {
        return null;
      }
      return JSON.parse(encryptionKeyDerivationParams);
    } catch (error) {
      console.error('Failed to get encryption key derivation params:', error);
      return null;
    }
  }, []);

  /**
   * Verify the password. Returns the current password hash if the password is correct, otherwise returns null.
   */
  const verifyPassword = useCallback(async (password: string): Promise<string | null> => {
    // Get the key derivation parameters
    const params = await getEncryptionKeyDerivationParams();
    if (!params) {
      throw new Error('Failed to verify current password. Please try again.');
    }

    // Derive the encryption key from the password using the stored parameters
    const passwordHash = await EncryptionUtility.deriveKeyFromPassword(
      password,
      params.salt,
      params.encryptionType,
      params.encryptionSettings
    );

    const currentPasswordHashBase64 = Buffer.from(passwordHash).toString('base64');

    // Check if the current password is correct
    const isValid = await dbContext.verifyEncryptionKey(currentPasswordHashBase64);
    if (!isValid) {
      return null;
    }

    return currentPasswordHashBase64;
  }, [dbContext, getEncryptionKeyDerivationParams]);

  /**
   * Load autofill state from storage
   */
  const loadAutofillState = useCallback(async () => {
    const configured = await LocalPreferencesService.getAutofillConfigured();
    setShouldShowAutofillReminder(!configured);
  }, []);

  /**
   * Mark autofill as configured for the current platform
   */
  const markAutofillConfigured = useCallback(async () => {
    await LocalPreferencesService.setAutofillConfigured(true);
    setShouldShowAutofillReminder(false);
  }, []);

  // Load autofill state on mount
  useEffect(() => {
    loadAutofillState();
  }, [loadAutofillState]);

  /**
   * Set offline mode and sync to native layer
   */
  const setOfflineMode = useCallback(async (offline: boolean) => {
    setIsOffline(offline);
    await NativeVaultManager.setOfflineMode(offline);
  }, []);

  const contextValue = useMemo(() => ({
    isLoggedIn,
    isInitialized,
    username,
    shouldShowAutofillReminder,
    isOffline,
    setAuthTokens,
    initializeAuth,
    login,
    clearAuthUserInitiated,
    clearAuthForced,
    setAuthMethods,
    getAutoLockTimeout,
    setAutoLockTimeout,
    markAutofillConfigured,
    verifyPassword,
    getEncryptionKeyDerivationParams,
    setOfflineMode,
  }), [
    isLoggedIn,
    isInitialized,
    username,
    shouldShowAutofillReminder,
    isOffline,
    setAuthTokens,
    initializeAuth,
    login,
    clearAuthUserInitiated,
    clearAuthForced,
    setAuthMethods,
    getAutoLockTimeout,
    setAutoLockTimeout,
    markAutofillConfigured,
    verifyPassword,
    getEncryptionKeyDerivationParams,
    setOfflineMode,
  ]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

/**
 * Hook to use the AuthContext
 */
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
