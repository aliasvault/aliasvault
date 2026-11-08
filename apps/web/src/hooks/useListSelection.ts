import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * What a list needs to drive multi-select; `T` is a list entry, `S` what the selection keeps of it.
 */
export type ListSelection<T, S> = {
  isActive: boolean;
  selection: S[];
  isSelected: (entry: T) => boolean;
  enter: (entry?: T) => void;
  exit: () => void;
  toggle: (entry: T, range: boolean) => void;
  selectAll: () => void;
  deselectAll: () => void;
};

/**
 * How selection mode was entered: `explicit` from a menu stays open at zero selected,
 * `implicit` from a modifier-click closes again once the last entry is deselected.
 */
type SelectionMode = 'off' | 'explicit' | 'implicit';

/**
 * Multi-select state for a list.
 * @param entries - the entries to select from, in list order
 * @param toSelected - what the selection keeps of an entry
 * @param keyOf - the unique key of a selected entry
 */
export function useListSelection<T, S>(entries: T[], toSelected: (entry: T) => S, keyOf: (selected: S) => string): ListSelection<T, S> {
  const [mode, setMode] = useState<SelectionMode>('off');
  const [selection, setSelection] = useState<S[]>([]);
  const anchorKeyRef = useRef<string | null>(null);

  const entryKey = useCallback((entry: T): string => keyOf(toSelected(entry)), [keyOf, toSelected]);

  // Entries that left the list (deleted, reloaded) drop out of the selection.
  const visibleSelection = useMemo(() => {
    const entryKeys = new Set(entries.map(entryKey));
    return selection.filter(selected => entryKeys.has(keyOf(selected)));
  }, [entries, entryKey, selection, keyOf]);

  const isActive = mode === 'explicit' || (mode === 'implicit' && visibleSelection.length > 0);

  const selectedKeys = useMemo(() => new Set(visibleSelection.map(keyOf)), [visibleSelection, keyOf]);

  const isSelected = useCallback((entry: T): boolean => selectedKeys.has(entryKey(entry)), [selectedKeys, entryKey]);

  const enter = useCallback((entry?: T): void => {
    setMode('explicit');
    setSelection(entry ? [toSelected(entry)] : []);
    anchorKeyRef.current = entry ? entryKey(entry) : null;
  }, [toSelected, entryKey]);

  const exit = useCallback((): void => {
    setMode('off');
    setSelection([]);
    anchorKeyRef.current = null;
  }, []);

  const toggle = useCallback((entry: T, range: boolean): void => {
    const key = entryKey(entry);
    if (!isActive) {
      setMode('implicit');
      setSelection([toSelected(entry)]);
      anchorKeyRef.current = key;
      return;
    }
    const keys = entries.map(entryKey);
    const from = anchorKeyRef.current ? keys.indexOf(anchorKeyRef.current) : -1;
    const to = keys.indexOf(key);
    if (range && from >= 0 && to >= 0) {
      // The range takes the clicked entry's new state: Shift+click on a selected entry deselects the range.
      const between = entries.slice(Math.min(from, to), Math.max(from, to) + 1).map(toSelected);
      const betweenKeys = new Set(between.map(keyOf));
      setSelection(current => (current.some(selected => keyOf(selected) === key)
        ? current.filter(selected => !betweenKeys.has(keyOf(selected)))
        : [...current, ...between.filter(candidate => !current.some(selected => keyOf(selected) === keyOf(candidate)))]));
    } else {
      setSelection(current => (current.some(selected => keyOf(selected) === key) ? current.filter(selected => keyOf(selected) !== key) : [...current, toSelected(entry)]));
    }
    anchorKeyRef.current = key;
  }, [isActive, entries, entryKey, keyOf, toSelected]);

  const selectAll = useCallback((): void => setSelection(entries.map(toSelected)), [entries, toSelected]);

  const deselectAll = useCallback((): void => setSelection([]), []);

  return { isActive, selection: visibleSelection, isSelected, enter, exit, toggle, selectAll, deselectAll };
}
