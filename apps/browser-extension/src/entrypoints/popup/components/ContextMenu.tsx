import { type UiIconName } from '@aliasvault/models/icons';
import React, { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

/**
 * What a parent can ask the menu to do.
 */
export type ContextMenuHandle = {
  open: (x: number, y: number) => void;
};

/**
 * What a custom trigger button gets to render with.
 */
export type ContextMenuTriggerProps = {
  isOpen: boolean;
  onClick: (e: React.MouseEvent) => void;
};

type ContextMenuProps = {
  children: React.ReactNode;
  renderTrigger?: (props: ContextMenuTriggerProps) => React.ReactNode;
  widthClass?: string;
};

/** Distance kept between a right-click menu and the popup edge. */
const VIEWPORT_MARGIN_PX = 8;

const MenuCloseContext = createContext<() => void>(() => {});

/**
 * Context menu, opened at the cursor on right-click or below its own trigger button; entries close it when picked.
 */
const ContextMenu = forwardRef<ContextMenuHandle, ContextMenuProps>(({ children, renderTrigger, widthClass = 'w-40' }, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * Close the menu.
   */
  const close = useCallback((): void => setIsOpen(false), []);

  useImperativeHandle(ref, () => ({
    /**
     * Open the menu at a cursor position.
     */
    open: (x: number, y: number): void => {
      setPosition({ x, y });
      setIsOpen(true);
    },
  }), []);

  // Keep a right-click menu inside the popup.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!isOpen || !position || !menu) {
      return;
    }
    const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(position.x, window.innerWidth - menu.offsetWidth - VIEWPORT_MARGIN_PX));
    const top = Math.max(VIEWPORT_MARGIN_PX, Math.min(position.y, window.innerHeight - menu.offsetHeight - VIEWPORT_MARGIN_PX));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }, [isOpen, position]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    /**
     * Escape closes the menu.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return (): void => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, close]);

  /**
   * Toggle the menu from its trigger button.
   */
  const toggleFromTrigger = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setPosition(null);
    setIsOpen(open => !open);
  };

  return (
    <div className="relative flex" onClick={(e) => e.stopPropagation()}>
      {renderTrigger?.({ isOpen, onClick: toggleFromTrigger })}
      {isOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={close} onContextMenu={(e) => {
            e.preventDefault(); e.stopPropagation(); close();
          }} />
          <div ref={menuRef} role="menu" className={`${position ? 'fixed' : 'absolute right-0 top-full mt-1'} z-40 ${widthClass} overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg`}>
            <MenuCloseContext.Provider value={close}>
              {children}
            </MenuCloseContext.Provider>
          </div>
        </>
      )}
    </div>
  );
});

ContextMenu.displayName = 'ContextMenu';

const itemClass = 'w-full flex items-center gap-2 px-4 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700';

type MenuItemProps = {
  children: React.ReactNode;
  onClick: () => void;
  icon?: UiIconName;
  danger?: boolean;
  /** An entry outside any group, with a bit more padding to stand apart from the headed groups. */
  standalone?: boolean;
  id?: string;
};

/**
 * A menu entry that closes the menu and runs its action.
 */
export const MenuItem: React.FC<MenuItemProps> = ({ children, onClick, icon, danger = false, standalone = false, id }) => {
  const close = useContext(MenuCloseContext);
  return (
    <button type="button" role="menuitem" id={id} onClick={() => {
      close(); onClick();
    }} className={`${itemClass} ${standalone ? 'py-2.5' : 'py-2'} ${danger ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}>
      {icon && <Icon name={icon} className="w-4 h-4" />}
      {children}
    </button>
  );
};

type MenuRadioItemProps = {
  children: React.ReactNode;
  checked: boolean;
  onClick: () => void;
};

/**
 * One option of a choice in a menu, with a check in front of the chosen one.
 */
export const MenuRadioItem: React.FC<MenuRadioItemProps> = ({ children, checked, onClick }) => {
  const close = useContext(MenuCloseContext);
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} onClick={() => {
      close(); onClick();
    }} className={`${itemClass} py-2 ${checked ? 'text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300'}`}>
      {checked ? <Icon name="check" className="w-4 h-4" /> : <span className="w-4" />}
      {children}
    </button>
  );
};

/**
 * Small heading above a group of menu entries.
 */
export const MenuHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-4 pt-2 pb-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">{children}</div>
);

/**
 * Line between groups of menu entries.
 */
export const MenuSeparator: React.FC = () => <div role="separator" className="h-px bg-gray-200 dark:bg-gray-600" />;

export default ContextMenu;
