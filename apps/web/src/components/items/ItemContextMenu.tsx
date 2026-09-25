import { TRASH_RETENTION_DEFAULT_DAYS } from '@aliasvault/models/vault';
import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import FormModal from '@/components/shared/FormModal';
import { useDb } from '@/context/DbContext';
import { useNotifications } from '@/context/NotificationContext';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useVaultMutate } from '@/hooks/useVaultMutate';
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
      notifications.addSuccessMessage(t('sharedResources.DuplicateSuccessMessage'), true);
      onMutated();
    } catch (error) {
      console.error('Failed to duplicate item:', error);
      notifications.addErrorMessage(t('sharedResources.DuplicateErrorMessage'), true);
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
      notifications.addSuccessMessage(t('pages.main.items.delete.DeleteSuccessMessage'), true);
      setShowDeleteModal(false);
      onMutated();
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
        aria-label={t('sharedResources.ItemOptions')}
        aria-haspopup="menu"
        className={`px-0.5 py-1 rounded text-gray-400 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0'} group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500`}>
        <svg className="w-2 h-4" viewBox="0 0 12 24" fill="currentColor" aria-hidden="true">
          <circle cx="6" cy="5" r="2" />
          <circle cx="6" cy="12" r="2" />
          <circle cx="6" cy="19" r="2" />
        </svg>
      </button>

      {isOpen && (
        <div ref={menuRef} role="menu" style={menuStyle} className={`${position ? 'fixed' : 'absolute right-0 top-full mt-1'} z-50 w-40 py-1 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 dark:bg-gray-700`}>
          <button type="button" role="menuitem" onClick={() => navigate(itemRoute(item, true))} className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600">
            {t('sharedResources.Edit')}
          </button>
          <button type="button" role="menuitem" onClick={duplicateItem} className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600">
            {t('sharedResources.Duplicate')}
          </button>
          <button type="button" role="menuitem" onClick={() => {
            setIsOpen(false); setShowDeleteModal(true); 
          }} className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-600">
            {t('sharedResources.Delete')}
          </button>
        </div>
      )}

      <FormModal
        isOpen={showDeleteModal}
        title={t('pages.main.items.delete.DeleteItemTitle')}
        iconBackgroundClass="bg-red-100 dark:bg-red-900/30"
        confirmText={t('pages.main.items.delete.YesImSureButton')}
        cancelText={t('pages.main.items.delete.NoCancelButton')}
        confirmButtonClass="bg-red-600 hover:bg-red-700"
        isLoading={isDeleting}
        onConfirm={confirmDelete}
        onClose={() => !isDeleting && setShowDeleteModal(false)}
        icon={(
          <svg className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        )}>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          {t('pages.main.items.delete.DeleteItemDescription', { 0: TRASH_RETENTION_DEFAULT_DAYS })}
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
