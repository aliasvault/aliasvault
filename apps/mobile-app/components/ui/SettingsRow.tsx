import { Ionicons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { StyleSheet, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native';


import { useColors } from '@/hooks/useColorScheme';
import { useIsSelectedRoute } from '@/hooks/useTwoPane';

import { ThemedText } from '@/components/themed/ThemedText';

type SettingsRowProps = {
  icon: ComponentProps<typeof Ionicons>['name'];
  iconColor?: string;
  label: string;
  labelColor?: string;
  /** Shown between the label and the chevron: a value, a skeleton or a badge. */
  trailing?: React.ReactNode;
  /** Whether a chevron ends the row. */
  chevron?: boolean;
  /** The page the row opens; marks the row while that page shows in the detail pane of a two-pane layout. */
  href?: Href | null;
  onPress: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  testID?: string;
};

/**
 * A row of the settings list: icon, label, an optional trailing view and a chevron.
 */
export function SettingsRow({ icon, iconColor, label, labelColor, trailing, chevron = true, href = null, onPress, onLayout, testID }: SettingsRowProps): React.ReactNode {
  const colors = useColors();
  const isSelected = useIsSelectedRoute(href);

  return (
    <TouchableOpacity testID={testID} style={[styles.row, { backgroundColor: isSelected ? colors.selectedRowBackground : colors.accentBackground }]} onPress={onPress} onLayout={onLayout}>
      <View style={styles.icon}>
        <Ionicons name={icon} size={20} color={iconColor ?? colors.text} />
      </View>
      <View style={styles.content}>
        <ThemedText style={[styles.label, { color: labelColor ?? colors.text }]}>{label}</ThemedText>
        {trailing}
        {chevron && <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 10,
  },
  icon: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    marginRight: 12,
    width: 24,
  },
  label: {
    flex: 1,
    fontSize: 16,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
});
