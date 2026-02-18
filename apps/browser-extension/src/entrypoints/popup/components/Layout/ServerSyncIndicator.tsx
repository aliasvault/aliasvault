import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { sendMessage } from 'webext-bridge/popup';

import type { FullVaultSyncResult } from '@/entrypoints/background/VaultMessageHandler';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';

/**
 * Minimum time (ms) to show the syncing indicator.
 * Ensures user sees confirmation that a new vault was downloaded.
 */
const MIN_SYNC_DISPLAY_TIME = 1000;

/**
 * Sync status indicator component.
 * Displays clickable status badges for offline mode, syncing, and pending sync.
 *
 * Priority order (highest to lowest):
 * 1. Offline (amber) - network unavailable, clickable to retry
 * 2. Syncing (green spinner) - downloading new vault (minimum display time)
 * 3. Uploading (blue spinner) - uploading local changes to server
 * 4. Pending (blue pulsing) - local changes waiting to be uploaded, clickable to retry
 * 5. Hidden - when synced
 *
 * Note: The syncing indicator only appears when actually downloading a new vault,
 * not during routine checks where nothing changed.
 */
const ServerSyncIndicator: React.FC = () => {
  const { t } = useTranslation();
  const app = useApp();
  const dbContext = useDb();
  const [isRetrying, setIsRetrying] = useState(false);

  // Track syncing state with minimum display time
  const [showSyncing, setShowSyncing] = useState(false);
  const syncStartTimeRef = useRef<number | null>(null);

  /**
   * Handle syncing state changes with minimum display time.
   * When syncing starts, show indicator immediately.
   * When syncing ends, wait until minimum time has passed.
   */
  useEffect(() => {
    if (dbContext.isSyncing) {
      // Sync started - show immediately and record start time
      setShowSyncing(true);
      syncStartTimeRef.current = Date.now();
    } else if (syncStartTimeRef.current !== null) {
      // Sync ended - wait for minimum display time
      const elapsed = Date.now() - syncStartTimeRef.current;
      const remaining = MIN_SYNC_DISPLAY_TIME - elapsed;

      if (remaining > 0) {
        const timer = setTimeout((): void => {
          setShowSyncing(false);
          syncStartTimeRef.current = null;
        }, remaining);
        return (): void => {
          clearTimeout(timer);
        };
      } else {
        setShowSyncing(false);
        syncStartTimeRef.current = null;
      }
    }
  }, [dbContext.isSyncing]);

  /**
   * Handle tap to force sync retry.
   */
  const handleRetry = useCallback(async (): Promise<void> => {
    if (isRetrying) {
      return;
    }

    setIsRetrying(true);

    // If we have local changes, show uploading indicator
    if (dbContext.isDirty) {
      dbContext.setIsUploading(true);
    }

    try {
      const result = await sendMessage('FULL_VAULT_SYNC', {}, 'background') as FullVaultSyncResult;

      // Handle logout requirement
      if (result.requiresLogout) {
        const errorMessage = result.errorKey
          ? t('common.errors.' + result.errorKey)
          : result.error;
        await app.logout(errorMessage);
        return;
      }

      // Update offline state based on result
      if (result.wasOffline) {
        await dbContext.setIsOffline(true);
      } else if (dbContext.isOffline) {
        // We were offline but now succeeded
        await dbContext.setIsOffline(false);
      }

      // Reload database if we got a new vault
      if (result.hasNewVault) {
        await dbContext.loadStoredDatabase();
      }

      await dbContext.refreshSyncState();
    } catch (error) {
      console.error('Retry sync error:', error);
    } finally {
      setIsRetrying(false);
      dbContext.setIsUploading(false);
    }
  }, [isRetrying, dbContext, app, t]);

  /*
   * Only show when logged in AND vault is unlocked (dbAvailable).
   * When vault is locked, we can't sync anyway, so showing indicator is misleading.
   */
  if (!app.isLoggedIn || !dbContext.dbAvailable) {
    return null;
  }

  // Priority 1: Offline indicator (clickable to retry) - keep text for important context
  if (dbContext.isOffline) {
    return (
      <button
        onClick={handleRetry}
        disabled={isRetrying}
        className="flex items-center gap-1.5 px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-md text-xs font-medium cursor-pointer hover:opacity-80 active:opacity-60 transition-colors"
        title={t('sync.tapToRetry')}
      >
        <div className="relative">
          {isRetrying ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          ) : (
            <>
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
            </>
          )}
        </div>
        <span>{t('sync.offline')}</span>
      </button>
    );
  }

  /*
   * Priority 2: Syncing indicator (not clickable, shows progress)
   * Only shown when actually downloading a new vault, with minimum display time
   */
  if (showSyncing) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-md text-xs font-medium"
        title={t('common.syncingVault')}
      >
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

  // Priority 3: Uploading indicator (not clickable, shows progress)
  if (dbContext.isUploading) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-md text-xs font-medium"
      >
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

  // Priority 4: Pending indicator (clickable to force sync) - icon only
  if (dbContext.isDirty) {
    return (
      <button
        onClick={handleRetry}
        disabled={isRetrying}
        className="flex items-center gap-1.5 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-md text-xs font-medium cursor-pointer hover:opacity-80 active:opacity-60 transition-colors"
        title={t('sync.tapToRetry')}
      >
        {isRetrying ? (
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        ) : (
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
        )}
      </button>
    );
  }

  return null;
};

export default ServerSyncIndicator;
