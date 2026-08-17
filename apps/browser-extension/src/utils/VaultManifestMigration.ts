import { requiresLegacyAccountKeyMigration } from '@/utils/legacy/LegacyStorageModelMigration';
import type { SqliteClient } from '@/utils/SqliteClient';

/**
 * Whether the vault still has to run the manifest migration. One of the two predicates behind the /upgrade gate,
 * answered entirely from local state.
 *
 * Two conditions, carried independently of each other:
 * 1. A stale local schema, rebuilt via `VaultSyncService.migrateVaultToCurrentSchema`. This is the permanent path:
 *    it delivered the initial sqlite-blob to manifest-v1 transition and fires again after every schema change we ship.
 * 2. A missing account key hierarchy ({@link requiresLegacyAccountKeyMigration}), one-time and deletable.
 *
 * Callers must check `requiresLegacySqliteBlobMigration()` first: a pre-2.0.0 vault has to walk the sqlite-blob upgrade chain before either condition here can be acted on.
 * @param sqliteClient - the open local vault
 */
export async function vaultRequiresManifestMigration(sqliteClient: SqliteClient): Promise<boolean> {
  return await sqliteClient.requiresSchemaMigration() || await requiresLegacyAccountKeyMigration();
}

/**
 * What a pending migration will actually do, which decides whether it may run on its own.
 */
export enum VaultMigrationKind {
  /** No migration pending. */
  None = 'none',

  /**
   * Rebuild the local database onto the current schema. Runs automatically.
   */
  SchemaRebuild = 'schema-rebuild',

  /**
   * Upgrades from sqlite-blob to manifest-v1 (api v1 to api v2) storage format.
   */
  StorageFormatUpgrade = 'storage-format-upgrade',
}

/**
 * A pending migration, classified.
 */
export type VaultMigrationStatus = {
  kind: VaultMigrationKind;

  /**
   * Whether the classification could be confirmed against the server. False when the vault key probe could not reach the server.
   */
  serverConfirmed: boolean;
};
