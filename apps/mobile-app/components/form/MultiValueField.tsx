import { MaterialIcons } from '@expo/vector-icons';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, TextInput, StyleSheet, Platform } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { RobustPressable } from '@/components/ui/RobustPressable';

type MultiValueFieldProps = {
  label: string;
  values: string[];
  onValuesChange: (values: string[]) => void;
  placeholder?: string;
  testID?: string;
};

/**
 * Multi-value form field component for fields like URLs that support multiple values.
 * Displays multiple input fields with a "+" button to add more.
 * Empty values are automatically filtered out when saving, so no explicit remove button is needed.
 */
export const MultiValueField: React.FC<MultiValueFieldProps> = ({
  label,
  values,
  onValuesChange,
  placeholder,
  testID,
}) => {
  const colors = useColors();

  // Track local display values to prevent flickering when adding new fields
  const [localValues, setLocalValues] = useState<string[]>(values.length > 0 ? values : ['']);

  // Track if we recently added a field (to prevent immediate removal)
  const recentlyAddedRef = useRef(false);
  const addTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local values with props, but respect the recently added flag
  useEffect(() => {
    if (!recentlyAddedRef.current) {
      setLocalValues(values.length > 0 ? values : ['']);
    }
  }, [values]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (addTimeoutRef.current) {
        clearTimeout(addTimeoutRef.current);
      }
    };
  }, []);

  /**
   * Handle value change for a specific index.
   */
  const handleValueChange = useCallback((index: number, newValue: string): void => {
    const newValues = [...localValues];
    newValues[index] = newValue;
    setLocalValues(newValues);
    // Filter empty values for storage, but keep at least empty array
    onValuesChange(newValues.filter(v => v.trim() !== ''));
  }, [localValues, onValuesChange]);

  /**
   * Add a new empty value field.
   */
  const handleAddValue = useCallback((): void => {
    // Set flag to prevent immediate removal of empty field
    recentlyAddedRef.current = true;

    // Clear any existing timeout
    if (addTimeoutRef.current) {
      clearTimeout(addTimeoutRef.current);
    }

    const newValues = [...localValues, ''];
    setLocalValues(newValues);
    onValuesChange(newValues.filter(v => v.trim() !== ''));

    // Allow removal after a delay (gives user time to start typing)
    addTimeoutRef.current = setTimeout(() => {
      recentlyAddedRef.current = false;
    }, 1000);
  }, [localValues, onValuesChange]);

  const styles = StyleSheet.create({
    addButton: {
      alignItems: 'center',
      borderLeftColor: colors.accentBorder,
      borderLeftWidth: 1,
      justifyContent: 'center',
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    input: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
      padding: 10,
    },
    inputContainer: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 6,
      borderWidth: 1,
      flexDirection: 'row',
    },
    inputGroup: {
      marginBottom: 6,
    },
    inputLabel: {
      color: colors.textMuted,
      fontSize: 12,
      marginBottom: 4,
    },
    valueContainer: {
      marginBottom: 8,
    },
  });

  return (
    <View style={styles.inputGroup}>
      <ThemedText style={styles.inputLabel}>{label}</ThemedText>
      {localValues.map((value, index) => {
        const isLastInput = index === localValues.length - 1;
        return (
          <View key={`${testID || 'multi'}-${index}`} style={styles.valueContainer}>
            <View style={styles.inputContainer}>
              <TextInput
                style={[
                  styles.input,
                  // Add extra right padding on the last input to prevent iOS clear button
                  // from being covered by the add button
                  isLastInput && Platform.OS === 'ios' && { paddingRight: 30 },
                ]}
                value={value}
                onChangeText={(newValue) => handleValueChange(index, newValue)}
                placeholder={placeholder}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                clearButtonMode={Platform.OS === 'ios' ? 'while-editing' : 'never'}
                testID={testID ? `${testID}-${index}` : undefined}
                accessibilityLabel={testID ? `${testID}-${index}` : undefined}
              />
              {/* Show add button on the last input */}
              {isLastInput && (
                <RobustPressable
                  style={styles.addButton}
                  onPress={handleAddValue}
                >
                  <MaterialIcons name="add" size={20} color={colors.primary} />
                </RobustPressable>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
};

export default MultiValueField;
