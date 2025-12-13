import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';

import type { Item } from '@/utils/dist/core/models/vault';

import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';

/**
 * Calculate days remaining until permanent deletion.
 * @param deletedAt - ISO timestamp when item was deleted
 * @param retentionDays - Number of days to retain (default 30)
 * @returns Number of days remaining, or 0 if already expired
 */
const getDaysRemaining = (deletedAt: string, retentionDays: number = 30): number => {
  const deletedDate = new Date(deletedAt);
  const expiryDate = new Date(deletedDate.getTime() + retentionDays * 24 * 60 * 60 * 1000);
  const now = new Date();
  const daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, daysRemaining);
};

/**
 * Recently Deleted page - shows items in trash that can be restored or permanently deleted.
 */
const RecentlyDeleted: React.FC = () => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const { executeVaultMutationAsync } = useVaultMutate();
  const { setHeaderButtons } = useHeaderButtons();
  const [items, setItems] = useState<Item[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [showConfirmEmptyAll, setShowConfirmEmptyAll] = useState(false);

  /**
   * Loading state with minimum duration for more fluid UX.
   */
  const [isLoading, setIsLoading] = useMinDurationLoading(true, 100);

  /**
   * Load recently deleted items.
   */
  const loadItems = useCallback(() => {
    if (dbContext?.sqliteClient) {
      const results = dbContext.sqliteClient.getRecentlyDeletedItems();
      setItems(results);
    }
  }, [dbContext?.sqliteClient]);

  /**
   * Restore an item from Recently Deleted.
   */
  const handleRestore = useCallback(async (itemId: string) => {
    if (!dbContext?.sqliteClient) {
      return;
    }

    await executeVaultMutationAsync(async () => {
      await dbContext.sqliteClient!.restoreItem(itemId);
    });

    loadItems();
  }, [dbContext?.sqliteClient, executeVaultMutationAsync, loadItems]);

  /**
   * Permanently delete an item.
   */
  const handlePermanentDelete = useCallback(async (itemId: string) => {
    if (!dbContext?.sqliteClient) {
      return;
    }

    await executeVaultMutationAsync(async () => {
      await dbContext.sqliteClient!.permanentlyDeleteItem(itemId);
    });

    loadItems();
    setShowConfirmDelete(false);
    setSelectedItemId(null);
  }, [dbContext?.sqliteClient, executeVaultMutationAsync, loadItems]);

  /**
   * Empty all items from Recently Deleted (permanent delete all).
   */
  const handleEmptyAll = useCallback(async () => {
    if (!dbContext?.sqliteClient) {
      return;
    }

    await executeVaultMutationAsync(async () => {
      for (const item of items) {
        await dbContext.sqliteClient!.permanentlyDeleteItem(item.Id);
      }
    });

    loadItems();
    setShowConfirmEmptyAll(false);
  }, [dbContext?.sqliteClient, executeVaultMutationAsync, items, loadItems]);

  // Clear header buttons on mount
  useEffect((): (() => void) => {
    setHeaderButtons(null);
    return () => setHeaderButtons(null);
  }, [setHeaderButtons]);

  // Load items on mount and when sqlite client changes
  useEffect(() => {
    /**
     * Load items from database.
     */
    const load = async (): Promise<void> => {
      if (dbContext?.sqliteClient) {
        setIsLoading(true);
        loadItems();
        setIsLoading(false);
      }
    };

    load();
  }, [dbContext?.sqliteClient, setIsLoading, loadItems]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-8">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="flex items-baseline gap-1.5 text-gray-900 dark:text-white text-xl">
          {t('recentlyDeleted.title')}
          <span className="text-sm text-gray-500 dark:text-gray-400">({items.length})</span>
        </h2>
        {items.length > 0 && (
          <button
            onClick={() => setShowConfirmEmptyAll(true)}
            className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
          >
            {t('recentlyDeleted.emptyAll')}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-gray-500 dark:text-gray-400 space-y-2 mb-10">
          <p>{t('recentlyDeleted.noItems')}</p>
          <p className="text-sm">{t('recentlyDeleted.noItemsDescription')}</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {t('recentlyDeleted.description')}
          </p>

          <ul className="space-y-2">
            {items.map(item => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const deletedAt = (item as any).DeletedAt;
              const daysRemaining = deletedAt ? getDaysRemaining(deletedAt) : 30;

              return (
                <li key={item.Id} className="relative">
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <div className="flex items-start gap-3">
                      {/* Item card content (simplified) */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {item.Logo && (
                            <img
                              src={`data:image/png;base64,${btoa(String.fromCharCode(...item.Logo))}`}
                              alt=""
                              className="w-6 h-6 rounded"
                            />
                          )}
                          <span className="font-medium text-gray-900 dark:text-white truncate">
                            {item.Name || t('recentlyDeleted.untitledItem')}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {daysRemaining > 0 ? (
                            t('recentlyDeleted.daysRemaining', { count: daysRemaining })
                          ) : (
                            <span className="text-red-500">{t('recentlyDeleted.expiringSoon')}</span>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleRestore(item.Id)}
                          className="px-3 py-1 text-sm bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded hover:bg-green-200 dark:hover:bg-green-900/50"
                        >
                          {t('recentlyDeleted.restore')}
                        </button>
                        <button
                          onClick={() => {
                            setSelectedItemId(item.Id);
                            setShowConfirmDelete(true);
                          }}
                          className="px-3 py-1 text-sm bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50"
                        >
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

      {/* Confirm Delete Modal */}
      {showConfirmDelete && selectedItemId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm mx-4">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {t('recentlyDeleted.confirmDeleteTitle')}
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              {t('recentlyDeleted.confirmDeleteMessage')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowConfirmDelete(false);
                  setSelectedItemId(null);
                }}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handlePermanentDelete(selectedItemId)}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
              >
                {t('recentlyDeleted.deletePermanently')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Empty All Modal */}
      {showConfirmEmptyAll && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm mx-4">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {t('recentlyDeleted.confirmEmptyAllTitle')}
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              {t('recentlyDeleted.confirmEmptyAllMessage', { count: items.length })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowConfirmEmptyAll(false)}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleEmptyAll}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
              >
                {t('recentlyDeleted.emptyAll')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RecentlyDeleted;
