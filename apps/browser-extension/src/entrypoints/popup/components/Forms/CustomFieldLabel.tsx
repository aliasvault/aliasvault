import React from 'react';
import { useTranslation } from 'react-i18next';

type CustomFieldLabelProps = {
  htmlFor: string;
  label: string;
  onEdit: () => void;
  onDelete?: () => void;
}

/**
 * Label row for a custom field with edit and delete buttons.
 * Editing opens the custom field modal so both the label and the type can be changed.
 */
const CustomFieldLabel: React.FC<CustomFieldLabelProps> = ({
  htmlFor,
  label,
  onEdit,
  onDelete
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2 mb-2">
      <label htmlFor={htmlFor} className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      <button
        type="button"
        onClick={onEdit}
        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs"
        title={t('itemTypes.editCustomField')}
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
          title={t('itemTypes.deleteCustomField')}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default CustomFieldLabel;
