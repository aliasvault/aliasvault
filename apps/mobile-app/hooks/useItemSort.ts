import { useState, useMemo, useCallback } from 'react';

import type { CredentialSortOrder } from '@/utils/db/repositories/SettingsRepository';
import type { Item } from '@/utils/dist/core/models/vault';

/**
 * Sort order options with their translation keys.
 */
export const SORT_OPTIONS: { value: CredentialSortOrder; labelKey: string }[] = [
  { value: 'OldestFirst', labelKey: 'items.sort.oldestFirst' },
  { value: 'NewestFirst', labelKey: 'items.sort.newestFirst' },
  { value: 'Alphabetical', labelKey: 'items.sort.alphabetical' },
];

/**
 * Return type for the useItemSort hook.
 */
export interface UseItemSortReturn {
  /**
   * Current sort order.
   */
  sortOrder: CredentialSortOrder;
  /**
   * Set the sort order.
   */
  setSortOrder: (order: CredentialSortOrder) => void;
  /**
   * Whether the sort menu is visible.
   */
  showSortMenu: boolean;
  /**
   * Set the sort menu visibility.
   */
  setShowSortMenu: (show: boolean) => void;
  /**
   * Toggle the sort menu visibility.
   */
  toggleSortMenu: () => void;
  /**
   * Sort items based on current sort order.
   */
  sortItems: (items: Item[]) => Item[];
}

/**
 * Hook to manage item sorting state and logic.
 * Can be used by both the main items screen and folder view.
 *
 * @param initialSortOrder - Optional initial sort order (default: 'OldestFirst')
 * @returns Sort state and functions
 */
export function useItemSort(initialSortOrder: CredentialSortOrder = 'OldestFirst'): UseItemSortReturn {
  const [sortOrder, setSortOrder] = useState<CredentialSortOrder>(initialSortOrder);
  const [showSortMenu, setShowSortMenu] = useState(false);

  /**
   * Toggle sort menu visibility.
   */
  const toggleSortMenu = useCallback(() => {
    setShowSortMenu(prev => !prev);
  }, []);

  /**
   * Sort items based on current sort order.
   * Returns a new sorted array without mutating the original.
   */
  const sortItems = useCallback((items: Item[]): Item[] => {
    const itemsCopy = [...items];
    switch (sortOrder) {
      case 'NewestFirst':
        return itemsCopy.sort((a, b) =>
          new Date(b.CreatedAt || 0).getTime() - new Date(a.CreatedAt || 0).getTime()
        );
      case 'Alphabetical':
        return itemsCopy.sort((a, b) =>
          (a.Name || '').localeCompare(b.Name || '')
        );
      case 'OldestFirst':
      default:
        return itemsCopy.sort((a, b) =>
          new Date(a.CreatedAt || 0).getTime() - new Date(b.CreatedAt || 0).getTime()
        );
    }
  }, [sortOrder]);

  return {
    sortOrder,
    setSortOrder,
    showSortMenu,
    setShowSortMenu,
    toggleSortMenu,
    sortItems,
  };
}

/**
 * Hook to create memoized sorted items from filtered items.
 * This is a convenience hook that combines useItemSort's sortItems with useMemo.
 *
 * @param filteredItems - The items to sort
 * @param sortOrder - The sort order to apply
 * @returns Memoized sorted items array
 */
export function useSortedItems(filteredItems: Item[], sortOrder: CredentialSortOrder): Item[] {
  return useMemo(() => {
    const itemsCopy = [...filteredItems];
    switch (sortOrder) {
      case 'NewestFirst':
        return itemsCopy.sort((a, b) =>
          new Date(b.CreatedAt || 0).getTime() - new Date(a.CreatedAt || 0).getTime()
        );
      case 'Alphabetical':
        return itemsCopy.sort((a, b) =>
          (a.Name || '').localeCompare(b.Name || '')
        );
      case 'OldestFirst':
      default:
        return itemsCopy.sort((a, b) =>
          new Date(a.CreatedAt || 0).getTime() - new Date(b.CreatedAt || 0).getTime()
        );
    }
  }, [filteredItems, sortOrder]);
}
