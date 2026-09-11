import type { SyncErrorDetail } from '@/utils/types/messaging/SyncErrorDetail';

/**
 * Result of a full vault sync operation.
 */
export type FullVaultSyncResult = SyncErrorDetail & {
  success: boolean;
  hasNewVault: boolean;
  wasOffline: boolean;
  sqliteBlobUpgradeRequired: boolean;
  manifestMigrationRequired?: boolean;
  requiresLogout: boolean;
};
