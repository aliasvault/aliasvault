import { getPlatform } from '@aliasvault/client/platform';
import { hasUnsyncedUserChanges } from '@aliasvault/client/sync/VaultDirtyState';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SmallLoadingIndicator from '@/components/loading/SmallLoadingIndicator';
import { useDb } from '@/context/DbContext';
import { useNotifications } from '@/context/NotificationContext';
import { useVaultSync } from '@/hooks/useVaultSync';
import { StorageKeys } from '@/utils/StorageKeys';
import { vaultStore } from '@/vault/VaultStore';

/** How long the indicator keeps spinning after a sync started, so a fast sync is still visible. */
const MIN_SPIN_MS = 600;

/**
 * Vault sync indicator in the top bar. Spins while syncing; otherwise a refresh button that pulls the latest vault,
 * marked with a red dot once a sync failed while the vault holds changes of the user the server does not have yet
 * (e.g. a background save that failed), so a click retries the push.
 */
const DbStatusIndicator: React.FC = () => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const { syncVault } = useVaultSync();
  const notifications = useNotifications();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [holdSpinning, setHoldSpinning] = useState(false);
  const [hasUnsyncedChanges, setHasUnsyncedChanges] = useState(false);
  const [lastSyncFailed, setLastSyncFailed] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isBusy = dbContext.isSyncing || dbContext.isUploading || isRefreshing;

  useEffect(() => {
    if (isBusy) {
      setHoldSpinning(true);
      if (holdTimer.current) {
        clearTimeout(holdTimer.current);
      }
      holdTimer.current = setTimeout(() => setHoldSpinning(false), MIN_SPIN_MS);
    }
  }, [isBusy]);

  useEffect(() => {
    return (): void => {
      if (holdTimer.current) {
        clearTimeout(holdTimer.current);
      }
    };
  }, []);

  const isSpinning = isBusy || holdSpinning;

  useEffect(() => vaultStore.onSyncFailureChange(setLastSyncFailed), []);

  // Re-check the pending changes whenever a sync finishes or the dirty flag changes.
  useEffect(() => {
    if (isBusy) {
      return undefined;
    }
    let cancelled = false;
    /**
     * Read whether the vault holds unsynced changes of the user.
     */
    const check = (): void => {
      void hasUnsyncedUserChanges().then(value => {
        if (!cancelled) {
          setHasUnsyncedChanges(value);
        }
      });
    };
    check();
    const unwatch = getPlatform().storage.watch(StorageKeys.IS_DIRTY, check);
    return (): void => {
      cancelled = true;
      unwatch();
    };
  }, [isBusy]);

  // Only a sync that failed makes pending changes an error; before the first attempt they are simply on their way.
  const showSyncError = lastSyncFailed && hasUnsyncedChanges;

  /**
   * Sync with the server. When the user's changes still did not get through, say so again.
   */
  const onRefreshClick = useCallback(async (): Promise<void> => {
    setIsRefreshing(true);
    let wasOffline = false;
    let errorMessage: string | null = null;
    try {
      await syncVault({
        /**
         * The server was not reachable.
         */
        onOffline: (): void => {
          wasOffline = true;
        },
        /**
         * The sync failed, or threw.
         */
        onError: (message: string): void => {
          errorMessage = message;
        },
      });
      if (wasOffline) {
        notifications.addErrorMessage(t('common.errors.serverNotAvailable'), true);
      } else if (errorMessage !== null) {
        // A sync error with details already shows in the sync error dialog; anything else (e.g. an exception) shows here.
        if (await getPlatform().storage.get(StorageKeys.LAST_SYNC_ERROR) === null) {
          notifications.addErrorMessage(errorMessage, true);
        }
      } else if (await hasUnsyncedUserChanges()) {
        notifications.addErrorMessage(t('common.vaultSaveError'), true);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [notifications, syncVault, t]);

  /**
   * The tooltip for the current state.
   */
  const getStatusTitle = (): string => {
    if (dbContext.isUploading) {
      return t('common.syncingChanges');
    }
    if (dbContext.isSyncing) {
      return t('common.loadingVault');
    }
    if (showSyncError) {
      return t('common.vaultSaveError');
    }
    return t('common.syncVaultData');
  };

  return (
    <div className="ms-1 items-center flex" id="vault-sync-indicator" data-syncing={isSpinning ? 'true' : 'false'}>
      <SmallLoadingIndicator title={getStatusTitle()} spinning={isSpinning}>
        {!isSpinning && (
          <button className="absolute p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-2xl" id="vault-refresh-btn" onClick={onRefreshClick}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
            {showSyncError && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" aria-hidden="true"></span>}
          </button>
        )}
      </SmallLoadingIndicator>
    </div>
  );
};

export default DbStatusIndicator;
