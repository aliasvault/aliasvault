/**
 * Result of a full vault sync operation.
 */
export type FullVaultSyncResult = {
  success: boolean;
  hasNewVault: boolean;
  wasOffline: boolean;
  sqliteBlobUpgradeRequired: boolean;
  manifestMigrationRequired?: boolean;
  error?: string;
  errorKey?: string;
  requiresLogout: boolean;
};
