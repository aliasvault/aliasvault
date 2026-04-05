import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { FolderSelectorModal } from '@/components/folders/FolderSelectorModal';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useColors } from '@/hooks/useColorScheme';

type Folder = {
  Id: string;
  Name: string;
  ParentFolderId: string | null;
  Weight: number;
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
  const inputRef = useRef<TextInput>(null);
  const [showModal, setShowModal] = useState(false);

  useImperativeHandle(ref, () => ({
    /**
     * Focus the input field
     */
    focus: (): void => {
      inputRef.current?.focus();
    }
  }));

  const hasFolders = folders.length > 0;
  const selectedFolder = folders.find(f => f.Id === selectedFolderId);

  const styles = StyleSheet.create({
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
    requiredAsterisk: {
      color: colors.destructive,
    },
    wrapper: {
      marginBottom: 16,
    },
  });

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>
        {t('items.itemName')} <Text style={styles.requiredAsterisk}>*</Text>
      </Text>
      <View style={styles.container}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          testID="item-name-input"
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

      {/* Folder selector modal with tree view */}
      <FolderSelectorModal
        folders={folders}
        selectedFolderId={selectedFolderId}
        onFolderChange={onFolderChange}
        isOpen={showModal}
        onClose={() => setShowModal(false)}
      />
    </View>
  );
});

ItemNameField.displayName = 'ItemNameField';

export default ItemNameField;
