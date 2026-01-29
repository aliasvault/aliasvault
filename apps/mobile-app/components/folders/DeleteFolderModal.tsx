import MaterialIcons from '@expo/vector-icons/MaterialIcons';
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

interface IDeleteFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeleteFolderOnly: () => Promise<void>;
  onDeleteFolderAndContents: () => Promise<void>;
  itemCount: number;
}

/**
 * Modal for deleting a folder with options to keep or delete contents.
 */
export const DeleteFolderModal: React.FC<IDeleteFolderModalProps> = ({
  isOpen,
  onClose,
  onDeleteFolderOnly,
  onDeleteFolderAndContents,
  itemCount,
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * Handle delete folder only (move items to root).
   */
  const handleDeleteFolderOnly = async (): Promise<void> => {
    setIsSubmitting(true);
    try {
      await onDeleteFolderOnly();
      onClose();
    } catch (err) {
      console.error('Error deleting folder:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Handle delete folder and all contents.
   */
  const handleDeleteFolderAndContents = async (): Promise<void> => {
    setIsSubmitting(true);
    try {
      await onDeleteFolderAndContents();
      onClose();
    } catch (err) {
      console.error('Error deleting folder with contents:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const styles = StyleSheet.create({
    cancelButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      marginTop: 12,
      paddingVertical: 12,
    },
    cancelButtonText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '500',
    },
    optionButton: {
      borderColor: colors.accentBorder,
      borderRadius: 10,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 12,
      marginTop: 12,
      padding: 14,
    },
    optionButtonDanger: {
      borderColor: colors.destructive,
    },
    optionContent: {
      flex: 1,
    },
    optionDescription: {
      color: colors.textMuted,
      fontSize: 13,
      marginTop: 2,
    },
    optionDescriptionDanger: {
      color: colors.textMuted,
    },
    optionIcon: {
      marginTop: 2,
    },
    optionTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    optionTitleDanger: {
      color: colors.destructive,
    },
  });

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      isSubmitting={isSubmitting}
      title={t('items.folders.deleteFolder')}
      showHeaderBorder={false}
      showFooterBorder={false}
    >
      {/* Option 1: Delete folder only - move items to root */}
      <TouchableOpacity
        style={styles.optionButton}
        onPress={handleDeleteFolderOnly}
        disabled={isSubmitting}
      >
        <MaterialIcons
          name="folder"
          size={22}
          color={colors.tint}
          style={styles.optionIcon}
        />
        <View style={styles.optionContent}>
          <Text style={styles.optionTitle}>
            {t('items.folders.deleteFolderKeepItems')}
          </Text>
          <Text style={styles.optionDescription}>
            {t('items.folders.deleteFolderKeepItemsDescription')}
          </Text>
        </View>
        {isSubmitting && <ActivityIndicator size="small" color={colors.primary} />}
      </TouchableOpacity>

      {/* Option 2: Delete folder and contents */}
      {itemCount > 0 && (
        <TouchableOpacity
          style={[styles.optionButton, styles.optionButtonDanger]}
          onPress={handleDeleteFolderAndContents}
          disabled={isSubmitting}
        >
          <MaterialIcons
            name="delete"
            size={22}
            color={colors.destructive}
            style={styles.optionIcon}
          />
          <View style={styles.optionContent}>
            <Text style={[styles.optionTitle, styles.optionTitleDanger]}>
              {t('items.folders.deleteFolderAndItems')}
            </Text>
            <Text style={[styles.optionDescription, styles.optionDescriptionDanger]}>
              {t('items.folders.deleteFolderAndItemsDescription', { count: itemCount })}
            </Text>
          </View>
          {isSubmitting && <ActivityIndicator size="small" color={colors.destructive} />}
        </TouchableOpacity>
      )}

      {/* Cancel button */}
      <TouchableOpacity
        style={styles.cancelButton}
        onPress={onClose}
        disabled={isSubmitting}
      >
        <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
      </TouchableOpacity>
    </ModalWrapper>
  );
};

export default DeleteFolderModal;
