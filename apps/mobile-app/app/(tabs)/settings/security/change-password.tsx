import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, KeyboardAvoidingView, Platform } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { useVaultMutate } from '@/hooks/useVaultMutate';

import LoadingOverlay from '@/components/LoadingOverlay';
import { ThemedButton } from '@/components/themed/ThemedButton';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedTextInput } from '@/components/themed/ThemedTextInput';
import { UsernameDisplay } from '@/components/ui/UsernameDisplay';
import { useAuth } from '@/context/AuthContext';
import { useDialog } from '@/context/DialogContext';

/**
 * Change password screen.
 * @returns {React.ReactNode} The rendered component
 */
export default function ChangePasswordScreen(): React.ReactNode {
  const colors = useColors();
  const authContext = useAuth();
  const { executeVaultPasswordChange, syncStatus } = useVaultMutate();
  const { t } = useTranslation();
  const { showAlert } = useDialog();

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
  });

  /**
   * Handle the submit button press.
   * @returns {Promise<void>} A promise that resolves when the operation is complete
   */
  const handleSubmit = async (): Promise<void> => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      showAlert(t('common.error'), t('settings.securitySettings.changePassword.fillAllFields'));
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

      const currentPasswordHashBase64 = await authContext.verifyPassword(currentPassword);
      if (!currentPasswordHashBase64) {
        showAlert(t('common.error'), t('settings.securitySettings.changePassword.currentPasswordIncorrect'));
        return;
      }

      await executeVaultPasswordChange(currentPasswordHashBase64, newPassword);

      // Show confirm dialog and go back to the settings screen
      showAlert(t('common.success'), t('settings.securitySettings.changePassword.passwordChangedSuccessfully'), () => {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        router.back();
      });
    } catch (error) {
      console.error('Password change error:', error);
      showAlert(t('common.error'), t('settings.securitySettings.changePassword.failedToChange'));
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
        style={styles.keyboardAvoidingView}
      >
        <ThemedContainer testID="change-password-screen">
          <ThemedScrollView>
            <ThemedText style={styles.headerText}>
              {t('settings.securitySettings.changePassword.headerText')}
            </ThemedText>
            <UsernameDisplay />
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
                style={styles.button}
              />
            </View>
          </ThemedScrollView>
        </ThemedContainer>
      </KeyboardAvoidingView>
    </>
  );
}