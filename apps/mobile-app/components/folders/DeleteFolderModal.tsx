import MaterialIcons from '@expo/vector-icons/MaterialIcons';
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
  const colorScheme = useColorScheme();
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
      backgroundColor: colorScheme === 'dark' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.5)',
      flex: 1,
      justifyContent: 'center',
    },
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
    container: {
      backgroundColor: colors.background,
      borderRadius: 12,
      marginHorizontal: 20,
      maxWidth: 400,
      padding: 20,
      width: '90%',
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
    title: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 4,
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
          <Text style={styles.title}>{t('items.folders.deleteFolder')}</Text>

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
            onPress={handleClose}
            disabled={isSubmitting}
          >
            <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

export default DeleteFolderModal;
