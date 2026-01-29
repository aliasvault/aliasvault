import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { ModalWrapper } from '@/components/common/ModalWrapper';

interface IFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (folderName: string) => Promise<void>;
  initialName?: string;
  mode: 'create' | 'edit';
}

/**
 * Modal for creating or editing a folder.
 */
export const FolderModal: React.FC<IFolderModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialName = '',
  mode,
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const [folderName, setFolderName] = useState(initialName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFolderName(initialName);
      setError(null);
    }
  }, [isOpen, initialName]);

  /**
   * Handle the form submission.
   */
  const handleSubmit = async (): Promise<void> => {
    const trimmedName = folderName.trim();
    if (!trimmedName) {
      setError(t('items.folders.folderNameRequired'));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSave(trimmedName);
      onClose();
    } catch (err) {
      setError(t('common.errors.unknownErrorTryAgain'));
      console.error('Error saving folder:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const styles = StyleSheet.create({
    label: {
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: '500',
    },
    input: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      color: colors.text,
      fontSize: 16,
      marginTop: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    errorText: {
      color: colors.destructive,
      fontSize: 14,
      marginTop: 8,
    },
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
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '600',
    },
  });

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      isSubmitting={isSubmitting}
      title={mode === 'create' ? t('items.folders.createFolder') : t('items.folders.editFolder')}
      keyboardAvoiding
      showHeaderBorder={false}
      showFooterBorder={false}
    >
      <Text style={styles.label}>{t('items.folders.folderName')}</Text>
      <TextInput
        style={styles.input}
        value={folderName}
        onChangeText={setFolderName}
        placeholder={t('items.folders.folderNamePlaceholder')}
        placeholderTextColor={colors.textMuted}
        autoFocus
        autoCapitalize="sentences"
        editable={!isSubmitting}
      />

      {error && <Text style={styles.errorText}>{error}</Text>}

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={onClose}
          disabled={isSubmitting}
        >
          <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.saveButton, isSubmitting && styles.saveButtonDisabled]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.saveButtonText}>
              {mode === 'create' ? t('common.add') : t('common.save')}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </ModalWrapper>
  );
};

export default FolderModal;
