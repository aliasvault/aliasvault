import { useCallback, useEffect, useState, type RefObject } from 'react';

type ActiveKind = 'item' | 'folder' | null;

interface IUseListKeyboardNavParams {
  folderCount: number;
  itemCount: number;
  searchInputRef: RefObject<HTMLInputElement | null>;
  resetKey: string | null;
  onActivateFolder: (index: number) => void;
  onActivateItem: (index: number) => void;
  onGoBack: () => void;
  onClearSearch: () => void;
}

interface IUseListKeyboardNavReturn {
  activeKind: ActiveKind;
  activeIndex: number;
  itemIdFor: (index: number) => string;
  folderIdFor: (index: number) => string;
  activeDescendantId: string | undefined;
}

const ID_PREFIX = 'kb-nav';

/**
 * Keyboard navigation for the items list:
 *   ↓ / ↑  move selection across folder pills + item cards
 *   →      open selected item / enter selected folder
 *   ←      go up one folder (ignored while typing in the search input)
 */
export const useListKeyboardNav = (params: IUseListKeyboardNavParams): IUseListKeyboardNavReturn => {
  const { folderCount, itemCount, searchInputRef, resetKey, onActivateFolder, onActivateItem, onGoBack, onClearSearch } = params;

  const [activeKind, setActiveKind] = useState<ActiveKind>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Reset selection when navigating to a new page/folder so the highlight starts fresh.
  useEffect(() => {
    setActiveKind(null);
    setActiveIndex(0);
  }, [resetKey]);

  // Clamp active selection when the underlying lists shrink (e.g. user types into search).
  useEffect(() => {
    if (activeKind === 'item') {
      if (itemCount === 0) {
        setActiveKind(null);
        setActiveIndex(0);
      } else if (activeIndex >= itemCount) {
        setActiveIndex(itemCount - 1);
      }
    } else if (activeKind === 'folder') {
      if (folderCount === 0) {
        setActiveKind(null);
        setActiveIndex(0);
      } else if (activeIndex >= folderCount) {
        setActiveIndex(folderCount - 1);
      }
    }
  }, [itemCount, folderCount, activeKind, activeIndex]);

  const itemIdFor = useCallback((index: number): string => `${ID_PREFIX}-item-${index}`, []);
  const folderIdFor = useCallback((index: number): string => `${ID_PREFIX}-folder-${index}`, []);

  useEffect(() => {
    /**
     * Move virtual selection down across folder row, then item row.
     */
    const moveDown = (): void => {
      if (activeKind === null) {
        if (folderCount > 0) {
          setActiveKind('folder');
          setActiveIndex(0);
        } else if (itemCount > 0) {
          setActiveKind('item');
          setActiveIndex(0);
        }
        return;
      }
      if (activeKind === 'folder') {
        if (activeIndex + 1 < folderCount) {
          setActiveIndex(activeIndex + 1);
        } else if (itemCount > 0) {
          setActiveKind('item');
          setActiveIndex(0);
        }
        return;
      }
      if (activeIndex + 1 < itemCount) {
        setActiveIndex(activeIndex + 1);
      }
    };

    /**
     * Move virtual selection up across item row, then folder row. At the topmost
     * selectable entry (first folder, or first item when there are no folders),
     * clear the selection and return focus to the search input.
     */
    const moveUp = (): void => {
      if (activeKind === 'item') {
        if (activeIndex - 1 >= 0) {
          setActiveIndex(activeIndex - 1);
          return;
        }
        if (folderCount > 0) {
          setActiveKind('folder');
          setActiveIndex(folderCount - 1);
          return;
        }
        setActiveKind(null);
        searchInputRef.current?.focus();
        return;
      }
      if (activeKind === 'folder') {
        if (activeIndex - 1 >= 0) {
          setActiveIndex(activeIndex - 1);
          return;
        }
        setActiveKind(null);
        searchInputRef.current?.focus();
      }
    };

    /**
     * Open the currently selected folder or item.
     */
    const activate = (): void => {
      if (activeKind === 'folder' && activeIndex < folderCount) {
        onActivateFolder(activeIndex);
      } else if (activeKind === 'item' && activeIndex < itemCount) {
        onActivateItem(activeIndex);
      }
    };

    /**
     * Document keydown handler — arrows only.
     */
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveDown();
        return;
      }
      // Enter mirrors ArrowRight; from an empty selection it opens the first item.
      if (e.key === 'Enter') {
        if (activeKind === null && itemCount > 0) {
          e.preventDefault();
          onActivateItem(0);
          return;
        }
        if (activeKind !== null) {
          e.preventDefault();
          activate();
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        /*
         * ArrowUp inside the search input with text and no list selection clears the
         * search — useful when the popup auto-prefills the search from the page URL
         * and the user wants to escape that filter without reaching for the mouse.
         */
        const searchInputForUp = searchInputRef.current;
        if (activeKind === null && e.target === searchInputForUp && (searchInputForUp?.value.length ?? 0) > 0) {
          e.preventDefault();
          onClearSearch();
          return;
        }
        e.preventDefault();
        moveUp();
        return;
      }
      /*
       * While the user is typing in search and hasn't moved into the list yet,
       * leave Left/Right alone so the text caret still works. Empty input has no
       * caret to preserve, so let the shortcut fire (e.g. ArrowLeft inside an empty
       * folder still goes back).
       */
      const searchInput = searchInputRef.current;
      if (activeKind === null && e.target === searchInput && (searchInput?.value.length ?? 0) > 0) {
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        activate();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onGoBack();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return (): void => document.removeEventListener('keydown', handleKeyDown);
  }, [folderCount, itemCount, activeKind, activeIndex, onActivateFolder, onActivateItem, onGoBack, onClearSearch, searchInputRef]);

  const activeDescendantId =
    activeKind === 'item' ? itemIdFor(activeIndex)
      : activeKind === 'folder' ? folderIdFor(activeIndex)
        : undefined;

  return {
    activeKind,
    activeIndex,
    itemIdFor,
    folderIdFor,
    activeDescendantId,
  };
};
