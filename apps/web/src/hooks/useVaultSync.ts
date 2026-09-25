import { syncErrorMessage } from '@aliasvault/client/sync/SyncErrorMessage';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';
import { vaultStore } from '@/vault/VaultStore';

type VaultSyncOptions = {
  onSuccess?: (hasNewVault: boolean) => void;
  onError?: (error: string) => void;
  onOffline?: () => void;
  onLegacySqliteBlobUpgradeRequired?: () => void;
  onManifestMigrationRequired?: () => void;
}

/**
 * Hook to sync the vault with the server.
 *
 * Sync logic (handled by the Rust sync engine):
 * - If server has newer vault AND we have local changes (isDirty): merge then upload
 * - If server has newer vault AND no local changes: just download
 * - If server has same revision AND we have local changes: upload
 * - If offline: keep local changes, sync later
 */
export const useVaultSync = (): { syncVault: (options?: VaultSyncOptions) => Promise<boolean>; } => {
  const { t } = useTranslation();
  const auth = useAuth();
  const dbContext = useDb();

  const syncVault = useCallback(async (options: VaultSyncOptions = {}) => {
    const { onSuccess, onError, onOffline, onLegacySqliteBlobUpgradeRequired, onManifestMigrationRequired } = options;

    try {
      const isLoggedIn = await auth.initializeAuth();
      if (!isLoggedIn) {
        return false;
      }

      const result = await vaultStore.fullVaultSync({});

      if (result.requiresLogout) {
        await auth.logout({ errorMessage: syncErrorMessage(result, t) });
        return false;
      }

      if (result.wasOffline) {
        await dbContext.setIsOffline(true);
        onOffline?.();
        onSuccess?.(false);
        return true;
      }

      if (dbContext.isOffline) {
        await dbContext.setIsOffline(false);
      }

      if (result.sqliteBlobUpgradeRequired) {
        onLegacySqliteBlobUpgradeRequired?.();
        return false;
      }

      if (result.manifestMigrationRequired) {
        onManifestMigrationRequired?.();
        return false;
      }

      if (!result.success) {
        onError?.(syncErrorMessage(result, t) ?? t('common.errors.unknownError'));
        return false;
      }

      if (result.hasNewVault) {
        await dbContext.loadStoredDatabase();
      }

      onSuccess?.(result.hasNewVault);
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error during vault sync';
      console.error('Vault sync error:', err);
      onError?.(errorMessage);
      return false;
    }
  }, [auth, dbContext, t]);

  return { syncVault };
};
