import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, KeyboardAvoidingView, Platform, ScrollView, Dimensions, Text } from 'react-native';

import { AppErrorCode, getAppErrorCode, getErrorTranslationKey, formatErrorWithCode } from '@/utils/types/errors/AppErrorCodes';
import { VaultVersionIncompatibleError } from '@/utils/types/errors/VaultVersionIncompatibleError';

import { useColors } from '@/hooks/useColorScheme';
import { useLogout } from '@/hooks/useLogout';
import { useTranslation } from '@/hooks/useTranslation';

import Logo from '@/assets/images/logo.svg';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedText } from '@/components/themed/ThemedText';
import { Avatar } from '@/components/ui/Avatar';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Unlock screen.
 */
export default function UnlockScreen() : React.ReactNode {
  const { isLoggedIn, username, isBiometricsEnabled, getBiometricDisplayName, getEncryptionKeyDerivationParams } = useApp();
  const { logoutUserInitiated, logoutForced } = useLogout();
  const dbContext = useDb();
  const [isLoading, setIsLoading] = useState(true);
  const [isBiometricsAvailable, setIsBiometricsAvailable] = useState(false);
  const colors = useColors();
  const { t } = useTranslation();
  const [biometricDisplayName, setBiometricDisplayName] = useState('');

  // PIN unlock state
  const [pinAvailable, setPinAvailable] = useState(false);

  // Error state for password unlock
  const [error, setError] = useState<string | null>(null);

  // Alert dialog state
  const [alertConfig, setAlertConfig] = useState<{ title: string; message: string } | null>(null);

  /**
   * Check if the key derivation parameters are stored in native storage.
   * If not, we can't unlock the vault so logout instead to redirect user to login screen.
   */
  const getKeyDerivationParams = useCallback(async () : Promise<{ salt: string; encryptionType: string; encryptionSettings: string } | null> => {
    const params = await getEncryptionKeyDerivationParams();
    if (!params) {
      // No params means corrupted state - force logout without confirmation
      await logoutForced();
      return null;
    }
    return params;
  }, [logoutForced, getEncryptionKeyDerivationParams]);

  useEffect(() => {
    let isMounted = true;

    /**
     * Fetch config and display unlock screen.
     * Note: The user has been redirected here because automatic unlock (biometric/PIN)
     * failed or was cancelled in initialize/reinitialize. We should NOT attempt
     * automatic unlock again - just show the manual unlock options.
     */
    const fetchConfig = async (): Promise<void> => {
      await getKeyDerivationParams();

      if (!isMounted) {
        return;
      }

      // Check if biometrics is available
      const enabled = await isBiometricsEnabled();
      if (!isMounted) {
        return;
      }
      setIsBiometricsAvailable(enabled);

      const displayName = await getBiometricDisplayName();
      if (!isMounted) {
        return;
      }
      setBiometricDisplayName(displayName);

      // Check if PIN is enabled
      const pinEnabled = await NativeVaultManager.isPinEnabled();
      if (!isMounted) {
        return;
      }
      setPinAvailable(pinEnabled);

      /*
       * If ONLY password unlock is available (no biometric, no PIN),
       * show password unlock immediately to avoid showing empty unlock screen.
       * Otherwise, show the unlock screen with manual retry options.
       */
      if (!enabled && !pinEnabled) {
        // Only password available - show it immediately
        try {
          if (!isLoggedIn || !username) {
            router.replace('/login');
            return;
          }

          const encryptionKeyBase64 = await NativeVaultManager.showPasswordUnlock(
            t('auth.unlockVault'),
            t('auth.enterPassword')
          );

          if (!encryptionKeyBase64) {
            // User cancelled - show the unlock screen
            setIsLoading(false);
            return;
          }

          /*
           * Store key in memory only, don't persist to keychain.
           * User is doing password unlock because biometric failed/cancelled,
           * so they can't authenticate biometrically to store in keychain.
           * The old key in keychain is preserved for future biometric unlocks.
           */
          await dbContext.testDatabaseConnection(encryptionKeyBase64, false);

          if (await dbContext.hasPendingMigrations()) {
            router.replace('/upgrade');
            return;
          }

          router.replace('/reinitialize');
        } catch (err) {
          if (err instanceof VaultVersionIncompatibleError) {
            await logoutForced();
            return;
          }

          console.error('Unlock error:', err);
          const errorCode = getAppErrorCode(err);

          if (!errorCode || errorCode === AppErrorCode.VAULT_DECRYPT_FAILED) {
            setError(t('auth.errors.incorrectPassword'));
          } else {
            const translationKey = getErrorTranslationKey(errorCode);
            setError(formatErrorWithCode(t(translationKey), errorCode));
          }
          setIsLoading(false);
        }
      } else {
        // Biometric or PIN available - show unlock screen with manual retry options
        setIsLoading(false);
      }
    };

    fetchConfig();

    return (): void => {
      isMounted = false;
    };
  }, [isBiometricsEnabled, getKeyDerivationParams, getBiometricDisplayName, dbContext, isLoggedIn, username, t, logoutForced]);

  /**
   * Handle the unlock.
   */
  /**
   * Show an alert dialog.
   */
  const showAlert = useCallback((title: string, message: string): void => {
    setAlertConfig({ title, message });
  }, []);

  /**
   * Hide the alert dialog.
   */
  const hideAlert = useCallback((): void => {
    setAlertConfig(null);
  }, []);

  /**
   * Handle password unlock using native password screen.
   */
  const handlePasswordUnlock = async () : Promise<void> => {
    setError(null);
    setIsLoading(true);
    try {
      if (!isLoggedIn || !username) {
        // No username means we're not logged in, redirect to login
        router.replace('/login');
        return;
      }

      // Show native password unlock screen
      const encryptionKeyBase64 = await NativeVaultManager.showPasswordUnlock(
        t('auth.unlockVault'),
        t('auth.enterPassword')
      );

      // User cancelled
      if (!encryptionKeyBase64) {
        setIsLoading(false);
        return;
      }

      /*
       * Test the database connection with the encryption key.
       * Store in memory only - don't persist to keychain.
       * User chose password unlock because biometric/PIN failed or was cancelled,
       * so they can't authenticate biometrically to update keychain.
       * This preserves the existing keychain entry for future biometric unlocks.
       */
      await dbContext.testDatabaseConnection(encryptionKeyBase64, false);

      // Check if the vault is up to date, if not, redirect to the upgrade page.
      if (await dbContext.hasPendingMigrations()) {
        router.replace('/upgrade');
        return;
      }

      /*
       * Navigate to reinitialize which will sync vault with server
       * and then navigate to the appropriate destination.
       */
      router.replace('/reinitialize');
    } catch (err) {
      if (err instanceof VaultVersionIncompatibleError) {
        // Vault version incompatible - force logout without confirmation
        await logoutForced();
        return;
      }

      console.error('Unlock error:', err);

      // Try to extract error code from the error
      const errorCode = getAppErrorCode(err);

      /*
       * During unlock, VAULT_DECRYPT_FAILED indicates wrong password.
       * This is thrown when decryption fails due to incorrect encryption key.
       */
      if (!errorCode || errorCode === AppErrorCode.VAULT_DECRYPT_FAILED) {
        // Treat as incorrect password - show error and allow retry
        setError(t('auth.errors.incorrectPassword'));
      } else {
        // Other error codes: show the formatted message with raw error code
        const translationKey = getErrorTranslationKey(errorCode);
        setError(formatErrorWithCode(t(translationKey), errorCode));
      }
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Internal PIN unlock handler - performs PIN unlock and navigates on success.
   * Returns true if unlock succeeded, false otherwise.
   */
  const performPinUnlock = async () : Promise<boolean> => {
    try {
      await NativeVaultManager.showPinUnlock();

      // Check if vault is now unlocked
      const isNowUnlocked = await NativeVaultManager.isVaultUnlocked();
      if (isNowUnlocked) {
        // Check if the vault is up to date
        if (await dbContext.hasPendingMigrations()) {
          router.replace('/upgrade');
          return true;
        }
        router.replace('/reinitialize');
        return true;
      }
      // Not unlocked means user cancelled - return false but don't show error
      return false;
    } catch (err) {
      // User cancelled or PIN unlock failed
      const errorMessage = err instanceof Error ? err.message : '';
      if (!errorMessage.includes('cancelled') && !errorMessage.includes('canceled')) {
        console.error('PIN unlock error:', err);
        setError(t('auth.errors.pinFailed'));
      }
      return false;
    }
  };

  /**
   * Handle the biometrics retry - directly triggers biometric unlock.
   * If biometric fails and PIN is available, automatically falls back to PIN.
   */
  const handleBiometricRetry = async () : Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      /*
       * Clear any wrong key from memory first (e.g., from failed password attempt).
       * This forces getEncryptionKey() to fetch from keychain via biometrics.
       */
      await NativeVaultManager.clearEncryptionKeyFromMemory();

      // unlockVault now throws errors instead of returning false
      await dbContext.unlockVault();

      // Check if the vault is up to date
      if (await dbContext.hasPendingMigrations()) {
        router.replace('/upgrade');
        return;
      }
      router.replace('/reinitialize');
    } catch (err) {
      console.error('Biometric retry error:', err);

      // Check if this is a cancellation - don't show error, just allow retry
      const errorCode = getAppErrorCode(err);
      if (errorCode === 'E-509') { // BIOMETRIC_CANCELLED
        // User cancelled - don't show error, just stay on screen
        return;
      }

      // For other errors, try PIN fallback if available
      if (pinAvailable) {
        await performPinUnlock();
      } else if (errorCode) {
        // Show the error with code if no PIN fallback
        const translationKey = getErrorTranslationKey(errorCode);
        setError(formatErrorWithCode(t(translationKey), errorCode));
      }
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle the PIN retry button - directly triggers PIN unlock flow.
   */
  const handlePinRetry = async () : Promise<void> => {
    setIsLoading(true);
    setError(null);
    await performPinUnlock();
    setIsLoading(false);
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
      color: colors.errorText,
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
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
      testID="unlock-screen"
    >
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <LoadingIndicator status={t('app.status.unlockingVault')} />
        </View>
      ) : (
        <ScrollView
          style={styles.container}
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

              <RobustPressable
                style={styles.button}
                onPress={handlePasswordUnlock}
                disabled={isLoading}
                testID="unlock-button"
              >
                <ThemedText style={styles.buttonText}>
                  {isLoading ? t('auth.unlocking') : t('auth.unlockWithPassword')}
                </ThemedText>
              </RobustPressable>

              {isBiometricsAvailable && (
                <RobustPressable
                  style={styles.faceIdButton}
                  onPress={handleBiometricRetry}
                >
                  <ThemedText style={styles.faceIdButtonText}>{t('auth.tryBiometricAgain', { biometric: biometricDisplayName })}</ThemedText>
                </RobustPressable>
              )}

              {/* Use PIN Button */}
              {pinAvailable && (
                <RobustPressable
                  style={styles.faceIdButton}
                  onPress={handlePinRetry}
                >
                  <ThemedText style={styles.faceIdButtonText}>{t('auth.tryPinAgain')}</ThemedText>
                </RobustPressable>
              )}
            </View>

            <RobustPressable
              style={styles.logoutButton}
              onPress={logoutUserInitiated}
              testID="logout-button"
            >
              <ThemedText style={styles.logoutButtonText}>{t('auth.logout')}</ThemedText>
            </RobustPressable>
          </View>
        </ScrollView>
      )}

      <ConfirmDialog
        isVisible={alertConfig !== null}
        title={alertConfig?.title ?? ''}
        message={alertConfig?.message ?? ''}
        buttons={[{ text: t('common.ok'), style: 'default', onPress: hideAlert }]}
        onClose={hideAlert}
      />
    </KeyboardAvoidingView>
  );
}