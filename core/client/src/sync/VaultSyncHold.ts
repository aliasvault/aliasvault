/**
 * VaultSyncHold.
 *
 * A hold that suspends vault syncing while an operation runs that is prone to race conditions, e.g. a master password change.
 */

import { StorageKeys } from '../constants/StorageKeys';
import { getPlatform } from '../platform/ClientPlatform';

/**
 * The operations that take the hold, named so a refused sync can log what it yielded to.
 */
export enum VaultSyncHoldReason {
  PasswordChange = 'passwordChange',
}

/** How long a hold stays valid without being released, so a crashed holder is forgotten. */
export const VAULT_SYNC_HOLD_TTL_MS = 2 * 60 * 1000; // 2 minutes

/** What is stored while the hold is held. */
type VaultSyncHoldRecord = { reason: VaultSyncHoldReason; heldAt: number };

/**
 * Run an operation while holding the sync hold, releasing it however the operation ends.
 * @param reason - the operation taking the hold
 * @param operation - the work no sync may race
 */
export async function withVaultSyncHold<T>(reason: VaultSyncHoldReason, operation: () => Promise<T>): Promise<T> {
  const record: VaultSyncHoldRecord = { reason, heldAt: Date.now() };
  await getPlatform().storage.set(StorageKeys.VAULT_SYNC_HOLD, record);
  try {
    return await operation();
  } finally {
    await getPlatform().storage.remove(StorageKeys.VAULT_SYNC_HOLD);
  }
}

/**
 * The reason syncing is on hold, or null when no unexpired hold is held.
 */
export async function getVaultSyncHoldReason(): Promise<VaultSyncHoldReason | null> {
  const hold = await getPlatform().storage.get(StorageKeys.VAULT_SYNC_HOLD) as VaultSyncHoldRecord | null;
  if (!hold || Date.now() - hold.heldAt >= VAULT_SYNC_HOLD_TTL_MS) {
    return null;
  }
  return hold.reason;
}
