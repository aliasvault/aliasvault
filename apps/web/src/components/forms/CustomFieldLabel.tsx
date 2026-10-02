import React from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/components/shared/Icon';

type CustomFieldLabelProps = {
  htmlFor: string;
  label: string;
  onEdit: () => void;
  onDelete?: () => void;
};

/**
 * Label row of a custom field with edit and delete buttons.
 */
const CustomFieldLabel: React.FC<CustomFieldLabelProps> = ({ htmlFor, label, onEdit, onDelete }) => {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2 mb-2">
      <label htmlFor={htmlFor} className="text-sm font-medium text-gray-900 dark:text-white">{label}</label>
      <button type="button" onClick={onEdit} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs" title={t('items.editableFieldLabel.editLabel')}>
        <Icon name="pencil" className="w-3 h-3" />
      </button>
      {onDelete && (
        <button type="button" onClick={onDelete} className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-xs" title={t('items.editableFieldLabel.deleteField')}>
          <Icon name="trash" className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};

export default CustomFieldLabel;
