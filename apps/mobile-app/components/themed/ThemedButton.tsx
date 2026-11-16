import React from 'react';
import { StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { RobustPressable } from '@/components/ui/RobustPressable';

type ThemedButtonProps = {
  title: string;
  variant?: 'primary' | 'secondary';
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  testID?: string;
};

/**
 * Themed button component that matches the app's design system.
 */
export const ThemedButton: React.FC<ThemedButtonProps> = ({
  title,
  variant = 'primary',
  onPress,
  loading = false,
  disabled = false,
  style,
  textStyle,
  testID,
}) => {
  const colors = useColors();
  const isSecondary = variant === 'secondary';
  const textColor = isSecondary ? colors.text : colors.primarySurfaceText;

  const styles = StyleSheet.create({
    button: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 6,
      justifyContent: 'center',
      padding: 12,
    },
    buttonDisabled: {
      backgroundColor: colors.textMuted,
      opacity: 0.7,
    },
    buttonSecondary: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderWidth: 1,
    },
    buttonSecondaryDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      color: textColor,
      fontSize: 16,
      fontWeight: '600',
    },
    loadingContainer: {
      position: 'absolute',
    },
  });

  return (
    <RobustPressable
      style={[
        styles.button,
        isSecondary && styles.buttonSecondary,
        disabled && (isSecondary ? styles.buttonSecondaryDisabled : styles.buttonDisabled),
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      testID={testID}
    >
      <ThemedText style={[styles.buttonText, textStyle]}>
        {title}
      </ThemedText>
      {loading && (
        <ActivityIndicator
          style={styles.loadingContainer}
          color={textColor}
        />
      )}
    </RobustPressable>
  );
};