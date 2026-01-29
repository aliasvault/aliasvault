import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState } from 'react';
import { View, TextInput, StyleSheet, TouchableOpacity } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';

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
  /** Optional testID for the text input */
  testID?: string;
};

/**
 * A form field for hidden/masked values like CVV, PIN, etc.
 * Includes a show/hide toggle button inside the input field.
 */
export const HiddenField: React.FC<HiddenFieldProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  onRemove,
  testID,
}) => {
  const colors = useColors();
  const [isVisible, setIsVisible] = useState(false);

  const styles = StyleSheet.create({
    container: {
      marginBottom: 0,
    },
    input: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    inputContainer: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 6,
      borderWidth: 1,
      flexDirection: 'row',
    },
    label: {
      color: colors.textMuted,
      fontSize: 12,
      marginBottom: 4,
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
      alignItems: 'center',
      borderLeftColor: colors.accentBorder,
      borderLeftWidth: 1,
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
  });

  // Only show label container if there's a label or remove button
  const showLabelContainer = label || onRemove;

  return (
    <View style={styles.container}>
      {showLabelContainer && (
        <View style={styles.labelContainer}>
          <ThemedText style={styles.label}>{label}</ThemedText>
          {onRemove && (
            <TouchableOpacity
              style={styles.removeButton}
              onPress={onRemove}
              activeOpacity={0.7}
            >
              <MaterialIcons name="close" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      )}
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
          testID={testID}
          accessibilityLabel={testID}
        />
        <TouchableOpacity
          style={styles.toggleButton}
          onPress={() => setIsVisible(!isVisible)}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name={isVisible ? 'visibility-off' : 'visibility'}
            size={20}
            color={colors.primary}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
};
