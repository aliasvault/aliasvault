import { SymbolView, SymbolWeight } from 'expo-symbols';
import { StyleProp, ViewStyle } from 'react-native';

import { IconSymbolName } from './IconSymbolName';

/**
 * Mapping from IconSymbolName to SF Symbols names.
 * This is the iOS-specific translation layer.
 */
const SF_SYMBOLS_MAPPING: Record<IconSymbolName, import('expo-symbols').SymbolViewProps['name']> = {
  [IconSymbolName.Key]: 'key.fill',
  [IconSymbolName.Envelope]: 'envelope.fill',
  [IconSymbolName.Gear]: 'gear',
  [IconSymbolName.House]: 'house.fill',
  [IconSymbolName.Paperplane]: 'paperplane.fill',
  [IconSymbolName.ChevronRight]: 'chevron.right',
  [IconSymbolName.ChevronLeftRight]: 'chevron.left.forwardslash.chevron.right',
  [IconSymbolName.Trash]: 'trash.fill',
};

/**
 * Icon symbol component for iOS.
 * Uses native SF Symbols for optimal performance and consistency.
 * Handles translation from IconSymbolName to SF Symbols names.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
  weight = 'regular',
}: {
  name: IconSymbolName;
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
  weight?: SymbolWeight;
}): React.ReactNode {
  return (
    <SymbolView
      weight={weight}
      tintColor={color}
      resizeMode="scaleAspectFit"
      name={SF_SYMBOLS_MAPPING[name]}
      style={[
        {
          width: size,
          height: size,
        },
        style,
      ]}
    />
  );
}
