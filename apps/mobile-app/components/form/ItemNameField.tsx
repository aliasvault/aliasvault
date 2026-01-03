import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState, useCallback, forwardRef, useImperativeHandle, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  View,
  ScrollView,
} from 'react-native';

import { RobustPressable } from '@/components/ui/RobustPressable';
import { useColors } from '@/hooks/useColorScheme';

type Folder = {
  Id: string;
  Name: string;
};

export interface ItemNameFieldRef {
  focus: () => void;
}

interface IItemNameFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  folders: Folder[];
  selectedFolderId: string | null | undefined;
  onFolderChange: (folderId: string | null) => void;
}

/**
 * ItemNameField component
 *
 * An item name input field with an integrated folder selection button.
 * The folder button appears inside the input when folders are available,
 * matching the browser extension's design pattern.
 */
export const ItemNameField = forwardRef<ItemNameFieldRef, IItemNameFieldProps>(({
  value,
  onChangeText,
  folders,
  selectedFolderId,
  onFolderChange,
}, ref) => {
  const { t } = useTranslation();
  const colors = useColors();
  const [showModal, setShowModal] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useImperativeHandle(ref, () => ({
    /**
     * Focus the input field
     */
    focus: (): void => {
      inputRef.current?.focus();
    }
  }));

  const selectedFolder = folders.find(f => f.Id === selectedFolderId);
  const hasFolders = folders.length > 0;

  /**
   * Handle folder selection.
   */
  const handleSelectFolder = useCallback((folderId: string | null): void => {
    onFolderChange(folderId);
    setShowModal(false);
  }, [onFolderChange]);

  const styles = StyleSheet.create({
    backdrop: {
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      flex: 1,
      justifyContent: 'center',
    },
    closeButton: {
      padding: 4,
      position: 'absolute',
      right: 16,
      top: 16,
    },
    container: {
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    folderButton: {
      alignItems: 'center',
      borderLeftColor: colors.accentBorder,
      borderLeftWidth: 1,
      flexDirection: 'row',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    folderButtonText: {
      color: colors.tint,
      fontSize: 12,
      fontWeight: '500',
      maxWidth: 60,
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
    input: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    label: {
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: '500',
      marginBottom: 6,
    },
    modalContainer: {
      backgroundColor: colors.background,
      borderRadius: 12,
      marginHorizontal: 20,
      maxHeight: '70%',
      maxWidth: 400,
      padding: 20,
      width: '90%',
    },
    optionsList: {
      marginTop: 16,
    },
    requiredAsterisk: {
      color: colors.destructive,
    },
    title: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 4,
    },
    wrapper: {
      marginBottom: 16,
    },
  });

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>
        {t('items.serviceName')} <Text style={styles.requiredAsterisk}>*</Text>
      </Text>
      <View style={styles.container}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={t('items.serviceName')}
          placeholderTextColor={colors.textMuted}
        />
        {hasFolders && (
          <RobustPressable
            style={styles.folderButton}
            onPress={() => setShowModal(true)}
          >
            <MaterialIcons
              name="folder"
              size={18}
              color={selectedFolderId ? colors.tint : colors.textMuted}
            />
            {selectedFolderId && selectedFolder && (
              <Text style={styles.folderButtonText} numberOfLines={1}>
                {selectedFolder.Name}
              </Text>
            )}
          </RobustPressable>
        )}
      </View>

      <Modal
        visible={showModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.modalContainer}>
            <Text style={styles.title}>{t('items.folders.selectFolder')}</Text>

            <RobustPressable
              style={styles.closeButton}
              onPress={() => setShowModal(false)}
            >
              <MaterialIcons name="close" size={24} color={colors.textMuted} />
            </RobustPressable>

            <ScrollView style={styles.optionsList}>
              {/* No folder option */}
              <RobustPressable
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
              </RobustPressable>

              {/* Folder options */}
              {folders.map(folder => (
                <RobustPressable
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
                </RobustPressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
});

ItemNameField.displayName = 'ItemNameField';

export default ItemNameField;
