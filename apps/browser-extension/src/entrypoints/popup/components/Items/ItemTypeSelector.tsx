import { ItemTypes } from '@aliasvault/models/vault';
import React from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

import type { ItemType } from '@aliasvault/models/vault';

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
      <Icon name="key" className="w-5 h-5" />
    )
  },
  {
    type: ItemTypes.Alias,
    titleKey: 'itemTypes.alias.title',
    iconSvg: (
      <Icon name="user" className="w-5 h-5" />
    )
  },
  {
    type: ItemTypes.CreditCard,
    titleKey: 'itemTypes.creditCard.title',
    iconSvg: (
      <Icon name="credit-card" className="w-5 h-5" />
    )
  },
  {
    type: ItemTypes.Note,
    titleKey: 'itemTypes.secureNote',
    iconSvg: (
      <Icon name="document-text" className="w-5 h-5" />
    )
  }
];

type ItemTypeSelectorProps = {
  selectedType: ItemType;
  showDropdown: boolean;
  onDropdownToggle: (show: boolean) => void;
  onTypeChange: (type: ItemType) => void;
};

/**
 * Item type selector component with dropdown menu.
 * Allows selecting between Login, Alias, CreditCard, and Note types.
 */
const ItemTypeSelector: React.FC<ItemTypeSelectorProps> = ({
  selectedType,
  showDropdown,
  onDropdownToggle,
  onTypeChange
}) => {
  const { t } = useTranslation();

  const selectedTypeOption = ITEM_TYPE_OPTIONS.find(opt => opt.type === selectedType);

  return (
    <div className="relative">
      <div className="relative w-full px-4 py-2 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg flex items-center gap-2">
        <button
          type="button"
          id="item-type-selector"
          onClick={() => onDropdownToggle(!showDropdown)}
          className="peer absolute inset-0 rounded-lg"
          aria-label={t('itemTypes.typeLabel')}
        />
        <span className="relative flex items-center gap-2 min-w-0 pointer-events-none peer-hover:opacity-80 transition-opacity">
          <span className="shrink-0 text-primary-600 dark:text-primary-400">
            {selectedTypeOption?.iconSvg}
          </span>
          <span className="text-primary-700 dark:text-primary-300 font-medium text-sm truncate">
            {selectedTypeOption ? t(selectedTypeOption.titleKey) : ''}
          </span>
        </span>
        <span className="relative flex-1 flex items-center justify-end gap-1 min-w-0 pointer-events-none peer-hover:opacity-80 transition-opacity">
          <span className="text-xs text-primary-600/80 dark:text-primary-400/80 truncate">
            {t('itemTypes.typeLabel')}
          </span>
          <Icon name="chevron-down" className={`w-4 h-4 shrink-0 text-primary-500 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
        </span>
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
                id={`item-type-option-${option.type}`}
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
                <span className="font-medium text-sm">
                  {t(option.titleKey)}
                </span>
                {selectedType === option.type && (
                  <Icon name="check" className="w-5 h-5 ml-auto text-primary-600 dark:text-primary-400" />
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
