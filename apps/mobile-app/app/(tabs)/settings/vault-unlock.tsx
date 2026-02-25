import * as LocalAuthentication from 'expo-local-authentication';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, Platform, Linking, Switch, TouchableOpacity } from 'react-native';
import Toast from 'react-native-toast-message';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { AuthMethod, useAuth } from '@/context/AuthContext';
import { useDialog } from '@/context/DialogContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Vault unlock settings screen.
 */
export default function VaultUnlockSettingsScreen() : React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const { showAlert, showDialog } = useDialog();
  const [initialized, setInitialized] = useState(false);
  const { setAuthMethods, getEnabledAuthMethods, getBiometricDisplayName } = useAuth();
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const [isBiometricsEnabled, setIsBiometricsEnabled] = useState(false);
  const [biometricDisplayName, setBiometricDisplayName] = useState('');
  const [_, setEnabledAuthMethods] = useState<AuthMethod[]>([]);

  // PIN state
  const [pinEnabled, setPinEnabled] = useState(false);

  useEffect(() => {
    /**
     * Initialize the auth methods.
     */
    const initializeAuth = async () : Promise<void> => {
      try {
        // Check for hardware support
        const compatible = await LocalAuthentication.hasHardwareAsync();

        // Check if any biometrics are enrolled
        const enrolled = await LocalAuthentication.isEnrolledAsync();

        // Set biometric availability based on all checks
        const isBiometricAvailable = compatible && enrolled;
        setHasBiometrics(isBiometricAvailable);

        // Get appropriate display name from auth context
        const displayName = await getBiometricDisplayName();
        setBiometricDisplayName(displayName);

        const methods = await getEnabledAuthMethods();
        setEnabledAuthMethods(methods);

        if (methods.includes('faceid') && enrolled) {
          setIsBiometricsEnabled(true);
        }

        // Load PIN settings (locked state removed - automatically handled by native code)
        const enabled = await NativeVaultManager.isPinEnabled();
        setPinEnabled(enabled);

        setInitialized(true);
      } catch (error) {
        console.error('Failed to initialize auth:', error);
        setHasBiometrics(false);
        setInitialized(true);
      }
    };

    initializeAuth();
  }, [getEnabledAuthMethods, getBiometricDisplayName, t]);

  useEffect(() => {
    if (!initialized) {
      return;
    }

    /**
     * Update the auth methods.
     */
    const updateAuthMethods = async () : Promise<void> => {
      const currentAuthMethods = await getEnabledAuthMethods();
      const newAuthMethods = isBiometricsEnabled ? ['faceid', 'password'] : ['password'];

      if (currentAuthMethods.length === newAuthMethods.length &&
          currentAuthMethods.every(method => newAuthMethods.includes(method))) {
        return;
      }

      setAuthMethods(newAuthMethods as AuthMethod[]);
    };

    updateAuthMethods();
  }, [isBiometricsEnabled, setAuthMethods, getEnabledAuthMethods, initialized]);

  const handleBiometricsToggle = useCallback(async (value: boolean) : Promise<void> => {
    if (value && !hasBiometrics) {
      showDialog(
        t('settings.vaultUnlockSettings.biometricNotAvailable', { biometric: biometricDisplayName }),
        t('settings.vaultUnlockSettings.biometricDisabledMessage', { biometric: biometricDisplayName }),
        [
          {
            text: t('settings.openSettings'),
            style: 'default',
            /**
             * Handle the open settings press.
             */
            onPress: () : void => {
              setIsBiometricsEnabled(true);
              setAuthMethods(['faceid', 'password']);
              if (Platform.OS === 'ios') {
                Linking.openURL('app-settings:');
              } else {
                Linking.openSettings();
              }
            },
          },
          {
            text: t('common.cancel'),
            style: 'cancel',
            /**
             * Handle the cancel press.
             */
            onPress: () : void => {
              setIsBiometricsEnabled(false);
              setAuthMethods(['password']);
            },
          },
        ]
      );
      return;
    }

    // Check if keystore is available when enabling biometrics (iOS requires device passcode)
    if (value && Platform.OS === 'ios') {
      const keystoreAvailable = await NativeVaultManager.isKeystoreAvailable();
      if (!keystoreAvailable) {
        showAlert(
          t('settings.vaultUnlockSettings.biometricNotAvailable', { biometric: biometricDisplayName }),
          t('settings.vaultUnlockSettings.featureRequiresPasscode')
        );
        return;
      }
    }

    /*
     * Biometrics and PIN can now both be enabled simultaneously.
     * Biometrics takes priority during unlock, PIN serves as fallback.
     */
    setIsBiometricsEnabled(value);
    setAuthMethods(value ? ['faceid', 'password'] : ['password']);

    // Show toast notification only on biometrics enabled
    if (value) {
      Toast.show({
        type: 'success',
        text1: t('settings.vaultUnlockSettings.biometricEnabled', { biometric: biometricDisplayName }),
        position: 'bottom',
        visibilityTime: 1200,
      });
    }
  }, [hasBiometrics, setAuthMethods, biometricDisplayName, showDialog, showAlert, t]);

  /**
   * Handle enable PIN - launches native PIN setup UI.
   */
  const handleEnablePin = useCallback(async () : Promise<void> => {
    try {
      // Check if keystore is available (requires device passcode on iOS)
      const keystoreAvailable = await NativeVaultManager.isKeystoreAvailable();

      if (!keystoreAvailable) {
        // On iOS, keystore requires device passcode to be set
        showAlert(
          t('common.error'),
          t('settings.vaultUnlockSettings.featureRequiresPasscode')
        );
        return;
      }

      // Launch native PIN setup UI
      await NativeVaultManager.showPinSetup();

      /*
       * PIN and biometrics can now both be enabled simultaneously.
       * Biometrics takes priority during unlock, PIN serves as fallback.
       */
      setPinEnabled(true);
      Toast.show({
        type: 'success',
        text1: t('settings.vaultUnlockSettings.pinEnabled'),
        position: 'bottom',
        visibilityTime: 1200,
      });
    } catch (error) {
      // Handle cancellation or errors
      if ((error as { code?: string })?.code === 'USER_CANCELLED') {
        // User cancelled - do nothing
        return;
      }

      console.error('Failed to enable PIN:', error);
      showAlert(t('common.error'), t('common.errors.unknownErrorTryAgain'));
    }
  }, [showAlert, t]);

  /**
   * Handle disable PIN.
   */
  const handleDisablePin = useCallback(async () : Promise<void> => {
    try {
      await NativeVaultManager.removeAndDisablePin();
      setPinEnabled(false);
      Toast.show({
        type: 'success',
        text1: t('settings.vaultUnlockSettings.pinDisabled'),
        position: 'bottom',
        visibilityTime: 1200,
      });
    } catch (error) {
      console.error('Failed to disable PIN:', error);
      showAlert(t('common.error'), t('common.errors.unknownErrorTryAgain'));
    }
  }, [showAlert, t]);

  const styles = StyleSheet.create({
    button: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      height: 50,
      justifyContent: 'center',
      marginTop: 16,
      width: '100%',
    },
    buttonText: {
      color: colors.primarySurfaceText,
      fontSize: 16,
      fontWeight: '600',
    },
    disabledText: {
      color: colors.textMuted,
      opacity: 0.5,
    },
    headerText: {
      color: colors.textMuted,
      fontSize: 13,
    },
    helpIcon: {
      marginLeft: 8,
    },
    helpText: {
      color: colors.textMuted,
      fontSize: 13,
      marginTop: 4,
    },
    option: {
      borderBottomColor: colors.accentBorder,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    optionContainer: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 16,
    },
    optionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    optionHeaderLeft: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
    },
    optionLast: {
      borderBottomWidth: 0,
    },
    optionText: {
      color: colors.text,
      fontSize: 16,
    },
    warningText: {
      color: colors.errorBorder,
      fontSize: 13,
      marginTop: 4,
    },
  });

  return (
    <ThemedContainer>
      <ThemedScrollView>
        <ThemedText style={styles.headerText}>
          {t('settings.vaultUnlockSettings.description')}
        </ThemedText>

        <View style={styles.optionContainer}>
          <TouchableOpacity
            style={styles.option}
            onPress={() => handleBiometricsToggle(!isBiometricsEnabled)}
          >
            <View style={styles.optionHeader}>
              <ThemedText style={[styles.optionText, !hasBiometrics && styles.disabledText]}>
                {biometricDisplayName}
              </ThemedText>
              <View pointerEvents="none">
                <Switch
                  value={isBiometricsEnabled}
                  disabled={!hasBiometrics}
                />
              </View>
            </View>
            <ThemedText style={styles.helpText}>
              {t('settings.vaultUnlockSettings.biometricHelp', {
                keystore: Platform.OS === 'ios' ? t('settings.vaultUnlockSettings.keystoreIOS') : t('settings.vaultUnlockSettings.keystoreAndroid')
              })}
            </ThemedText>
            {!hasBiometrics && (
              <ThemedText style={[styles.helpText, { color: colors.errorBorder }]}>
                {t('settings.vaultUnlockSettings.biometricUnavailableHelp', { biometric: biometricDisplayName })}
              </ThemedText>
            )}
          </TouchableOpacity>

          {/* PIN option */}
          <TouchableOpacity
            style={styles.option}
            onPress={pinEnabled ? handleDisablePin : handleEnablePin}
          >
            <View style={styles.optionHeader}>
              <View style={styles.optionHeaderLeft}>
                <ThemedText style={[styles.optionText]}>
                  {t('settings.vaultUnlockSettings.pin')}
                </ThemedText>
              </View>
              <View pointerEvents="none">
                <Switch
                  value={pinEnabled}
                />
              </View>
            </View>
            <ThemedText style={styles.helpText}>
              {t('settings.vaultUnlockSettings.pinDescription')}
            </ThemedText>
          </TouchableOpacity>

          <View style={[styles.option, styles.optionLast]}>
            <View style={styles.optionHeader}>
              <ThemedText style={styles.optionText}>{t('items.password')}</ThemedText>
              <Switch
                value={true}
                disabled={true}
              />
            </View>
            <ThemedText style={styles.helpText}>
              {t('settings.vaultUnlockSettings.passwordHelp')}
            </ThemedText>
          </View>
        </View>

      </ThemedScrollView>
    </ThemedContainer>
  );
}