import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import React, { useCallback, useMemo, useState } from 'react';

import type { FieldType } from '@/utils/dist/core/models/vault';
import { FieldTypes } from '@/utils/dist/core/models/vault';

import CustomFieldLabel from './CustomFieldLabel';
import CustomFieldModal from './CustomFieldModal';
import { FormInput } from './FormInput';
import HiddenField from './HiddenField';
import PasswordField from './PasswordField';

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

interface ISortableCustomFieldProps {
  field: CustomFieldDefinition;
  value: string;
  onValueChange: (value: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * Individual sortable custom field item
 */
const SortableCustomField: React.FC<ISortableCustomFieldProps> = ({
  field,
  value,
  onValueChange,
  onEdit,
  onDelete,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.tempId });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 'auto',
  };

  /**
   * Renders the appropriate input field based on field type
   */
  const renderFieldInput = (): React.ReactNode => {
    if (field.fieldType === FieldTypes.TextArea) {
      return (
        <textarea
          id={field.tempId}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-white"
        />
      );
    }

    if (field.fieldType === FieldTypes.Password) {
      return (
        <PasswordField
          id={field.tempId}
          label=""
          value={value}
          onChange={onValueChange}
        />
      );
    }

    if (field.isHidden || field.fieldType === FieldTypes.Hidden) {
      return (
        <HiddenField
          id={field.tempId}
          label=""
          value={value}
          onChange={onValueChange}
        />
      );
    }

    return (
      <FormInput
        id={field.tempId}
        label=""
        value={value}
        onChange={onValueChange}
        type="text"
      />
    );
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative bg-white dark:bg-gray-800"
    >
      {/* Draggable label row */}
      <div
        className="cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <CustomFieldLabel
          htmlFor={field.tempId}
          label={field.label}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
      {/* Input field */}
      {renderFieldInput()}
    </div>
  );
};

interface IDraggableCustomFieldsListProps {
  customFields: CustomFieldDefinition[];
  fieldValues: Record<string, string | string[]>;
  onFieldsReorder: (reorderedFields: CustomFieldDefinition[]) => void;
  onFieldValueChange: (tempId: string, value: string) => void;
  onFieldUpdate: (tempId: string, label: string, fieldType: FieldType) => void;
  onFieldDelete: (tempId: string) => void;
}

/**
 * A sortable list of custom fields with drag-and-drop reordering support.
 * Uses @dnd-kit for accessible and performant drag-and-drop functionality.
 */
const DraggableCustomFieldsList: React.FC<IDraggableCustomFieldsListProps> = ({
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
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  /**
   * Handle drag end event
   */
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = customFields.findIndex((f) => f.tempId === active.id);
      const newIndex = customFields.findIndex((f) => f.tempId === over.id);

      const reorderedFields = arrayMove(customFields, oldIndex, newIndex);

      const updatedFields = reorderedFields.map((field, index) => ({
        ...field,
        displayOrder: index,
      }));

      onFieldsReorder(updatedFields);
    }
  }, [customFields, onFieldsReorder]);

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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={customFields.map((f) => f.tempId)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-3">
            {customFields.map((field) => (
              <SortableCustomField
                key={field.tempId}
                field={field}
                value={(fieldValues[field.tempId] as string) || ''}
                onValueChange={(value) => onFieldValueChange(field.tempId, value)}
                onEdit={() => setEditingFieldId(field.tempId)}
                onDelete={() => onFieldDelete(field.tempId)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <CustomFieldModal
        isOpen={editingValues !== undefined}
        initialValues={editingValues}
        onClose={() => setEditingFieldId(null)}
        onSubmit={handleEditSubmit}
      />
    </>
  );
};

export default DraggableCustomFieldsList;
