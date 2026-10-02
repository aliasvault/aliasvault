import { TRASH_RETENTION_DEFAULT_DAYS } from '@aliasvault/models/vault';
import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import FormModal from '@/components/shared/FormModal';
import Icon from '@/components/shared/Icon';
import { useDb } from '@/context/DbContext';
import { useNotifications } from '@/context/NotificationContext';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useVaultMutate, VaultPushFailedError } from '@/hooks/useVaultMutate';
import { itemRoute } from '@/utils/ItemRoute';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';

/**
 * What a parent can ask the menu to do.
 */
export type ItemContextMenuHandle = {
  /** Open the menu at a cursor position. */
  open: (x: number, y: number) => void;
};

type ItemContextMenuProps = {
  item: ItemRef;
  itemName: string | null;
  onMutated: () => void;
};

/**
 * Ellipsis menu on an item with edit, duplicate and delete.
 */
const ItemContextMenu = forwardRef<ItemContextMenuHandle, ItemContextMenuProps>(({ item, itemName, onMutated }, ref) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dbContext = useDb();
  const notifications = useNotifications();
  const { executeVaultMutationAsync } = useVaultMutate();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  /**
   * Close the menu.
   */
  const closeMenu = useCallback((): void => setIsOpen(false), []);

  useClickOutside([menuRef, buttonRef], closeMenu, isOpen);

  useImperativeHandle(ref, () => ({
    /**
     * Open the menu at a cursor position.
     */
    open: (x: number, y: number): void => {
      setPosition({ x, y });
      setIsOpen(true);
    },
  }), []);

  /**
   * Toggle the menu from the ellipsis button.
   */
  const toggleMenu = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (isOpen) {
      closeMenu();
      return;
    }
    setPosition(null);
    setIsOpen(true);
  };

  /**
   * Duplicate the item.
   */
  const duplicateItem = async (): Promise<void> => {
    setIsOpen(false);
    if (isDuplicating || !dbContext.sqliteClient) {
      return;
    }
    setIsDuplicating(true);
    try {
      await executeVaultMutationAsync(async () => {
        await dbContext.sqliteClient!.items.duplicate(item);
      });
      notifications.addSuccessMessage(t('common.duplicateSuccessMessage'), true);
      onMutated();
    } catch (error) {
      console.error('Failed to duplicate item:', error);
      // Failed push (e.g. server not reachable).
      if (!(error instanceof VaultPushFailedError)) {
        notifications.addErrorMessage(t('common.duplicateErrorMessage'), true);
      }
    } finally {
      setIsDuplicating(false);
    }
  };

  /**
   * Move the item to the trash.
   */
  const confirmDelete = async (): Promise<void> => {
    if (isDeleting || !dbContext.sqliteClient) {
      return;
    }
    setIsDeleting(true);
    try {
      await executeVaultMutationAsync(async () => {
        await dbContext.sqliteClient!.items.trash(item);
      });
      notifications.addSuccessMessage(t('items.delete.deleteSuccessMessage'), true);
      setShowDeleteModal(false);
      onMutated();
    } catch (error) {
      // Failed push (e.g. server not reachable).
      if (!(error instanceof VaultPushFailedError)) {
        throw error;
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const menuStyle: React.CSSProperties | undefined = position ? { left: `min(${Math.round(position.x)}px, calc(100vw - 170px))`, top: `min(${Math.round(position.y)}px, calc(100vh - 140px))` } : undefined;

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleMenu}
        aria-label={t('items.contextMenu.title')}
        aria-haspopup="menu"
        className={`px-0.5 py-1 rounded text-gray-400 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0'} group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500`}>
        <Icon name="dots-vertical-narrow" className="w-2 h-4" />
      </button>

      {isOpen && (
        <div ref={menuRef} role="menu" style={menuStyle} className={`${position ? 'fixed' : 'absolute right-0 top-full mt-1'} z-50 w-40 overflow-hidden rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 dark:bg-gray-800 dark:shadow-xl dark:shadow-black/40 dark:ring-gray-600 dark:ring-opacity-100`}>
          <button type="button" role="menuitem" onClick={() => navigate(itemRoute(item, true))} className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
            {t('common.edit')}
          </button>
          <button type="button" role="menuitem" onClick={duplicateItem} className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
            {t('common.duplicate')}
          </button>
          <button type="button" role="menuitem" onClick={() => {
            setIsOpen(false); setShowDeleteModal(true); 
          }} className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700">
            {t('common.delete')}
          </button>
        </div>
      )}

      <FormModal
        isOpen={showDeleteModal}
        title={t('items.deleteItem')}
        iconBackgroundClass="bg-red-100 dark:bg-red-900/30"
        confirmText={t('items.delete.yesImSureButton')}
        cancelText={t('items.delete.noCancelButton')}
        confirmButtonClass="bg-red-600 hover:bg-red-700"
        isLoading={isDeleting}
        onConfirm={confirmDelete}
        onClose={() => !isDeleting && setShowDeleteModal(false)}
        icon={(
          <Icon name="exclamation" className="h-6 w-6 text-red-600 dark:text-red-400" />
        )}>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          {t('items.delete.deleteItemDescription', { days: TRASH_RETENTION_DEFAULT_DAYS })}
        </p>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-md p-3">
          <p className="text-sm font-medium text-gray-900 dark:text-white break-all">{itemName ?? ''}</p>
        </div>
      </FormModal>
    </div>
  );
});

ItemContextMenu.displayName = 'ItemContextMenu';

export default ItemContextMenu;
