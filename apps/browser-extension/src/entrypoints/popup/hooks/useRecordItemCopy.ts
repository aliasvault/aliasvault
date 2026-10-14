import { getOrCreateDeviceId } from '@aliasvault/client/platform/DeviceId';
import { useCallback } from 'react';

import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';

import { logExpected } from '@/utils/Diagnostics';

/**
 * Record a copied value in its item's usage statistics.
 */
export function useRecordItemCopy(): (itemId?: string, manifestId?: string) => void {
  const dbContext = useDb();
  const { executeVaultMutationAsync } = useVaultMutate();

  return useCallback((itemId?: string, manifestId?: string): void => {
    const client = dbContext.sqliteClient;
    if (!itemId || !manifestId || !client) {
      return;
    }
    executeVaultMutationAsync(async () => {
      // No such item (deleted between copy and record) leaves nothing to attribute the use to.
      client.itemStats.recordUsage({ Id: itemId, ManifestId: manifestId }, 'copy', await getOrCreateDeviceId());
    }).catch((error) => logExpected('[Clipboard] Recording the item usage failed', error));
  }, [dbContext.sqliteClient, executeVaultMutationAsync]);
}
