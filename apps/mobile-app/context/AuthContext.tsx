import { Buffer } from 'buffer';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainerRef, ParamListBase } from '@react-navigation/native';
import * as LocalAuthentication from 'expo-local-authentication';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Alert, AppState, Platform } from 'react-native';

import EncryptionUtility from '@/utils/EncryptionUtility';

import { useDb } from '@/context/DbContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

// Create a navigation reference
export const navigationRef = React.createRef<NavigationContainerRef<ParamListBase>>();

export type AuthMethod = 'faceid' | 'password';

type AuthContextType = {
  isLoggedIn: boolean;
  isInitialized: boolean;
  username: string | null;
  isOffline: boolean;
  getEnabledAuthMethods: () => Promise<AuthMethod[]>;
  isBiometricsEnabled: () => Promise<boolean>;
  setAuthTokens: (username: string, accessToken: string, refreshToken: string) => Promise<void>;
  initializeAuth: () => Promise<{ isLoggedIn: boolean; enabledAuthMethods: AuthMethod[] }>;
  login: () => Promise<void>;
  logout: (errorMessage?: string) => Promise<void>;
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

const AUTOFILL_CONFIGURED_KEY = 'autofill_configured';
const CLIPBOARD_TIMEOUT_KEY = 'clipboard_clear_timeout';

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
  const [shouldShowAutofillReminder, setShouldShowAutofillReminder] = useState(false);
  const [returnUrl, setReturnUrl] = useState<{ path: string; params?: object } | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const appState = useRef(AppState.currentState);
  const dbContext = useDb();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const lastRouteRef = useRef<{ path: string, params?: object }>({ path: pathname, params });

  useEffect(() => {
    lastRouteRef.current = { path: pathname, params };
  }, [pathname, params]);

  /**
   * Get enabled auth methods from the native module
   */
  const getEnabledAuthMethods = useCallback(async (): Promise<AuthMethod[]> => {
    try {
      let methods = await NativeVaultManager.getAuthMethods() as AuthMethod[];
      // Check if Face ID is actually available despite being enabled
      if (methods.includes('faceid')) {
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        if (!isEnrolled) {
          // Remove Face ID from the list of enabled auth methods
          methods = methods.filter(method => method !== 'faceid');
        }
      }
      return methods;
    } catch (error) {
      console.error('Failed to get enabled auth methods:', error);
      return ['password'];
    }
  }, []);

  /**
   * Check if biometrics is enabled on the device (regardless of whether it's enabled in the AliasVault app).
   */
  const isBiometricsEnabledOnDevice = useCallback(async (): Promise<boolean> => {
    const hasBiometrics = await LocalAuthentication.hasHardwareAsync();
    if (!hasBiometrics) {
      return false;
    }

    return await LocalAuthentication.isEnrolledAsync();
  }, []);

  /**
   * Check if biometrics is enabled based on enabled auth methods
   */
  const isBiometricsEnabled = useCallback(async (): Promise<boolean> => {
    const deviceHasBiometrics = await isBiometricsEnabledOnDevice();
    if (!deviceHasBiometrics) {
      return false;
    }

    const methods = await getEnabledAuthMethods();
    return methods.includes('faceid');
  }, [getEnabledAuthMethods, isBiometricsEnabledOnDevice]);

  /**
   * Set auth tokens in storage as part of the login process. After db is initialized, the login method should be called as well.
   */
  const setAuthTokens = useCallback(async (username: string, accessToken: string, refreshToken: string): Promise<void> => {
    await AsyncStorage.setItem('username', username);
    await AsyncStorage.setItem('accessToken', accessToken);
    await AsyncStorage.setItem('refreshToken', refreshToken);

    setUsername(username);
  }, []);

  /**
   * Initialize the authentication state, called on initial load by _layout.tsx.
   * @returns object containing whether the user is logged in and enabled auth methods
   */
  const initializeAuth = useCallback(async (): Promise<{ isLoggedIn: boolean; enabledAuthMethods: AuthMethod[] }> => {
    const accessToken = await AsyncStorage.getItem('accessToken') as string;
    const refreshToken = await AsyncStorage.getItem('refreshToken') as string;
    const username = await AsyncStorage.getItem('username') as string;
    let isAuthenticated = false;
    let methods: AuthMethod[] = ['password'];

    if (accessToken && refreshToken && username) {
      setUsername(username);
      setIsLoggedIn(true);
      isAuthenticated = true;
      methods = await getEnabledAuthMethods();
    }
    setIsInitialized(true);
    return { isLoggedIn: isAuthenticated, enabledAuthMethods: methods };
  }, [getEnabledAuthMethods]);

  /**
   * Set logged in status to true which refreshes the app.
   */
  const login = useCallback(async (): Promise<void> => {
    setIsLoggedIn(true);
  }, []);

  /**
   * Logout the user and clear the auth tokens from chrome storage.
   */
  const logout = useCallback(async (errorMessage?: string): Promise<void> => {
    await AsyncStorage.removeItem('username');
    await AsyncStorage.removeItem('accessToken');
    await AsyncStorage.removeItem('refreshToken');
    await AsyncStorage.removeItem('authMethods');
    dbContext?.clearDatabase();

    if (errorMessage) {
      // Show alert
      Alert.alert(errorMessage);
    }

    setUsername(null);
    setIsLoggedIn(false);
  }, [dbContext]);

  /**
   * Set the authentication methods and save them to storage
   */
  const setAuthMethods = useCallback(async (methods: AuthMethod[]): Promise<void> => {
    // Ensure password is always included
    const methodsToSave = methods.includes('password') ? methods : [...methods, 'password'];

    // Update native credentials manager
    try {
      await NativeVaultManager.setAuthMethods(methodsToSave);
    } catch (error) {
      console.error('Failed to update native auth methods:', error);
    }
  }, []);

  /**
   * Get the appropriate biometric display name translation key based on device capabilities
   */
  const getBiometricDisplayNameKey = useCallback(async (): Promise<string> => {
    try {
      const hasBiometrics = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();

      // For Android, we use the term "Biometrics" for facial recognition and fingerprint.
      if (Platform.OS === 'android') {
        return 'settings.vaultUnlockSettings.biometrics';
      }

      // For iOS, we check if the device has explicit Face ID or Touch ID support.
      if (!hasBiometrics || !enrolled) {
        return 'settings.vaultUnlockSettings.faceIdTouchId';
      }

      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const hasFaceIDSupport = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      const hasTouchIDSupport = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);

      if (hasFaceIDSupport) {
        return 'settings.vaultUnlockSettings.faceId';
      } else if (hasTouchIDSupport) {
        return 'settings.vaultUnlockSettings.touchId';
      }

      return 'settings.vaultUnlockSettings.faceIdTouchId';
    } catch (error) {
      console.error('Failed to get biometric display name:', error);
      return 'settings.vaultUnlockSettings.faceIdTouchId';
    }
  }, []);

  /**
   * Get the display label translation key for the current auth method
   * Prefers Face ID if enabled, otherwise falls back to Password
   */
  const getAuthMethodDisplayKey = useCallback(async (): Promise<string> => {
    const methods = await getEnabledAuthMethods();
    if (methods.includes('faceid')) {
      try {
        if (await isBiometricsEnabledOnDevice()) {
          return await getBiometricDisplayNameKey();
        }
      } catch (error) {
        console.error('Failed to check Face ID enrollment:', error);
      }
    }
    return 'credentials.password';
  }, [getEnabledAuthMethods, getBiometricDisplayNameKey, isBiometricsEnabledOnDevice]);

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
   * Get the clipboard clear timeout from AsyncStorage
   */
  const getClipboardClearTimeout = useCallback(async (): Promise<number> => {
    try {
      const timeoutStr = await AsyncStorage.getItem(CLIPBOARD_TIMEOUT_KEY);
      return timeoutStr ? parseInt(timeoutStr, 10) : 15;
    } catch (error) {
      console.error('Failed to get clipboard clear timeout:', error);
      return 10;
    }
  }, []);

  /**
   * Set the clipboard clear timeout in AsyncStorage
   */
  const setClipboardClearTimeout = useCallback(async (timeout: number): Promise<void> => {
    try {
      await AsyncStorage.setItem(CLIPBOARD_TIMEOUT_KEY, timeout.toString());
    } catch (error) {
      console.error('Failed to set clipboard clear timeout:', error);
    }
  }, []);

  /**
   * Check if the vault is unlocked.
   */
  const isVaultUnlocked = useCallback(async (): Promise<boolean> => {
    try {
      return await NativeVaultManager.isVaultUnlocked();
    } catch (error) {
      console.error('Failed to check vault status:', error);
      return false;
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

    // Check if the current password is correct by attempting to decrypt the vault
    const dbAvailable = await dbContext.testDatabaseConnection(currentPasswordHashBase64);
    if (!dbAvailable) {
      return null;
    }

    return currentPasswordHashBase64;
  }, [dbContext, getEncryptionKeyDerivationParams]);

  // Handle app state changes
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        /**
         * App coming to foreground
         * Skip vault re-initialization checks during unlock, login, initialize, and reinitialize flows to prevent race conditions
         * where the AppState listener fires during app initialization, especially on iOS release builds.
         */
        if (!pathname?.includes('unlock') && !pathname?.includes('login') && !pathname?.includes('initialize') && !pathname?.includes('reinitialize')) {
          try {
            // Check if vault is unlocked.
            const isUnlocked = await isVaultUnlocked();
            if (!isUnlocked) {
              // Get current full URL including query params
              const currentRoute = lastRouteRef.current;
              if (currentRoute?.path) {
                setReturnUrl({
                  path: currentRoute.path,
                  params: currentRoute.params
                });
              }

              // Database connection failed, navigate to reinitialize flow
              router.replace('/reinitialize');
            }
          } catch {
            // Database query failed, navigate to reinitialize flow
            router.replace('/reinitialize');
          }
        }
      }
      appState.current = nextAppState;
    });

    return (): void => {
      subscription.remove();
    };
  }, [isVaultUnlocked, pathname]);

  /**
   * Load autofill state from storage
   */
  const loadAutofillState = useCallback(async () => {
    const configured = await AsyncStorage.getItem(AUTOFILL_CONFIGURED_KEY);
    setShouldShowAutofillReminder(configured !== 'true');
  }, []);

  /**
   * Mark autofill as configured for the current platform
   */
  const markAutofillConfigured = useCallback(async () => {
    await AsyncStorage.setItem(AUTOFILL_CONFIGURED_KEY, 'true');
    setShouldShowAutofillReminder(false);
  }, []);

  // Load autofill state on mount
  useEffect(() => {
    loadAutofillState();
  }, [loadAutofillState]);

  const contextValue = useMemo(() => ({
    isLoggedIn,
    isInitialized,
    username,
    shouldShowAutofillReminder,
    returnUrl,
    isOffline,
    getEnabledAuthMethods,
    isBiometricsEnabled,
    setAuthTokens,
    initializeAuth,
    login,
    logout,
    setAuthMethods,
    getAuthMethodDisplayKey,
    isBiometricsEnabledOnDevice,
    getAutoLockTimeout,
    setAutoLockTimeout,
    getClipboardClearTimeout,
    setClipboardClearTimeout,
    getBiometricDisplayNameKey,
    markAutofillConfigured,
    setReturnUrl,
    verifyPassword,
    getEncryptionKeyDerivationParams,
    setOfflineMode: setIsOffline,
  }), [
    isLoggedIn,
    isInitialized,
    username,
    shouldShowAutofillReminder,
    returnUrl,
    isOffline,
    getEnabledAuthMethods,
    isBiometricsEnabled,
    setAuthTokens,
    initializeAuth,
    login,
    logout,
    setAuthMethods,
    getAuthMethodDisplayKey,
    isBiometricsEnabledOnDevice,
    getAutoLockTimeout,
    setAutoLockTimeout,
    getClipboardClearTimeout,
    setClipboardClearTimeout,
    getBiometricDisplayNameKey,
    markAutofillConfigured,
    setReturnUrl,
    verifyPassword,
    getEncryptionKeyDerivationParams,
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