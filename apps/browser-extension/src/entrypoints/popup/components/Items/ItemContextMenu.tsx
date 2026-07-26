import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

type ItemContextMenuProps = {
  position: { x: number; y: number };
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

const MENU_WIDTH = 160;
const MENU_HEIGHT = 120;

/**
 * Context menu with actions for a single item in the items list.
 * Opened via right-click on an item row or via the row's ellipsis button.
 */
const ItemContextMenu: React.FC<ItemContextMenuProps> = ({ position, onClose, onEdit, onDuplicate, onDelete }) => {
  const { t } = useTranslation();

  // Close on Escape while the menu is open.
  useEffect(() => {
    /**
     * Close the menu when Escape is pressed.
     */
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return (): void => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const left = Math.max(8, Math.min(position.x, window.innerWidth - MENU_WIDTH - 8));
  const top = Math.max(8, Math.min(position.y, window.innerHeight - MENU_HEIGHT - 8));

  const itemClass = 'w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700';

  /**
   * Close the menu, then run the given action.
   */
  const runAction = (action: () => void) => (): void => {
    onClose();
    action();
  };

  return (
    <>
      <div
        className="fixed inset-0 z-30"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        role="menu"
        style={{ top, left }}
        className="fixed z-40 w-40 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg"
      >
        <button role="menuitem" onClick={runAction(onEdit)} className={itemClass}>
          {t('common.edit')}
        </button>
        <button role="menuitem" onClick={runAction(onDuplicate)} className={itemClass}>
          {t('common.duplicate')}
        </button>
        <button role="menuitem" onClick={runAction(onDelete)} className={`${itemClass} text-red-600 dark:text-red-400`}>
          {t('common.delete')}
        </button>
      </div>
    </>
  );
};

export default ItemContextMenu;
