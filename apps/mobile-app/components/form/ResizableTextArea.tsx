import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutChangeEvent, StyleSheet, TextInput, TextInputProps, TouchableHighlight, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { HapticsUtility } from '@/utils/HapticsUtility';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';

/** Minimum height in pixels. */
const MIN_HEIGHT = 100;

/** Max height as a fraction of the window height. */
const MAX_HEIGHT_RATIO = 0.6;

/** Height change per accessibility increment/decrement action. */
const ACCESSIBILITY_STEP = 40;

/** Vertical movement in pixels before a touch counts as a drag instead of a tap. */
const DRAG_THRESHOLD = 2;

/** Extra touch area around the drag handle. */
const HANDLE_HIT_SLOP = { bottom: 12, left: 24, right: 24, top: 8 };

type ResizableTextAreaProps = Omit<TextInputProps, 'onChangeText' | 'multiline' | 'numberOfLines'> & {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  onRemove?: () => void;
  testID?: string;
}

/**
 * Multi-line form field with a drag handle at the bottom to resize it.
 *
 * Until the handle is dragged the field grows with its content (between the minimum
 * and maximum height). After a drag it keeps the height the user dragged it to.
 */
export const ResizableTextArea: React.FC<ResizableTextAreaProps> = ({
  label,
  value,
  onChangeText,
  onRemove,
  testID,
  ...props
}): React.ReactNode => {
  const colors = useColors();
  const { t } = useTranslation();
  const { height: windowHeight } = useWindowDimensions();

  const maxHeight = Math.max(MIN_HEIGHT * 2, Math.round(windowHeight * MAX_HEIGHT_RATIO));

  // Whether the user dragged the handle; until then the field sizes itself to its content.
  const [isResized, setIsResized] = useState(false);

  // Height the field renders at: measured from the layout while it still auto-grows,
  // driven by the drag afterwards.
  const height = useSharedValue(MIN_HEIGHT);
  const maxHeightValue = useSharedValue(maxHeight);
  const dragStartHeight = useSharedValue(MIN_HEIGHT);
  const hasDragged = useSharedValue(false);

  // Keep the height within bounds when the window size changes (e.g. rotation).
  useEffect(() => {
    maxHeightValue.value = maxHeight;

    if (isResized && height.value > maxHeight) {
      height.value = maxHeight;
    }
  }, [maxHeight, isResized, height, maxHeightValue]);

  const animatedHeightStyle = useAnimatedStyle(() => ({ height: height.value }));

  /**
   * Give feedback when the handle is grabbed.
   */
  const handleDragStart = useCallback((): void => {
    HapticsUtility.impact(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  /**
   * Resize with a native gesture instead of a JS PanResponder: on iOS the surrounding
   * scroll view and modal sheet keep the touch for themselves when the drag is handled in
   * JS, so the page scrolls or the modal is dragged away instead of the field growing.
   */
  const resizeGesture = useMemo(() => Gesture.Pan()
    .minDistance(0)
    .hitSlop(HANDLE_HIT_SLOP)
    .onBegin((): void => {
      hasDragged.value = false;
      dragStartHeight.value = height.value;
      runOnJS(handleDragStart)();
    })
    // Resize the field along with the finger, ignoring the jitter of a plain tap.
    .onUpdate((event): void => {
      if (!hasDragged.value && Math.abs(event.translationY) < DRAG_THRESHOLD) {
        return;
      }

      height.value = Math.min(Math.max(dragStartHeight.value + event.translationY, MIN_HEIGHT), maxHeightValue.value);

      // Switch from auto-growing to the fixed height that follows the finger.
      if (!hasDragged.value) {
        hasDragged.value = true;
        runOnJS(setIsResized)(true);
      }
    }), [dragStartHeight, handleDragStart, hasDragged, height, maxHeightValue]);

  /**
   * Resize in fixed steps, used by the accessibility increment/decrement actions.
   */
  const stepHeight = useCallback((delta: number): void => {
    height.value = Math.min(Math.max(height.value + delta, MIN_HEIGHT), maxHeightValue.value);
    setIsResized(true);
  }, [height, maxHeightValue]);

  /**
   * Track the height the field renders at, so a drag starts from the size the
   * user actually sees while the field is still auto-growing.
   */
  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    if (isResized) {
      return;
    }

    height.value = event.nativeEvent.layout.height;
  }, [isResized, height]);

  const styles = StyleSheet.create({
    handle: {
      alignItems: 'center',
      borderTopColor: colors.accentBorder,
      borderTopWidth: 1,
      justifyContent: 'center',
      paddingVertical: 3,
    },
    input: {
      color: colors.text,
      fontSize: 16,
      padding: 10,
      textAlignVertical: 'top',
    },
    inputContainer: {
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 6,
      borderWidth: 1,
    },
    inputFilling: {
      flex: 1,
    },
    inputGroup: {
      marginBottom: 6,
    },
    inputLabel: {
      color: colors.textMuted,
      fontSize: 12,
    },
    labelContainer: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    removeButton: {
      padding: 4,
    },
  });

  const showLabelContainer = label || onRemove;

  return (
    <View style={styles.inputGroup}>
      {showLabelContainer && (
        <View style={styles.labelContainer}>
          <ThemedText style={styles.inputLabel}>{label}</ThemedText>
          {onRemove && (
            <TouchableHighlight
              style={styles.removeButton}
              onPress={onRemove}
              underlayColor={colors.accentBackground}
            >
              <MaterialIcons name="close" size={18} color={colors.textMuted} />
            </TouchableHighlight>
          )}
        </View>
      )}
      <View style={styles.inputContainer}>
        <Animated.View
          style={isResized ? animatedHeightStyle : undefined}
          onLayout={handleLayout}
        >
          <TextInput
            style={isResized ? [styles.input, styles.inputFilling] : [styles.input, { minHeight: MIN_HEIGHT, maxHeight }]}
            value={value}
            onChangeText={onChangeText}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            multiline
            testID={testID}
            accessibilityLabel={testID}
            {...props}
          />
        </Animated.View>
        <GestureDetector gesture={resizeGesture}>
          <View
            style={styles.handle}
            hitSlop={HANDLE_HIT_SLOP}
            accessibilityRole="adjustable"
            accessibilityLabel={t('common.resizeField')}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(event) => stepHeight(event.nativeEvent.actionName === 'increment' ? ACCESSIBILITY_STEP : -ACCESSIBILITY_STEP)}
            testID={testID ? `${testID}-resize-handle` : undefined}
          >
            <MaterialIcons name="drag-handle" size={18} color={colors.textMuted} />
          </View>
        </GestureDetector>
      </View>
    </View>
  );
};
