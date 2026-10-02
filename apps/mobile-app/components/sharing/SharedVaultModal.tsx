import { familySharingText } from '@aliasvault/client/sharing/FamilySharingView';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { HapticsUtility } from '@/utils/HapticsUtility';

import { useColors } from '@/hooks/useColorScheme';

import { ModalWrapper } from '@/components/common/ModalWrapper';

interface ISharedVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
  initialName?: string;
  mode: 'create' | 'rename';
}

/**
 * Modal for creating or renaming a shared vault.
 */
export const SharedVaultModal: React.FC<ISharedVaultModalProps> = ({ isOpen, onClose, onSave, initialName = '', mode }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const [name, setName] = useState(initialName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmedName = name.trim();

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the form each time the modal opens
      setName(initialName);
      setError(null);
    }
  }, [isOpen, initialName]);

  /**
   * Save the name and close.
   */
  const handleSubmit = async (): Promise<void> => {
    if (!trimmedName || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSave(trimmedName);
      HapticsUtility.notification(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (err) {
      setError(t('common.errors.unknownErrorTryAgain'));
      console.error('Error saving shared vault:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit = trimmedName.length > 0 && !isSubmitting;

  const styles = StyleSheet.create({
    buttonRow: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 20,
    },
    cancelButton: {
      alignItems: 'center',
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      flex: 1,
      paddingVertical: 12,
    },
    cancelButtonText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '500',
    },
    errorText: {
      color: colors.destructive,
      fontSize: 14,
      marginTop: 8,
    },
    input: {
      backgroundColor: colors.modalSurfaceRaised,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      color: colors.text,
      fontSize: 16,
      marginTop: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    label: {
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: '500',
    },
    saveButton: {
      alignItems: 'center',
      backgroundColor: colors.tint,
      borderRadius: 8,
      flex: 1,
      paddingVertical: 12,
    },
    saveButtonDisabled: {
      opacity: 0.6,
    },
    saveButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '600',
    },
  });

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      isSubmitting={isSubmitting}
      title={mode === 'create' ? familySharingText.createSharedVault : familySharingText.renameVault}
      keyboardAvoiding
      showHeaderBorder={false}
      showFooterBorder={false}
    >
      <Text style={styles.label}>{familySharingText.vaultName}</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder={familySharingText.vaultNamePlaceholder}
        placeholderTextColor={colors.textMuted}
        autoFocus
        autoCapitalize="sentences"
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
        editable={!isSubmitting}
      />

      {error && <Text style={styles.errorText}>{error}</Text>}

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.cancelButton} onPress={onClose} disabled={isSubmitting}>
          <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.saveButton, !canSubmit && styles.saveButtonDisabled]} onPress={handleSubmit} disabled={!canSubmit}>
          {isSubmitting ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Text style={styles.saveButtonText}>{mode === 'create' ? familySharingText.create : t('common.save')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </ModalWrapper>
  );
};

export default SharedVaultModal;
