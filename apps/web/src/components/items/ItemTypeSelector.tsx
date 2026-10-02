import { type ItemType, ItemTypes } from '@aliasvault/models/vault';
import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/components/shared/Icon';
import { useClickOutside } from '@/hooks/useClickOutside';

type ItemTypeSelectorProps = {
  selectedType: ItemType;
  onSelectedTypeChange: (itemType: ItemType) => void;
  showDropdown: boolean;
  onShowDropdownChange: (show: boolean) => void;
};

/** All item types, in menu order. */
const ALL_TYPES: ItemType[] = [ItemTypes.Login, ItemTypes.Alias, ItemTypes.CreditCard, ItemTypes.Note];

/**
 * The icon of an item type.
 */
const TypeIcon: React.FC<{ itemType: ItemType; className?: string }> = ({ itemType, className = 'w-5 h-5' }) => {
  switch (itemType) {
    case ItemTypes.Login:
      return <Icon name="key" className={className} />;
    case ItemTypes.Alias:
      return <Icon name="user" className={className} />;
    case ItemTypes.CreditCard:
      return <Icon name="credit-card" className={className} />;
    default:
      return <Icon name="document-text" className={className} />;
  }
};

/**
 * The translation key of an item type's name.
 */
const typeNameKey = (itemType: ItemType): string => {
  switch (itemType) {
    case ItemTypes.Login: return 'itemTypes.login.title';
    case ItemTypes.Alias: return 'itemTypes.alias.title';
    case ItemTypes.CreditCard: return 'itemTypes.creditCard.title';
    default: return 'itemTypes.secureNote';
  }
};

type ItemTypePillProps = {
  itemType: ItemType;
  /** Makes the pill the dropdown toggle of the edit page; without it the pill is a muted read-only label. */
  onClick?: () => void;
  isOpen?: boolean;
};

/**
 * Pill showing the item type.
 */
export const ItemTypePill: React.FC<ItemTypePillProps> = ({ itemType, onClick, isOpen = false }) => {
  const { t } = useTranslation();

  if (!onClick) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full">
        <span className="shrink-0 text-gray-500 dark:text-gray-400"><TypeIcon itemType={itemType} className="w-3.5 h-3.5" /></span>
        <span className="text-xs font-medium whitespace-nowrap text-gray-700 dark:text-gray-300">{t(typeNameKey(itemType))}</span>
      </span>
    );
  }

  return (
    <button type="button" id="itemTypeSelectorToggle" onClick={onClick} className="inline-flex items-center gap-1.5 pl-2.5 pr-2 py-0.5 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-full hover:bg-primary-100 dark:hover:bg-primary-900/40 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors">
      <span className="shrink-0 text-primary-600 dark:text-primary-400"><TypeIcon itemType={itemType} className="w-3.5 h-3.5" /></span>
      <span className="text-xs font-medium whitespace-nowrap text-primary-700 dark:text-primary-300">{t(typeNameKey(itemType))}</span>
      <span className="ml-1 text-xs whitespace-nowrap text-primary-600/70 dark:text-primary-400/70">{t('itemTypes.typeLabel')}</span>
      <Icon name="chevron-down" className={`w-3 h-3 shrink-0 text-primary-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
    </button>
  );
};

/**
 * Dropdown to pick the item type.
 */
const ItemTypeSelector: React.FC<ItemTypeSelectorProps> = ({ selectedType, onSelectedTypeChange, showDropdown, onShowDropdownChange }) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onShowDropdownChange(false), [onShowDropdownChange]);
  useClickOutside([containerRef], close, showDropdown);

  useEffect(() => {
    if (!showDropdown) {
      return;
    }
    /**
     * Close on Escape.
     */
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return (): void => document.removeEventListener('keydown', onKeyDown);
  }, [showDropdown, close]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <ItemTypePill itemType={selectedType} onClick={() => onShowDropdownChange(!showDropdown)} isOpen={showDropdown} />

      {showDropdown && (
        <div className="absolute left-0 z-20 mt-2 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
          {ALL_TYPES.map((itemType) => {
            const selected = selectedType === itemType;
            return (
              <button key={itemType} type="button" id={`itemTypeSelector_${itemType}`} onClick={() => {
                if (!selected) {
                  onSelectedTypeChange(itemType);
                }
                onShowDropdownChange(false);
              }} className={`w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-3 border-b border-gray-100 dark:border-gray-700 last:border-b-0 ${selected ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' : 'text-gray-900 dark:text-white'}`}>
                <span className={selected ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}><TypeIcon itemType={itemType} /></span>
                <span className="font-medium text-sm">{t(typeNameKey(itemType))}</span>
                {selected && (
                  <Icon name="check" className="w-5 h-5 ml-auto text-primary-600 dark:text-primary-400" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ItemTypeSelector;
