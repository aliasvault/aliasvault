import { encryptVaultBlob } from '@aliasvault/client/crypto/VaultBlob';
import { hasSyncError } from '@aliasvault/client/sync/VaultSync';
import { useCallback } from 'react';

import { useDb } from '@/context/DbContext';
import { devLog } from '@/utils/DevLogger';
import { vaultStore } from '@/vault/VaultStore';

/**
 * Hook to execute a vault mutation.
 *
 * Flow:
 * 1. Execute the mutation on the in-memory database
 * 2. Save the encrypted vault locally and mark it dirty (bumps the mutation sequence)
 * 3. Trigger a sync which handles upload, merge if needed and offline mode; the sync drives the upload indicator
 */
export function useVaultMutate(): { executeVaultMutationAsync: (operation: () => Promise<void>) => Promise<void>; } {
  const dbContext = useDb();

  /**
   * Execute the operation and save the result locally, marking the vault dirty with the scopes it wrote into.
   */
  const saveLocally = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    await operation();

    const sqliteClient = dbContext.sqliteClient;
    if (!sqliteClient) {
      throw new Error('Vault is locked');
    }
    const scopes = sqliteClient.takeMutationScopes();

    try {
      const encryptionKey = await vaultStore.getEncryptionKey();
      if (!encryptionKey) {
        throw new Error('Vault is locked');
      }
      const encryptedVaultBlob = await encryptVaultBlob(sqliteClient.exportToBytes(), encryptionKey);
      await vaultStore.storeEncryptedVault({ vaultBlob: encryptedVaultBlob, markDirty: true, scopes });
    } catch (error) {
      // The write is still in the local database, so put the scopes back for whichever store carries it next.
      scopes.forEach(scope => sqliteClient.recordMutationScope(scope));
      throw error;
    }
  }, [dbContext]);

  /**
   * Trigger the sync that pushes the mutation.
   */
  const triggerSync = useCallback((): void => {
    vaultStore.fullVaultSync().then(async (result) => {
      if (hasSyncError(result)) {
        devLog('[VaultMutate] Sync after mutation reported an error', result);
      }
      if (result.hasNewVault) {
        await dbContext.loadStoredDatabase();
      }
    }).catch((error) => {
      console.error('[VaultMutate] Sync after mutation failed:', error);
    });
  }, [dbContext]);

  /**
   * Execute a vault mutation: apply it locally, persist it, and sync it to the server.
   */
  const executeVaultMutationAsync = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    await saveLocally(operation);
    triggerSync();
  }, [saveLocally, triggerSync]);

  return { executeVaultMutationAsync };
}
