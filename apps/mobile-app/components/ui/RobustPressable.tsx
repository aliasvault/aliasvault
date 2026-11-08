import React from 'react';
import { StyleProp, ViewStyle, Platform, type AccessibilityState } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';

interface IRobustPressableProps {
  onPress?: () => void;
  onLongPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  pressRetentionOffset?: number;
  hitSlop?: number;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
}

/**
 * A simplified robust Pressable component that uses react-native-gesture-handler
 * for better performance and reliability, especially with Magic Keyboard trackpad
 * interactions on iPad. Simulates TouchableOpacity behavior with opacity feedback.
 * Only exposes essential props while handling all press behavior internally.
 */
export const RobustPressable: React.FC<IRobustPressableProps> = ({
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  children,
  style,
  disabled,
  pressRetentionOffset = 10,
  hitSlop = 10,
  testID,
  accessibilityLabel,
  accessibilityState,
}) => {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      hitSlop={hitSlop}
      pressRetentionOffset={pressRetentionOffset}
      disabled={disabled}
      android_ripple={{ color: 'lightgray' }}
      style={({ pressed }) => [
        style,
        { opacity: pressed ? 0.6 : 1 },
      ]}
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? testID}
      accessibilityState={accessibilityState}
    >
      {children}
    </Pressable>
  );
};
