import { MaterialIcons } from '@expo/vector-icons';
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { View, TextInput, TextInputProps, StyleSheet, TouchableHighlight, Platform } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';

type FormFieldButton = {
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
}

export type FormFieldRef = {
  focus: () => void;
  selectAll: () => void;
}

type FormFieldProps = Omit<TextInputProps, 'onChangeText'> & {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  required?: boolean;
  buttons?: FormFieldButton[];
  error?: string;
  /** Optional callback for remove button - when provided, shows X button in label row */
  onRemove?: () => void;
  /** Optional testID for the text input */
  testID?: string;
}

/**
 * Simple form field component without react-hook-form.
 */
const FormFieldComponent = forwardRef<FormFieldRef, FormFieldProps>(({
  label,
  value,
  onChangeText,
  required,
  buttons,
  error,
  onRemove,
  testID,
  ...props
}, ref) => {
  const colors = useColors();
  const inputRef = useRef<TextInput>(null);
  const [isFocused, setIsFocused] = useState(false);

  useImperativeHandle(ref, () => ({
    focus: (): void => {
      inputRef.current?.focus();
    },
    selectAll: (): void => {
      inputRef.current?.setSelection(0, (value || '').length);
    }
  }));

  const colorRed = 'red';

  const styles = StyleSheet.create({
    button: {
      borderLeftColor: colors.accentBorder,
      borderLeftWidth: 1,
      padding: 10,
    },
    clearButton: {
      borderRadius: 6,
      marginRight: 4,
      padding: 6,
    },
    errorText: {
      color: colorRed,
      fontSize: 12,
      marginTop: 4,
    },
    input: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
      marginRight: 5,
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
    inputError: {
      borderColor: colorRed,
    },
    inputGroup: {
      marginBottom: 6,
    },
    inputLabel: {
      color: colors.textMuted,
      fontSize: 12,
      marginBottom: 4,
    },
    labelContainer: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    removeButton: {
      padding: 4,
    },
    requiredIndicator: {
      color: colorRed,
      marginLeft: 4,
    },
  });

  const showClearButton = Platform.OS === 'android' && value && value.length > 0 && isFocused;

  // Only show label container if there's a label or remove button
  const showLabelContainer = label || onRemove;

  return (
    <View style={styles.inputGroup}>
      {showLabelContainer && (
        <View style={styles.labelContainer}>
          <ThemedText style={styles.inputLabel}>
            {label} {required && <ThemedText style={styles.requiredIndicator}>*</ThemedText>}
          </ThemedText>
          {onRemove && (
            <TouchableHighlight
              style={styles.removeButton}
              onPress={onRemove}
              underlayColor={colors.accentBackground}
            >
              <MaterialIcons name="close" size={18} color={colors.textMuted} />
            </TouchableHighlight>
          )}
        </View>
      )}
      <View style={[styles.inputContainer, error ? styles.inputError : null]}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={value}
          placeholderTextColor={colors.textMuted}
          onChangeText={onChangeText}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect={false}
          clearButtonMode={Platform.OS === 'ios' ? "while-editing" : "never"}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          testID={testID}
          accessibilityLabel={testID}
          {...props}
        />
        {showClearButton && (
          <TouchableHighlight
            style={styles.clearButton}
            onPress={() => onChangeText('')}
            underlayColor={colors.accentBackground}
          >
            <MaterialIcons name="close" size={16} color={colors.textMuted} />
          </TouchableHighlight>
        )}
        {buttons?.map((button, index) => (
          <TouchableHighlight
            key={index}
            style={styles.button}
            onPress={button.onPress}
            underlayColor={colors.accentBackground}
          >
            <MaterialIcons name={button.icon} size={20} color={colors.primary} />
          </TouchableHighlight>
        ))}
      </View>
      {error && <ThemedText style={styles.errorText}>{error}</ThemedText>}
    </View>
  );
});

FormFieldComponent.displayName = 'FormField';

export const FormField = FormFieldComponent;
