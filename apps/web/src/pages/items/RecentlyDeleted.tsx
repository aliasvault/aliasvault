import { scopedKey } from '@aliasvault/client/database/ItemRef';
import { fromStandardFormat } from '@aliasvault/client/utilities/DateFormatter';
import { TRASH_RETENTION_DEFAULT_DAYS } from '@aliasvault/models/vault';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import ItemFilterDropdown from '@/components/items/ItemFilterDropdown';
import ItemIcon from '@/components/items/ItemIcon';
import LoadingIndicator from '@/components/loading/LoadingIndicator';
import FormModal from '@/components/shared/FormModal';
import Icon from '@/components/shared/Icon';
import PageContent from '@/components/shared/PageContent';
import PageHeader from '@/components/shared/PageHeader';
import Text from '@/components/shared/Text';
import { useDb } from '@/context/DbContext';
import { useNotifications } from '@/context/NotificationContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVaultMutate } from '@/hooks/useVaultMutate';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';
import type { ItemWithDeletedAt } from '@aliasvault/client/database/mappers/ItemMapper';
import type { ItemFilterType } from '@aliasvault/client/items/ItemFilters';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days left before a trashed item is purged.
 * @param deletedAt - the stored UTC DeletedAt timestamp
 */
const getDaysRemaining = (deletedAt: string | undefined): number => {
  if (!deletedAt) {
    return TRASH_RETENTION_DEFAULT_DAYS;
  }
  const expiresAt = fromStandardFormat(deletedAt).getTime() + TRASH_RETENTION_DEFAULT_DAYS * DAY_MS;
  return Math.max(0, Math.floor((expiresAt - Date.now()) / DAY_MS));
};

/**
 * Red warning icon of the delete confirmations.
 */
const DeleteIcon: React.FC = () => (
  <Icon name="exclamation" className="h-6 w-6 text-red-600 dark:text-red-400" />
);

/**
 * Recently deleted items: restore them, or delete them permanently before the retention period ends.
 */
