import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { ModalWrapper } from '@/components/common/ModalWrapper';

type Folder = {
  Id: string;
  Name: string;
};

interface IFolderSelectorProps {
  folders: Folder[];
  selectedFolderId: string | null | undefined;
  onFolderChange: (folderId: string | null) => void;
}

/**
 * FolderSelector component
 *
 * A button that opens a modal to select a folder for an item.
 * Can be placed anywhere in the form.
 */
export const FolderSelector: React.FC<IFolderSelectorProps> = ({
  folders,
  selectedFolderId,
  onFolderChange,
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const [showModal, setShowModal] = useState(false);

  const selectedFolder = folders.find(f => f.Id === selectedFolderId);

  /**
   * Handle folder selection.
   */
  const handleSelectFolder = useCallback((folderId: string | null): void => {
    onFolderChange(folderId);
    setShowModal(false);
  }, [onFolderChange]);

  const styles = StyleSheet.create({
    button: {
      alignItems: 'center',
      backgroundColor: selectedFolderId ? colors.tint + '20' : colors.accentBackground,
      borderColor: selectedFolderId ? colors.tint : colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    buttonText: {
      color: selectedFolderId ? colors.tint : colors.textMuted,
      flex: 1,
      fontSize: 15,
    },
    closeButton: {
      padding: 4,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    folderOption: {
      alignItems: 'center',
      borderRadius: 8,
      flexDirection: 'row',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    folderOptionActive: {
      backgroundColor: colors.tint + '15',
    },
    folderOptionText: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
    },
    folderOptionTextActive: {
      color: colors.tint,
      fontWeight: '600',
    },
    label: {
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: '500',
      marginBottom: 6,
    },
    modalHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    modalTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
    },
    optionsList: {
      maxHeight: 300,
    },
    wrapper: {
      marginBottom: 16,
    },
  });

  const modalContent = (
    <>
      <View style={styles.modalHeader}>
        <Text style={styles.modalTitle}>{t('items.folders.selectFolder')}</Text>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => setShowModal(false)}
        >
          <MaterialIcons name="close" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.optionsList}>
        {/* No folder option */}
        <TouchableOpacity
          style={[
            styles.folderOption,
            !selectedFolderId && styles.folderOptionActive,
          ]}
          onPress={() => handleSelectFolder(null)}
        >
          <MaterialIcons
            name="folder-open"
            size={22}
            color={!selectedFolderId ? colors.tint : colors.textMuted}
          />
          <Text
            style={[
              styles.folderOptionText,
              !selectedFolderId && styles.folderOptionTextActive,
            ]}
          >
            {t('items.folders.noFolder')}
          </Text>
          {!selectedFolderId && (
            <MaterialIcons name="check" size={20} color={colors.tint} />
          )}
        </TouchableOpacity>

        {/* Folder options */}
        {folders.map(folder => (
          <TouchableOpacity
            key={folder.Id}
            style={[
              styles.folderOption,
              selectedFolderId === folder.Id && styles.folderOptionActive,
            ]}
            onPress={() => handleSelectFolder(folder.Id)}
          >
            <MaterialIcons
              name="folder"
              size={22}
              color={selectedFolderId === folder.Id ? colors.tint : colors.textMuted}
            />
            <Text
              style={[
                styles.folderOptionText,
                selectedFolderId === folder.Id && styles.folderOptionTextActive,
              ]}
              numberOfLines={1}
            >
              {folder.Name}
            </Text>
            {selectedFolderId === folder.Id && (
              <MaterialIcons name="check" size={20} color={colors.tint} />
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </>
  );

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{t('items.folders.folder')}</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => setShowModal(true)}
        activeOpacity={0.7}
      >
        <MaterialIcons
          name="folder"
          size={20}
          color={selectedFolderId ? colors.tint : colors.textMuted}
        />
        <Text style={styles.buttonText} numberOfLines={1}>
          {selectedFolder ? selectedFolder.Name : t('items.folders.noFolder')}
        </Text>
        <MaterialIcons
          name="keyboard-arrow-down"
          size={20}
          color={colors.textMuted}
        />
      </TouchableOpacity>

      <ModalWrapper
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        showHeaderBorder={false}
        showFooterBorder={false}
      >
        {modalContent}
      </ModalWrapper>
    </View>
  );
};

export default FolderSelector;
