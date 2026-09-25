import { type ItemFilterType } from '@aliasvault/client/items/ItemFilters';
import { ItemTypes } from '@aliasvault/models/vault';
import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClickOutside } from '@/hooks/useClickOutside';

type ItemFilterDropdownProps = {
  title: string;
  count?: number;
  activeFilter: ItemFilterType | null;
  isRecentlyDeletedActive?: boolean;
  recentlyDeletedCount: number;
  showFoldersToggle: boolean;
  showFolders: boolean;
  titleActions?: React.ReactNode;
  onSelectFilter: (filter: ItemFilterType) => void;
  onSelectRecentlyDeleted: () => void;
  onToggleShowFolders: () => void;
};

/**
 * Page title which acts as a filter dropdown when clicked.
 */
const ItemFilterDropdown: React.FC<ItemFilterDropdownProps> = ({ title, count, activeFilter, isRecentlyDeletedActive = false, recentlyDeletedCount, showFoldersToggle, showFolders, titleActions, onSelectFilter, onSelectRecentlyDeleted, onToggleShowFolders }) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * Close the menu.
   */
  const close = useCallback((): void => setIsOpen(false), []);
  useClickOutside([buttonRef, menuRef], close, isOpen);

  /**
   * Whether a filter is the active one.
   */
  const isActive = (filter: ItemFilterType): boolean => !isRecentlyDeletedActive && activeFilter === filter;

  /**
   * Pick a filter and close.
   */
  const pickFilter = (filter: ItemFilterType): void => {
    setIsOpen(false);
    onSelectFilter(filter);
  };

  /**
   * The classes of a type/feature filter row.
   */
  const rowClass = (filter: ItemFilterType, withIcon: boolean): string =>
    `w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 ${withIcon ? 'flex items-center gap-2' : ''} ${isActive(filter) ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-gray-300'}`;

  /**
   * The classes of a filter row icon.
   */
  const iconClass = (filter: ItemFilterType): string => `w-5 h-5 ${isActive(filter) ? 'text-orange-500 dark:text-orange-400' : 'text-gray-400 dark:text-gray-500'}`;

  return (
    <div className="relative flex items-center gap-2">
      <button ref={buttonRef} onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-2 text-gray-900 dark:text-white hover:text-gray-700 dark:hover:text-gray-300 focus:outline-none">
        <h1 className="flex items-baseline gap-1.5 text-xl font-semibold tracking-tight text-gray-900 dark:text-white sm:text-2xl">
          <span>{title}</span>
          {count !== undefined && (
            <span className="text-base text-gray-500 dark:text-gray-400">({count})</span>
          )}
        </h1>
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {titleActions}

      {isOpen && (
        <div ref={menuRef} className="absolute left-0 top-full z-40 mt-2 w-56 origin-top-left rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none dark:bg-gray-700">
          <div className="py-1">
            <div className={`flex items-center justify-between px-4 py-2 ${isActive('all') ? 'bg-orange-50 dark:bg-orange-900/20' : ''}`}>
              <button onClick={() => pickFilter('all')} className={`text-left text-sm hover:text-gray-900 dark:hover:text-white ${isActive('all') ? 'text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-gray-300'}`}>
                {t('pages.main.items.home.FilterAllOption')}
              </button>
              {showFoldersToggle && (
                <button onClick={(e) => {
                  e.stopPropagation(); setIsOpen(false); onToggleShowFolders(); 
                }} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
                  <span>{t('pages.main.items.home.ShowFoldersOption')}</span>
                  <svg className={`w-5 h-5 ${showFolders ? 'text-orange-500 dark:text-orange-400' : 'text-gray-400 dark:text-gray-500'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    {showFolders && <polyline points="7 12 10 15 17 8" />}
                  </svg>
                </button>
              )}
            </div>
            <div className="border-t border-gray-200 dark:border-gray-600 my-1"></div>

            <button onClick={() => pickFilter(ItemTypes.Login)} className={rowClass(ItemTypes.Login, true)}>
              <svg className={iconClass(ItemTypes.Login)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              {t('components.main.items.itemTypeSelector.TypeLogin')}
            </button>
            <button onClick={() => pickFilter(ItemTypes.Alias)} className={rowClass(ItemTypes.Alias, true)}>
              <svg className={iconClass(ItemTypes.Alias)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              {t('components.main.items.itemTypeSelector.TypeAlias')}
            </button>
            <button onClick={() => pickFilter(ItemTypes.CreditCard)} className={rowClass(ItemTypes.CreditCard, true)}>
              <svg className={iconClass(ItemTypes.CreditCard)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              {t('components.main.items.itemTypeSelector.TypeCreditCard')}
            </button>
            <button onClick={() => pickFilter(ItemTypes.Note)} className={rowClass(ItemTypes.Note, true)}>
              <svg className={iconClass(ItemTypes.Note)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {t('components.main.items.itemTypeSelector.TypeNote')}
            </button>

            <div className="border-t border-gray-200 dark:border-gray-600 my-1"></div>

            <button onClick={() => pickFilter('passkeys')} className={rowClass('passkeys', false)}>
              {t('pages.main.items.home.FilterPasskeysOption')}
            </button>
            <button onClick={() => pickFilter('attachments')} className={rowClass('attachments', false)}>
              {t('pages.main.items.home.FilterAttachmentsOption')}
            </button>
            <button onClick={() => pickFilter('totp')} className={rowClass('totp', false)}>
              {t('pages.main.items.home.FilterTotpOption')}
            </button>

            <div className="border-t border-gray-200 dark:border-gray-600 my-1"></div>

            <button onClick={() => {
              setIsOpen(false); onSelectRecentlyDeleted(); 
            }} className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center justify-between ${isRecentlyDeletedActive ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-gray-300'}`}>
              <span>{t('pages.main.items.home.FilterRecentlyDeletedOption')}</span>
              {recentlyDeletedCount > 0 && (
                <span className={isRecentlyDeletedActive ? 'text-orange-500 dark:text-orange-400' : 'text-gray-400 dark:text-gray-500'}>{recentlyDeletedCount}</span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ItemFilterDropdown;
