import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { isSharedFolder } from '@aliasvault/client/items/FolderUtils';
import { FolderIcon } from '@/components/folders/FolderIcon';
import { FolderSelectorModal } from '@/components/folders/FolderSelectorModal';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useColors } from '@/hooks/useColorScheme';
import { usePersonalManifestId } from '@/hooks/usePersonalManifestId';

import type { Folder, FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

export interface ItemNameFieldRef {
  focus: () => void;
}

interface IItemNameFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  folders: Folder[];
  selectedFolder: FolderRef | null | undefined;
  onFolderChange: (folder: FolderRef | null) => void;
  logoSlot?: React.ReactNode;
}

/**
 * An item name input field with an integrated logo button on the left and folder selection button on the right.
 */
export const ItemNameField = forwardRef<ItemNameFieldRef, IItemNameFieldProps>(({
  value,
  onChangeText,
  folders,
  selectedFolder: selectedFolderRef,
  onFolderChange,
  logoSlot,
}, ref) => {
  const { t } = useTranslation();
  const colors = useColors();
  const personalManifestId = usePersonalManifestId();
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
  const selectedFolder = selectedFolderRef ? folders.find(f => f.Id === selectedFolderRef.Id && f.ManifestId === selectedFolderRef.ManifestId) : undefined;

  const styles = StyleSheet.create({
    container: {
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      flexDirection: 'row',
      alignItems: 'center',
      overflow: 'hidden',
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
      marginBottom: 4,
    },
  });

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>
        {t('items.itemName')} <Text style={styles.requiredAsterisk}>*</Text>
      </Text>
      <View style={styles.container}>
        {logoSlot}
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
            <FolderIcon
              isShared={selectedFolder !== undefined && isSharedFolder(selectedFolder, personalManifestId)}
              size={18}
              color={selectedFolderRef ? colors.tint : colors.textMuted}
            />
            {selectedFolder && (
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
        selectedFolder={selectedFolderRef}
        personalManifestId={personalManifestId}
        onFolderChange={onFolderChange}
        isOpen={showModal}
        onClose={() => setShowModal(false)}
      />
    </View>
  );
});

ItemNameField.displayName = 'ItemNameField';

export default ItemNameField;
