import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { View, StyleSheet, TouchableHighlight } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';

type CustomFieldLabelProps = {
  label: string;
  onEdit: () => void;
  onDelete?: () => void;
  drag?: () => void;
}

/** Label row for a custom field with edit and delete buttons. */
export const CustomFieldLabel: React.FC<CustomFieldLabelProps> = ({
  label,
  onEdit,
  onDelete,
  drag
}) => {
  const colors = useColors();

  const styles = StyleSheet.create({
    actionButton: {
      borderRadius: 4,
      marginLeft: 4,
      padding: 2,
    },
    container: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    deleteButton: {
      marginLeft: 4,
    },
    dragHandle: {
      marginLeft: 'auto',
      padding: 2,
    },
    editButton: {
      marginLeft: 4,
      padding: 2,
    },
    label: {
      color: colors.textMuted,
      fontSize: 12,
    },
  });

  return (
    <View style={styles.container}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <TouchableHighlight
        style={styles.editButton}
        onPress={onEdit}
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
      {drag && (
        <TouchableHighlight
          style={[styles.actionButton, styles.dragHandle]}
          onPressIn={drag}
          underlayColor={colors.accentBackground}
        >
          <MaterialIcons name="drag-indicator" size={18} color={colors.textMuted} />
        </TouchableHighlight>
      )}
    </View>
  );
};
