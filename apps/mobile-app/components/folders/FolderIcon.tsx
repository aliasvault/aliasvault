import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useColors } from '@/hooks/useColorScheme';

import type { StyleProp, ViewStyle } from 'react-native';

type FolderIconProps = {
  isShared?: boolean;
  size: number;
  color: string;
  style?: StyleProp<ViewStyle>;
};

const FOLDER_PATH = 'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z';
const PEOPLE_PATH = 'M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.957-4.611 8.586 8.586 0 011.71 5.157v.003z';

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
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <Path d={FOLDER_PATH} />
      </Svg>
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
          <Svg width={badgeSize * 0.75} height={badgeSize * 0.75} viewBox="0 0 24 24" fill={colors.primary}>
            <Path d={PEOPLE_PATH} />
          </Svg>
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
