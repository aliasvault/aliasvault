import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ActivityIndicator,
} from 'react-native';

import { useColors, useColorScheme } from '@/hooks/useColorScheme';

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
  const colorScheme = useColorScheme();
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

  /**
   * Handle close - only allow if not submitting
   */
  const handleClose = (): void => {
    if (!isSubmitting) {
      onClose();
    }
  };

  const styles = StyleSheet.create({
    backdrop: {
      alignItems: 'center',
      backgroundColor: colorScheme === 'dark' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.5)',
      flex: 1,
      justifyContent: 'center',
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
    container: {
      backgroundColor: colors.background,
      borderRadius: 12,
      marginHorizontal: 20,
      maxWidth: 400,
      padding: 20,
      width: '90%',
    },
    errorText: {
      color: colors.destructive,
      fontSize: 14,
      marginTop: 8,
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
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '600',
    },
    title: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 16,
    },
  });

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.backdrop}
        >
          <TouchableWithoutFeedback>
            <View style={styles.container}>
              <Text style={styles.title}>
                {mode === 'create' ? t('items.folders.createFolder') : t('items.folders.editFolder')}
              </Text>

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
                  onPress={handleClose}
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
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

export default FolderModal;
