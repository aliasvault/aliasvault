import { Buffer } from 'buffer';

import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, KeyboardAvoidingView, Platform } from 'react-native';

import type { DeleteAccountInitiateRequest, DeleteAccountInitiateResponse, DeleteAccountRequest } from '@/utils/dist/core/models/webapi';

import { useColors } from '@/hooks/useColorScheme';

import LoadingOverlay from '@/components/LoadingOverlay';
import { ThemedButton } from '@/components/themed/ThemedButton';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedTextInput } from '@/components/themed/ThemedTextInput';
import { UsernameDisplay } from '@/components/ui/UsernameDisplay';
import { useApp } from '@/context/AppContext';
import { useDialog } from '@/context/DialogContext';
import { useWebApi } from '@/context/WebApiContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Delete account screen.
 */
export default function DeleteAccountScreen(): React.ReactNode {
  const colors = useColors();
  const webApi = useWebApi();
  const { username, verifyPassword, logout } = useApp();
  const { t } = useTranslation();
  const { showAlert, showConfirm } = useDialog();

  const [confirmUsername, setConfirmUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
  const [step, setStep] = useState<'username' | 'password'>('username');

  const styles = StyleSheet.create({
    button: {
      marginTop: 16,
    },
    form: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 12,
      borderWidth: 1,
      marginTop: 20,
      padding: 20,
    },
    headerText: {
      color: colors.textMuted,
      fontSize: 13,
      marginBottom: 16,
    },
    inputContainer: {
      marginTop: 10,
    },
    keyboardAvoidingView: {
      flex: 1,
    },
    label: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '500',
      marginBottom: 8,
    },
    warningIcon: {
      alignSelf:'flex-start',
      color: colors.errorText,
      fontSize: 16,
    },
    warningItem: {
      alignItems: 'center',
      flexDirection: 'row',
      marginBottom: 10,
      paddingLeft: 8,
    },
    warningItemText: {
      color: colors.text,
      flex: 1,
      fontSize: 14,
      marginLeft: 8,
    },
    warningText: {
      backgroundColor: colors.errorBackground,
      borderColor: colors.errorBorder,
      borderRadius: 12,
      borderWidth: 1,
      color: colors.errorText,
      fontSize: 14,
      marginBottom: 20,
      padding: 16,
      textAlign: 'center',
    },
  });

  /**
   * Handles the username confirmation step
   */
  const handleUsernameSubmit = (): void => {
    if (confirmUsername !== username) {
      showAlert(t('common.error'), t('settings.securitySettings.deleteAccount.usernameDoesNotMatch'));
      return;
    }
    setStep('password');
  };

  /**
   * Handles the account deletion process
   */
  const handleDeleteAccount = async (): Promise<void> => {
    if (!password) {
      showAlert(t('common.error'), t('settings.securitySettings.deleteAccount.enterPassword'));
      return;
    }

    showConfirm(
      t('settings.securitySettings.deleteAccount.deleteAccount'),
      t('settings.securitySettings.deleteAccount.confirmationMessage'),
      t('settings.securitySettings.deleteAccount.deleteAccount'),
      async (): Promise<void> => handleDeleteAccountPress(),
      { confirmStyle: 'destructive' }
    );
  };

  /**
   * Handles the account deletion process
   */
  const handleDeleteAccountPress = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setLoadingStatus(t('settings.securitySettings.deleteAccount.verifyingPassword'));
      const currentPasswordHashBase64 = await verifyPassword(password);
      if (!currentPasswordHashBase64) {
        showAlert(t('common.error'), t('settings.securitySettings.deleteAccount.currentPasswordIncorrect'));
        return;
      }

      setLoadingStatus(t('settings.securitySettings.deleteAccount.initiatingDeletion'));

      await new Promise((resolve) => setTimeout(resolve, 500));

      if (!username) {
        throw new Error(t('common.errors.unknownErrorTryAgain'));
      }

      const deleteAccountInitiateRequest: DeleteAccountInitiateRequest = {
        username: username,
      };

      // Get the current salt and server ephemeral
      const data = await webApi.post<DeleteAccountInitiateRequest, DeleteAccountInitiateResponse>('Auth/delete-account/initiate', deleteAccountInitiateRequest);
      const currentSalt = data.salt;
      const currentServerEphemeral = data.serverEphemeral;
      const srpIdentity = data.srpIdentity;

      setLoadingStatus(t('settings.securitySettings.deleteAccount.verifyingWithServer'));
      // Convert base64 string to hex string
      const currentPasswordHashString = Buffer.from(currentPasswordHashBase64, 'base64').toString('hex').toUpperCase();

      // Generate client ephemeral and session using native SRP
      const newClientEphemeral = await NativeVaultManager.srpGenerateEphemeral();

      const privateKey = await NativeVaultManager.srpDerivePrivateKey(currentSalt, srpIdentity, currentPasswordHashString);
      const newClientSession = await NativeVaultManager.srpDeriveSession(
        newClientEphemeral.secret,
        currentServerEphemeral,
        currentSalt,
        srpIdentity,
        privateKey
      );

      const deleteAccountRequest: DeleteAccountRequest = {
        username: username,
        clientPublicEphemeral: newClientEphemeral.public,
        clientSessionProof: newClientSession.proof,
      };

      setLoadingStatus(t('settings.securitySettings.deleteAccount.deletingAccount'));
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Send final delete request with SRP proof.
      await webApi.post('Auth/delete-account/confirm', deleteAccountRequest);

      // Logout silently and navigate to login screen.
      await logout(t('settings.securitySettings.deleteAccount.accountDeleted'));
      router.replace('/login');
    } catch (error) {
      console.error('Error deleting account:', error);
      showAlert(t('common.error'), t('settings.securitySettings.deleteAccount.failedToDelete'));
    } finally {
      setIsLoading(false);
      setLoadingStatus(null);
    }
  };

  /**
   * Renders a warning item with a bullet point
   * @param text - The warning text to display
   * @returns A React component
   */
  const WarningItem = ({ text }: { text: string }): React.ReactNode => (
    <View style={styles.warningItem}>
      <ThemedText style={styles.warningIcon}>•</ThemedText>
      <ThemedText style={styles.warningItemText}>{text}</ThemedText>
    </View>
  );

  /**
   * Renders the delete account screen
   * @returns A React component
   */
  return (
    <>
      {isLoading && <LoadingOverlay status={loadingStatus ?? ''} />}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
      >
        <ThemedContainer>
          <ThemedScrollView>
            <ThemedText style={styles.headerText}>
              {t('settings.securitySettings.deleteAccount.headerText')}
            </ThemedText>
            <UsernameDisplay />
            <View style={styles.form}>
              {step === 'username' ? (
                <>
                  <ThemedText style={styles.warningText}>
                    {t('settings.securitySettings.deleteAccount.warningText')}
                  </ThemedText>
                  <WarningItem text={t('settings.securitySettings.deleteAccount.warningVaults')} />
                  <WarningItem text={t('settings.securitySettings.deleteAccount.warningAliases')} />
                  <WarningItem text={t('settings.securitySettings.deleteAccount.warningRecovery')} />
                  <View style={styles.inputContainer}>
                    <ThemedText style={styles.label}>{t('settings.securitySettings.deleteAccount.enterUsername')}</ThemedText>
                    <ThemedTextInput
                      value={confirmUsername}
                      onChangeText={setConfirmUsername}
                      placeholder={t('settings.securitySettings.deleteAccount.enterUsername')}
                      autoCapitalize="none"
                    />
                  </View>
                  <ThemedButton
                    title={t('common.continue')}
                    onPress={handleUsernameSubmit}
                    style={styles.button}
                  />
                </>
              ) : (
                <>
                  <ThemedText style={styles.warningText}>
                    {t('settings.securitySettings.deleteAccount.finalWarning')}
                  </ThemedText>
                  <WarningItem text={t('settings.securitySettings.deleteAccount.irreversibleWarning')} />
                  <View style={styles.inputContainer}>
                    <ThemedText style={styles.label}>{t('settings.securitySettings.deleteAccount.password')}</ThemedText>
                    <ThemedTextInput
                      secureTextEntry
                      value={password}
                      onChangeText={setPassword}
                      placeholder={t('settings.securitySettings.deleteAccount.enterPassword')}
                    />
                  </View>
                  <ThemedButton
                    title={t('settings.securitySettings.deleteAccount.deleteAccount')}
                    onPress={handleDeleteAccount}
                    loading={isLoading}
                    style={styles.button}
                  />
                </>
              )}
            </View>
          </ThemedScrollView>
        </ThemedContainer>
      </KeyboardAvoidingView>
    </>
  );
}