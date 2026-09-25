import { FieldTypes } from '@aliasvault/models/vault';
import React, { useRef, useState } from 'react';

import CustomFieldLabel from '@/components/forms/CustomFieldLabel';
import CustomFieldModal from '@/components/forms/CustomFieldModal';
import { EDIT_INPUT_CLASSES } from '@/components/forms/EditFormRow';
import EditPasswordFormRow from '@/components/forms/EditPasswordFormRow';
import type { FieldEdit } from '@/models/ItemEdit';

type DraggableCustomFieldsListProps = {
  customFields: FieldEdit[];
  onReorder: (reordered: FieldEdit[]) => void;
  onValueChange: (fieldKey: string, value: string) => void;
  onFieldUpdate: (fieldKey: string, label: string, fieldType: string) => void;
  onDelete: (fieldKey: string) => void;
};

/**
 * Collapses the dragged field while keeping it mounted, so the browser keeps the drag going.
 */
const DRAGGED_STYLE: React.CSSProperties = { height: 0, margin: 0, overflow: 'hidden', opacity: 0 };

/**
 * The custom fields of an item, reorderable by dragging their label row.
 */
const DraggableCustomFieldsList: React.FC<DraggableCustomFieldsListProps> = ({ customFields, onReorder, onValueChange, onFieldUpdate, onDelete }) => {
  const [editingField, setEditingField] = useState<FieldEdit | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dragHeight, setDragHeight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Start dragging: use the whole field as drag image, then collapse it on the next tick (after the image is captured).
   */
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, field: FieldEdit, index: number): void => {
    const item = e.currentTarget.closest<HTMLElement>('[data-drag-item]');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', field.FieldKey);
    if (item) {
      e.dataTransfer.setDragImage(item, e.clientX - item.getBoundingClientRect().left, e.clientY - item.getBoundingClientRect().top);
      setDragHeight(item.offsetHeight);
    }
    setTimeout(() => {
      setDragKey(field.FieldKey);
      setDropIndex(index);
    }, 0);
  };

  /**
   * Reset the drag state.
   */
  const endDrag = (): void => {
    setDragKey(null);
    setDropIndex(null);
  };

  /**
   * Track the insertion index (among the non-dragged fields) from the pointer position.
   */
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    if (dragKey === null || !containerRef.current) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const others = Array.from(containerRef.current.querySelectorAll<HTMLElement>('[data-drag-item]')).filter(el => el.dataset.dragItem !== dragKey);
    const index = others.filter(el => {
      const rect = el.getBoundingClientRect();
      return e.clientY > rect.top + rect.height / 2;
    }).length;
    setDropIndex(index);
  };

  /**
   * Hide the placeholder once the pointer leaves the list, so a drop outside visibly does nothing.
   */
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDropIndex(null);
    }
  };

  /**
   * Move the dragged field to the placeholder position.
   */
  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const fromIndex = customFields.findIndex(f => f.FieldKey === dragKey);
    if (fromIndex !== -1 && dropIndex !== null && dropIndex !== fromIndex) {
      const reordered = customFields.filter(f => f.FieldKey !== dragKey);
      reordered.splice(dropIndex, 0, customFields[fromIndex]);
      onReorder(reordered);
    }
    endDrag();
  };

  const placeholder = <div key="drop-placeholder" style={{ height: dragHeight }} className="rounded-lg border-2 border-dashed border-primary-500/60 bg-primary-500/10 animate-drop-slot" />;
  const others = customFields.filter(f => f.FieldKey !== dragKey);

  return (
    <>
      <div ref={containerRef} className="space-y-4" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        {customFields.map(field => {
          const inputId = `custom-${field.FieldKey}`;
          const isDragged = field.FieldKey === dragKey;
          const slotIndex = others.indexOf(field);
          return (
            <React.Fragment key={field.FieldKey}>
              {!isDragged && dropIndex === slotIndex && placeholder}
              <div data-drag-item={field.FieldKey} style={isDragged ? DRAGGED_STYLE : undefined} className="relative bg-white dark:bg-gray-800 rounded-lg group">
                <div className="relative cursor-grab active:cursor-grabbing" draggable onDragStart={e => handleDragStart(e, field, slotIndex)} onDragEnd={endDrag}>
                  <CustomFieldLabel htmlFor={inputId} label={field.Label} onEdit={() => setEditingField(field)} onDelete={() => onDelete(field.FieldKey)} />
                  <svg className="absolute right-0 top-0 w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M7 4a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm-1.5 7.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM16 4a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm-1.5 7.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM16 16a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                  </svg>
                </div>

                {field.FieldType === FieldTypes.TextArea ? (
                  <div className="relative">
                    <textarea id={inputId} style={{ height: '200px' }} className={EDIT_INPUT_CLASSES} value={field.Value} onChange={e => onValueChange(field.FieldKey, e.target.value)}></textarea>
                  </div>
                ) : field.FieldType === FieldTypes.Password ? (
                  <EditPasswordFormRow id={inputId} label="" value={field.Value} onChange={v => onValueChange(field.FieldKey, v)} showPassword={false} showGenerateButtons />
                ) : field.IsHidden || field.FieldType === FieldTypes.Hidden ? (
                  <EditPasswordFormRow id={inputId} label="" value={field.Value} onChange={v => onValueChange(field.FieldKey, v)} showPassword={false} showGenerateButtons={false} />
                ) : (
                  <div className="relative">
                    <input type="text" id={inputId} autoComplete="off" className={EDIT_INPUT_CLASSES} value={field.Value} onChange={e => onValueChange(field.FieldKey, e.target.value)} autoCapitalize="off" autoCorrect="off" />
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
        {dropIndex !== null && dropIndex >= others.length && placeholder}
      </div>

      <CustomFieldModal isOpen={editingField !== null} isEditMode initialLabel={editingField?.Label ?? ''} initialFieldType={editingField?.FieldType ?? FieldTypes.Text} onClose={() => setEditingField(null)} onSubmit={(label, fieldType) => {
        if (editingField) {
          onFieldUpdate(editingField.FieldKey, label, fieldType);
        }
      }} />
    </>
  );
};

export default DraggableCustomFieldsList;
