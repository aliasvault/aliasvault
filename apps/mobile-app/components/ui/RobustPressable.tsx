import React, { useRef, useCallback } from 'react';
import { Pressable, PressableProps, GestureResponderEvent, Platform } from 'react-native';

interface IRobustPressableProps extends Omit<PressableProps, 'style'> {
  onPress?: (event: GestureResponderEvent) => void;
  children: React.ReactNode;
  activeOpacity?: number;
  style?: PressableProps['style'];
}

/**
 * A more robust Pressable component that better handles Magic Keyboard trackpad interactions.
 * This component ensures clicks register even when the cursor is moving slightly during tap,
 * while maintaining TouchableOpacity-like activeOpacity behavior.
 */
export const RobustPressable: React.FC<IRobustPressableProps> = ({
  onPress,
  onPressIn,
  onPressOut,
  hitSlop,
  pressRetentionOffset,
  delayLongPress,
  disabled,
  activeOpacity = 0.7,
  style,
  ...props
}) => {
  const pressStartTime = useRef<number>(0);
  const pressStartLocation = useRef<{ x: number; y: number } | null>(null);
  const isPressing = useRef<boolean>(false);
  const hasMoved = useRef<boolean>(false);

  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    pressStartTime.current = Date.now();
    pressStartLocation.current = {
      x: event.nativeEvent.pageX,
      y: event.nativeEvent.pageY
    };
    isPressing.current = true;
    hasMoved.current = false;

    onPressIn?.(event);
  }, [onPressIn]);

  const handlePressOut = useCallback((event: GestureResponderEvent) => {
    const pressDuration = Date.now() - pressStartTime.current;

    // Check if the press moved too much (for trackpad detection)
    if (pressStartLocation.current) {
      const moveDistance = Math.sqrt(
        Math.pow(event.nativeEvent.pageX - pressStartLocation.current.x, 2) +
        Math.pow(event.nativeEvent.pageY - pressStartLocation.current.y, 2)
      );

      // Allow up to 15 pixels of movement for trackpad taps
      if (moveDistance > 15) {
        hasMoved.current = true;
      }
    }

    /**
     * For iPad with trackpad/mouse: be more lenient with tap detection
     * Accept taps up to 600ms and allow small movements
     */
    if (isPressing.current && pressDuration < 600 && !hasMoved.current) {
      onPress?.(event);
    }

    isPressing.current = false;
    pressStartLocation.current = null;
    onPressOut?.(event);
  }, [onPress, onPressOut]);

  // Increase hit slop for better trackpad interaction
  const enhancedHitSlop = Platform.select({
    ios: hitSlop ?? { top: 15, bottom: 15, left: 15, right: 15 },
    default: hitSlop ?? { top: 12, bottom: 12, left: 12, right: 12 }
  });

  // Increase press retention offset to handle cursor movement during tap
  const enhancedPressRetentionOffset = pressRetentionOffset ?? {
    top: 25,
    bottom: 25,
    left: 25,
    right: 25
  };

  return (
    <Pressable
      {...props}
      style={({ pressed, hovered }) => [
        typeof style === 'function' ? style({ pressed, hovered }) : style,
        pressed && { opacity: activeOpacity },
        hovered && Platform.OS !== 'ios' && { opacity: Math.max(activeOpacity, 0.8) }
      ]}
      onPress={undefined} // We handle onPress in onPressOut for better trackpad support
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      hitSlop={enhancedHitSlop}
      pressRetentionOffset={enhancedPressRetentionOffset}
      delayLongPress={delayLongPress ?? 500}
      disabled={disabled}
    />
  );
};
