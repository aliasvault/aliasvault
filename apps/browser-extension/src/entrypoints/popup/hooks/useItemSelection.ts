import { isSameItem, scopedKey } from '@aliasvault/client/database/ItemRef';
import { toSelectedItem, toggleSelectedItem, type SelectedItem } from '@aliasvault/client/items/BulkItemActions';
import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Item selection state and actions.
 */
export type ItemSelection = {
  isActive: boolean;
  selection: SelectedItem[];
  isSelected: (item: SelectedItem) => boolean;
  enter: (item?: SelectedItem) => void;
  exit: () => void;
  toggle: (item: SelectedItem, range: boolean) => void;
  selectAll: () => void;
  deselectAll: () => void;
};

/**
 * Multi-select state list of items.
 * @param items - the items to select from
 */
export function useItemSelection(items: SelectedItem[]): ItemSelection {
  const [isActive, setIsActive] = useState(false);
  const [selection, setSelection] = useState<SelectedItem[]>([]);
  const anchorRef = useRef<SelectedItem | null>(null);

  const selectedKeys = useMemo(() => new Set(selection.map(item => scopedKey(item.ManifestId, item.Id))), [selection]);

  const isSelected = useCallback((item: SelectedItem): boolean => selectedKeys.has(scopedKey(item.ManifestId, item.Id)), [selectedKeys]);

  const enter = useCallback((item?: SelectedItem): void => {
    setIsActive(true);
    setSelection(item ? [toSelectedItem(item)] : []);
    anchorRef.current = item ?? null;
  }, []);

  const exit = useCallback((): void => {
    setIsActive(false);
    setSelection([]);
    anchorRef.current = null;
  }, []);

  const toggle = useCallback((item: SelectedItem, range: boolean): void => {
    setIsActive(true);
    const anchor = anchorRef.current;
    const from = anchor ? items.findIndex(candidate => isSameItem(candidate, anchor)) : -1;
    const to = items.findIndex(candidate => isSameItem(candidate, item));
    if (range && from >= 0 && to >= 0) {
      // The range takes the clicked item's new state: Shift+click on a selected item deselects the range.
      const between = items.slice(Math.min(from, to), Math.max(from, to) + 1);
      setSelection(current => (current.some(selected => isSameItem(selected, item))
        ? current.filter(selected => !between.some(entry => isSameItem(entry, selected)))
        : [...current, ...between.filter(candidate => !current.some(selected => isSameItem(selected, candidate))).map(toSelectedItem)]));
    } else {
      setSelection(current => toggleSelectedItem(current, toSelectedItem(item)));
    }
    anchorRef.current = item;
  }, [items]);

  const selectAll = useCallback((): void => setSelection(items.map(toSelectedItem)), [items]);

  const deselectAll = useCallback((): void => setSelection([]), []);

  return { isActive, selection, isSelected, enter, exit, toggle, selectAll, deselectAll };
}
