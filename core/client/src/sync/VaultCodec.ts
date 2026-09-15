/**
 * VaultCodec: the EF migration ids that tell whether a local vault's schema is current.
 */

import type SqliteClient from '../database/SqliteClient';

/**
 * VaultCodec: reads the migration a vault was stamped with and the one a schema would stamp.
 */
export class VaultCodec {
  /**
   * Read the latest EF migration ID from `__EFMigrationsHistory` (empty string if not stamped).
   * @param sqliteClient - opened client
   */
  public static getLatestMigrationId(sqliteClient: SqliteClient): string {
    try {
      const rows = sqliteClient.executeQuery<{ MigrationId: string }>(
        'SELECT MigrationId FROM __EFMigrationsHistory ORDER BY MigrationId DESC LIMIT 1'
      );
      return rows[0]?.MigrationId ?? '';
    } catch {
      return '';
    }
  }

  /**
   * The migration ID a freshly created database would be stamped with.
   * @param schemaSql - the COMPLETE_SCHEMA_SQL string for the target client version
   */
  public static getSchemaMigrationId(schemaSql: string): string {
    const ids = [...schemaSql.matchAll(/INSERT\s+INTO\s+"__EFMigrationsHistory"[^;]*?VALUES\s*\(\s*'([^']+)'/gi)].map(m => m[1]);
    return ids.length === 0 ? '' : ids.reduce((a, b) => (b > a ? b : a));
  }
}

export default VaultCodec;
