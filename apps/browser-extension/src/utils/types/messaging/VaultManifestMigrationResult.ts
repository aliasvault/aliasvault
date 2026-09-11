import type { SyncErrorDetail } from '@/utils/types/messaging/SyncErrorDetail';

/**
 * Result of the manifest migration.
 */
export type VaultManifestMigrationResult = SyncErrorDetail & {
  success: boolean;
  pushed: boolean;
};
