import React from 'react';
import { TouchableOpacity, StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';

type ThemedButtonProps = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
};

/**
 * Themed button component that matches the app's design system.
 */
export const ThemedButton: React.FC<ThemedButtonProps> = ({
  title,
  onPress,
  loading = false,
  disabled = false,
  style,
  textStyle,
}) => {
  const colors = useColors();

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
    buttonText: {
      color: colors.primarySurfaceText,
      fontSize: 16,
      fontWeight: '600',
    },
    loadingContainer: {
      position: 'absolute',
    },
  });

  return (
    <TouchableOpacity
      style={[
        styles.button,
        disabled && styles.buttonDisabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      <ThemedText style={[styles.buttonText, textStyle]}>
        {title}
      </ThemedText>
      {loading && (
        <ActivityIndicator
          style={styles.loadingContainer}
          color={colors.background}
        />
      )}
    </TouchableOpacity>
  );
};