import { MaterialIcons } from '@expo/vector-icons';
import React, { useState, useRef, useEffect } from 'react';
import { View, TextInput, StyleSheet, TouchableHighlight, Keyboard } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';

type EditableFieldLabelProps = {
  label: string;
  onLabelChange: (newLabel: string) => void;
  onDelete?: () => void;
}

/**
 * Editable field label component with edit button.
 * Shows label text with a small edit icon. When clicked, shows an input field.
 */
export const EditableFieldLabel: React.FC<EditableFieldLabelProps> = ({
  label,
  onLabelChange,
  onDelete
}) => {
  const colors = useColors();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(label);
  const inputRef = useRef<TextInput>(null);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  /**
   * Handle the save action.
   */
  const handleSave = (): void => {
    if (editValue.trim()) {
      onLabelChange(editValue.trim());
      setIsEditing(false);
      Keyboard.dismiss();
    }
  };

  /**
   * Handle the cancel action.
   */
  const handleCancel = (): void => {
    setEditValue(label);
    setIsEditing(false);
    Keyboard.dismiss();
  };

  const styles = StyleSheet.create({
    actionButton: {
      borderRadius: 4,
      marginLeft: 4,
      padding: 2,
    },
    cancelButton: {
      marginLeft: 4,
    },
    container: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    deleteButton: {
      marginLeft: 4,
    },
    editButton: {
      marginLeft: 4,
      padding: 2,
    },
    editContainer: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
    },
    editInput: {
      backgroundColor: colors.background,
      borderColor: colors.primary,
      borderRadius: 4,
      borderWidth: 1,
      color: colors.text,
      flex: 1,
      fontSize: 12,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    label: {
      color: colors.textMuted,
      fontSize: 12,
    },
    saveButton: {
      marginLeft: 4,
    },
  });

  if (isEditing) {
    return (
      <View style={styles.container}>
        <View style={styles.editContainer}>
          <TextInput
            ref={inputRef}
            style={styles.editInput}
            value={editValue}
            onChangeText={setEditValue}
            onSubmitEditing={handleSave}
            placeholder="Field label"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
          />
          <TouchableHighlight
            style={[styles.actionButton, styles.saveButton]}
            onPress={handleSave}
            underlayColor={colors.accentBackground}
          >
            <MaterialIcons name="check" size={18} color={colors.success} />
          </TouchableHighlight>
          <TouchableHighlight
            style={[styles.actionButton, styles.cancelButton]}
            onPress={handleCancel}
            underlayColor={colors.accentBackground}
          >
            <MaterialIcons name="close" size={18} color={colors.textMuted} />
          </TouchableHighlight>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <TouchableHighlight
        style={styles.editButton}
        onPress={() => setIsEditing(true)}
        underlayColor={colors.accentBackground}
      >
        <MaterialIcons name="edit" size={14} color={colors.textMuted} />
      </TouchableHighlight>
      {onDelete && (
        <TouchableHighlight
          style={[styles.actionButton, styles.deleteButton]}
          onPress={onDelete}
          underlayColor={colors.accentBackground}
        >
          <MaterialIcons name="delete" size={14} color={colors.destructive} />
        </TouchableHighlight>
      )}
    </View>
  );
};
