import { apiErrorMessage } from '@aliasvault/client/api/errors/ApiErrorMessage';
import { IncorrectPasswordError, PasswordChangedElsewhereError } from '@aliasvault/client/auth/MasterPasswordService';
import { MIN_ACCEPTED_PASSWORD_LENGTH } from '@aliasvault/client/utilities/PasswordStrength';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, KeyboardAvoidingView, Platform } from 'react-native';

import { isServerUnreachable } from '@/utils/ServerReachability';

import { useColors } from '@/hooks/useColorScheme';
import { useVaultMutate } from '@/hooks/useVaultMutate';

import { PasswordStrengthIndicator } from '@/components/form/PasswordStrengthIndicator';
import LoadingOverlay from '@/components/LoadingOverlay';
import { ThemedButton } from '@/components/themed/ThemedButton';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedTextInput } from '@/components/themed/ThemedTextInput';
import { UsernameDisplay } from '@/components/ui/UsernameDisplay';
import { useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';

/**
 * Change password screen.
 * @returns {React.ReactNode} The rendered component
 */
export default function ChangePasswordScreen(): React.ReactNode {
  const colors = useColors();
  const authContext = useAuth();
  const dbContext = useDb();
  const { executeVaultPasswordChange, syncStatus } = useVaultMutate();
  const { t } = useTranslation();
  const { showAlert } = useDialog();
  const headerHeight = useHeaderHeight();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string | null>(null);

  const styles = StyleSheet.create({
    button: {
      marginTop: 8,
    },
    form: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 20,
      padding: 16,
    },
    headerText: {
      color: colors.textMuted,
      fontSize: 13,
      marginBottom: 16,
    },
    inputContainer: {
      marginBottom: 16,
    },
    keyboardAvoidingView: {
      flex: 1,
    },
    label: {
      color: colors.text,
      fontSize: 16,
      marginBottom: 8,
    },
    offlineWarning: {
      alignItems: 'center',
      backgroundColor: colors.warningBackground,
      borderRadius: 12,
      flexDirection: 'row',
      gap: 12,
      marginTop: 16,
      padding: 12,
    },
    offlineWarningText: {
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
    },
  });

  /**
   * Map a password change failure onto the message to show.
   * @param error - the error thrown by the change flow
   */
  const errorMessage = (error: unknown): string => {
    if (error instanceof IncorrectPasswordError) {
      return t('settings.securitySettings.changePassword.currentPasswordIncorrect');
    }
    if (error instanceof PasswordChangedElsewhereError) {
      return t('common.errors.passwordChanged');
    }
    return apiErrorMessage(error, t, t('settings.securitySettings.changePassword.failedToChange'));
  };

  /**
   * Handle the submit button press.
   * @returns {Promise<void>} A promise that resolves when the operation is complete
   */
  const handleSubmit = async (): Promise<void> => {
    // A password change is a handshake with the server, so it cannot run offline.
    if (dbContext.isOffline) {
      showAlert(t('common.error'), t('common.errors.serverNotAvailable'));
      return;
    }

    if (!currentPassword || !newPassword || !confirmPassword) {
      showAlert(t('common.error'), t('settings.securitySettings.changePassword.fillAllFields'));
      return;
    }

    if (newPassword.length < MIN_ACCEPTED_PASSWORD_LENGTH) {
      showAlert(t('common.error'), t('settings.securitySettings.changePassword.passwordTooShort', { minLength: MIN_ACCEPTED_PASSWORD_LENGTH }));
      return;
    }

    if (newPassword !== confirmPassword) {
      showAlert(t('common.error'), t('settings.securitySettings.changePassword.passwordsDoNotMatch'));
      return;
    }

    if (!authContext.username) {
      showAlert(t('common.error'), t('settings.securitySettings.changePassword.userNotAuthenticated'));
      return;
    }

    try {
      setIsLoading(true);
      setLoadingStatus(t('settings.securitySettings.changePassword.initiatingChange'));

      const currentUnlockKeyBase64 = await authContext.verifyPassword(currentPassword);
      if (!currentUnlockKeyBase64) {
        showAlert(t('common.error'), t('settings.securitySettings.changePassword.currentPasswordIncorrect'));
        return;
      }

      await executeVaultPasswordChange(currentUnlockKeyBase64, newPassword);

      // Show confirm dialog and go back to the settings screen
      showAlert(t('common.success'), t('settings.securitySettings.changePassword.passwordChangedSuccessfully'), () => {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        router.back();
      });
    } catch (error) {
      console.error('Password change error:', error);
      if (await isServerUnreachable()) {
        await dbContext.setIsOffline(true);
        showAlert(t('common.error'), t('common.errors.serverNotAvailable'));
        return;
      }
      showAlert(t('common.error'), errorMessage(error));
    } finally {
      setIsLoading(false);
      setLoadingStatus(null);
    }
  };

  return (
    <>
      {(isLoading) && (
        <LoadingOverlay status={syncStatus.length > 0 ? syncStatus : loadingStatus ?? ''} />
      )}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'android' ? headerHeight : 0}
        style={styles.keyboardAvoidingView}
      >
        <ThemedContainer testID="change-password-screen">
          <ThemedScrollView>
            <ThemedText style={styles.headerText}>
              {t('settings.securitySettings.changePassword.headerText')}
            </ThemedText>
            <UsernameDisplay />
            {dbContext.isOffline && (
              <View style={styles.offlineWarning}>
                <Ionicons name="warning" size={20} color={colors.warning} />
                <ThemedText style={styles.offlineWarningText}>{t('common.errors.serverNotAvailable')}</ThemedText>
              </View>
            )}
            <View style={styles.form}>
              <View style={styles.inputContainer}>
                <ThemedText style={styles.label}>{t('settings.securitySettings.changePassword.currentPassword')}</ThemedText>
                <ThemedTextInput
                  testID="current-password-input"
                  secureTextEntry
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder={t('settings.securitySettings.changePassword.enterCurrentPassword')}
                />
              </View>

              <View style={styles.inputContainer}>
                <ThemedText style={styles.label}>{t('settings.securitySettings.changePassword.newPassword')}</ThemedText>
                <ThemedTextInput
                  testID="new-password-input"
                  secureTextEntry
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder={t('settings.securitySettings.changePassword.enterNewPassword')}
                />
                <PasswordStrengthIndicator password={newPassword} />
              </View>

              <View style={styles.inputContainer}>
                <ThemedText style={styles.label}>{t('settings.securitySettings.changePassword.confirmNewPassword')}</ThemedText>
                <ThemedTextInput
                  testID="confirm-password-input"
                  secureTextEntry
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder={t('settings.securitySettings.changePassword.confirmNewPassword')}
                />
              </View>

              <ThemedButton
                testID="change-password-button"
                title={t('settings.securitySettings.changePassword.changePassword')}
                onPress={handleSubmit}
                loading={isLoading}
                disabled={dbContext.isOffline}
                style={styles.button}
              />
            </View>
          </ThemedScrollView>
        </ThemedContainer>
      </KeyboardAvoidingView>
    </>
  );
}