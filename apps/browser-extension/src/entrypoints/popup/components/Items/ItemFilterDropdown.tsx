import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ITEM_TYPE_OPTIONS } from '@/entrypoints/popup/components/Items/ItemTypeSelector';

import { isItemTypeFilter, type ItemFilterType } from '@/utils/ItemFilters';

/**
 * Filter selection that includes the dedicated "deleted" page as an option too.
 */
export type ItemFilterSelection = ItemFilterType | 'deleted';

type ItemFilterDropdownProps = {
  /** Title shown on the trigger button. */
  title: string;
  /** Count shown next to the title on the trigger. Pass undefined to hide. */
  count?: number;
  /** Currently active selection — used to highlight the matching menu row. */
  activeFilter: ItemFilterSelection;
  /** Number of items currently in the Recently Deleted page (badge). */
  recentlyDeletedCount: number;
  /** Whether to render the "Show folders" toggle row. */
  showFoldersToggle?: boolean;
  /** Current value of the "Show folders" preference. */
  showFolders?: boolean;
  /** Toggle the "Show folders" preference. */
  onToggleShowFolders?: (next: boolean) => void;
  /** Called when the user picks a non-deleted filter. */
  onSelectFilter: (filter: ItemFilterType) => void;
  /** Called when the user picks "Recently deleted". */
  onSelectRecentlyDeleted: () => void;
};

/**
 * Dropdown that lets the user switch between item filters (All, type filters,
 * passkeys/attachments/TOTP) and jump to the Recently Deleted page. Used on the
 * items list and Recently Deleted pages so both share the same navigation menu.
 */
const ItemFilterDropdown: React.FC<ItemFilterDropdownProps> = ({
  title,
  count,
  activeFilter,
  recentlyDeletedCount,
  showFoldersToggle = false,
  showFolders = false,
  onToggleShowFolders,
  onSelectFilter,
  onSelectRecentlyDeleted,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  /** Compose the className for a row, applying the active-state highlight. */
  const itemRowClass = (selected: boolean) : string =>
    `w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
      selected
        ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400'
        : 'text-gray-700 dark:text-gray-300'
    }`;

  /** Close the menu and notify the parent of the new filter. */
  const handleSelectFilter = (filter: ItemFilterType) : void => {
    setIsOpen(false);
    onSelectFilter(filter);
  };

  /** Close the menu and notify the parent that the user picked Recently Deleted. */
  const handleSelectRecentlyDeleted = () : void => {
    setIsOpen(false);
    onSelectRecentlyDeleted();
  };

  return (
    <div className="relative min-w-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-gray-900 dark:text-white text-xl hover:text-gray-700 dark:hover:text-gray-300 focus:outline-none min-w-0"
      >
        <h2 className="flex items-baseline gap-1.5 min-w-0 overflow-hidden">
          <span className="truncate">{title}</span>
          {count !== undefined && (
            <span className="text-sm text-gray-500 dark:text-gray-400 shrink-0">
              ({count})
            </span>
          )}
        </h2>
        <svg
          className="w-4 h-4 mt-1 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 top-full mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl ring-1 ring-black/5 dark:ring-white/10 z-20">
            <div className="py-1">
              <div className="relative">
                <button
                  onClick={() => handleSelectFilter('all')}
                  className={itemRowClass(activeFilter === 'all')}
                >
                  {t('items.title')}
                </button>
                {showFoldersToggle && onToggleShowFolders && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = !showFolders;
                      onToggleShowFolders(next);
                      setIsOpen(false);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    <span>{t('items.filters.folders')}</span>
                    <svg
                      className={`w-5 h-5 ${showFolders ? 'text-orange-500 dark:text-orange-400' : 'text-gray-400 dark:text-gray-500'}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      {showFolders && (
                        <polyline points="7 12 10 15 17 8" />
                      )}
                    </svg>
                  </button>
                )}
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
              {ITEM_TYPE_OPTIONS.map((option) => {
                const selected = isItemTypeFilter(activeFilter as ItemFilterType) && activeFilter === option.type;
                return (
                  <button
                    key={option.type}
                    onClick={() => handleSelectFilter(option.type)}
                    className={`${itemRowClass(selected)} flex items-center gap-2`}
                  >
                    <span className={selected ? 'text-orange-500 dark:text-orange-400' : 'text-gray-400 dark:text-gray-500'}>
                      {option.iconSvg}
                    </span>
                    {t(option.titleKey)}
                  </button>
                );
              })}
              <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
              <button
                onClick={() => handleSelectFilter('passkeys')}
                className={itemRowClass(activeFilter === 'passkeys')}
              >
                {t('common.passkeys')}
              </button>
              <button
                onClick={() => handleSelectFilter('attachments')}
                className={itemRowClass(activeFilter === 'attachments')}
              >
                {t('common.attachments')}
              </button>
              <button
                onClick={() => handleSelectFilter('totp')}
                className={itemRowClass(activeFilter === 'totp')}
              >
                {t('items.filters.totp')}
              </button>
              <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
              <button
                onClick={handleSelectRecentlyDeleted}
                className={`${itemRowClass(activeFilter === 'deleted')} flex items-center justify-between`}
              >
                <span>{t('recentlyDeleted.title')}</span>
                {recentlyDeletedCount > 0 && (
                  <span className={activeFilter === 'deleted' ? 'text-orange-500 dark:text-orange-400' : 'text-gray-400 dark:text-gray-500'}>
                    {recentlyDeletedCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ItemFilterDropdown;
