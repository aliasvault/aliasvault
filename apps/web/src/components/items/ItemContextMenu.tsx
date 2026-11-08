import { TRASH_RETENTION_DEFAULT_DAYS } from '@aliasvault/models/vault';
import React, { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import ContextMenu, { MenuItem, type ContextMenuHandle } from '@/components/shared/ContextMenu';
import FormModal from '@/components/shared/FormModal';
import Icon from '@/components/shared/Icon';
import { useDb } from '@/context/DbContext';
import { useNotifications } from '@/context/NotificationContext';
import { useVaultMutate, VaultPushFailedError } from '@/hooks/useVaultMutate';
import { itemRoute } from '@/utils/ItemRoute';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';

type ItemContextMenuProps = {
  item: ItemRef;
  itemName: string | null;
  onMutated: () => void;
  hideTrigger?: boolean;
};

/**
 * Context menu of an item (right-click or its ••• button) with edit, duplicate and delete.
 */
const ItemContextMenu = forwardRef<ContextMenuHandle, ItemContextMenuProps>(({ item, itemName, onMutated, hideTrigger = false }, ref) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dbContext = useDb();
  const notifications = useNotifications();
  const { executeVaultMutationAsync } = useVaultMutate();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);

  /**
   * Duplicate the item.
   */
  const duplicateItem = async (): Promise<void> => {
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

  return (
    <div className="flex" onClick={(e) => e.stopPropagation()}>
      <ContextMenu ref={ref} renderTrigger={({ ref: triggerRef, isOpen, onClick }) => (
        <button
          ref={triggerRef}
          type="button"
          onClick={onClick}
          aria-label={t('items.contextMenu.title')}
          aria-haspopup="menu"
          className={`${hideTrigger ? 'hidden' : ''} px-0.5 py-1 rounded text-gray-400 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0'} group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500`}>
          <Icon name="dots-vertical-narrow" className="w-2 h-4" />
        </button>
      )}>
        <MenuItem icon="eye" onClick={() => navigate(itemRoute(item))}>{t('common.open')}</MenuItem>
        <MenuItem icon="pencil-alt" onClick={() => navigate(itemRoute(item, true))}>{t('common.edit')}</MenuItem>
        <MenuItem icon="document-duplicate" onClick={() => void duplicateItem()}>{t('common.duplicate')}</MenuItem>
        <MenuItem danger icon="trash" onClick={() => setShowDeleteModal(true)}>{t('common.delete')}</MenuItem>
      </ContextMenu>

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
