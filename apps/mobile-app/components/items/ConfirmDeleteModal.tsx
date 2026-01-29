import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { ModalWrapper } from '@/components/common/ModalWrapper';

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

  const styles = StyleSheet.create({
    message: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
    },
    buttonsContainer: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 20,
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
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      isSubmitting={isSubmitting}
      title={title}
      showHeaderBorder={false}
      showFooterBorder={false}
    >
      <Text style={styles.message}>{message}</Text>

      <View style={styles.buttonsContainer}>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={onClose}
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
    </ModalWrapper>
  );
};

export default ConfirmDeleteModal;
