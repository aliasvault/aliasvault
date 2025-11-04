// This file is a fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React from 'react';
import { OpaqueColorValue, StyleProp, TextStyle } from 'react-native';

import { IconSymbolName } from './IconSymbolName';

/**
 * Mapping from IconSymbolName to MaterialIcons names.
 * This is the Android-specific translation layer.
 */
const MATERIAL_ICONS_MAPPING: Record<IconSymbolName, React.ComponentProps<typeof MaterialIcons>['name']> = {
  [IconSymbolName.Key]: 'key',
  [IconSymbolName.Envelope]: 'mail',
  [IconSymbolName.Gear]: 'settings',
  [IconSymbolName.House]: 'home',
  [IconSymbolName.Paperplane]: 'send',
  [IconSymbolName.ChevronRight]: 'chevron-right',
  [IconSymbolName.ChevronLeftRight]: 'code',
  [IconSymbolName.Trash]: 'delete',
};

/**
 * An icon component that uses MaterialIcons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Handles translation from IconSymbolName to MaterialIcons names.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
}): React.ReactNode {
  return <MaterialIcons color={color} size={size} name={MATERIAL_ICONS_MAPPING[name]} style={style} />;
}
