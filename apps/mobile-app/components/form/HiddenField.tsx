import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { RobustPressable } from '@/components/ui/RobustPressable';

type HiddenFieldProps = {
  /** Field label */
  label: string;
  /** Current value */
  value: string;
  /** Change handler */
  onChangeText: (value: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Keyboard type */
  keyboardType?: 'default' | 'numeric';
  /** Optional callback for remove button */
  onRemove?: () => void;
};

/**
 * A form field for hidden/masked values like CVV, PIN, etc.
 * Includes a show/hide toggle button.
 */
export const HiddenField: React.FC<HiddenFieldProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  onRemove,
}) => {
  const colors = useColors();
  const [isVisible, setIsVisible] = useState(false);

  const styles = StyleSheet.create({
    container: {
      marginBottom: 0,
    },
    input: {
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      color: colors.text,
      flex: 1,
      fontSize: 16,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    inputContainer: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    label: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 6,
    },
    labelContainer: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    removeButton: {
      padding: 4,
    },
    toggleButton: {
      marginLeft: 8,
      padding: 8,
    },
  });

  return (
    <View style={styles.container}>
      <View style={styles.labelContainer}>
        <ThemedText style={styles.label}>{label}</ThemedText>
        {onRemove && (
          <RobustPressable onPress={onRemove} style={styles.removeButton}>
            <MaterialIcons name="close" size={18} color={colors.textMuted} />
          </RobustPressable>
        )}
      </View>
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={!isVisible}
          keyboardType={keyboardType}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <RobustPressable
          onPress={() => setIsVisible(!isVisible)}
          style={styles.toggleButton}
        >
          <MaterialIcons
            name={isVisible ? 'visibility' : 'visibility-off'}
            size={24}
            color={colors.textMuted}
          />
        </RobustPressable>
      </View>
    </View>
  );
};
