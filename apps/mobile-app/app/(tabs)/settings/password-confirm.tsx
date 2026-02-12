import { router, useLocalSearchParams } from 'expo-router';
import { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, KeyboardAvoidingView, Platform } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import LoadingOverlay from '@/components/LoadingOverlay';
import { ThemedButton } from '@/components/themed/ThemedButton';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedTextInput } from '@/components/themed/ThemedTextInput';
import { useAuth } from '@/context/AuthContext';
import { passwordConfirmEmitter } from '@/events/PasswordConfirmEmitter';

/**
 * Password confirmation screen.
 * This screen can be used to confirm the user's password before performing
 * sensitive operations like exporting vault data.
 *
 * Usage:
 * 1. Navigate to this screen with optional description param
 * 2. Listen to passwordConfirmEmitter for 'confirmed' or 'cancelled' events
 * 3. On 'confirmed', the password hash is passed as the event payload
 * 4. Back navigation (swipe/button) automatically emits 'cancelled'
 */
export default function PasswordConfirmScreen(): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const authContext = useAuth();
  const params = useLocalSearchParams<{
    description?: string;
  }>();

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  // Track if we've already emitted a result (confirmed or cancelled)
  const hasEmittedResult = useRef(false);

  const description = params.description ?? t('settings.passwordConfirm.defaultDescription');

  // Emit 'cancelled' when component unmounts (back navigation) if no result was emitted
  useEffect(() => {
    return (): void => {
      if (!hasEmittedResult.current) {
        passwordConfirmEmitter.emit('cancelled');
      }
    };
  }, []);

  /**
   * Handle password verification.
   */
  const handleVerify = async (): Promise<void> => {
    if (!password) {
      setError(t('validation.required'));
      return;
    }

    setError('');
    setIsVerifying(true);

    try {
      const passwordHashBase64 = await authContext.verifyPassword(password);
      if (!passwordHashBase64) {
        setError(t('auth.errors.incorrectPassword'));
        return;
      }

      // Password verified - emit success and go back
      hasEmittedResult.current = true;
      passwordConfirmEmitter.emit('confirmed', passwordHashBase64);
      router.back();
    } catch (err) {
      console.error('Password verification error:', err);
      setError(t('common.errors.unknownError'));
    } finally {
      setIsVerifying(false);
    }
  };

  const styles = StyleSheet.create({
    button: {
      marginTop: 8,
    },
    errorText: {
      color: colors.red,
      fontSize: 13,
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
      lineHeight: 20,
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

  return (
    <>
      {isVerifying && (
        <LoadingOverlay status={t('settings.securitySettings.deleteAccount.verifyingPassword')} />
      )}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
      >
        <ThemedContainer testID="password-confirm-screen">
          <ThemedScrollView>
            <ThemedText style={styles.headerText}>
              {description}
            </ThemedText>

            <View style={styles.form}>
              <View style={styles.inputContainer}>
                <ThemedText style={styles.label}>
                  {t('auth.password')}
                </ThemedText>
                <ThemedTextInput
                  testID="password-confirm-input"
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t('auth.enterPasswordPlaceholder')}
                  editable={!isVerifying}
                  autoFocus
                />
                {error ? (
                  <ThemedText style={styles.errorText}>{error}</ThemedText>
                ) : null}
              </View>

              <ThemedButton
                testID="password-confirm-button"
                title={t('common.confirm')}
                onPress={handleVerify}
                loading={isVerifying}
                disabled={!password || isVerifying}
                style={styles.button}
              />
            </View>
          </ThemedScrollView>
        </ThemedContainer>
      </KeyboardAvoidingView>
    </>
  );
}
