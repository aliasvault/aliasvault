import React, { useCallback, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';

import type { FieldType } from '@/utils/dist/core/models/vault';
import { FieldTypes } from '@/utils/dist/core/models/vault';

type CustomFieldModalProps = {
  isOpen: boolean;
  /** Existing field values when editing, omitted when adding a new field */
  initialValues?: { label: string; fieldType: FieldType };
  onClose: () => void;
  onSubmit: (label: string, fieldType: FieldType) => void;
};

/**
 * Modal for creating and editing a custom field.
 */
const CustomFieldModal: React.FC<CustomFieldModalProps> = ({
  isOpen,
  initialValues,
  onClose,
  onSubmit
}) => {
  const { t } = useTranslation();
  const isEditMode = initialValues !== undefined;
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState<FieldType>(FieldTypes.Text);

  /**
   * Reset the form to the field being edited (or to defaults) whenever the modal opens.
   */
  useLayoutEffect(() => {
    if (isOpen) {
      setLabel(initialValues?.label ?? '');
      setFieldType(initialValues?.fieldType ?? FieldTypes.Text);
    }
  }, [isOpen, initialValues]);

  /**
   * Submit the form and close the modal.
   */
  const handleSubmit = useCallback((): void => {
    if (!label.trim()) {
      return;
    }

    onSubmit(label.trim(), fieldType);
    onClose();
  }, [label, fieldType, onSubmit, onClose]);

  /**
   * Submit on enter so the label input can be confirmed without reaching for the mouse.
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? t('itemTypes.editCustomField') : t('itemTypes.addCustomField')}
      footer={
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!label.trim()}
            className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isEditMode ? t('common.save') : t('common.add')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            {t('common.cancel')}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('itemTypes.fieldLabel')}
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-white"
            placeholder={t('itemTypes.enterFieldName')}
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('itemTypes.fieldType')}
          </label>
          <select
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as FieldType)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-white"
          >
            <option value={FieldTypes.Text}>{t('itemTypes.fieldTypes.text')}</option>
            <option value={FieldTypes.Password}>{t('itemTypes.fieldTypes.password')}</option>
            <option value={FieldTypes.Hidden}>{t('itemTypes.fieldTypes.hidden')}</option>
            <option value={FieldTypes.TextArea}>{t('itemTypes.fieldTypes.textArea')}</option>
            <option value={FieldTypes.URL}>{t('itemTypes.fieldTypes.url')}</option>
            <option value={FieldTypes.Email}>{t('itemTypes.fieldTypes.email')}</option>
            <option value={FieldTypes.Phone}>{t('itemTypes.fieldTypes.phone')}</option>
            <option value={FieldTypes.Number}>{t('itemTypes.fieldTypes.number')}</option>
            <option value={FieldTypes.Date}>{t('itemTypes.fieldTypes.date')}</option>
          </select>
        </div>
      </div>
    </ModalWrapper>
  );
};

export default CustomFieldModal;
