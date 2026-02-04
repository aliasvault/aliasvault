import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { sendMessage } from 'webext-bridge/popup';

import type { FullVaultSyncResult } from '@/entrypoints/background/VaultMessageHandler';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';

type VaultSyncOptions = {
  onSuccess?: (hasNewVault: boolean) => void;
  onError?: (error: string) => void;
  onStatus?: (message: string) => void;
  onOffline?: () => void;
  onUpgradeRequired?: () => void;
}

/**
 * Hook to sync the vault with the server.
 * Delegates to background script for actual sync orchestration.
 * This ensures sync completes even if popup closes mid-operation.
 *
 * Sync logic (handled in background):
 * - If server has newer vault AND we have local changes (isDirty) → merge then upload
 * - If server has newer vault AND no local changes → just download
 * - If server has same revision AND we have local changes → upload
 * - If offline → keep local changes, sync later
 *
 * Race detection (handled in background):
 * - Upload captures mutationSequence at start
 * - After upload, only clears isDirty if sequence unchanged
 * - If sequence changed during upload, stays dirty for next sync
 */
export const useVaultSync = (): { syncVault: (options?: VaultSyncOptions) => Promise<boolean>; } => {
  const { t } = useTranslation();
  const app = useApp();
  const dbContext = useDb();

  const syncVault = useCallback(async (options: VaultSyncOptions = {}) => {
    const { onSuccess, onError, onStatus, onOffline, onUpgradeRequired } = options;

    try {
      // Check if user is logged in first
      const isLoggedIn = await app.initializeAuth();

      if (!isLoggedIn) {
        return false;
      }

      onStatus?.(t('common.checkingVaultUpdates'));

      // Delegate to background script for full sync orchestration
      const result = await sendMessage('FULL_VAULT_SYNC', {}, 'background') as FullVaultSyncResult;

      // Handle logout requirement
      if (result.requiresLogout) {
        const errorMessage = result.errorKey ? t('common.errors.' + result.errorKey) : result.error;
        await app.logout(errorMessage);
        return false;
      }

      // Handle offline mode
      if (result.wasOffline) {
        await dbContext.setIsOffline(true);
        onStatus?.(t('common.offlineMode'));
        onOffline?.();
        onSuccess?.(false);
        return true;
      }

      // Exit offline mode if we were in it
      if (dbContext.isOffline) {
        await dbContext.setIsOffline(false);
      }

      // Handle upgrade requirement
      if (result.upgradeRequired) {
        onUpgradeRequired?.();
        return false;
      }

      // Handle errors
      if (!result.success) {
        const errorMessage = result.errorKey ? t('common.errors.' + result.errorKey) : result.error ?? t('common.errors.unknownError');
        onError?.(errorMessage);
        return false;
      }

      // If we got a new vault, show syncing indicator and reload database into memory
      if (result.hasNewVault) {
        dbContext.setIsSyncing(true);
        onStatus?.(t('common.syncingUpdatedVault'));
        await dbContext.loadStoredDatabase();
      }

      // Refresh sync state from storage
      await dbContext.refreshSyncState();

      onSuccess?.(result.hasNewVault);
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error during vault sync';
      console.error('Vault sync error:', err);
      onError?.(errorMessage);
      return false;
    } finally {
      // Always clear syncing state when done
      dbContext.setIsSyncing(false);
    }
  }, [app, dbContext, t]);

  return { syncVault };
};
