import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import DraggableFlatList, {
  RenderItemParams,
} from 'react-native-draggable-flatlist';

import type { FieldType } from '@/utils/dist/core/models/vault';
import { FieldTypes } from '@/utils/dist/core/models/vault';

import { useColors } from '@/hooks/useColorScheme';

import { EditableFieldLabel } from './EditableFieldLabel';
import { FormField } from './FormField';
import { HiddenField } from './HiddenField';

/**
 * Custom field definition type
 */
export type CustomFieldDefinition = {
  tempId: string;
  label: string;
  fieldType: FieldType;
  isHidden: boolean;
  displayOrder: number;
};

type CustomFieldItemProps = {
  field: CustomFieldDefinition;
  value: string;
  onValueChange: (value: string) => void;
  onLabelChange: (newLabel: string) => void;
  onDelete: () => void;
  drag: () => void;
};

/**
 * Individual custom field item
 */
const CustomFieldItem: React.FC<CustomFieldItemProps> = ({
  field,
  value,
  onValueChange,
  onLabelChange,
  onDelete,
  drag,
}) => {
  const colors = useColors();

  /**
   * Renders the appropriate input field based on field type
   */
  const renderFieldInput = (): React.ReactNode => {
    if (field.fieldType === FieldTypes.TextArea) {
      return (
        <FormField
          value={value}
          onChangeText={onValueChange}
          label=""
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
      );
    }

    if (field.isHidden || field.fieldType === FieldTypes.Hidden || field.fieldType === FieldTypes.Password) {
      return (
        <HiddenField
          value={value}
          onChangeText={onValueChange}
          label=""
        />
      );
    }

    return (
      <FormField
        value={value}
        onChangeText={onValueChange}
        label=""
      />
    );
  };

  const styles = StyleSheet.create({
    container: {
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
    },
    contentContainer: {
      flex: 1,
    },
    dragHandle: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingLeft: 4,
      paddingRight: 0,
      paddingVertical: 12,
    },
    labelContainer: {
      marginBottom: 4,
    },
    outerContainer: {
      flexDirection: 'row',
      padding: 8,
      paddingRight: 4,
    },
  });

  return (
    <View style={styles.container}>
      <View style={styles.outerContainer}>
        {/* Field content */}
        <View style={styles.contentContainer}>
          {/* Label row */}
          <View style={styles.labelContainer}>
            <EditableFieldLabel
              label={field.label}
              onLabelChange={onLabelChange}
              onDelete={onDelete}
            />
          </View>
          {/* Input field */}
          {renderFieldInput()}
        </View>
        {/* Drag handle on right side */}
        <View
          style={styles.dragHandle}
          onTouchStart={drag}
        >
          <MaterialIcons name="drag-indicator" size={20} color={colors.textMuted} />
        </View>
      </View>
    </View>
  );
};

type DraggableCustomFieldsListProps = {
  customFields: CustomFieldDefinition[];
  fieldValues: Record<string, string | string[]>;
  onFieldsReorder: (reorderedFields: CustomFieldDefinition[]) => void;
  onFieldValueChange: (tempId: string, value: string) => void;
  onFieldLabelChange: (tempId: string, newLabel: string) => void;
  onFieldDelete: (tempId: string) => void;
};

/**
 * A sortable list of custom fields with drag-and-drop reordering.
 * Uses react-native-draggable-flatlist for smooth, reliable drag animations.
 */
export const DraggableCustomFieldsList: React.FC<DraggableCustomFieldsListProps> = ({
  customFields,
  fieldValues,
  onFieldsReorder,
  onFieldValueChange,
  onFieldLabelChange,
  onFieldDelete,
}) => {
  /**
   * Handle drag begin
   */
  const handleDragBegin = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  /**
   * Handle drag end
   */
  const handleDragEnd = useCallback(({ data }: { data: CustomFieldDefinition[] }) => {
    // Update display order for all fields
    const updatedFields = data.map((field, index) => ({
      ...field,
      displayOrder: index,
    }));

    onFieldsReorder(updatedFields);
  }, [onFieldsReorder]);

  /**
   * Render each draggable item
   */
  const renderItem = useCallback(({ item, drag }: RenderItemParams<CustomFieldDefinition>) => {
    return (
      <View style={styles.itemWrapper}>
        <CustomFieldItem
          field={item}
          value={(fieldValues[item.tempId] as string) || ''}
          onValueChange={(value) => onFieldValueChange(item.tempId, value)}
          onLabelChange={(newLabel) => onFieldLabelChange(item.tempId, newLabel)}
          onDelete={() => onFieldDelete(item.tempId)}
          drag={drag}
        />
      </View>
    );
  }, [fieldValues, onFieldValueChange, onFieldLabelChange, onFieldDelete]);

  /**
   * Key extractor for FlatList
   */
  const keyExtractor = useCallback((item: CustomFieldDefinition) => item.tempId, []);

  if (customFields.length === 0) {
    return null;
  }

  return (
    <DraggableFlatList
      data={customFields}
      onDragBegin={handleDragBegin}
      onDragEnd={handleDragEnd}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      containerStyle={styles.container}
      scrollEnabled={false}
    />
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  itemWrapper: {
    marginVertical: 4,
  },
});
