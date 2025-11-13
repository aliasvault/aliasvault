import { Buffer } from 'buffer';

import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, TextInput, Alert, KeyboardAvoidingView, Platform, ScrollView, Dimensions, TouchableWithoutFeedback, Keyboard, Text, Pressable } from 'react-native';

import EncryptionUtility from '@/utils/EncryptionUtility';
import { VaultVersionIncompatibleError } from '@/utils/types/errors/VaultVersionIncompatibleError';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import Logo from '@/assets/images/logo.svg';
import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { Avatar } from '@/components/ui/Avatar';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Unlock screen.
 */
export default function UnlockScreen() : React.ReactNode {
  const { isLoggedIn, username, isBiometricsEnabled, getBiometricDisplayNameKey, getEncryptionKeyDerivationParams, logout } = useApp();
  const dbContext = useDb();
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isBiometricsAvailable, setIsBiometricsAvailable] = useState(false);
  const colors = useColors();
  const { t } = useTranslation();
  const [biometricDisplayName, setBiometricDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // PIN unlock state
  const [pinAvailable, setPinAvailable] = useState(false);

  // Error state for password unlock
  const [error, setError] = useState<string | null>(null);

  /**
   * Check if the key derivation parameters are stored in native storage.
   * If not, we can't unlock the vault so logout instead to redirect user to login screen.
   */
  const getKeyDerivationParams = useCallback(async () : Promise<{ salt: string; encryptionType: string; encryptionSettings: string } | null> => {
    const params = await getEncryptionKeyDerivationParams();
    if (!params) {
      await logout();
      router.replace('/login');
      return null;
    }
    return params;
  }, [logout, getEncryptionKeyDerivationParams]);

  /**
   * Handle PIN unlock using native UI.
   * Falls back to showing password input on cancel.
   */
  const handlePinUnlock = useCallback(async () : Promise<void> => {
    try {
      /*
       * Show native PIN unlock UI
       * This will handle the unlock internally and store the encryption key
       */
      await NativeVaultManager.showPinUnlock();

      /*
       * Check if the vault is ready
       */
      if (dbContext.dbAvailable) {
        // Check if the vault is up to date, if not, redirect to the upgrade page.
        if (await dbContext.hasPendingMigrations()) {
          router.replace('/upgrade');
          return;
        }

        /*
         * Navigate to initialize page which will handle vault sync and then navigate to credentials
         * This ensures we always check for vault updates even after local unlock
         */
        router.replace('/initialize');
      } else {
        // If db is not available for whatever reason, fallback to password unlock.
        setIsLoading(false);
        Alert.alert(
          t('common.error'),
          t('auth.errors.incorrectPassword'),
          [{ text: t('common.ok'), style: 'default' }]
        );
      }
    } catch (err: unknown) {
      // User cancelled or error occurred
      setIsLoading(false);

      if (err && typeof err === 'object' && 'code' in err) {
        // Show password input as fallback on error
        console.error('PIN unlock failed:', err);

        // Check if PIN is still enabled and update state accordingly
        const pinStillEnabled = await NativeVaultManager.isPinEnabled();
        setPinAvailable(pinStillEnabled);
        return;
      }
    }
  }, [dbContext, t, setPinAvailable]);

  useEffect(() => {
    getKeyDerivationParams();

    /**
     * Fetch the biometric config and PIN availability, then attempt unlock.
     */
    const fetchConfigAndUnlock = async () : Promise<void> => {
      const enabled = await isBiometricsEnabled();
      setIsBiometricsAvailable(enabled);

      const displayNameKey = await getBiometricDisplayNameKey();
      setBiometricDisplayName(t(displayNameKey));

      // Check PIN availability
      const pinEnabled = await NativeVaultManager.isPinEnabled();
      setPinAvailable(pinEnabled);

      /*
       * If PIN is enabled, automatically try PIN unlock first
       * Show loading state, then launch native PIN UI
       * If user cancels or PIN is not available, loading stops and password input shows
       */
      if (pinEnabled) {
        await handlePinUnlock();
      } else {
        // No PIN available, stop loading to show password input
        setIsLoading(false);
      }
    };
    fetchConfigAndUnlock();

  }, [isBiometricsEnabled, getKeyDerivationParams, getBiometricDisplayNameKey, t, handlePinUnlock]);

  /**
   * Handle the unlock.
   */
  const handleUnlock = async () : Promise<void> => {
    if (!password) {
      Alert.alert(
        t('common.error'),
        t('auth.errors.enterPassword'),
        [{ text: t('common.ok'), style: 'default' }]
      );
      return;
    }

    setError(null);
    setIsLoading(true);
    try {
      if (!isLoggedIn || !username) {
        // No username means we're not logged in, redirect to login
        router.replace('/login');
        return;
      }

      // Get the key derivation parameters from native storage
      const params = await getKeyDerivationParams();
      if (!params) {
        return;
      }

      // Derive the encryption key from the password using the stored parameters
      const passwordHash = await EncryptionUtility.deriveKeyFromPassword(
        password,
        params.salt,
        params.encryptionType,
        params.encryptionSettings
      );

      const passwordHashBase64 = Buffer.from(passwordHash).toString('base64');

      // Test the database connection with the derived encryption key
      if (await dbContext.testDatabaseConnection(passwordHashBase64)) {
        // Check if the vault is up to date, if not, redirect to the upgrade page.
        if (await dbContext.hasPendingMigrations()) {
          router.replace('/upgrade');
          return;
        }

        /*
         * Navigate to initialize page which will handle vault sync and then navigate to credentials
         * This ensures we always check for vault updates even after local unlock
         */
        router.replace('/initialize');
      } else {
        Alert.alert(
          t('common.error'),
          t('auth.errors.incorrectPassword'),
          [{ text: t('common.ok'), style: 'default' }]
        );
      }
    } catch (error) {
      if (error instanceof VaultVersionIncompatibleError) {
        await logout(t(error.message));
        return;
      }

      console.error('Unlock error:', error);
      Alert.alert(
        t('common.error'),
        t('auth.errors.incorrectPassword'),
        [{ text: t('common.ok'), style: 'default' }]
      );
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle the logout.
   */
  const handleLogout = async () : Promise<void> => {
    /*
     * Clear any stored tokens or session data
     * This will be handled by the auth context
     */
    await logout();
    router.replace('/login');
  };

  /**
   * Handle the biometrics retry.
   */
  const handleBiometricsRetry = async () : Promise<void> => {
    router.replace('/reinitialize');
  };

  const styles = StyleSheet.create({
    appName: {
      color: colors.text,
      fontSize: 32,
      fontWeight: 'bold',
      textAlign: 'center',
    },
    avatarContainer: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      marginBottom: 16,
    },
    button: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      height: 50,
      justifyContent: 'center',
      marginBottom: 16,
      width: '100%',
    },
    buttonText: {
      color: colors.primarySurfaceText,
      fontSize: 16,
      fontWeight: '600',
    },
    container: {
      flex: 1,
    },
    content: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      padding: 20,
      width: '100%',
    },
    errorText: {
      color: colors.errorBorder,
      fontSize: 14,
      marginBottom: 12,
      textAlign: 'center',
    },
    faceIdButton: {
      alignItems: 'center',
      height: 50,
      justifyContent: 'center',
      width: '100%',
    },
    faceIdButtonText: {
      color: colors.primary,
      fontSize: 16,
      fontWeight: '600',
    },
    gradientContainer: {
      height: Dimensions.get('window').height * 0.4,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    headerSection: {
      paddingBottom: 24,
      paddingHorizontal: 16,
      paddingTop: 24,
    },
    input: {
      backgroundColor: colors.background,
      borderRadius: 8,
      color: colors.text,
      flex: 1,
      fontSize: 16,
      height: 50,
      paddingHorizontal: 16,
    },
    inputContainer: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      flexDirection: 'row',
      marginBottom: 16,
    },
    inputIcon: {
      padding: 12,
    },
    keyboardAvoidingView: {
      flex: 1,
    },
    linkButton: {
      marginTop: 16,
    },
    linkButtonText: {
      color: colors.primary,
      fontSize: 16,
      textAlign: 'center',
    },
    loadingContainer: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'flex-start',
      paddingHorizontal: 20,
      paddingTop: '40%',
    },
    logoContainer: {
      alignItems: 'center',
      marginBottom: 8,
    },
    logoutButton: {
      alignSelf: 'center',
      justifyContent: 'center',
      marginTop: 16,
    },
    logoutButtonText: {
      color: colors.red,
      fontSize: 16,
    },
    mainContent: {
      flex: 1,
      justifyContent: 'center',
      paddingBottom: 40,
      paddingHorizontal: 20,
    },
    scrollContent: {
      flexGrow: 1,
    },
    subtitle: {
      color: colors.text,
      fontSize: 16,
      marginBottom: 24,
      opacity: 0.7,
      textAlign: 'center',
    },
    username: {
      color: colors.text,
      fontSize: 18,
      opacity: 0.8,
      textAlign: 'center',
    },
  });

  // Render password mode or loading
  return (
    <ThemedView style={styles.container}>
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <LoadingIndicator status={t('app.status.unlockingVault')} />
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardAvoidingView}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <LinearGradient
                colors={[colors.loginHeader, colors.background]}
                style={styles.gradientContainer}
              />
              <View style={styles.mainContent}>
                <View style={styles.headerSection}>
                  <View style={styles.logoContainer}>
                    <Logo width={80} height={80} />
                    <Text style={styles.appName}>{t('auth.unlockVault')}</Text>
                  </View>
                </View>
                <View style={styles.content}>
                  <View style={styles.avatarContainer}>
                    <Avatar />
                    <ThemedText style={styles.username}>{username}</ThemedText>
                  </View>
                  <ThemedText style={styles.subtitle}>{t('auth.enterPassword')}</ThemedText>

                  {/* Error Message */}
                  {error && <ThemedText style={styles.errorText}>{error}</ThemedText>}

                  <View style={styles.inputContainer}>
                    <MaterialIcons
                      name="lock"
                      size={20}
                      color={colors.textMuted}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder={t('auth.enterPasswordPlaceholder')}
                      placeholderTextColor={colors.textMuted}
                      secureTextEntry={!showPassword}
                      value={password}
                      onChangeText={setPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      multiline={false}
                      numberOfLines={1}
                    />
                    <Pressable
                      onPress={() => setShowPassword(!showPassword)}
                      style={styles.inputIcon}
                    >
                      <MaterialIcons
                        name={showPassword ? "visibility" : "visibility-off"}
                        size={20}
                        color={colors.textMuted}
                      />
                    </Pressable>
                  </View>

                  <RobustPressable
                    style={styles.button}
                    onPress={handleUnlock}
                    disabled={isLoading}
                  >
                    <ThemedText style={styles.buttonText}>
                      {isLoading ? t('auth.unlocking') : t('auth.unlock')}
                    </ThemedText>
                  </RobustPressable>

                  {isBiometricsAvailable && (
                    <RobustPressable
                      style={styles.faceIdButton}
                      onPress={handleBiometricsRetry}
                    >
                      <ThemedText style={styles.faceIdButtonText}>{t('auth.tryBiometricAgain', { biometric: biometricDisplayName })}</ThemedText>
                    </RobustPressable>
                  )}

                  {/* Use PIN Button */}
                  {pinAvailable && (
                    <Pressable
                      style={styles.linkButton}
                      onPress={() => {
                        setIsLoading(true);
                        handlePinUnlock();
                      }}
                    >
                      <ThemedText style={styles.linkButtonText}>{t('auth.unlockWithPin')}</ThemedText>
                    </Pressable>
                  )}
                </View>

                <RobustPressable
                  style={styles.logoutButton}
                  onPress={handleLogout}
                >
                  <ThemedText style={styles.logoutButtonText}>{t('auth.logout')}</ThemedText>
                </RobustPressable>
              </View>
            </ScrollView>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      )}
    </ThemedView>
  );
}