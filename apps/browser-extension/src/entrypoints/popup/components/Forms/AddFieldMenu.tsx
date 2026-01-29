import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';

import type { FieldType, SystemFieldDefinition } from '@/utils/dist/core/models/vault';
import { FieldCategories } from '@/utils/dist/core/models/vault';

/**
 * Configuration for an optional section (not field-based).
 */
type OptionalSection = {
  /** Unique key for this section */
  key: string;
  /** Whether this section is currently visible */
  isVisible: boolean;
  /** Callback to add/show this section */
  onAdd: () => void;
};

/**
 * Callbacks for adding custom fields.
 */
type AddFieldMenuCallbacks = {
  /** Callback when a system field is added */
  onAddSystemField: (fieldKey: string) => void;
  /** Callback when a custom field is added */
  onAddCustomField: (label: string, fieldType: FieldType) => void;
};

type AddFieldMenuProps = {
  /**
   * Optional system fields for the current item type.
   * These are fields with ShowByDefault: false that can be added via the menu.
   */
  optionalSystemFields: SystemFieldDefinition[];
  /**
   * Field keys that are currently visible (either have a value or were manually added).
   */
  visibleFieldKeys: Set<string>;
  /**
   * Optional sections (like 2FA, Attachments) that are not field-based.
   */
  optionalSections: OptionalSection[];
  /**
   * Callbacks for adding fields.
   */
  callbacks: AddFieldMenuCallbacks;
};

/**
 * Menu option for internal use.
 */
type MenuOption = {
  key: string;
  label: string;
  icon: React.ReactNode;
  action: () => void;
};

/**
 * Notes icon for menu option.
 */
const NotesIcon: React.FC = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

/**
 * Lock icon for 2FA menu option.
 */
const LockIcon: React.FC = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
  </svg>
);

/**
 * Attachment icon for menu option.
 */
const AttachmentIcon: React.FC = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
  </svg>
);

/**
 * Plus icon for add button and custom field option.
 */
const PlusIcon: React.FC = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
  </svg>
);

/**
 * Get icon for a field category.
 */
const getFieldIcon = (category: string): React.ReactNode => {
  switch (category) {
    case FieldCategories.Notes:
      return <NotesIcon />;
    default:
      return <PlusIcon />;
  }
};

/**
 * Get icon for optional sections.
 */
const getSectionIcon = (key: string): React.ReactNode => {
  switch (key) {
    case '2fa':
      return <LockIcon />;
    case 'attachments':
      return <AttachmentIcon />;
    default:
      return <PlusIcon />;
  }
};

/**
 * A dropdown menu for adding optional fields and sections to an item.
 * Dynamically determines which options to show based on system field registry
 * and current field visibility.
 */
