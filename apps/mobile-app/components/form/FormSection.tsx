import React from 'react';
import { View, StyleSheet } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';

type FormSectionProps = {
  /** Section title - can be a string or custom React node */
  title?: React.ReactNode;
  /** Content to render inside the section */
  children: React.ReactNode;
  /** Optional action buttons to show in the header */
  actions?: React.ReactNode;
  /** Whether to add bottom margin (default: true) */
  marginBottom?: boolean;
};

/**
 * A reusable form section container with consistent styling.
 * Used for grouping related form fields with an optional title and action buttons.
 */
export const FormSection: React.FC<FormSectionProps> = ({
  title,
  children,
  actions,
  marginBottom = true,
}) => {
  const colors = useColors();

  const styles = StyleSheet.create({
    actionsContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    container: {
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      marginBottom: marginBottom ? 24 : 0,
      padding: 16,
    },
    contentContainer: {
      gap: 12,
    },
    headerContainer: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    title: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
    },
    titleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
  });

  return (
    <View style={styles.container}>
      {title && (
        <View style={styles.headerContainer}>
          <View style={styles.titleContainer}>
            {typeof title === 'string' ? (
              <ThemedText style={styles.title}>{title}</ThemedText>
            ) : (
              title
            )}
          </View>
          {actions && <View style={styles.actionsContainer}>{actions}</View>}
        </View>
      )}
      <View style={styles.contentContainer}>{children}</View>
    </View>
  );
};
