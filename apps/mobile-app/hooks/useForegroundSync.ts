import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useVaultSync } from '@/hooks/useVaultSync';

import { useDb } from '@/context/DbContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Push pending local changes when the app returns to the foreground. The autofill and passkey layers only record
 * a use locally (they may be stopped by the OS at any time), so this is where those writes reach the server.
 */
export function useForegroundSync(): void {
  const dbContext = useDb();
  const { syncVault } = useVaultSync();
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      const cameToForeground = appState.current.match(/inactive|background/) && nextAppState === 'active';
      appState.current = nextAppState;
      if (!cameToForeground) {
        return;
      }

      try {
        // A locked vault goes through the reinitialize flow, which syncs by itself.
        if (!(await NativeVaultManager.isVaultUnlocked())) {
          return;
        }
        const syncState = await NativeVaultManager.getSyncState();
        if (!syncState.isDirty || syncState.isSyncing) {
          return;
        }
        await syncVault({ onSuccess: () => void dbContext.refreshSyncState() });
      } catch (error) {
        console.warn('[useForegroundSync] Failed to push pending changes:', error);
      }
    });

    return (): void => {
      subscription.remove();
    };
  }, [dbContext, syncVault]);
}
