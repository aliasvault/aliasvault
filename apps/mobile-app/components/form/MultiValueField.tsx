import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, TextInput, StyleSheet, Pressable, type TextInputInstance } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';

type MultiValueFieldProps = {
  label: string;
  values: string[];
  onValuesChange: (values: string[]) => void;
  placeholder?: string;
  testID?: string;
  addLabel: string;
};

/**
 * The non-empty values of a list of rows.
 */
function filled(rows: string[]): string[] {
  return rows.filter(row => typeof row === 'string' && row.trim() !== '');
}

/**
 * A list of text inputs for a multi-value field, with an add button next to the label and a remove button per row.
 */
export const MultiValueField: React.FC<MultiValueFieldProps> = ({ label, values, onValuesChange, placeholder, testID, addLabel }) => {
  const colors = useColors();
  const { t } = useTranslation();
  const [rows, setRows] = useState<string[]>(values.length > 0 ? values : ['']);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const inputs = useRef<(TextInputInstance | null)[]>([]);

  /*
   * Rows are local so an empty row survives while it is being edited; the parent only gets the filled values.
   * A change from outside (a restored form, an item type switch) replaces the rows.
   */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs the local rows with a change from outside
    setRows(current => {
      const currentValues = filled(current);
      const nextValues = filled(values);
      const isSame = currentValues.length === nextValues.length && currentValues.every((value, index) => value === nextValues[index]);
      return isSame ? current : nextValues.length > 0 ? nextValues : [''];
    });
  }, [values]);

  useEffect(() => {
    if (focusIndex !== null) {
      inputs.current[focusIndex]?.focus();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the focus request is handled once
      setFocusIndex(null);
    }
  }, [focusIndex]);

  /**
   * Show new rows and hand the filled values to the parent.
   */
  const update = (next: string[]): void => {
    setRows(next);
    onValuesChange(filled(next));
  };

  /**
   * Add an empty row and focus it; empty rows are dropped on save.
   */
  const add = (): void => {
    setRows([...rows, '']);
    setFocusIndex(rows.length);
  };

  /**
   * Remove a row; the add button brings one back after the last is removed.
   */
  const remove = (index: number): void => {
    update(rows.filter((_, i) => i !== index));
  };

  const styles = StyleSheet.create({
    addButton: {
      alignItems: 'center',
      borderColor: colors.accentBorder,
      borderRadius: 999,
      borderStyle: 'dashed',
      borderWidth: 1,
      flexDirection: 'row',
      gap: 2,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    addButtonText: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 16,
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
      marginBottom: 8,
    },
    inputGroup: {
      marginBottom: 6,
    },
    inputLabel: {
      color: colors.textMuted,
      fontSize: 12,
    },
    labelRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    removeButton: {
      alignItems: 'center',
      alignSelf: 'stretch',
      justifyContent: 'center',
      opacity: 0.5,
      width: 40,
    },
    removeButtonPressed: {
      opacity: 1,
    },
  });

  return (
    <View style={styles.inputGroup}>
      <View style={styles.labelRow}>
        <ThemedText style={styles.inputLabel}>{label}</ThemedText>
        <Pressable
          style={({ pressed }) => [styles.addButton, pressed && { borderColor: colors.primary }]}
          onPress={add}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          testID={testID ? `${testID}-add` : undefined}
        >
          <MaterialIcons name="add" size={14} color={colors.textMuted} />
          <ThemedText style={styles.addButtonText}>{addLabel}</ThemedText>
        </Pressable>
      </View>
      {rows.map((row, index) => (
        <View key={index} style={styles.inputContainer}>
          <TextInput
            ref={element => {
              inputs.current[index] = element;
            }}
            style={styles.input}
            value={row}
            onChangeText={(text) => update(rows.map((value, i) => (i === index ? text : value)))}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            testID={testID ? `${testID}-${index}` : undefined}
            accessibilityLabel={testID ? `${testID}-${index}` : undefined}
          />
          <Pressable
            style={({ pressed }) => [styles.removeButton, pressed && styles.removeButtonPressed]}
            onPress={() => remove(index)}
            hitSlop={{ top: 4, bottom: 4 }}
            accessibilityRole="button"
            accessibilityLabel={t('common.remove')}
            testID={testID ? `${testID}-remove-${index}` : undefined}
          >
            <MaterialIcons name="close" size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      ))}
    </View>
  );
};

export default MultiValueField;
