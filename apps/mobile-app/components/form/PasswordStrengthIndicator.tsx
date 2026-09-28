import { getPasswordStrength } from '@aliasvault/client/utilities/PasswordStrength';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, View } from 'react-native';

import { useColors, useColorScheme } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';

const LABEL_KEYS = ['veryWeak', 'weak', 'fair', 'good', 'strong'];

/**
 * Bar, label and track colors per strength level, the same Tailwind shades the web app and browser extension use.
 */
const STRENGTH_COLORS = {
  light: {
    bar: ['#fb923c', '#eab308', '#22c55e', '#16a34a', '#15803d'],
    text: ['#ea580c', '#ca8a04', '#16a34a', '#15803d', '#166534'],
    track: '#e5e7eb',
  },
  dark: {
    bar: ['#f97316', '#ca8a04', '#16a34a', '#15803d', '#166534'],
    text: ['#fb923c', '#facc15', '#4ade80', '#86efac', '#bbf7d0'],
    track: '#374151',
  },
};

type PasswordStrengthIndicatorProps = {
  /** The password to rate, the indicator hides itself while this is empty. */
  password: string;
};

/**
 * Strength bar shown underneath a new password input, mirroring the web app and browser extension.
 * @returns {React.ReactNode} The rendered component
 */
export function PasswordStrengthIndicator({ password }: PasswordStrengthIndicatorProps): React.ReactNode {
  const { t } = useTranslation();
  const colors = useColors();
  const palette = STRENGTH_COLORS[useColorScheme()];
  const strength = getPasswordStrength(password);
  const width = useRef(new Animated.Value(strength + 1)).current;

  useEffect(() => {
    Animated.timing(width, { toValue: strength + 1, duration: 300, useNativeDriver: false }).start();
  }, [strength, width]);

  if (password.length === 0) {
    return null;
  }

  const styles = StyleSheet.create({
    bar: {
      backgroundColor: palette.bar[strength],
      borderRadius: 5,
      height: 10,
    },
    container: {
      marginTop: 12,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    label: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '500',
    },
    strength: {
      color: palette.text[strength],
      fontSize: 12,
      fontWeight: '600',
    },
    track: {
      backgroundColor: palette.track,
      borderRadius: 5,
      height: 10,
      overflow: 'hidden',
    },
  });

  return (
    <View style={styles.container} testID="password-strength-indicator">
      <View style={styles.header}>
        <ThemedText style={styles.label}>{t('common.passwordStrength.title')}</ThemedText>
        <ThemedText style={styles.strength}>{t(`common.passwordStrength.${LABEL_KEYS[strength]}`)}</ThemedText>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.bar, { width: width.interpolate({ inputRange: [0, 5], outputRange: ['0%', '100%'] }) }]} />
      </View>
    </View>
  );
}
