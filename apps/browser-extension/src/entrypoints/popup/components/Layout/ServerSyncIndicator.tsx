import { syncErrorMessage } from '@aliasvault/client/sync/SyncErrorMessage';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/entrypoints/popup/components/Icons/Icon';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';

import { logFailure } from '@/utils/Diagnostics';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';

/**
 * Minimum time (ms) an in-flight indicator stays visible once it has appeared.
 * A sync that resolves in tens of milliseconds would otherwise flicker the badge, so we hold it just long enough
 * to register as a state rather than a flicker. This also bridges the short idle gap between two chained syncs,
 * which would otherwise flicker the badge off and straight back on.
 */
const MIN_SYNC_DISPLAY_TIME = 400;

/**
 * Grace period (ms) before the pending indicator appears. A save flips the vault to dirty for a few hundred ms
 * even when the background sync will resolve it afterwards. So we wait a bit before showing the pending indicator
 * to avoid flashing the badge unnecessarily.
 */
const PENDING_DISPLAY_DELAY = 1000;

/**
 * Keep the syncing indicator visible for a minimum amount of time, measured from the moment it first turned on to prevent flickering.
 * @param active - the underlying state the indicator reflects
 * @param minVisibleMs - how long the indicator has to stay visible at minimum
 * @returns Whether the indicator should be rendered.
 */
const useMinimumVisible = (active: boolean, minVisibleMs: number): boolean => {
  const [visible, setVisible] = useState(active);
  const shownAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (active) {
      if (shownAtRef.current === null) {
        shownAtRef.current = Date.now();
      }
      setVisible(true);
      return;
    }

    // Never shown, so there is nothing to hold on to.
    if (shownAtRef.current === null) {
      return;
    }

    const remaining = minVisibleMs - (Date.now() - shownAtRef.current);
    if (remaining <= 0) {
      shownAtRef.current = null;
      setVisible(false);
      return;
    }

    const timer = setTimeout((): void => {
      shownAtRef.current = null;
      setVisible(false);
    }, remaining);
    return (): void => clearTimeout(timer);
  }, [active, minVisibleMs]);

  return visible;
};

/**
 * Sync status indicator component.
 * Displays clickable status badges for offline mode, syncing, and pending sync.
 *
 * Priority order (highest to lowest):
 * 1. Offline (amber) - network unavailable, clickable to retry
 * 2. Syncing (green spinner) - downloading new vault (minimum display time)
 * 3. Uploading (blue spinner) - uploading local changes to server (minimum display time)
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

  // Hold both in-flight indicators up long enough that a fast sync never flashes them
  const showSyncing = useMinimumVisible(dbContext.isSyncing, MIN_SYNC_DISPLAY_TIME);
  const showUploading = useMinimumVisible(dbContext.isUploading, MIN_SYNC_DISPLAY_TIME);

  // Track pending state with a grace delay so transient dirty windows never flash the badge
  const [showPending, setShowPending] = useState(false);

  /**
   * Only surface the pending indicator when the vault has stayed dirty for the grace period.
   */
  useEffect(() => {
    if (!dbContext.hasUnsyncedUserChanges) {
      setShowPending(false);
      return;
    }
    const timer = setTimeout((): void => setShowPending(true), PENDING_DISPLAY_DELAY);
    return (): void => clearTimeout(timer);
  }, [dbContext.hasUnsyncedUserChanges]);

  /**
   * Handle tap to force sync retry.
   */
  const handleRetry = useCallback(async (): Promise<void> => {
    if (isRetrying) {
      return;
    }

    setIsRetrying(true);

    try {
      const result = await sendMessage('FULL_VAULT_SYNC', {});

      // Handle logout requirement
      if (result.requiresLogout) {
        await app.logout(syncErrorMessage(result, t));
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
      logFailure('Retry sync error', error);
    } finally {
      setIsRetrying(false);
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
        className="flex items-center gap-1.5 mx-2 px-2 py-1 bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded-md text-xs font-medium cursor-pointer hover:opacity-80 active:opacity-60 transition-colors"
        title={t('sync.tapToRetry')}
      >
        <div className="relative">
          {isRetrying ? (
            <Icon name="refresh" className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <>
              <Icon name="status-offline" className="w-3.5 h-3.5" />
              {dbContext.hasUnsyncedUserChanges && (
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
        className="flex items-center gap-1.5 mx-2 px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-md text-xs font-medium"
        title={t('vault.syncingVault')}
      >
        <Icon name="refresh" className="w-3.5 h-3.5 animate-spin" />
      </div>
    );
  }

  // Priority 3: Uploading indicator (not clickable, shows progress)
  if (showUploading) {
    return (
      <div
        className="flex items-center gap-1.5 mx-2 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-md text-xs font-medium"
      >
        <Icon name="refresh" className="w-3.5 h-3.5 animate-spin" />
      </div>
    );
  }

  // Priority 4: Pending indicator (clickable to force sync) - icon only
  if (showPending) {
    return (
      <button
        onClick={handleRetry}
        disabled={isRetrying}
        className="flex items-center gap-1.5 mx-2 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-md text-xs font-medium cursor-pointer hover:opacity-80 active:opacity-60 transition-colors"
        title={t('sync.tapToRetry')}
      >
        {isRetrying ? (
          <Icon name="refresh" className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <div className="relative">
            <Icon name="cloud-upload" className="w-3.5 h-3.5" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-500 dark:bg-blue-400 rounded-full animate-pulse" />
          </div>
        )}
      </button>
    );
  }

  return null;
};

export default ServerSyncIndicator;
