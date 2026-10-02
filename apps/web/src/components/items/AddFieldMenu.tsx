import { FieldCategories, type SystemFieldDefinition } from '@aliasvault/models/vault';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import CustomFieldModal from '@/components/forms/CustomFieldModal';
import Icon from '@/components/shared/Icon';
import MenuItem from '@/components/shared/MenuItem';

type AddFieldMenuProps = {
  optionalSystemFields: SystemFieldDefinition[];
  visibleFieldKeys: Set<string>;
  show2FA: boolean;
  showAttachments: boolean;
  hasLoginFields: boolean;
  customFieldCount: number;
  onAddSystemField: (fieldKey: string) => void;
  onAddCustomField: (label: string, fieldType: string) => void;
  onAdd2FA: () => void;
  onAddAttachments: () => void;
};

/** Translation keys of the optional system field names. */
/**
 * The icon of a field category.
 */
const FieldIcon: React.FC<{ category: string }> = ({ category }) => {
  switch (category) {
    case FieldCategories.Notes:
      return <Icon name="document-text" className="w-5 h-5" />;
    case FieldCategories.Card:
      return <Icon name="credit-card" className="w-5 h-5" />;
    default:
      return <Icon name="plus-sm" className="w-5 h-5" />;
  }
};

/**
 * The "+" menu that adds optional fields and sections to the item form.
 */
const AddFieldMenu: React.FC<AddFieldMenuProps> = ({ optionalSystemFields, visibleFieldKeys, show2FA, showAttachments, hasLoginFields, customFieldCount, onAddSystemField, onAddCustomField, onAdd2FA, onAddAttachments }) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [showCustomFieldModal, setShowCustomFieldModal] = useState(false);
  const [customFieldLabel, setCustomFieldLabel] = useState('');

  return (
    <div className="relative">
      <button type="button" onClick={() => setIsOpen(v => !v)} className="w-full px-4 py-2 border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-md hover:border-primary-500 hover:text-primary-600 dark:hover:text-primary-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors flex items-center justify-center gap-2">
        <Icon name="plus-sm" className="w-5 h-5" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black bg-opacity-50" onClick={() => setIsOpen(false)}></div>
          <div className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
            {optionalSystemFields.filter(f => !visibleFieldKeys.has(f.FieldKey)).map(field => (
              <MenuItem key={field.FieldKey} size="md" icon={<FieldIcon category={field.Category} />} label={t(`fieldLabels.${field.FieldKey}`, { defaultValue: field.FieldKey })} onClick={() => {
                onAddSystemField(field.FieldKey);
                setIsOpen(false);
              }} />
            ))}

            {!show2FA && hasLoginFields && (
              <MenuItem size="md" icon={<Icon name="lock-closed" className="w-5 h-5" />} label={t('common.twoFactorAuthentication')} onClick={() => {
                onAdd2FA();
                setIsOpen(false);
              }} />
            )}

            {!showAttachments && (
              <MenuItem size="md" icon={<Icon name="paper-clip" className="w-5 h-5" />} label={t('common.attachments')} onClick={() => {
                onAddAttachments();
                setIsOpen(false);
              }} />
            )}

            <MenuItem size="md" icon={<Icon name="plus-sm" className="w-5 h-5" />} label={t('itemTypes.addCustomField')} onClick={() => {
              setCustomFieldLabel(t('items.addFieldMenu.defaultFieldLabel', { number: customFieldCount + 1 }));
              setShowCustomFieldModal(true);
              setIsOpen(false);
            }} />
          </div>
        </>
      )}

      <CustomFieldModal isOpen={showCustomFieldModal} initialLabel={customFieldLabel} onClose={() => {
        setShowCustomFieldModal(false);
        setCustomFieldLabel('');
      }} onSubmit={onAddCustomField} />
    </div>
  );
};

export default AddFieldMenu;
