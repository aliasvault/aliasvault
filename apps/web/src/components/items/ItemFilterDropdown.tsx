import { ItemFilter, type ItemFilterType } from '@aliasvault/client/items/ItemFilters';
import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FolderIcon from '@/components/folders/FolderIcon';
import Icon from '@/components/shared/Icon';
import { useClickOutside } from '@/hooks/useClickOutside';

type ItemFilterDropdownProps = {
  title: string;
  count?: number;
  titleFolder?: { isShared: boolean };
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
const ItemFilterDropdown: React.FC<ItemFilterDropdownProps> = ({ title, count, titleFolder, activeFilter, isRecentlyDeletedActive = false, recentlyDeletedCount, showFoldersToggle, showFolders, titleActions, onSelectFilter, onSelectRecentlyDeleted, onToggleShowFolders }) => {
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
          {titleFolder && <FolderIcon isShared={titleFolder.isShared} className="w-5 h-5 self-center text-orange-500" />}
          <span>{title}</span>
          {count !== undefined && (
            <span className="text-base text-gray-500 dark:text-gray-400">({count})</span>
          )}
        </h1>
        <Icon name="chevron-down" className="w-5 h-5" />
      </button>

      {titleActions}

      {isOpen && (
        <div ref={menuRef} className="absolute left-0 top-full z-40 mt-2 w-56 origin-top-left rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none dark:bg-gray-700">
          <div className="py-1">
            <div className={`flex items-center justify-between px-4 py-2 ${isActive(ItemFilter.All) ? 'bg-orange-50 dark:bg-orange-900/20' : ''}`}>
              <button onClick={() => pickFilter(ItemFilter.All)} className={`text-left text-sm hover:text-gray-900 dark:hover:text-white ${isActive(ItemFilter.All) ? 'text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-gray-300'}`}>
                {t('items.title')}
              </button>
              {showFoldersToggle && (
                <button onClick={(e) => {
                  e.stopPropagation(); setIsOpen(false); onToggleShowFolders(); 
                }} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
                  <span>{t('items.filters.showFolders')}</span>
                  <Icon name={showFolders ? 'square-check' : 'square-feather'} className={`w-5 h-5 ${showFolders ? 'text-orange-500 dark:text-orange-400' : 'text-gray-400 dark:text-gray-500'}`} />
                </button>
              )}
            </div>
            <div className="border-t border-gray-200 dark:border-gray-600 my-1"></div>

            <button onClick={() => pickFilter(ItemFilter.Login)} className={rowClass(ItemFilter.Login, true)}>
              <Icon name="key" className={iconClass(ItemFilter.Login)} />
              {t('itemTypes.login.title')}
            </button>
            <button onClick={() => pickFilter(ItemFilter.Alias)} className={rowClass(ItemFilter.Alias, true)}>
              <Icon name="user" className={iconClass(ItemFilter.Alias)} />
              {t('itemTypes.alias.title')}
            </button>
            <button onClick={() => pickFilter(ItemFilter.CreditCard)} className={rowClass(ItemFilter.CreditCard, true)}>
              <Icon name="credit-card" className={iconClass(ItemFilter.CreditCard)} />
              {t('itemTypes.creditCard.title')}
            </button>
            <button onClick={() => pickFilter(ItemFilter.Note)} className={rowClass(ItemFilter.Note, true)}>
              <Icon name="document-text" className={iconClass(ItemFilter.Note)} />
              {t('itemTypes.secureNote')}
            </button>

            <div className="border-t border-gray-200 dark:border-gray-600 my-1"></div>

            <button onClick={() => pickFilter(ItemFilter.Passkeys)} className={rowClass(ItemFilter.Passkeys, false)}>
              {t('common.passkeys')}
            </button>
            <button onClick={() => pickFilter(ItemFilter.Attachments)} className={rowClass(ItemFilter.Attachments, false)}>
              {t('common.attachments')}
            </button>
            <button onClick={() => pickFilter(ItemFilter.Totp)} className={rowClass(ItemFilter.Totp, false)}>
              {t('items.filters.totp')}
            </button>

            <div className="border-t border-gray-200 dark:border-gray-600 my-1"></div>

            <button onClick={() => {
              setIsOpen(false); onSelectRecentlyDeleted(); 
            }} className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center justify-between ${isRecentlyDeletedActive ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-gray-300'}`}>
              <span>{t('items.recentlyDeleted.title')}</span>
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
