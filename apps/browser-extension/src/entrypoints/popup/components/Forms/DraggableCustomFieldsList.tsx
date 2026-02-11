import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import React, { useCallback } from 'react';

import type { FieldType } from '@/utils/dist/core/models/vault';
import { FieldTypes } from '@/utils/dist/core/models/vault';

import EditableFieldLabel from './EditableFieldLabel';
import { FormInput } from './FormInput';
import HiddenField from './HiddenField';

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
  onLabelChange: (newLabel: string) => void;
  onDelete: () => void;
}

/**
 * Individual sortable custom field item
 */
const SortableCustomField: React.FC<ISortableCustomFieldProps> = ({
  field,
  value,
  onValueChange,
  onLabelChange,
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

    if (field.isHidden || field.fieldType === FieldTypes.Hidden || field.fieldType === FieldTypes.Password) {
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
        <EditableFieldLabel
          htmlFor={field.tempId}
          label={field.label}
          onLabelChange={onLabelChange}
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
  onFieldLabelChange: (tempId: string, newLabel: string) => void;
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
  onFieldLabelChange,
  onFieldDelete,
}) => {
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

  if (customFields.length === 0) {
    return null;
  }

  return (
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
              onLabelChange={(newLabel) => onFieldLabelChange(field.tempId, newLabel)}
              onDelete={() => onFieldDelete(field.tempId)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
};

export default DraggableCustomFieldsList;
