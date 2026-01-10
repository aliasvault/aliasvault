import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

/**
 * Folder with item count for display.
 */
export type FolderWithCount = {
  id: string;
  name: string;
  itemCount: number;
};

interface IFolderPillProps {
  folder: FolderWithCount;
  onPress: () => void;
}

/**
 * FolderPill component
 *
 * Displays a folder as a compact pill/tag that can be clicked to navigate into.
 * Designed to be displayed inline with other folder pills.
 */
export const FolderPill: React.FC<IFolderPillProps> = ({ folder, onPress }) => {
  const colors = useColors();

  const styles = StyleSheet.create({
    container: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 20,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    folderName: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '500',
      maxWidth: 120,
    },
    itemCount: {
      color: colors.textMuted,
      fontSize: 12,
    },
  });

  return (
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.7}>
      <MaterialIcons name="folder" size={16} color={colors.tint} />
      <Text style={styles.folderName} numberOfLines={1} ellipsizeMode="tail">
        {folder.name}
      </Text>
      {folder.itemCount > 0 && (
        <Text style={styles.itemCount}>{folder.itemCount}</Text>
      )}
    </TouchableOpacity>
  );
};

export default FolderPill;
