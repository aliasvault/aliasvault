import React from 'react';
import { StyleSheet, View } from 'react-native';

import { UiIcon } from '@/components/ui/UiIcon';
import { useColors } from '@/hooks/useColorScheme';

import type { StyleProp, ViewStyle } from 'react-native';

type FolderIconProps = {
  isShared?: boolean;
  size: number;
  color: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Folder glyph, optionally carrying a small people badge that marks the folder as shared with other people.
 * Same drawing as the browser extension's FolderIcon, with the badge scaled to the glyph.
 */
export const FolderIcon: React.FC<FolderIconProps> = ({ isShared = false, size, color, style }) => {
  const colors = useColors();
  const badgeSize = Math.round(size * 0.625);
  const badgeOffset = -Math.round(size * 0.25);

  return (
    <View style={[{ width: size, height: size }, style]}>
      <UiIcon name="folder-filled" size={size} color={color} />
      {isShared && (
        <View
          style={[styles.badge, {
            backgroundColor: colors.accentBackground,
            borderColor: colors.accentBorder,
            borderRadius: badgeSize / 2,
            bottom: badgeOffset,
            height: badgeSize,
            right: badgeOffset,
            width: badgeSize,
          }]}
        >
          <UiIcon name="users" size={badgeSize * 0.75} color={colors.primary} />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    position: 'absolute',
  },
});

export default FolderIcon;
