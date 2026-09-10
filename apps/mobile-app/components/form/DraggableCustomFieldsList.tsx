import * as Haptics from 'expo-haptics';
import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import DraggableFlatList, {
  RenderItemParams,
} from 'react-native-draggable-flatlist';

import type { FieldType } from '@/utils/dist/core/models/vault';
import { FieldTypes } from '@/utils/dist/core/models/vault';
import { HapticsUtility } from '@/utils/HapticsUtility';

import { useColors } from '@/hooks/useColorScheme';

import { AdvancedPasswordField } from './AdvancedPasswordField';
import { CustomFieldLabel } from './CustomFieldLabel';
import { CustomFieldModal } from './CustomFieldModal';
import { FormField } from './FormField';
import { HiddenField } from './HiddenField';
import { ResizableTextArea } from './ResizableTextArea';

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
  onEdit: () => void;
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
  onEdit,
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
        <ResizableTextArea
          value={value}
          onChangeText={onValueChange}
          label=""
        />
      );
    }

    if (field.fieldType === FieldTypes.Password) {
      return (
        <AdvancedPasswordField
          value={value}
          onChangeText={onValueChange}
          label=""
        />
      );
    }

    if (field.isHidden || field.fieldType === FieldTypes.Hidden) {
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
      padding: 8,
    },
    labelContainer: {
      marginBottom: 4,
    },
  });

  return (
    <View style={styles.container}>
      {/* Label row with inline, right-aligned drag handle */}
      <View style={styles.labelContainer}>
        <CustomFieldLabel
          label={field.label}
          onEdit={onEdit}
          onDelete={onDelete}
          drag={drag}
        />
      </View>
      {/* Input field */}
      {renderFieldInput()}
    </View>
  );
};

type DraggableCustomFieldsListProps = {
  customFields: CustomFieldDefinition[];
  fieldValues: Record<string, string | string[]>;
  onFieldsReorder: (reorderedFields: CustomFieldDefinition[]) => void;
  onFieldValueChange: (tempId: string, value: string) => void;
  onFieldUpdate: (tempId: string, label: string, fieldType: FieldType) => void;
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
  onFieldUpdate,
  onFieldDelete,
}) => {
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const editingField = customFields.find((f) => f.tempId === editingFieldId);
  const editingValues = useMemo(
    () => editingField ? { label: editingField.label, fieldType: editingField.fieldType } : undefined,
    [editingField]
  );

  /**
   * Handle drag begin
   */
  const handleDragBegin = useCallback(() => {
    HapticsUtility.impact(Haptics.ImpactFeedbackStyle.Medium);
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
          onEdit={() => setEditingFieldId(item.tempId)}
          onDelete={() => onFieldDelete(item.tempId)}
          drag={drag}
        />
      </View>
    );
  }, [fieldValues, onFieldValueChange, onFieldDelete]);

  /**
   * Key extractor for FlatList
   */
  const keyExtractor = useCallback((item: CustomFieldDefinition) => item.tempId, []);

  /**
   * Apply the edits made in the custom field modal to the field being edited.
   */
  const handleEditSubmit = useCallback((label: string, fieldType: FieldType) => {
    if (editingFieldId) {
      onFieldUpdate(editingFieldId, label, fieldType);
    }
  }, [editingFieldId, onFieldUpdate]);

  if (customFields.length === 0) {
    return null;
  }

  return (
    <>
      <DraggableFlatList
        data={customFields}
        onDragBegin={handleDragBegin}
        onDragEnd={handleDragEnd}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        containerStyle={styles.container}
        scrollEnabled={false}
      />

      <CustomFieldModal
        isOpen={editingValues !== undefined}
        initialValues={editingValues}
        onClose={() => setEditingFieldId(null)}
        onSubmit={handleEditSubmit}
      />
    </>
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
