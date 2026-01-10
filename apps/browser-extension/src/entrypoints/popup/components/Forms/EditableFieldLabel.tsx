import React, { useState } from 'react';

type EditableFieldLabelProps = {
  htmlFor: string;
  label: string;
  onLabelChange: (newLabel: string) => void;
  onDelete?: () => void;
}

/**
 * Editable field label component with edit button.
 * Shows label text with a small edit icon. When clicked, shows an input field.
 */
const EditableFieldLabel: React.FC<EditableFieldLabelProps> = ({
  htmlFor,
  label,
  onLabelChange,
  onDelete
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(label);

  /**
   * Handle the save action.
   */
  const handleSave = (): void => {
    if (editValue.trim()) {
      onLabelChange(editValue.trim());
      setIsEditing(false);
    }
  };

  /**
   * Handle the cancel action.
   */
  const handleCancel = (): void => {
    setEditValue(label);
    setIsEditing(false);
  };

  /**
   * Handle the key down event.
   */
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          className="flex-1 px-2 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 border border-primary-500 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 dark:bg-gray-700 dark:border-primary-400"
          placeholder="Field label"
          autoFocus
        />
        <button
          type="button"
          onClick={handleSave}
          className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 text-xs px-2 py-1"
        >
          ✓
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 text-xs px-2 py-1"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 mb-2">
      <label htmlFor={htmlFor} className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs"
        title="Edit label"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-xs"
          title="Delete field"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default EditableFieldLabel;