const RecentlyDeleted: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dbContext = useDb();
  const notifications = useNotifications();
  const { executeVaultMutationAsync } = useVaultMutate();
  usePageTitle(t('items.recentlyDeleted.title'));

  const [items, setItems] = useState<ItemWithDeletedAt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<ItemRef | null>(null);
  const [showEmptyAllModal, setShowEmptyAllModal] = useState(false);

  /**
   * Read the trashed items from the local vault.
   */
  const loadItems = useCallback((): void => {
    const client = dbContext.sqliteClient;
    if (!client) {
      return;
    }
    setItems(client.items.getRecentlyDeleted());
    setIsLoading(false);
  }, [dbContext.sqliteClient]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  /**
   * Take an item out of the trash and go back to the vault.
   */
  const restoreItem = async (item: ItemRef): Promise<void> => {
    const client = dbContext.sqliteClient;
    if (!client || isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      await executeVaultMutationAsync(async () => {
        await client.items.restore(item);
      });
      notifications.addSuccessMessage(t('items.trash.restoreSuccess'));
      navigate('/items');
    } catch (error) {
      console.error('Failed to restore item:', error);
      notifications.addErrorMessage(t('items.trash.restoreFailed'), true);
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Permanently delete the item picked in the confirmation.
   */
  const confirmDelete = async (): Promise<void> => {
    const client = dbContext.sqliteClient;
    if (!client || !itemToDelete) {
      return;
    }
    setIsBusy(true);
    try {
      await executeVaultMutationAsync(async () => {
        await client.items.permanentlyDelete(itemToDelete);
      });
      notifications.addSuccessMessage(t('items.recentlyDeleted.itemDeleted'));
    } catch (error) {
      console.error('Failed to delete item:', error);
      notifications.addErrorMessage(t('items.trash.deleteFailed'), true);
    } finally {
      setIsBusy(false);
      setItemToDelete(null);
      loadItems();
    }
  };

  /**
   * Permanently delete every trashed item in one vault write.
   */
  const confirmEmptyAll = async (): Promise<void> => {
    const client = dbContext.sqliteClient;
    if (!client) {
      return;
    }
    setIsBusy(true);
    let failed = 0;
    try {
      await executeVaultMutationAsync(async () => {
        for (const item of items) {
          try {
            await client.items.permanentlyDelete(item);
          } catch (error) {
            console.error('Failed to delete item:', error);
            failed++;
          }
        }
      });
      if (failed > 0) {
        notifications.addErrorMessage(t('items.trash.emptyAllPartialFailed', { count: failed }), true);
      } else {
        notifications.addSuccessMessage(t('items.recentlyDeleted.allItemsDeleted'));
      }
    } catch (error) {
      console.error('Failed to empty the trash:', error);
      notifications.addErrorMessage(t('items.trash.deleteFailed'), true);
    } finally {
      setIsBusy(false);
      setShowEmptyAllModal(false);
      loadItems();
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbItems={[{ displayName: t('navigation.vault'), url: '/items' }, { displayName: t('items.recentlyDeleted.title') }]}
        title={t('items.recentlyDeleted.title')}
        description={t('items.trash.pageDescription')}
        titleActions={(
          <ItemFilterDropdown
            title={t('items.recentlyDeleted.title')}
            count={items.length}
            activeFilter={null}
            isRecentlyDeletedActive={true}
            recentlyDeletedCount={items.length}
            showFoldersToggle={false}
            showFolders={false}
            onSelectFilter={(filter: ItemFilterType) => navigate(`/items?filter=${filter}`)}
            onSelectRecentlyDeleted={() => undefined}
            onToggleShowFolders={() => undefined}
          />
        )}
        customActions={items.length > 0 && (
          <button type="button" onClick={() => setShowEmptyAllModal(true)} className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">
            {t('items.trash.emptyAll')}
          </button>
        )}
      />

      {isLoading ? (
        <LoadingIndicator />
      ) : (
        <PageContent className="mx-4">
          <div className="p-4 mb-4 bg-white border border-gray-200 rounded-lg shadow-sm dark:border-gray-700 dark:bg-gray-800">
            {items.length === 0 ? (
              <Text variant="muted">{t('items.trash.noItems')}</Text>
            ) : (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t('items.trash.description')}</p>
                <ul className="space-y-2">
                  {items.map(item => {
                    const daysRemaining = getDaysRemaining(item.DeletedAt);
                    return (
                      <li key={scopedKey(item.ManifestId, item.Id)} data-item="deleted" className="relative">
                        <div className="bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-3">
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <ItemIcon item={item} sizeClass="w-6 h-6" />
                                <span data-item-name className="font-medium text-gray-900 dark:text-white truncate">{item.Name || t('items.untitled')}</span>
                              </div>
                              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                {daysRemaining > 0 ? t('items.trash.daysRemaining', { days: daysRemaining }) : <span className="text-red-500">{t('items.recentlyDeleted.expiringSoon')}</span>}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <button type="button" data-action="restore" disabled={isBusy} onClick={() => void restoreItem(item)} className="px-3 py-1 text-sm bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded hover:bg-green-200 dark:hover:bg-green-900/50 disabled:opacity-50">
                                {t('items.recentlyDeleted.restore')}
                              </button>
                              <button type="button" data-action="delete" disabled={isBusy} onClick={() => setItemToDelete({ Id: item.Id, ManifestId: item.ManifestId })} className="px-3 py-1 text-sm bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50">
                                {t('common.delete')}
                              </button>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </PageContent>
      )}

      <FormModal
        isOpen={itemToDelete !== null}
        title={t('items.trash.confirmDeleteTitle')}
        icon={<DeleteIcon />}
        iconBackgroundClass="bg-red-100 dark:bg-red-900/30"
        confirmText={t('items.recentlyDeleted.deletePermanently')}
        cancelText={t('common.cancel')}
        confirmButtonClass="bg-red-600 hover:bg-red-700"
        isLoading={isBusy}
        onConfirm={() => void confirmDelete()}
        onClose={() => !isBusy && setItemToDelete(null)}>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('items.trash.confirmDeleteMessage')}</p>
      </FormModal>

      <FormModal
        isOpen={showEmptyAllModal}
        title={t('items.trash.confirmEmptyAllTitle')}
        icon={<DeleteIcon />}
        iconBackgroundClass="bg-red-100 dark:bg-red-900/30"
        confirmText={t('items.trash.emptyAll')}
        cancelText={t('common.cancel')}
        confirmButtonClass="bg-red-600 hover:bg-red-700"
        isLoading={isBusy}
        onConfirm={() => void confirmEmptyAll()}
        onClose={() => !isBusy && setShowEmptyAllModal(false)}>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('items.trash.confirmEmptyAllMessage', { count: items.length })}</p>
      </FormModal>
    </>
  );
};

export default RecentlyDeleted;