const AddFieldMenu: React.FC<AddFieldMenuProps> = ({
  optionalSystemFields,
  visibleFieldKeys,
  optionalSections,
  callbacks
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [showCustomFieldModal, setShowCustomFieldModal] = useState(false);
  const [customFieldLabel, setCustomFieldLabel] = useState('');
  const [customFieldType, setCustomFieldType] = useState<FieldType>('Text');

  /**
   * Handle opening the custom field modal.
   */
  const handleOpenCustomFieldModal = useCallback((): void => {
    setShowCustomFieldModal(true);
    setIsOpen(false);
  }, []);

  /**
   * Handle adding the custom field.
   */
  const handleAddCustomField = useCallback((): void => {
    if (!customFieldLabel.trim()) {
      return;
    }

    callbacks.onAddCustomField(customFieldLabel, customFieldType);
    setCustomFieldLabel('');
    setCustomFieldType('Text');
    setShowCustomFieldModal(false);
  }, [customFieldLabel, customFieldType, callbacks]);

  /**
   * Handle closing the custom field modal.
   */
  const handleCloseCustomFieldModal = useCallback((): void => {
    setCustomFieldLabel('');
    setCustomFieldType('Text');
    setShowCustomFieldModal(false);
  }, []);

  /**
   * Handle adding a system field and closing menu.
   */
  const handleAddSystemField = useCallback((fieldKey: string): void => {
    callbacks.onAddSystemField(fieldKey);
    setIsOpen(false);
  }, [callbacks]);

  /**
   * Handle adding an optional section and closing menu.
   */
  const handleAddSection = useCallback((onAdd: () => void): void => {
    onAdd();
    setIsOpen(false);
  }, []);

  /**
   * Build menu options based on optional system fields and sections.
   */
  const menuOptions = useMemo((): MenuOption[] => {
    const options: MenuOption[] = [];

    // Add optional system fields that are not currently visible
    optionalSystemFields.forEach(field => {
      if (!visibleFieldKeys.has(field.FieldKey)) {
        options.push({
          key: field.FieldKey,
          label: t(`fieldLabels.${field.FieldKey}`, { defaultValue: field.FieldKey }),
          icon: getFieldIcon(field.Category),
          /**
           * Handle adding an optional system field.
           */
          action: () => handleAddSystemField(field.FieldKey)
        });
      }
    });

    // Add optional sections that are not currently visible
    optionalSections.forEach(section => {
      if (!section.isVisible) {
        options.push({
          key: section.key,
          label: t(`common.${section.key === '2fa' ? 'twoFactorAuthentication' : section.key}`),
          icon: getSectionIcon(section.key),
          /**
           * Handle adding an optional section.
           */
          action: () => handleAddSection(section.onAdd)
        });
      }
    });

    return options;
  }, [optionalSystemFields, visibleFieldKeys, optionalSections, t, handleAddSystemField, handleAddSection]);

  return (
    <>
      <div className="relative">
        <button
          type="button"
          id="add-field-menu"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full px-4 py-2 border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-md hover:border-primary-500 hover:text-primary-600 dark:hover:text-primary-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors flex items-center justify-center gap-2"
        >
          <PlusIcon />
        </button>

        {/* Dropdown Menu */}
        {isOpen && (
          <>
            {/* Dark overlay backdrop for better visibility */}
            <div
              className="fixed inset-0 z-10 bg-black bg-opacity-50"
              onClick={() => setIsOpen(false)}
            />
            <div className="absolute bottom-full left-0 right-0 mb-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg overflow-hidden">
              {menuOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={option.action}
                  className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-3 border-b border-gray-100 dark:border-gray-700 last:border-b-0 text-gray-700 dark:text-gray-300"
                >
                  <span className="text-gray-500 dark:text-gray-400">
                    {option.icon}
                  </span>
                  <span>{option.label}</span>
                </button>
              ))}
              {/* Custom field option - always available */}
              <button
                type="button"
                onClick={handleOpenCustomFieldModal}
                className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-3 border-b border-gray-100 dark:border-gray-700 last:border-b-0 text-gray-700 dark:text-gray-300"
              >
                <span className="text-gray-500 dark:text-gray-400">
                  <PlusIcon />
                </span>
                <span>{t('itemTypes.addCustomField')}</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Custom Field Modal */}
      <ModalWrapper
        isOpen={showCustomFieldModal}
        onClose={handleCloseCustomFieldModal}
        title={t('itemTypes.addCustomField')}
        footer={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleAddCustomField}
              disabled={!customFieldLabel.trim()}
              className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('common.add')}
            </button>
            <button
              type="button"
              onClick={handleCloseCustomFieldModal}
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
              value={customFieldLabel}
              onChange={(e) => setCustomFieldLabel(e.target.value)}
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
              value={customFieldType}
              onChange={(e) => setCustomFieldType(e.target.value as FieldType)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="Text">{t('itemTypes.fieldTypes.text')}</option>
              <option value="Hidden">{t('itemTypes.fieldTypes.hidden')}</option>
              <option value="Email">{t('itemTypes.fieldTypes.email')}</option>
              <option value="URL">{t('itemTypes.fieldTypes.url')}</option>
              <option value="Phone">{t('itemTypes.fieldTypes.phone')}</option>
              <option value="Number">{t('itemTypes.fieldTypes.number')}</option>
              <option value="Date">{t('itemTypes.fieldTypes.date')}</option>
              <option value="TextArea">{t('itemTypes.fieldTypes.textArea')}</option>
            </select>
          </div>
        </div>
      </ModalWrapper>
    </>
  );
};

export default AddFieldMenu;
export type { OptionalSection };
