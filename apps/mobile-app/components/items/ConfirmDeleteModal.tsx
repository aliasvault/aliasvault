import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';

import { useColors, useColorScheme } from '@/hooks/useColorScheme';

interface IConfirmDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
  message: string;
  confirmText?: string;
}

/**
 * Modal for confirming permanent deletion of items.
 */
export const ConfirmDeleteModal: React.FC<IConfirmDeleteModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const colorScheme = useColorScheme();
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * Handle confirm action.
   */
  const handleConfirm = async (): Promise<void> => {
    setIsSubmitting(true);
    try {
      await onConfirm();
    } catch (err) {
      console.error('Error during confirm action:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Handle close - only allow if not submitting.
   */
  const handleClose = (): void => {
    if (!isSubmitting) {
      onClose();
    }
  };

  const styles = StyleSheet.create({
    backdrop: {
      alignItems: 'center',
      // Lighter backdrop in dark mode for better contrast against black background
      backgroundColor: colorScheme === 'dark' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.5)',
      flex: 1,
      justifyContent: 'center',
    },
    container: {
      backgroundColor: colors.background,
      borderRadius: 12,
      marginHorizontal: 20,
      maxWidth: 400,
      padding: 20,
      width: '90%',
    },
    title: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 12,
    },
    message: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 20,
    },
    buttonsContainer: {
      flexDirection: 'row',
      gap: 12,
    },
    cancelButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
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
    confirmButton: {
      alignItems: 'center',
      backgroundColor: colors.destructive,
      borderRadius: 8,
      flex: 1,
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'center',
      paddingVertical: 12,
    },
    confirmButtonDisabled: {
      opacity: 0.6,
    },
    confirmButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '600',
    },
  });

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.container}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <View style={styles.buttonsContainer}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleClose}
              disabled={isSubmitting}
            >
              <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.confirmButton,
                isSubmitting && styles.confirmButtonDisabled
              ]}
              onPress={handleConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting && (
                <ActivityIndicator size="small" color={colors.white} />
              )}
              <Text style={styles.confirmButtonText}>
                {confirmText || t('common.delete')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default ConfirmDeleteModal;
