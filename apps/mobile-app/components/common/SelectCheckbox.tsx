import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

/**
 * The checkbox of a row in selection mode.
 */
export function SelectCheckbox({ isSelected }: { isSelected: boolean }): React.ReactNode {
  const colors = useColors();

  const styles = StyleSheet.create({
    box: {
      alignItems: 'center',
      backgroundColor: isSelected ? colors.primary : 'transparent',
      borderColor: isSelected ? colors.primary : colors.textMuted,
      borderRadius: 4,
      borderWidth: 2,
      height: 20,
      justifyContent: 'center',
      marginRight: 10,
      width: 20,
    },
  });

  return (
    <View style={styles.box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {isSelected && <MaterialIcons name="check" size={14} color="#ffffff" />}
    </View>
  );
}
