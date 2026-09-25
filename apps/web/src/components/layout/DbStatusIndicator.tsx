import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SmallLoadingIndicator from '@/components/loading/SmallLoadingIndicator';
import { useDb } from '@/context/DbContext';
import { useVaultSync } from '@/hooks/useVaultSync';

/** How long the indicator keeps spinning after a sync started, so a fast sync is still visible. */
const MIN_SPIN_MS = 600;

/**
 * Vault sync indicator in the top bar. Spins while syncing; otherwise a refresh button that pulls the latest vault.
 */
const DbStatusIndicator: React.FC = () => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const { syncVault } = useVaultSync();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [holdSpinning, setHoldSpinning] = useState(false);
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

  /**
   * Pull the latest vault from the server.
   */
  const onRefreshClick = useCallback(async (): Promise<void> => {
    setIsRefreshing(true);
    try {
      await syncVault();
    } finally {
      setIsRefreshing(false);
    }
  }, [syncVault]);

  /**
   * The tooltip for the current state.
   */
  const getStatusTitle = (): string => {
    if (dbContext.isUploading) {
      return t('sharedResources.SyncingChanges');
    }
    if (dbContext.isSyncing) {
      return t('sharedResources.LoadingVault');
    }
    return t('sharedResources.SyncVaultData');
  };

  return (
    <div className="ms-1 items-center flex" id="vault-sync-indicator" data-syncing={isSpinning ? 'true' : 'false'}>
      <SmallLoadingIndicator title={getStatusTitle()} spinning={isSpinning}>
        {!isSpinning && (
          <button className="absolute p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-2xl" id="vault-refresh-btn" onClick={onRefreshClick}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </SmallLoadingIndicator>
    </div>
  );
};

export default DbStatusIndicator;
