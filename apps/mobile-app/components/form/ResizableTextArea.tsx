import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, LayoutChangeEvent, PanResponder, StyleSheet, TextInput, TextInputProps, TouchableHighlight, View, useWindowDimensions } from 'react-native';

import { HapticsUtility } from '@/utils/HapticsUtility';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';

/** Minimum height in pixels. */
const MIN_HEIGHT = 100;

/** Max height as a fraction of the window height. */
const MAX_HEIGHT_RATIO = 0.6;

/** Height change per accessibility increment/decrement action. */
const ACCESSIBILITY_STEP = 40;

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
  const maxHeightRef = useRef(maxHeight);

  // Whether the user dragged the handle; until then the field sizes itself to its content.
  const [isResized, setIsResized] = useState(false);
  const heightAnim = useRef(new Animated.Value(MIN_HEIGHT)).current;
  const renderedHeight = useRef(MIN_HEIGHT);
  const dragStartHeight = useRef(MIN_HEIGHT);
  const hasDragged = useRef(false);

  /**
   * Clamp a height between the minimum and the current maximum.
   */
  const clampHeight = useCallback((height: number): number => {
    return Math.min(Math.max(height, MIN_HEIGHT), maxHeightRef.current);
  }, []);

  /**
   * Apply a height to the animated value and remember it as the rendered height.
   */
  const applyHeight = useCallback((height: number): void => {
    renderedHeight.current = height;
    heightAnim.setValue(height);
  }, [heightAnim]);

  // Keep the height within bounds when the window size changes (e.g. rotation).
  useEffect(() => {
    maxHeightRef.current = maxHeight;

    if (isResized && renderedHeight.current > maxHeight) {
      applyHeight(maxHeight);
    }
  }, [maxHeight, isResized, applyHeight]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (): boolean => true,
    onMoveShouldSetPanResponder: (): boolean => true,
    onPanResponderTerminationRequest: (): boolean => false,
    onPanResponderGrant: (): void => {
      hasDragged.current = false;
      dragStartHeight.current = renderedHeight.current;
      heightAnim.setValue(renderedHeight.current);
      HapticsUtility.impact(Haptics.ImpactFeedbackStyle.Light);
    },
    // Resize the field along with the finger, ignoring the jitter of a plain tap.
    onPanResponderMove: (_event, gestureState): void => {
      if (!hasDragged.current && Math.abs(gestureState.dy) < 2) {
        return;
      }

      applyHeight(clampHeight(dragStartHeight.current + gestureState.dy));

      // Switch from auto-growing to the fixed height that follows the finger.
      if (!hasDragged.current) {
        hasDragged.current = true;
        setIsResized(true);
      }
    },
  }), [applyHeight, clampHeight, heightAnim]);

  /**
   * Resize in fixed steps, used by the accessibility increment/decrement actions.
   */
  const stepHeight = useCallback((delta: number): void => {
    applyHeight(clampHeight(renderedHeight.current + delta));
    setIsResized(true);
  }, [applyHeight, clampHeight]);

  /**
   * Track the height the field renders at, so a drag starts from the size the
   * user actually sees while the field is still auto-growing.
   */
  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    renderedHeight.current = event.nativeEvent.layout.height;
  }, []);

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
          style={isResized ? { height: heightAnim } : undefined}
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
        <View
          style={styles.handle}
          hitSlop={{ bottom: 12, left: 24, right: 24, top: 8 }}
          accessibilityRole="adjustable"
          accessibilityLabel={t('common.resizeField')}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => stepHeight(event.nativeEvent.actionName === 'increment' ? ACCESSIBILITY_STEP : -ACCESSIBILITY_STEP)}
          testID={testID ? `${testID}-resize-handle` : undefined}
          {...panResponder.panHandlers}
        >
          <MaterialIcons name="drag-handle" size={18} color={colors.textMuted} />
        </View>
      </View>
    </View>
  );
};
