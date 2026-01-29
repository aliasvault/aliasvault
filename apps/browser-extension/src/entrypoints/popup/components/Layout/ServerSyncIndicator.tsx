import React from 'react';
import { useTranslation } from 'react-i18next';

import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';

/**
 * Sync status indicator component.
 * Displays status badges for offline mode and pending sync.
 */
const ServerSyncIndicator: React.FC = () => {
  const { t } = useTranslation();
  const app = useApp();
  const dbContext = useDb();

  /*
   * Only show when logged in AND vault is unlocked (dbAvailable).
   * When vault is locked, we can't sync anyway, so showing "Syncing..." is misleading.
   */
  if (!app.isLoggedIn || !dbContext.dbAvailable) {
    return null;
  }

  // Show offline indicator (with badge dot if there are pending changes)
  if (dbContext.isOffline) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-md text-xs font-medium">
        <div className="relative">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
            />
          </svg>
          {dbContext.isDirty && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full" />
          )}
        </div>
        <span>{t('common.offline')}</span>
      </div>
    );
  }

  // Show syncing indicator (downloading new vault from server)
  if (dbContext.isSyncing) {
    return (
      <div title={t('common.syncingVault')} className="flex items-center gap-1.5 px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-md text-xs font-medium">
        <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </div>
    );
  }

  // Show pending sync indicator (local changes waiting to be uploaded)
  if (dbContext.isDirty) {
    return (
      <div title={t('common.pendingSync')} className="flex items-center gap-1.5 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-md text-xs font-medium">
        <div className="relative">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-500 dark:bg-blue-400 rounded-full animate-pulse" />
        </div>
      </div>
    );
  }

  return null;
};

export default ServerSyncIndicator;
