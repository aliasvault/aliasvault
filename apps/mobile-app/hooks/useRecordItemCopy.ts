import { useCallback } from 'react';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';

import { useVaultSync } from '@/hooks/useVaultSync';

import { useDb } from '@/context/DbContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/** How long to wait after a copy before pushing, so a burst of copies goes up in one sync. */
const PUSH_DELAY_MS = 2000;

let pendingPush: ReturnType<typeof setTimeout> | null = null;

/**
 * Record a copied value in its item's usage statistics and push it silently shortly after (Stats scope, no indicator).
 */
export function useRecordItemCopy(): (item?: ItemRef) => void {
  const dbContext = useDb();
  const { syncVault } = useVaultSync();

  return useCallback((item?: ItemRef): void => {
    if (!item?.Id || !item.ManifestId) {
      return;
    }
    NativeVaultManager.recordItemCopy(item.Id, item.ManifestId)
      .then(() => {
        if (pendingPush) {
          clearTimeout(pendingPush);
        }
        pendingPush = setTimeout(() => {
          pendingPush = null;
          void NativeVaultManager.getSyncState().then((state) => {
            if (state.isDirty && !state.isSyncing) {
              return syncVault({ onSuccess: () => void dbContext.refreshSyncState() });
            }
          });
        }, PUSH_DELAY_MS);
      })
      .catch((error) => console.warn('[useRecordItemCopy] Failed to record item usage:', error));
  }, [dbContext, syncVault]);
}
