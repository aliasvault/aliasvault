import { Buffer } from 'buffer';

import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, SafeAreaView, TextInput, ActivityIndicator, Animated, ScrollView, KeyboardAvoidingView, Platform, Dimensions } from 'react-native';

import { useApiUrl } from '@/utils/ApiUrlUtility';
import ConversionUtility from '@/utils/ConversionUtility';
import type { EncryptionKeyDerivationParams } from '@/utils/dist/core/models/metadata';
import type { LoginResponse } from '@/utils/dist/core/models/webapi';
import EncryptionUtility from '@/utils/EncryptionUtility';
import { SrpUtility } from '@/utils/SrpUtility';
import { ApiAuthError } from '@/utils/types/errors/ApiAuthError';
import { LocalAuthError } from '@/utils/types/errors/LocalAuthError';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useVaultSync } from '@/hooks/useVaultSync';

import Logo from '@/assets/images/logo.svg';
import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedView } from '@/components/themed/ThemedView';
import { InAppBrowserView } from '@/components/ui/InAppBrowserView';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';
import { useWebApi } from '@/context/WebApiContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Login screen.
 */
export default function LoginScreen() : React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const { showAlert, showDialog } = useDialog();

  // Animation values for entrance effects
  const logoScale = useRef(new Animated.Value(0.3)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslateY = useRef(new Animated.Value(20)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const formOpacity = useRef(new Animated.Value(0)).current;
  const formTranslateY = useRef(new Animated.Value(30)).current;

  const { loadApiUrl, getDisplayUrl } = useApiUrl();

  // Track if username prefill has been attempted (only do it once on mount)
  const usernamePrefillAttemptedRef = useRef(false);

  useEffect(() => {
    /* Staggered entrance animations - Logo: scale up with spring + fade in */
    Animated.parallel([
      Animated.spring(logoScale, {
        toValue: 1,
        friction: 5,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();

    // App name: slide up + fade in (slight delay after logo starts)
    Animated.sequence([
      Animated.delay(150),
      Animated.parallel([
        Animated.timing(titleTranslateY, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // Form slides up shortly after
    Animated.sequence([
      Animated.delay(300),
      Animated.parallel([
        Animated.timing(formOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(formTranslateY, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    loadApiUrl();

    /**
     * Check for saved username (from forced logout) and prefill the username field.
     * This enables users to easily re-login after a forced logout.
     * Only prefill once on mount - if user clears it, don't repopulate.
     */
    const loadSavedUsername = async () : Promise<void> => {
      if (usernamePrefillAttemptedRef.current) {
        return;
      }
      usernamePrefillAttemptedRef.current = true;

      try {
        const savedUsername = await NativeVaultManager.getUsername();
        if (savedUsername) {
          setCredentials(prev => ({ ...prev, username: savedUsername }));
        }
      } catch {
        // Ignore errors - username prefill is optional
      }
    };
    loadSavedUsername();
  }, [loadApiUrl, logoScale, logoOpacity, titleTranslateY, titleOpacity, formOpacity, formTranslateY]);

  // Update URL when returning from settings
  useFocusEffect(() => {
    loadApiUrl();
  });

  const [credentials, setCredentials] = useState({
    username: '',
    password: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [initiateLoginResponse, setInitiateLoginResponse] = useState<LoginResponse | null>(null);
  const [passwordHashString, setPasswordHashString] = useState<string | null>(null);
  const [passwordHashBase64, setPasswordHashBase64] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const authContext = useApp();
  const dbContext = useDb();
  const webApi = useWebApi();
  const { syncVault } = useVaultSync();

  const srpUtil = new SrpUtility(webApi);

  /**
   * Process the vault response by storing the vault and logging in the user.
   * @param token - The token to use for the vault
   * @param refreshToken - The refresh token to use for the vault
   * @param passwordHashBase64 - The password hash base64
   * @param initiateLoginResponse - The initiate login response
   */
  const processVaultResponse = async (
    token: string,
    refreshToken: string,
    passwordHashBase64: string,
    initiateLoginResponse: LoginResponse
  ) : Promise<void> => {
    // Get biometric display name from auth context
    const biometricDisplayName = await authContext.getBiometricDisplayName();
    const isBiometricsEnabledOnDevice = await authContext.isBiometricsEnabledOnDevice();

    if (isBiometricsEnabledOnDevice) {
      // Show biometric prompt if biometrics are available (faceid or fingerprint enrolled) on device.
      showDialog(
        t('auth.enableBiometric', { biometric: biometricDisplayName }),
        t('auth.biometricPrompt', { biometric: biometricDisplayName }),
        [
          {
            text: t('common.no'),
            style: 'destructive',
            /**
             * Handle disabling biometric authentication
             */
            onPress: async () : Promise<void> => {
              await authContext.setAuthMethods(['password']);
              await continueProcessVaultResponse(
                token,
                refreshToken,
                passwordHashBase64,
                initiateLoginResponse
              );
            }
          },
          {
            text: t('common.yes'),
            style: 'default',
            /**
             * Handle enabling biometric authentication
             */
            onPress: async () : Promise<void> => {
              await authContext.setAuthMethods(['faceid', 'password']);
              await continueProcessVaultResponse(
                token,
                refreshToken,
                passwordHashBase64,
                initiateLoginResponse
              );
            }
          }
        ]
      );
    } else {
      // If biometrics are not available on device, only allow password authentication.
      await authContext.setAuthMethods(['password']);
      await continueProcessVaultResponse(
        token,
        refreshToken,
        passwordHashBase64,
        initiateLoginResponse
      );
    }
  };

  /**
   * Continue processing the vault response after biometric choice
   * @param token - The token to use for the vault
   * @param refreshToken - The refresh token to use for the vault
   * @param passwordHashBase64 - The password hash base64
   * @param initiateLoginResponse - The initiate login response
   * @param encryptionKeyDerivationParams - The encryption key derivation parameters
   */
  const continueProcessVaultResponse = async (
    token: string,
    refreshToken: string,
    passwordHashBase64: string,
    initiateLoginResponse: LoginResponse
  ) : Promise<void> => {
    const encryptionKeyDerivationParams : EncryptionKeyDerivationParams = {
      encryptionType: initiateLoginResponse.encryptionType,
      encryptionSettings: initiateLoginResponse.encryptionSettings,
      salt: initiateLoginResponse.salt,
    };

    /*
     * Store auth tokens and encryption credentials. syncVault will download
     * the vault and store it (including metadata) through native code.
     */
    await authContext.setAuthTokens(ConversionUtility.normalizeUsername(credentials.username), token, refreshToken);
    await dbContext.storeEncryptionKey(passwordHashBase64);
    await dbContext.storeEncryptionKeyDerivationParams(encryptionKeyDerivationParams);

    /*
     * Forced logout recovery check:
     * If there's an existing local vault (from forced logout), try to unlock it.
     * If decryption fails (password changed or corrupted), reset sync state so
     * sync will do a clean download instead of trying to merge.
     */
    const hasExistingVault = await NativeVaultManager.hasEncryptedDatabase();
    if (hasExistingVault) {
      try {
        await NativeVaultManager.unlockVault();
        /*
         * Decryption succeeded - local vault is valid, sync will handle it.
         * The sync will compare revisions and decide whether to keep local or download.
         */
        console.info('Existing local vault (after forced logout) decrypted successfully, syncing with server');
      } catch {
        /*
         * Decryption failed (password changed or corrupted).
         * Reset sync state so sync will do a clean download instead of trying to merge.
         * This matches the browser extension behavior in persistAndLoadVault().
         */
        console.info('Existing vault could not be decrypted (password changed or corrupted), resetting for fresh download');
        await NativeVaultManager.resetSyncStateForFreshDownload();
      }
    }

    let upgradeRequired = false;

    /*
     * Sync vault from server (downloads, stores, and validates compatibility)
     * This will handle the forced logout recovery check in case our local vault is dirty
     * or is ahead of server in case of RPO event.
     *
     * Critical errors (auth, version) are handled internally via app.logout(message)
     * which shows a native alert. We check the return value to know if sync succeeded.
     */
    const syncSuccess = await syncVault({
      /**
       * Update login status during sync.
       */
      onStatus: (status) => {
        setLoginStatus(status);
      },
      /**
       * Handle non-critical errors (shown via custom dialog).
       */
      onError: (message) => {
        // Show modal with error message for non-critical errors
        showAlert(t('common.error'), message);
        setIsLoading(false);
      },
      /**
       * On upgrade required.
       */
      onUpgradeRequired: async () : Promise<void> => {
        upgradeRequired = true;

        // Still login to ensure the user is logged in.
        await authContext.login();

        // But after login, redirect to upgrade screen immediately.
        router.replace('/upgrade');
        return;
      },
    });

    if (!syncSuccess || upgradeRequired) {
      /*
       * Sync failed or upgrade required - don't continue with login
       * Critical errors already showed alert via app.logout()
       */
      setIsLoading(false);
      return;
    }

    /*
     * After syncVault completes, the vault has been downloaded and stored by native code.
     * Immediately mark the database as available without file system checks for faster bootstrap.
     */
    dbContext.setDatabaseAvailable();

    await authContext.login();

    // Reset prefill flag so next logout will prefill again
    usernamePrefillAttemptedRef.current = false;

    authContext.setOfflineMode(false);
    setTwoFactorRequired(false);
    setTwoFactorCode('');
    setPasswordHashString(null);
    setPasswordHashBase64(null);
    setInitiateLoginResponse(null);
    setLoginStatus(null);
    router.replace('/(tabs)/items');
    setIsLoading(false);
  };

  /**
   * Handle the submit.
   */
  const handleSubmit = async () : Promise<void> => {
    setIsLoading(true);
    setError(null);

    // Sanity check: if username or password is empty, return
    if (!credentials.username || !credentials.password) {
      setError(t('auth.errors.credentialsRequired'));
      setIsLoading(false);
      return;
    }

    setLoginStatus(t('auth.loggingIn'));
    await new Promise(resolve => requestAnimationFrame(resolve));

    try {
      const initiateLoginResponse = await srpUtil.initiateLogin(ConversionUtility.normalizeUsername(credentials.username));

      const passwordHash = await EncryptionUtility.deriveKeyFromPassword(
        credentials.password,
        initiateLoginResponse.salt,
        initiateLoginResponse.encryptionType,
        initiateLoginResponse.encryptionSettings
      );

      const passwordHashString = Buffer.from(passwordHash).toString('hex').toUpperCase();
      const passwordHashBase64 = Buffer.from(passwordHash).toString('base64');

      setLoginStatus(t('auth.validatingCredentials'));
      await new Promise(resolve => requestAnimationFrame(resolve));
      const validationResponse = await srpUtil.validateLogin(
        ConversionUtility.normalizeUsername(credentials.username),
        passwordHashString,
        true,
        initiateLoginResponse
      );

      if (validationResponse.requiresTwoFactor) {
        setInitiateLoginResponse(initiateLoginResponse);
        setPasswordHashString(passwordHashString);
        setPasswordHashBase64(passwordHashBase64);
        setTwoFactorRequired(true);
        setIsLoading(false);
        setLoginStatus(null);
        return;
      }

      if (!validationResponse.token) {
        throw new Error('Login failed -- no token returned');
      }

      setLoginStatus(t('auth.syncingVault'));
      await new Promise(resolve => requestAnimationFrame(resolve));

      await processVaultResponse(
        validationResponse.token.token,
        validationResponse.token.refreshToken,
        passwordHashBase64,
        initiateLoginResponse
      );
    } catch (err) {
      if (err instanceof ApiAuthError) {
        console.error('ApiAuthError error:', err);
        setError(t(`apiErrors.${err.message}`));
      } else if (err instanceof LocalAuthError) {
        console.error('Network/SSL error:', err);
        setError((err as LocalAuthError).message);
      } else {
        console.error('Login error:', err);
        // Check if self-hosted to show appropriate server error message
        const isSelfHosted = await webApi.isSelfHosted();
        setError(isSelfHosted ? t('auth.errors.serverErrorSelfHosted') : t('auth.errors.serverError'));
      }
      setIsLoading(false);
      setLoginStatus(null);
    }
  };

  /**
   * Handle the two factor submit.
   */
  const handleTwoFactorSubmit = async () : Promise<void> => {
    setIsLoading(true);
    setLoginStatus(t('auth.verifyingAuthCode'));
    setError(null);
    await new Promise(resolve => requestAnimationFrame(resolve));

    try {
      if (!passwordHashString || !passwordHashBase64 || !initiateLoginResponse) {
        throw new Error('Required login data not found');
      }

      const code = twoFactorCode.trim();
      if (!/^\d{6}$/.test(code)) {
        throw new ApiAuthError(t('auth.errors.invalidAuthCode'));
      }

      const validationResponse = await srpUtil.validateLogin2Fa(
        ConversionUtility.normalizeUsername(credentials.username),
        passwordHashString,
        true,
        initiateLoginResponse,
        parseInt(twoFactorCode)
      );

      if (!validationResponse.token) {
        throw new Error('Login failed -- no token returned');
      }

      setLoginStatus(t('auth.syncingVault'));
      await new Promise(resolve => requestAnimationFrame(resolve));

      await processVaultResponse(
        validationResponse.token.token,
        validationResponse.token.refreshToken,
        passwordHashBase64,
        initiateLoginResponse
      );
    } catch (err) {
      console.error('2FA error:', err);
      if (err instanceof ApiAuthError) {
        setError(t(`apiErrors.${err.message}`));
      } else if (err instanceof LocalAuthError) {
        setError((err as Error).message);
      } else {
        // Check if self-hosted to show appropriate server error message
        const isSelfHosted = await webApi.isSelfHosted();
        setError(t(isSelfHosted ? 'auth.errors.serverErrorSelfHosted' : 'auth.errors.serverError'));
      }
      setIsLoading(false);
    }
  };

  const styles = StyleSheet.create({
    appName: {
      color: colors.text,
      fontSize: 32,
      fontWeight: 'bold',
      textAlign: 'center',
    },
    button: {
      alignItems: 'center',
      borderRadius: 8,
      padding: 12,
    },
    buttonContainer: {
      gap: 8,
    },
    buttonText: {
      color: colors.primarySurfaceText,
      fontSize: 16,
      fontWeight: '600',
    },
    clickableLink: {
      color: colors.primary,
      textDecorationLine: 'underline',
    },
    container: {
      backgroundColor: colors.background,
      flex: 1,
    },
    content: {
      backgroundColor: colors.background,
      flex: 1,
      marginBottom: 16,
      padding: 16,
      paddingBottom: 0,
    },
    createNewVaultContainer: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: 16,
    },
    errorContainer: {
      backgroundColor: colors.errorBackground,
      borderColor: colors.errorBorder,
      borderRadius: 8,
      borderWidth: 1,
      marginBottom: 16,
      padding: 12,
    },
    errorText: {
      color: colors.errorText,
      fontSize: 14,
    },
    formContainer: {
      gap: 16,
    },
    gradientContainer: {
      height: Dimensions.get('window').height * 0.4,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    headerContainer: {
      marginBottom: 24,
    },
    headerSection: {
      borderBottomLeftRadius: 24,
      borderBottomRightRadius: 24,
      paddingBottom: 24,
      paddingHorizontal: 16,
      paddingTop: Platform.OS === 'ios' ? 24 : 64,
    },
    headerSubtitle: {
      color: colors.textMuted,
      fontSize: 14,
    },
    headerSubtitleContainer: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    headerTitle: {
      color: colors.text,
      fontSize: 24,
      fontWeight: 'bold',
      marginBottom: 4,
    },
    input: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
      height: 45,
      paddingHorizontal: 4,
    },
    inputContainer: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      flexDirection: 'row',
      width: '100%',
    },
    inputIcon: {
      padding: 10,
    },
    label: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 4,
    },
    logoContainer: {
      alignItems: 'center',
      marginBottom: 8,
    },
    primaryButton: {
      backgroundColor: colors.primary,
      marginTop: 16,
    },
    scrollContent: {
      flexGrow: 1,
    },
    secondaryButton: {
      backgroundColor: colors.secondary,
    },
    textMuted: {
      color: colors.textMuted,
    },
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
      testID="login-screen"
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <SafeAreaView>
          <LinearGradient
            colors={[colors.loginHeader, colors.background]}
            style={styles.gradientContainer}
          />
          <View style={styles.headerSection}>
            <View style={styles.logoContainer}>
              <Animated.View style={{
                opacity: logoOpacity,
                transform: [{ scale: logoScale }],
              }}>
                <Logo width={80} height={80} />
              </Animated.View>
              <Animated.Text style={[styles.appName, {
                opacity: titleOpacity,
                transform: [{ translateY: titleTranslateY }],
              }]}>
                {t('app.appName')}
              </Animated.Text>
            </View>
          </View>
        </SafeAreaView>
        <ThemedView style={styles.content}>
          {isLoading ? (
            <LoadingIndicator status={loginStatus ?? t('common.loading')} />
          ) : (
            <Animated.View style={{
              opacity: formOpacity,
              transform: [{ translateY: formTranslateY }],
            }}>
              <View style={styles.headerContainer}>
                <Text style={styles.headerTitle}>{t('auth.login')}</Text>
                <View style={styles.headerSubtitleContainer}>
                  <Text style={styles.headerSubtitle}>
                    {t('auth.connectingTo')}{' '}
                  </Text>
                  <RobustPressable
                    onPress={() => router.push('/login-settings')}
                    testID="server-url-link-button"
                  >
                    <Text style={styles.clickableLink} testID="server-url-link"                    >
                      {getDisplayUrl()}
                    </Text>
                  </RobustPressable>
                </View>
              </View>

              {error && (
                <View style={styles.errorContainer} testID="error-message">
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              {twoFactorRequired ? (
                <View style={styles.formContainer}>
                  <Text style={styles.label}>{t('auth.authCode')}</Text>
                  <View style={styles.inputContainer}>
                    <MaterialIcons
                      name="security"
                      size={24}
                      color={colors.textMuted}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.input}
                      value={twoFactorCode}
                      onChangeText={setTwoFactorCode}
                      autoCorrect={false}
                      autoCapitalize="none"
                      placeholder={t('auth.enterAuthCode')}
                      keyboardType="numeric"
                      maxLength={6}
                      placeholderTextColor={colors.textMuted}
                      multiline={false}
                      numberOfLines={1}
                    />
                  </View>
                  <View style={styles.buttonContainer}>
                    <RobustPressable
                      style={[styles.button, styles.primaryButton]}
                      onPress={handleTwoFactorSubmit}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <ActivityIndicator color={colors.text} />
                      ) : (
                        <Text style={styles.buttonText}>{t('auth.verify')}</Text>
                      )}
                    </RobustPressable>
                    <RobustPressable
                      style={[styles.button, styles.secondaryButton]}
                      onPress={() => {
                        setCredentials({ username: '', password: '' });
                        setTwoFactorRequired(false);
                        setTwoFactorCode('');
                        setPasswordHashString(null);
                        setPasswordHashBase64(null);
                        setInitiateLoginResponse(null);
                        setError(null);
                      }}
                    >
                      <Text style={styles.buttonText}>{t('common.cancel')}</Text>
                    </RobustPressable>
                  </View>
                  <Text style={styles.textMuted}>
                    {t('auth.authCodeNote')}
                  </Text>
                </View>
              ) : (
                <View style={styles.formContainer}>
                  <Text style={styles.label}>{t('auth.username')}</Text>
                  <View style={styles.inputContainer}>
                    <MaterialIcons
                      name="person"
                      size={20}
                      color={colors.textMuted}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.input}
                      value={credentials.username}
                      onChangeText={(text) => setCredentials({ ...credentials, username: text })}
                      placeholder={t('auth.usernamePlaceholder')}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholderTextColor={colors.textMuted}
                      multiline={false}
                      numberOfLines={1}
                      testID="username-input"
                    />
                  </View>
                  <Text style={styles.label}>{t('auth.password')}</Text>
                  <View style={styles.inputContainer}>
                    <MaterialIcons
                      name="lock"
                      size={20}
                      color={colors.textMuted}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.input}
                      value={credentials.password}
                      onChangeText={(text) => setCredentials({ ...credentials, password: text })}
                      placeholder={t('auth.passwordPlaceholder')}
                      secureTextEntry={!showPassword}
                      placeholderTextColor={colors.textMuted}
                      autoCorrect={false}
                      autoCapitalize="none"
                      multiline={false}
                      numberOfLines={1}
                      testID="password-input"
                    />
                    <RobustPressable
                      onPress={() => setShowPassword(!showPassword)}
                      style={styles.inputIcon}
                    >
                      <MaterialIcons
                        name={showPassword ? "visibility" : "visibility-off"}
                        size={24}
                        color={colors.textMuted}
                      />
                    </RobustPressable>
                  </View>
                  <RobustPressable
                    style={[styles.button, styles.primaryButton]}
                    onPress={handleSubmit}
                    disabled={isLoading}
                    testID="login-button"
                  >
                    {isLoading ? (
                      <ActivityIndicator color={colors.text} />
                    ) : (
                      <Text style={styles.buttonText}>{t('auth.login')}</Text>
                    )}
                  </RobustPressable>
                  <View style={styles.createNewVaultContainer}>
                    <Text style={styles.textMuted}>{t('auth.noAccountYet')} </Text>
                    <InAppBrowserView
                      url="https://app.aliasvault.net/user/setup"
                      title={t('auth.createNewVault')}
                      textStyle={styles.clickableLink}
                    />
                  </View>
                </View>
              )}
            </Animated.View>
          )}
        </ThemedView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}