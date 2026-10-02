import { familySharingText } from '@aliasvault/client/sharing/FamilySharingView';
import React from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { FolderIcon } from '@/components/folders/FolderIcon';

type FolderHeaderTitleProps = {
  name: string;
  isShared: boolean;
};

/**
 * Navigation header title of a folder screen: folder icon (with the people badge when shared) and name.
 */
export const FolderHeaderTitle: React.FC<FolderHeaderTitleProps> = ({ name, isShared }) => {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const maxWidth = Platform.OS === 'ios' ? width - 180 : width - 140;

  const styles = StyleSheet.create({
    container: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      maxWidth,
    },
    title: {
      color: colors.text,
      flexShrink: 1,
      fontSize: Platform.OS === 'ios' ? 17 : 20,
      fontWeight: Platform.OS === 'ios' ? '600' : '500',
    },
  });

  return (
    <View style={styles.container} accessible accessibilityRole="header" accessibilityLabel={isShared ? `${name}, ${familySharingText.sharedVault}` : name}>
      <FolderIcon isShared={isShared} size={20} color={colors.tint} />
      <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">{name}</Text>
    </View>
  );
};

export default FolderHeaderTitle;
