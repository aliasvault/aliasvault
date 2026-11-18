import { useState, useMemo, useCallback } from 'react';

import { CredentialSortOrder } from '@aliasvault/client/database/repositories/SettingsRepository';
import { recencyGroupStarts, sortItems, type RecencyGroup } from '@aliasvault/client/items/ItemSort';
import type { Item } from '@aliasvault/models/vault';

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
}

/**
 * Hook to manage item sorting state.
 * Can be used by both the main items screen and folder view.
 *
 * @param initialSortOrder - Optional initial sort order (default: NewestFirst)
 * @returns Sort state and functions
 */
export function useItemSort(initialSortOrder: CredentialSortOrder = CredentialSortOrder.NewestFirst): UseItemSortReturn {
  const [sortOrder, setSortOrder] = useState<CredentialSortOrder>(initialSortOrder);
  const [showSortMenu, setShowSortMenu] = useState(false);

  /**
   * Toggle sort menu visibility.
   */
  const toggleSortMenu = useCallback(() => {
    setShowSortMenu(prev => !prev);
  }, []);

  return {
    sortOrder,
    setSortOrder,
    showSortMenu,
    setShowSortMenu,
    toggleSortMenu,
  };
}

/**
 * Hook to create memoized sorted items from filtered items.
 *
 * @param filteredItems - The items to sort
 * @param sortOrder - The sort order to apply
 * @returns Memoized sorted items array
 */
export function useSortedItems<T extends Item>(filteredItems: T[], sortOrder: CredentialSortOrder): T[] {
  return useMemo(() => sortItems(filteredItems, sortOrder), [filteredItems, sortOrder]);
}

/**
 * Hook for the date group header above each sorted item that starts one, when sorted on last use.
 *
 * @param sortedItems - The sorted items
 * @param sortOrder - The sort order they are in
 * @returns Per item, the group it starts or null, or null when the order has no groups
 */
export function useRecencyGroupStarts(sortedItems: Item[], sortOrder: CredentialSortOrder): (RecencyGroup | null)[] | null {
  return useMemo(() => recencyGroupStarts(sortedItems, sortOrder, item => item), [sortedItems, sortOrder]);
}
