import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSyntheticEvent, ScrollView, StyleSheet, TextInput, TextInputProps, TextInputSelectionChangeEventData, TouchableHighlight, View, useWindowDimensions } from 'react-native';
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

/** Animated text input component. */
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

type ResizableTextAreaProps = Omit<TextInputProps, 'onChangeText' | 'multiline' | 'numberOfLines'> & {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  onRemove?: () => void;
  testID?: string;
}

/**
 * Multi-line form field with a drag handle at the bottom to resize it.
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
  const [isResized, setIsResized] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const isCaretAtEnd = useRef(false);

  // Height the field renders at: follows the content while it still auto-grows,
  // driven by the drag afterwards.
  const height = useSharedValue(MIN_HEIGHT);
  const contentHeight = useSharedValue(MIN_HEIGHT);
  const maxHeightValue = useSharedValue(maxHeight);
  const dragStartHeight = useSharedValue(MIN_HEIGHT);
  const hasDragged = useSharedValue(false);

  // Keep the height within bounds when the window size changes (e.g. rotation).
  useEffect(() => {
    maxHeightValue.value = maxHeight;
    height.value = Math.min(Math.max(isResized ? height.value : contentHeight.value, MIN_HEIGHT), maxHeight);
  }, [maxHeight, isResized, height, contentHeight, maxHeightValue]);

  const animatedHeightStyle = useAnimatedStyle(() => ({ height: height.value }));
  const animatedInputStyle = useAnimatedStyle(() => ({ minHeight: height.value }));

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
   * Grow the field with its text until it is resized by hand.
   */
  const handleContentSizeChange = useCallback((_width: number, newContentHeight: number): void => {
    contentHeight.value = newContentHeight;

    if (!isResized) {
      height.value = Math.min(Math.max(newContentHeight, MIN_HEIGHT), maxHeightValue.value);
    }

    if (isCaretAtEnd.current) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  }, [contentHeight, height, isResized, maxHeightValue]);

  /**
   * Track whether the caret is at the end of the text.
   */
  const handleSelectionChange = useCallback((event: NativeSyntheticEvent<TextInputSelectionChangeEventData>): void => {
    isCaretAtEnd.current = event.nativeEvent.selection.end >= value.length;
  }, [value.length]);

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
      overflow: 'hidden',
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
        <Animated.ScrollView
          ref={scrollRef}
          style={animatedHeightStyle}
          onContentSizeChange={handleContentSizeChange}
          keyboardShouldPersistTaps="always"
          nestedScrollEnabled
        >
          <AnimatedTextInput
            style={isResized ? [styles.input, animatedInputStyle] : [styles.input, { minHeight: MIN_HEIGHT }]}
            value={value}
            onChangeText={onChangeText}
            onSelectionChange={handleSelectionChange}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            multiline
            scrollEnabled={false}
            testID={testID}
            accessibilityLabel={testID}
            {...props}
          />
        </Animated.ScrollView>
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
