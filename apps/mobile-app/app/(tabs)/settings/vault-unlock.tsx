import { MaterialIcons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, Alert, Platform, Linking, Switch, TouchableOpacity, Modal } from 'react-native';
import Toast from 'react-native-toast-message';

import { isPinEnabled, setupPin, removeAndDisablePin } from '@/utils/PinUnlockService';

import { useColors } from '@/hooks/useColorScheme';

import { PinNumpad } from '@/components/pin/PinNumpad';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { AuthMethod, useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';

/**
 * Vault unlock settings screen.
 */
export default function VaultUnlockSettingsScreen() : React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const dbContext = useDb();
  const [initialized, setInitialized] = useState(false);
  const { setAuthMethods, getEnabledAuthMethods, getBiometricDisplayNameKey } = useAuth();
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const [isBiometricsEnabled, setIsBiometricsEnabled] = useState(false);
  const [biometricDisplayName, setBiometricDisplayName] = useState('');
  const [_, setEnabledAuthMethods] = useState<AuthMethod[]>([]);

  // PIN state
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pinLocked, setPinLocked] = useState(false);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinSetupStep, setPinSetupStep] = useState(1);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

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

        // Get appropriate display name key from auth context
        const displayNameKey = await getBiometricDisplayNameKey();
        // Translate the key
        const displayName = t(displayNameKey);
        setBiometricDisplayName(displayName);

        const methods = await getEnabledAuthMethods();
        setEnabledAuthMethods(methods);

        if (methods.includes('faceid') && enrolled) {
          setIsBiometricsEnabled(true);
        }

        // Load PIN settings (locked state removed - automatically handled by native code)
        const enabled = await isPinEnabled();
        setPinEnabled(enabled);
        setPinLocked(false); // No longer tracking locked state

        setInitialized(true);
      } catch (error) {
        console.error('Failed to initialize auth:', error);
        setHasBiometrics(false);
        setInitialized(true);
      }
    };

    initializeAuth();
  }, [getEnabledAuthMethods, getBiometricDisplayNameKey, t]);

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
      Alert.alert(
        t('settings.vaultUnlockSettings.biometricNotAvailable', { biometric: biometricDisplayName }),
        t('settings.vaultUnlockSettings.biometricDisabledMessage', { biometric: biometricDisplayName }),
        [
          {
            text: t('settings.openSettings'),
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

    // If enabling biometrics and PIN is enabled, disable PIN first
    if (value && pinEnabled) {
      try {
        await removeAndDisablePin();
        setPinEnabled(false);
      } catch (error) {
        console.error('Failed to disable PIN:', error);
      }
    }

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
  }, [hasBiometrics, pinEnabled, setAuthMethods, biometricDisplayName, t]);

  /**
   * Handle enable PIN.
   */
  const handleEnablePin = useCallback(() : void => {
    // Don't disable biometrics yet - only after successful PIN setup
    setPinSetupStep(1);
    setNewPin('');
    setConfirmPin('');
    setShowPinSetup(true);
  }, []);

  /**
   * Handle disable PIN.
   */
  const handleDisablePin = useCallback(async () : Promise<void> => {
    try {
      await removeAndDisablePin();
      setPinEnabled(false);
      setPinLocked(false);
      Toast.show({
        type: 'success',
        text1: t('settings.vaultUnlockSettings.pinDisabled'),
        position: 'bottom',
        visibilityTime: 1200,
      });
    } catch (error) {
      console.error('Failed to disable PIN:', error);
      Alert.alert(
        t('common.error'),
        t('common.errors.unknownErrorTryAgain'),
        [{ text: t('common.ok'), style: 'default' }]
      );
    }
  }, [t]);

  /**
   * Handle PIN change for step 1 (enter new PIN).
   */
  const handleNewPinChange = useCallback((pin: string) : void => {
    setNewPin(pin);
    setPinError(null);
  }, []);

  /**
   * Handle step 1 submit (advance to confirmation).
   */
  const handleNewPinSubmit = useCallback(() : void => {
    setPinSetupStep(2);
  }, []);

  /**
   * Handle PIN change for step 2 (confirm PIN).
   */
  const handleConfirmPinChange = useCallback((pin: string) : void => {
    setConfirmPin(pin);
    setPinError(null);
  }, []);

  /**
   * Handle step 2 submit (confirm and save PIN).
   */
  const handleConfirmPinSubmit = useCallback(() : void => {
    if (confirmPin !== newPin) {
      setPinError(t('settings.vaultUnlockSettings.pinMismatch'));
      // Restart from step 1 on mismatch
      setTimeout(() => {
        setPinSetupStep(1);
        setNewPin('');
        setConfirmPin('');
        setPinError(null);
      }, 1000); // Show error for 1s before restarting
      return;
    }

    // PINs match, submit
    handlePinSetupSubmit(confirmPin);
  }, [confirmPin, newPin, t]);

  /**
   * Handle PIN setup submit.
   */
  const handlePinSetupSubmit = useCallback(async (pin: string) : Promise<void> => {
    try {
      // Setup PIN - encryption key is retrieved internally by native code
      await setupPin(pin);

      // PIN setup successful - now disable biometrics if it was enabled
      if (isBiometricsEnabled) {
        setIsBiometricsEnabled(false);
        await setAuthMethods(['password']);
      }

      setPinEnabled(true);
      setShowPinSetup(false);
      setPinSetupStep(1);
      setNewPin('');
      setConfirmPin('');
      setPinError(null);
      Toast.show({
        type: 'success',
        text1: t('settings.vaultUnlockSettings.pinEnabled'),
        position: 'bottom',
        visibilityTime: 1200,
      });
    } catch (error) {
      console.error('Failed to enable PIN:', error);
      let errorMessage = t('common.errors.unknownErrorTryAgain');

      setPinError(errorMessage);
      setConfirmPin('');
    }
  }, [isBiometricsEnabled, setAuthMethods, t]);

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
    input: {
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      color: colors.text,
      fontSize: 24,
      height: 60,
      letterSpacing: 8,
      paddingHorizontal: 16,
      textAlign: 'center',
    },
    modalButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      height: 50,
      justifyContent: 'center',
      marginTop: 16,
      width: '100%',
    },
    modalButtonText: {
      color: colors.primarySurfaceText,
      fontSize: 16,
      fontWeight: '600',
    },
    modalCloseButton: {
      padding: 8,
      position: 'absolute',
      right: 8,
      top: 8,
    },
    modalContainer: {
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      flex: 1,
      justifyContent: 'center',
      padding: 20,
    },
    modalContent: {
      backgroundColor: colors.accentBackground,
      borderRadius: 16,
      padding: 24,
    },
    modalText: {
      color: colors.textMuted,
      fontSize: 14,
      marginBottom: 16,
    },
    modalTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 16,
      paddingRight: 32,
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
                keystore: Platform.OS === 'ios' ? t('settings.vaultUnlockSettings.keystoreIOS') : t('settings.vaultUnlockSettings.keystoreAndroid'),
                biometric: biometricDisplayName
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
            onPress={pinEnabled && !pinLocked ? handleDisablePin : handleEnablePin}
          >
            <View style={styles.optionHeader}>
              <View style={styles.optionHeaderLeft}>
                <ThemedText style={[styles.optionText, pinLocked && styles.disabledText]}>
                  {t('settings.vaultUnlockSettings.pin')}
                </ThemedText>
              </View>
              <View pointerEvents="none">
                <Switch
                  value={pinEnabled && !pinLocked}
                  disabled={pinLocked}
                />
              </View>
            </View>
            <ThemedText style={styles.helpText}>
              {t('settings.vaultUnlockSettings.pinDescription')}
            </ThemedText>
            {pinLocked && (
              <ThemedText style={styles.warningText}>
                {t('settings.vaultUnlockSettings.pinLocked')}
              </ThemedText>
            )}
          </TouchableOpacity>

          <View style={[styles.option, styles.optionLast]}>
            <View style={styles.optionHeader}>
              <ThemedText style={styles.optionText}>{t('credentials.password')}</ThemedText>
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

        {/* PIN Setup Modal */}
        <Modal
          visible={showPinSetup}
          transparent={true}
          animationType="fade"
          onRequestClose={() => {
            setShowPinSetup(false);
            setPinSetupStep(1);
            setNewPin('');
            setConfirmPin('');
          }}
        >
          <View style={styles.modalContainer}>
            <ThemedView style={styles.modalContent}>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => {
                  setShowPinSetup(false);
                  setPinSetupStep(1);
                  setNewPin('');
                  setConfirmPin('');
                }}
              >
                <MaterialIcons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>

              {pinSetupStep === 1 ? (
                <PinNumpad
                  pin={newPin}
                  onPinChange={handleNewPinChange}
                  onSubmit={handleNewPinSubmit}
                  error={pinError}
                  title={t('settings.vaultUnlockSettings.setupPin')}
                  subtitle={t('settings.vaultUnlockSettings.enterNewPinDescription')}
                  submitButtonText={t('common.next')}
                  minLength={4}
                  maxLength={8}
                />
              ) : (
                <PinNumpad
                  pin={confirmPin}
                  onPinChange={handleConfirmPinChange}
                  onSubmit={handleConfirmPinSubmit}
                  error={pinError}
                  title={t('settings.vaultUnlockSettings.confirmPin')}
                  subtitle={t('settings.vaultUnlockSettings.confirmPinDescription')}
                  submitButtonText={t('common.confirm')}
                  minLength={4}
                  maxLength={8}
                />
              )}
            </ThemedView>
          </View>
        </Modal>
      </ThemedScrollView>
    </ThemedContainer>
  );
}