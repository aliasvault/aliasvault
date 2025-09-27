import { Buffer } from 'buffer';

import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, SafeAreaView, TextInput, ActivityIndicator, Animated, ScrollView, KeyboardAvoidingView, Platform, Dimensions, Alert } from 'react-native';

import { useApiUrl } from '@/utils/ApiUrlUtility';
import ConversionUtility from '@/utils/ConversionUtility';
import type { EncryptionKeyDerivationParams } from '@/utils/dist/shared/models/metadata';
import type { LoginResponse, VaultResponse } from '@/utils/dist/shared/models/webapi';
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
import { useWebApi } from '@/context/WebApiContext';

/**
 * Login screen.
 */
export default function LoginScreen() : React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const [fadeAnim] = useState(new Animated.Value(0));
  const { loadApiUrl, getDisplayUrl } = useApiUrl();

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 1000,
      useNativeDriver: true,
    }).start();
    loadApiUrl();
  }, [fadeAnim, loadApiUrl]);

  // Update URL when returning from settings
  useFocusEffect(() => {
    loadApiUrl();
  });

  const [credentials, setCredentials] = useState({
    username: 'imgshare',
    password: 'asdasdasdasd1',
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
   * @param vaultResponseJson - The vault response
   * @param passwordHashBase64 - The password hash base64
   * @param initiateLoginResponse - The initiate login response
   */
  const processVaultResponse = async (
    token: string,
    refreshToken: string,
    vaultResponseJson: VaultResponse,
    passwordHashBase64: string,
    initiateLoginResponse: LoginResponse
  ) : Promise<void> => {
    // Get biometric display name key and translate it
    const biometricDisplayNameKey = await authContext.getBiometricDisplayNameKey();
    const biometricDisplayName = t(biometricDisplayNameKey);
    const isBiometricsEnabledOnDevice = await authContext.isBiometricsEnabledOnDevice();

    if (isBiometricsEnabledOnDevice) {
      // Show biometric prompt if biometrics are available (faceid or fingerprint enrolled) on device.
      Alert.alert(
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
                vaultResponseJson,
                passwordHashBase64,
                initiateLoginResponse
              );
            }
          },
          {
            text: t('common.yes'),
            isPreferred: true,
            /**
             * Handle enabling biometric authentication
             */
            onPress: async () : Promise<void> => {
              await authContext.setAuthMethods(['faceid', 'password']);
              await continueProcessVaultResponse(
                token,
                refreshToken,
                vaultResponseJson,
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
        vaultResponseJson,
        passwordHashBase64,
        initiateLoginResponse
      );
    }
  };

  /**
   * Continue processing the vault response after biometric choice
   * @param token - The token to use for the vault
   * @param refreshToken - The refresh token to use for the vault
   * @param vaultResponseJson - The vault response
   * @param passwordHashBase64 - The password hash base64
   * @param initiateLoginResponse - The initiate login response
   * @param encryptionKeyDerivationParams - The encryption key derivation parameters
   */
  const continueProcessVaultResponse = async (
    token: string,
    refreshToken: string,
    vaultResponseJson: VaultResponse,
    passwordHashBase64: string,
    initiateLoginResponse: LoginResponse
  ) : Promise<void> => {
    const encryptionKeyDerivationParams : EncryptionKeyDerivationParams = {
      encryptionType: initiateLoginResponse.encryptionType,
      encryptionSettings: initiateLoginResponse.encryptionSettings,
      salt: initiateLoginResponse.salt,
    };

    // Set auth tokens, store encryption key and key derivation params, and initialize database
    await authContext.setAuthTokens(ConversionUtility.normalizeUsername(credentials.username), token, refreshToken);
    await dbContext.storeEncryptionKey(passwordHashBase64);
    await dbContext.storeEncryptionKeyDerivationParams(encryptionKeyDerivationParams);
    await dbContext.initializeDatabase(vaultResponseJson);

    let checkSuccess = true;
    /**
     * After setting auth tokens, execute a server status check immediately
     * which takes care of certain sanity checks such as ensuring client/server
     * compatibility.
     */
    await syncVault({
      initialSync: true,
      /**
       * Handle the status update.
       */
      onError: (message) => {
        checkSuccess = false;

        // Show modal with error message
        Alert.alert(t('common.error'), message);
        // Error will trigger logout through the sync process
        setIsLoading(false);
      },
      /**
       * On upgrade required.
       */
      onUpgradeRequired: async () : Promise<void> => {
        checkSuccess = false;

        // Still login to ensure the user is logged in.
        await authContext.login();

        // But after login, redirect to upgrade screen immediately.
        router.replace('/upgrade');
        return;
      },
    });

    if (!checkSuccess) {
      // If the syncvault checks have failed, we can't continue with the login process.
      return;
    }

    await authContext.login();

    authContext.setOfflineMode(false);
    setTwoFactorRequired(false);
    setTwoFactorCode('');
    setPasswordHashString(null);
    setPasswordHashBase64(null);
    setInitiateLoginResponse(null);
    setLoginStatus(null);
    router.replace('/(tabs)/credentials');
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
      const vaultResponseJson = await webApi.authFetch<VaultResponse>('Vault', { method: 'GET', headers: {
        'Authorization': `Bearer ${validationResponse.token.token}`
      } });

      const vaultError = webApi.validateVaultResponse(vaultResponseJson);
      if (vaultError) {
        console.error('vaultError', vaultError);
        setError(vaultError);
        setIsLoading(false);
        setLoginStatus(null);
        return;
      }

      await processVaultResponse(
        validationResponse.token.token,
        validationResponse.token.refreshToken,
        vaultResponseJson,
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
        setError(t(isSelfHosted ? 'auth.errors.serverErrorSelfHosted' : 'auth.errors.serverError'));
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
      const vaultResponseJson = await webApi.authFetch<VaultResponse>('Vault', { method: 'GET', headers: {
        'Authorization': `Bearer ${validationResponse.token.token}`
      } });

      const vaultError = webApi.validateVaultResponse(vaultResponseJson);
      if (vaultError) {
        setError(vaultError);
        setIsLoading(false);
        return;
      }

      await processVaultResponse(
        validationResponse.token.token,
        validationResponse.token.refreshToken,
        vaultResponseJson,
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
      paddingTop: 24,
    },
    headerSubtitle: {
      color: colors.textMuted,
      fontSize: 14,
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
          <Animated.View style={[styles.headerSection, { opacity: fadeAnim }]}>
            <View style={styles.logoContainer}>
              <Logo width={80} height={80} />
              <Text style={styles.appName}>{t('app.appName')}</Text>
            </View>
          </Animated.View>
        </SafeAreaView>
        <ThemedView style={styles.content}>
          {isLoading ? (
            <LoadingIndicator status={loginStatus ?? t('common.loading')} />
          ) : (
            <>
              <View style={styles.headerContainer}>
                <Text style={styles.headerTitle}>{t('auth.login')}</Text>
                <Text style={styles.headerSubtitle}>
                  {t('auth.connectingTo')} {' '}
                  <Text
                    style={styles.clickableLink}
                    onPress={() => router.push('/login-settings')}
                  >
                    {getDisplayUrl()}
                  </Text>
                </Text>
              </View>

              {error && (
                <View style={styles.errorContainer}>
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
            </>
          )}
        </ThemedView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}