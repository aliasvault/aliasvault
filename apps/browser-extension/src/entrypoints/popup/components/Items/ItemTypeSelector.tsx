import React from 'react';
import { useTranslation } from 'react-i18next';

import type { ItemType } from '@/utils/dist/core/models/vault';
import { ItemTypes } from '@/utils/dist/core/models/vault';

/**
 * Item type option configuration.
 */
type ItemTypeOption = {
  type: ItemType;
  titleKey: string;
  iconSvg: React.ReactNode;
};

/**
 * Available item type options with icons.
 */
const ITEM_TYPE_OPTIONS: ItemTypeOption[] = [
  {
    type: ItemTypes.Login,
    titleKey: 'itemTypes.login.title',
    iconSvg: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
      </svg>
    )
  },
  {
    type: ItemTypes.Alias,
    titleKey: 'itemTypes.alias.title',
    iconSvg: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    )
  },
  {
    type: ItemTypes.CreditCard,
    titleKey: 'itemTypes.creditCard.title',
    iconSvg: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    )
  },
  {
    type: ItemTypes.Note,
    titleKey: 'itemTypes.note.title',
    iconSvg: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    )
  }
];

type ItemTypeSelectorProps = {
  selectedType: ItemType;
  isEditMode: boolean;
  showDropdown: boolean;
  onDropdownToggle: (show: boolean) => void;
  onTypeChange: (type: ItemType) => void;
  onRegenerateAlias?: () => void;
};

/**
 * Item type selector component with dropdown menu.
 * Allows selecting between Login, Alias, CreditCard, and Note types.
 */
const ItemTypeSelector: React.FC<ItemTypeSelectorProps> = ({
  selectedType,
  isEditMode,
  showDropdown,
  onDropdownToggle,
  onTypeChange,
  onRegenerateAlias
}) => {
  const { t } = useTranslation();

  const selectedTypeOption = ITEM_TYPE_OPTIONS.find(opt => opt.type === selectedType);

  return (
    <div className="relative">
      <div className="w-full px-4 py-2 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg flex items-center gap-2">
        <button
          type="button"
          onClick={() => onDropdownToggle(!showDropdown)}
          className="flex-1 flex items-center justify-between hover:opacity-80 transition-opacity"
        >
          <div className="flex items-center gap-2">
            <span className="text-primary-600 dark:text-primary-400">
              {selectedTypeOption?.iconSvg}
            </span>
            <span className="text-primary-700 dark:text-primary-300 font-medium text-sm">
              {isEditMode ? t('itemTypes.editing') : t('itemTypes.creating')} {selectedTypeOption ? t(selectedTypeOption.titleKey) : ''}
            </span>
          </div>
          <svg
            className={`w-4 h-4 text-primary-500 transition-transform ${showDropdown ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {/* Regenerate alias button - icon only for flexibility */}
        {selectedType === ItemTypes.Alias && !isEditMode && onRegenerateAlias && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRegenerateAlias();
            }}
            className="flex-shrink-0 p-1.5 text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/40 rounded transition-colors"
            title={t('itemTypes.regenerateAlias')}
          >
            <svg className='w-4 h-4' viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 4v6h-6"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
        )}
      </div>

      {/* Type Dropdown Menu */}
      {showDropdown && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => onDropdownToggle(false)}
          />
          <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg">
            {ITEM_TYPE_OPTIONS.map((option) => (
              <button
                key={option.type}
                type="button"
                onClick={() => onTypeChange(option.type)}
                className={`w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-3 border-b border-gray-100 dark:border-gray-700 last:border-b-0 ${
                  selectedType === option.type
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'text-gray-900 dark:text-white'
                }`}
              >
                <span className={selectedType === option.type ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}>
                  {option.iconSvg}
                </span>
                <span className="font-medium">
                  {t(option.titleKey)}
                </span>
                {selectedType === option.type && (
                  <svg className="w-5 h-5 ml-auto text-primary-600 dark:text-primary-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default ItemTypeSelector;
export { ITEM_TYPE_OPTIONS };
export type { ItemTypeOption };
