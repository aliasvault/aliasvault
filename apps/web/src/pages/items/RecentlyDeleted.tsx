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
import PageContent from '@/components/shared/PageContent';
import PageHeader from '@/components/shared/PageHeader';
import { useDb } from '@/context/DbContext';
import { useNotifications } from '@/context/NotificationContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVaultMutate } from '@/hooks/useVaultMutate';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';
import type { ItemWithDeletedAt } from '@aliasvault/client/database/mappers/ItemMapper';
import type { ItemFilterType } from '@aliasvault/client/items/ItemFilters';

const tk = 'pages.main.items.recentlyDeleted';

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
  <svg className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
  </svg>
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
  usePageTitle(t(`${tk}.PageTitle`));

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
      notifications.addSuccessMessage(t(`${tk}.RestoreSuccess`));
      navigate('/items');
    } catch (error) {
      console.error('Failed to restore item:', error);
      notifications.addErrorMessage(t(`${tk}.RestoreFailed`), true);
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
      notifications.addSuccessMessage(t(`${tk}.DeleteSuccess`));
    } catch (error) {
      console.error('Failed to delete item:', error);
      notifications.addErrorMessage(t(`${tk}.DeleteFailed`), true);
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
        notifications.addErrorMessage(t(`${tk}.EmptyAllPartialFailed`, { 0: failed }), true);
      } else {
        notifications.addSuccessMessage(t(`${tk}.EmptyAllSuccess`));
      }
    } catch (error) {
      console.error('Failed to empty the trash:', error);
      notifications.addErrorMessage(t(`${tk}.DeleteFailed`), true);
    } finally {
      setIsBusy(false);
      setShowEmptyAllModal(false);
      loadItems();
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbItems={[{ displayName: t('pages.main.items.home.PageTitle'), url: '/items' }, { displayName: t(`${tk}.PageTitle`) }]}
        title={t(`${tk}.PageTitle`)}
        description={t(`${tk}.PageDescription`)}
        titleActions={(
          <ItemFilterDropdown
            title={t(`${tk}.PageTitle`)}
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
            {t(`${tk}.EmptyAll`)}
          </button>
        )}
      />

      {isLoading ? (
        <LoadingIndicator />
      ) : (
        <PageContent className="mx-4">
          <div className="p-4 mb-4 bg-white border border-gray-200 rounded-lg shadow-sm dark:border-gray-700 dark:bg-gray-800">
            {items.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400">{t(`${tk}.NoItems`)}</p>
            ) : (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t(`${tk}.Description`)}</p>
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
                                <span data-item-name className="font-medium text-gray-900 dark:text-white truncate">{item.Name || t(`${tk}.Untitled`)}</span>
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {daysRemaining > 0 ? t(`${tk}.DaysRemaining`, { 0: daysRemaining }) : <span className="text-red-500">{t(`${tk}.ExpiringSoon`)}</span>}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <button type="button" data-action="restore" disabled={isBusy} onClick={() => void restoreItem(item)} className="px-3 py-1 text-sm bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded hover:bg-green-200 dark:hover:bg-green-900/50 disabled:opacity-50">
                                {t(`${tk}.Restore`)}
                              </button>
                              <button type="button" data-action="delete" disabled={isBusy} onClick={() => setItemToDelete({ Id: item.Id, ManifestId: item.ManifestId })} className="px-3 py-1 text-sm bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50">
                                {t('sharedResources.Delete')}
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
        title={t(`${tk}.ConfirmDeleteTitle`)}
        icon={<DeleteIcon />}
        iconBackgroundClass="bg-red-100 dark:bg-red-900/30"
        confirmText={t(`${tk}.DeletePermanently`)}
        cancelText={t('sharedResources.Cancel')}
        confirmButtonClass="bg-red-600 hover:bg-red-700"
        isLoading={isBusy}
        onConfirm={() => void confirmDelete()}
        onClose={() => !isBusy && setItemToDelete(null)}>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t(`${tk}.ConfirmDeleteMessage`)}</p>
      </FormModal>

      <FormModal
        isOpen={showEmptyAllModal}
        title={t(`${tk}.ConfirmEmptyAllTitle`)}
        icon={<DeleteIcon />}
        iconBackgroundClass="bg-red-100 dark:bg-red-900/30"
        confirmText={t(`${tk}.EmptyAll`)}
        cancelText={t('sharedResources.Cancel')}
        confirmButtonClass="bg-red-600 hover:bg-red-700"
        isLoading={isBusy}
        onConfirm={() => void confirmEmptyAll()}
        onClose={() => !isBusy && setShowEmptyAllModal(false)}>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t(`${tk}.ConfirmEmptyAllMessage`, { 0: items.length })}</p>
      </FormModal>
    </>
  );
};

export default RecentlyDeleted;
