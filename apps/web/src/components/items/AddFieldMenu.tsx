import { FieldCategories, FieldKey, type SystemFieldDefinition } from '@aliasvault/models/vault';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import CustomFieldModal from '@/components/forms/CustomFieldModal';

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
const FIELD_LABEL_KEYS: Record<string, string> = {
  [FieldKey.LoginUsername]: 'FieldLoginUsername',
  [FieldKey.LoginPassword]: 'FieldLoginPassword',
  [FieldKey.LoginEmail]: 'FieldLoginEmail',
  [FieldKey.LoginUrl]: 'FieldLoginUrl',
  [FieldKey.AliasFirstName]: 'FieldAliasFirstName',
  [FieldKey.AliasLastName]: 'FieldAliasLastName',
  [FieldKey.AliasGender]: 'FieldAliasGender',
  [FieldKey.AliasBirthdate]: 'FieldAliasBirthdate',
  [FieldKey.CardNumber]: 'FieldCardNumber',
  [FieldKey.CardCardholderName]: 'FieldCardCardholderName',
  [FieldKey.CardExpiryMonth]: 'FieldCardExpiryMonth',
  [FieldKey.CardExpiryYear]: 'FieldCardExpiryYear',
  [FieldKey.CardCvv]: 'FieldCardCvv',
  [FieldKey.CardPin]: 'FieldCardPin',
  [FieldKey.NotesContent]: 'FieldNotesContent',
};

/**
 * The icon of a field category.
 */
const FieldIcon: React.FC<{ category: string }> = ({ category }) => {
  switch (category) {
    case FieldCategories.Notes:
      return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
    case FieldCategories.Card:
      return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>;
    default:
      return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>;
  }
};

const MENU_ITEM_CLASSES = 'w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-3 border-b border-gray-100 dark:border-gray-700 last:border-b-0 text-gray-700 dark:text-gray-300';

/**
 * The "+" menu that adds optional fields and sections to the item form.
 */
const AddFieldMenu: React.FC<AddFieldMenuProps> = ({ optionalSystemFields, visibleFieldKeys, show2FA, showAttachments, hasLoginFields, customFieldCount, onAddSystemField, onAddCustomField, onAdd2FA, onAddAttachments }) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [showCustomFieldModal, setShowCustomFieldModal] = useState(false);
  const [customFieldLabel, setCustomFieldLabel] = useState('');
  const tk = 'components.main.items.addFieldMenu';

  return (
    <div className="relative">
      <button type="button" onClick={() => setIsOpen(v => !v)} className="w-full px-4 py-2 border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-md hover:border-primary-500 hover:text-primary-600 dark:hover:text-primary-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors flex items-center justify-center gap-2">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black bg-opacity-50" onClick={() => setIsOpen(false)}></div>
          <div className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
            {optionalSystemFields.filter(f => !visibleFieldKeys.has(f.FieldKey)).map(field => (
              <button key={field.FieldKey} type="button" onClick={() => {
                onAddSystemField(field.FieldKey);
                setIsOpen(false);
              }} className={MENU_ITEM_CLASSES}>
                <span className="text-gray-500 dark:text-gray-400"><FieldIcon category={field.Category} /></span>
                <span>{FIELD_LABEL_KEYS[field.FieldKey] ? t(`${tk}.${FIELD_LABEL_KEYS[field.FieldKey]}`) : field.FieldKey}</span>
              </button>
            ))}

            {!show2FA && hasLoginFields && (
              <button type="button" onClick={() => {
                onAdd2FA();
                setIsOpen(false);
              }} className={MENU_ITEM_CLASSES}>
                <span className="text-gray-500 dark:text-gray-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </span>
                <span>{t(`${tk}.TwoFactorAuthentication`)}</span>
              </button>
            )}

            {!showAttachments && (
              <button type="button" onClick={() => {
                onAddAttachments();
                setIsOpen(false);
              }} className={MENU_ITEM_CLASSES}>
                <span className="text-gray-500 dark:text-gray-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                </span>
                <span>{t(`${tk}.Attachments`)}</span>
              </button>
            )}

            <button type="button" onClick={() => {
              setCustomFieldLabel(t(`${tk}.DefaultFieldLabel`, { 0: customFieldCount + 1 }));
              setShowCustomFieldModal(true);
              setIsOpen(false);
            }} className={MENU_ITEM_CLASSES}>
              <span className="text-gray-500 dark:text-gray-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </span>
              <span>{t(`${tk}.AddCustomField`)}</span>
            </button>
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
