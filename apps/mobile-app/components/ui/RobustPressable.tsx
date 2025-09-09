import React from 'react';
import { StyleProp, ViewStyle, Platform } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';

interface IRobustPressableProps {
  onPress?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  pressRetentionOffset?: number;
  hitSlop?: number;
}

/**
 * A simplified robust Pressable component that uses react-native-gesture-handler
 * for better performance and reliability, especially with Magic Keyboard trackpad
 * interactions on iPad. Simulates TouchableOpacity behavior with opacity feedback.
 * Only exposes essential props while handling all press behavior internally.
 */
export const RobustPressable: React.FC<IRobustPressableProps> = ({
  onPress,
  children,
  style,
  disabled,
  pressRetentionOffset = 10,
  hitSlop = 10,
}) => {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={hitSlop}
      pressRetentionOffset={pressRetentionOffset}
      disabled={disabled}
      android_ripple={{ color: 'lightgray' }}
      style={({ pressed }) => [
        style,
        { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      {children}
    </Pressable>
  );
};