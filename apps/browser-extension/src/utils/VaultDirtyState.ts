/**
 * VaultDirtyState.
 *
 * The local vault's pending-sync state: whether it holds changes the server does not have yet, and which
 * mutation scopes those changes belong to. Shared between the background sync (which decides what to push) and
 * the popup (which decides what to show).
 */

import { storage } from 'wxt/utils/storage';

import { dirtyScopeStorageKey, StorageKeys } from '@/utils/constants/storageKeys';
import { ALL_VAULT_MUTATION_SCOPES, hasUserVisibleScope, type VaultMutationScope } from '@/utils/types/VaultMutationScope';

/**
 * Read the set of currently-dirty mutation scopes from their independent per-scope flags.
 */
export async function getDirtyScopes(): Promise<VaultMutationScope[]> {
  const flags = await Promise.all(
    ALL_VAULT_MUTATION_SCOPES.map(async scope => ((await storage.getItem(dirtyScopeStorageKey(scope))) === true ? scope : null))
  );
  return flags.filter((s): s is VaultMutationScope => s !== null);
}

/**
 * Clear every per-scope dirty flag. Called once a sync has confirmed all pending changes are on the server.
 */
export async function clearDirtyScopes(): Promise<void> {
  await storage.removeItems(ALL_VAULT_MUTATION_SCOPES.map(scope => dirtyScopeStorageKey(scope)));
}

/**
 * Whether the vault holds unsynced changes the user should see an indicator for. A vault that is only dirty
 * from silent scopes (e.g. item usage statistics) syncs exactly like any other, but reports clean here so the
 * UI stays quiet about mutations the user did not explicitly request.
 */
export async function hasUnsyncedUserChanges(): Promise<boolean> {
  if (await storage.getItem(StorageKeys.IS_DIRTY) !== true) {
    return false;
  }
  return hasUserVisibleScope(await getDirtyScopes());
}
