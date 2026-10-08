import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import Toast from 'react-native-toast-message';

import { HapticsUtility } from '@/utils/HapticsUtility';
import { VaultAuthenticationError } from '@/utils/types/errors/VaultAuthenticationError';

import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';
import { useTranslation } from '@/hooks/useTranslation';
import { useVaultSync } from '@/hooks/useVaultSync';

import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';

/**
 * Pull-to-refresh: syncs the vault with the server, then calls `reload` so the screen shows the synced data.
 * @param reload - reloads the screen's data from the local vault
 * @param setIsLoading - optional loading state of the screen, set while the refresh runs
 */
export const useVaultRefresh = (
  reload: () => Promise<void>,
  setIsLoading?: (isLoading: boolean) => void
): { refreshing: boolean; onRefresh: () => Promise<void> } => {
  const { t } = useTranslation();
  const router = useRouter();
  const dbContext = useDb();
  const { showAlert } = useDialog();
  const { syncVault } = useVaultSync();
  const [refreshing, setRefreshing] = useMinDurationLoading(false, 200);

  const onRefresh = useCallback(async (): Promise<void> => {
    HapticsUtility.impact();

    /**
     * Stop the refresh and loading indicators.
     */
    const done = (): void => {
      setRefreshing(false);
      setIsLoading?.(false);
    };

    setRefreshing(true);
    setIsLoading?.(true);

    // Always attempt sync, even when offline - this allows recovery when connection is restored
    try {
      await syncVault({
        /**
         * On success.
         */
        onSuccess: async (hasNewVault) => {
          await reload();
          await dbContext.refreshSyncState(); // Clear offline state if we were offline
          done();
          setTimeout(() => {
            Toast.show({
              type: 'success',
              text1: hasNewVault ? t('items.vaultSyncedSuccessfully') : t('items.vaultUpToDate'),
              position: 'top',
              visibilityTime: 1200,
            });
          }, 200);
        },
        /**
         * On offline - just update state, ServerSyncIndicator shows offline status.
         */
        onOffline: async () => {
          done();
          await dbContext.setIsOffline(true);
          await dbContext.refreshSyncState();
        },
        /**
         * On error.
         */
        onError: (error) => {
          console.error('Error syncing vault:', error);
          done();

          // Show generic error message to user, detailed error is logged above
          showAlert(t('common.error'), t('common.errors.unknownError'));
        },
        /**
         * On upgrade required.
         */
        onUpgradeRequired: (): void => {
          router.replace('/upgrade');
        },
      });
    } catch (err) {
      console.error('Error refreshing vault:', err);
      done();

      if (!(err instanceof VaultAuthenticationError)) {
        Toast.show({
          type: 'error',
          text1: t('items.vaultSyncFailed'),
          text2: t('common.errors.unknownError'),
        });
      }
    }
  }, [syncVault, reload, setIsLoading, setRefreshing, dbContext, router, showAlert, t]);

  return { refreshing, onRefresh };
};
