import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';

type SettingsHeaderProps = {
  title: string;
  description?: string;
  icon: keyof typeof Ionicons.glyphMap;
};

/**
 * Settings header component.
 * @param title - The title of the header.
 * @param description - The description of the header.
 * @param icon - The icon of the header.
 * @returns The settings header component.
 */
export function SettingsHeader({ title, description, icon }: SettingsHeaderProps): React.ReactNode {
  const colors = useColors();

  const styles = StyleSheet.create({
    container: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      paddingBottom: 16,
      paddingHorizontal: 16,
      paddingTop: 20,
      textAlign: 'center',
    },
    description: {
      color: colors.textMuted,
      fontSize: 15,
      lineHeight: 20,
      textAlign: 'center',
    },
    iconContainer: {
      alignItems: 'center',
      alignSelf: 'center',
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 14,
      borderWidth: 1,
      elevation: 1,
      justifyContent: 'center',
      padding: 16,
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
    },
    title: {
      color: colors.text,
      fontSize: 24,
      fontWeight: 'bold',
      lineHeight: 24,
      marginBottom: 6,
      marginTop:  20,
      textAlign: 'center',
    },
  });

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Ionicons name={icon} size={48} color={colors.primary} />
      </View>
      <ThemedText style={styles.title}>{title}</ThemedText>
      {description ? (
        <ThemedText style={styles.description}>{description}</ThemedText>
      ) : null}
    </View>
  );
}
