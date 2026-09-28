import { FieldTypes } from '@aliasvault/models/vault';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FormModal from '@/components/shared/FormModal';

type CustomFieldModalProps = {
  isOpen: boolean;
  isEditMode?: boolean;
  initialLabel?: string;
  initialFieldType?: string;
  onClose: () => void;
  onSubmit: (label: string, fieldType: string) => void;
};

/** The field types a custom field can have, with their translation keys. */
const FIELD_TYPE_OPTIONS: [string, string][] = [
  [FieldTypes.Text, 'FieldTypeText'],
  [FieldTypes.Password, 'FieldTypePassword'],
  [FieldTypes.Hidden, 'FieldTypeHidden'],
  [FieldTypes.TextArea, 'FieldTypeTextArea'],
  [FieldTypes.URL, 'FieldTypeUrl'],
  [FieldTypes.Email, 'FieldTypeEmail'],
  [FieldTypes.Phone, 'FieldTypePhone'],
  [FieldTypes.Number, 'FieldTypeNumber'],
  [FieldTypes.Date, 'FieldTypeDate'],
];

/**
 * Modal for creating and editing a custom field.
 */
const CustomFieldModal: React.FC<CustomFieldModalProps> = ({ isOpen, isEditMode = false, initialLabel = '', initialFieldType = FieldTypes.Text, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const [label, setLabel] = useState(initialLabel);
  const [fieldType, setFieldType] = useState(initialFieldType);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the form to the field being edited (or the defaults) whenever the modal opens, then focus the label.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setLabel(initialLabel);
    setFieldType(initialFieldType);
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    return (): void => clearTimeout(timer);
  }, [initialFieldType, initialLabel, isOpen]);

  /**
   * Submit when the label is filled in.
   */
  const handleConfirm = (): void => {
    if (label.trim().length > 0) {
      onSubmit(label.trim(), fieldType);
      onClose();
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      title={isEditMode ? t('components.main.items.addFieldMenu.EditCustomField') : t('components.main.items.addFieldMenu.AddCustomField')}
      confirmText={isEditMode ? t('sharedResources.Save') : t('components.main.items.addFieldMenu.Add')}
      cancelText={t('components.main.items.addFieldMenu.Cancel')}
      confirmButtonClass="bg-primary-600 hover:bg-primary-500 dark:bg-primary-700 dark:hover:bg-primary-600"
      maxWidth="md"
      onClose={onClose}
      onConfirm={handleConfirm}
      icon={(
        <svg className="h-6 w-6 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      )}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="custom-field-label-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('components.main.items.addFieldMenu.FieldLabel')}</label>
          <input ref={inputRef} type="text" id="custom-field-label-input" value={label} onChange={e => setLabel(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-white" placeholder={t('components.main.items.addFieldMenu.EnterFieldName')} />
        </div>
        <div>
          <label htmlFor="custom-field-type-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('components.main.items.addFieldMenu.FieldType')}</label>
          <select id="custom-field-type-select" value={fieldType} onChange={e => setFieldType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-white">
            {FIELD_TYPE_OPTIONS.map(([value, key]) => <option key={value} value={value}>{t(`components.main.items.addFieldMenu.${key}`)}</option>)}
          </select>
        </div>
      </div>
    </FormModal>
  );
};

export default CustomFieldModal;
