/**
 * Result of the manifest migration.
 */
export type VaultManifestMigrationResult = {
  success: boolean;
  pushed: boolean;
  error?: string;
};
