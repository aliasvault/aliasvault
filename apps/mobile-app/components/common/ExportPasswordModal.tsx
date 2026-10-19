import { MIN_ACCEPTED_PASSWORD_LENGTH } from '@aliasvault/client/utilities/PasswordStrength';
import React, { useLayoutEffect, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import { ModalWrapper } from '@/components/common/ModalWrapper';
import { PasswordStrengthIndicator } from '@/components/form/PasswordStrengthIndicator';
import { ThemedText } from '@/components/themed/ThemedText';

type ExportPasswordModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (exportPassword: string) => void;
};

/**
 * Asks for the password an encrypted (.avex) export is protected with.
 */
export const ExportPasswordModal: React.FC<ExportPasswordModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const [exportPassword, setExportPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useLayoutEffect(() => {
    if (isOpen) {
      setExportPassword('');
      setConfirmPassword('');
    }
  }, [isOpen]);

  const isTooShort = exportPassword.length > 0 && exportPassword.length < MIN_ACCEPTED_PASSWORD_LENGTH;
  const isMismatch = confirmPassword.length > 0 && exportPassword !== confirmPassword;
  const isValid = exportPassword.length >= MIN_ACCEPTED_PASSWORD_LENGTH && exportPassword === confirmPassword;

  const styles = StyleSheet.create({
    button: {
      alignItems: 'center',
      borderRadius: 8,
      flex: 1,
      paddingVertical: 12,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonPrimary: {
      backgroundColor: colors.primary,
    },
    buttonSecondary: {
      backgroundColor: colors.modalSurfaceRaised,
      borderColor: colors.accentBorder,
      borderWidth: 1,
    },
    buttonText: {
      fontWeight: '600',
    },
    buttonTextPrimary: {
      color: colors.primarySurfaceText,
    },
    buttonTextSecondary: {
      color: colors.text,
    },
    buttons: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 16,
    },
    description: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 16,
    },
    errorText: {
      color: colors.red,
      fontSize: 13,
      marginTop: 8,
    },
    field: {
      marginBottom: 12,
    },
    input: {
      backgroundColor: colors.modalSurfaceRaised,
      borderColor: colors.accentBorder,
      borderRadius: 6,
      borderWidth: 1,
      color: colors.text,
      fontSize: 16,
      padding: 10,
    },
    inputLabel: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
    },
  });

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose} title={t('importExport.exportEncryptedPasswordTitle')} keyboardAvoiding showHeaderBorder={false} showFooterBorder={false}>
      <ThemedText style={styles.description}>{t('importExport.exportEncryptedPasswordDescription')}</ThemedText>

      <View style={styles.field}>
        <ThemedText style={styles.inputLabel}>{t('importExport.exportPasswordModal.exportPasswordLabel')}</ThemedText>
        <TextInput style={styles.input} secureTextEntry autoFocus autoCapitalize="none" autoCorrect={false} value={exportPassword} onChangeText={setExportPassword} />
        <PasswordStrengthIndicator password={exportPassword} />
      </View>

      <View style={styles.field}>
        <ThemedText style={styles.inputLabel}>{t('importExport.exportPasswordModal.confirmExportPasswordLabel')}</ThemedText>
        <TextInput style={styles.input} secureTextEntry autoCapitalize="none" autoCorrect={false} value={confirmPassword} onChangeText={setConfirmPassword} />
      </View>

      {isTooShort && <ThemedText style={styles.errorText}>{t('settings.securitySettings.changePassword.passwordTooShort', { minLength: MIN_ACCEPTED_PASSWORD_LENGTH })}</ThemedText>}
      {!isTooShort && isMismatch && <ThemedText style={styles.errorText}>{t('common.errorPasswordMismatch')}</ThemedText>}

      <View style={styles.buttons}>
        <TouchableOpacity style={[styles.button, styles.buttonSecondary]} onPress={onClose} activeOpacity={0.7}>
          <ThemedText style={[styles.buttonText, styles.buttonTextSecondary]}>{t('common.cancel')}</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.buttonPrimary, !isValid && styles.buttonDisabled]} onPress={() => onSubmit(exportPassword)} disabled={!isValid} activeOpacity={0.7}>
          <ThemedText style={[styles.buttonText, styles.buttonTextPrimary]}>{t('common.create')}</ThemedText>
        </TouchableOpacity>
      </View>
    </ModalWrapper>
  );
};

export default ExportPasswordModal;
