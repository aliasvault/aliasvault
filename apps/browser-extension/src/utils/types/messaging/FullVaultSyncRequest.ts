import type { VaultSyncOptions } from '@aliasvault/client/sync/VaultSyncEngine';

/**
 * What a caller asks of a full sync: the engine's own options, plus whether a failure is stored for the popup's
 * sync-error dialog.
 */
export type FullVaultSyncRequest = VaultSyncOptions & {
  /**
   * Whether a failure is persisted so the popup can surface it later, defaults to true. Only the login pull
   * opts out: the login page reports the failure itself, and persisting it would report the same failure twice.
   */
  reportErrorToPopup?: boolean;
};
