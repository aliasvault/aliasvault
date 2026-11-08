import React from 'react';
import { Platform, TouchableOpacity, type AccessibilityState, type StyleProp, type ViewStyle } from 'react-native';

/**
 * How long the iOS context menu takes to close after an action. iOS keeps the row away until then, so the row covers
 * its spot with a copy of itself meanwhile.
 */
export const CONTEXT_MENU_DISMISS_MS = Platform.OS === 'ios' ? 450 : 0;

type ListRowPressableProps = {
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onLongPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
  children: React.ReactNode;
};

/**
 * Pressable for a list row.
 */
export function ListRowPressable(props: ListRowPressableProps): React.ReactNode {
  return <TouchableOpacity activeOpacity={0.7} hitSlop={10} {...props} />;
}
