import { type ItemType, ItemTypes } from '@aliasvault/models/vault';
import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

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
      return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>;
    case ItemTypes.Alias:
      return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>;
    case ItemTypes.CreditCard:
      return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>;
    default:
      return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
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
      <svg className={`w-3 h-3 shrink-0 text-primary-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
      </svg>
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
                  <svg className="w-5 h-5 ml-auto text-primary-600 dark:text-primary-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
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
