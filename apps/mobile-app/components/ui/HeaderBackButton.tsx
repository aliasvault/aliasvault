import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { RobustPressable } from './RobustPressable';

type HeaderBackButtonProps = {
  /** The label to display next to the back arrow */
  label: string;
  /** Callback when the button is pressed */
  onPress: () => void;
  /** Optional testID for E2E testing */
  testID?: string;
};

/**
 * A reusable header back button component for navigation headers.
 * Displays a chevron icon with a label, styled to match iOS navigation patterns.
 * Uses RobustPressable for reliable touch handling in E2E tests.
 */
export const HeaderBackButton: React.FC<HeaderBackButtonProps> = ({
  label,
  onPress,
  testID = 'back-button',
}) => {
  const colors = useColors();

  return (
    <RobustPressable
      onPress={onPress}
      style={styles.container}
    >
      <MaterialIcons
        name="chevron-left"
        size={28}
        color={colors.primary}
      />
      <Text testID={testID} style={[styles.label, { color: colors.primary }]}>
        {label}
      </Text>
    </RobustPressable>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    marginLeft: -8,
    paddingHorizontal: 8,
  },
  label: {
    fontSize: 17,
  },
});
