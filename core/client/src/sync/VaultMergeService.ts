import { TRASH_RETENTION_DAYS } from '../constants/Vault';
import { getPlatform } from '../platform/ClientPlatform';
import { devLog } from '../platform/Logger';
import { rustCore } from '../rust/RustCore';
import { base64ToBytes, bytesToBase64 } from '../utilities/Base64';

import type { SqliteClient } from '../database/SqliteClient';
import type { ISqliteDatabase, SqliteValue } from '../platform/SqliteEngine';
import type { RustSqlStatement, RustTableData } from '../rust/RustCoreTypes';

/**
 * Record type for JSON data passed to/from Rust.
 */
type JsonRecord = { [key: string]: unknown };

/**
 * Result of a merge operation.
 */
export type MergeResult = {
  success: boolean;
  mergedVaultBase64: string;
  stats: MergeStats;
}

/**
 * Statistics about what was merged.
 */
export type MergeStats = {
  tablesProcessed: number;
  recordsFromLocal: number;
  recordsFromServer: number;
  recordsCreatedLocally: number;
  conflicts: number;
}

/**
 * Service for merging two vault SQLite databases using Last-Write-Wins (LWW) strategy.
 *
 * This implementation uses the Rust core for the merge logic, ensuring consistency
 * across all platforms (browser, iOS, Android, server).
 *
 * The merge uses UpdatedAt timestamps on all SyncableEntity records to determine
 * which version of a record wins in case of conflict.
 */
export class VaultMergeService {
  /**
   * LEGACY: SQLite statement-level merge, kept only for the frozen sqlite-blob storage format (a
   * not-yet-migrated local vault). Manifest-v1 vaults merge at canonical level instead, see
   * `VaultSyncService.pullAndMerge`. TODO: delete this function once all users have migrated to manifest-v1.
   *
   * Uses the Rust core for the merge logic. The merge base is the SERVER vault (it is freshly
   * materialized with the newest schema and the newest codec overflow carrier), and the local
   * vault's winning changes are applied on top of it:
   * 1. Load both SQLite databases
   * 2. Read the syncable tables from both as JSON
   * 3. Call Rust merge (returns SQL statements that bring local changes onto the server base)
   * 4. Execute SQL statements on the SERVER database
   * 5. Export the merged (server-based) database - the codec overflow carrier rides along untouched
   *
   * @param localVaultBase64 - The local vault (with offline changes) as base64 SQLite
   * @param serverVaultBase64 - The server vault (latest version) as base64 SQLite
   * @returns MergeResult with the merged vault as base64
   */
  public async merge(localVaultBase64: string, serverVaultBase64: string): Promise<MergeResult> {
    try {
      const core = rustCore();

      // Load both databases
      const localDb = await this.loadDatabase(localVaultBase64);
      const serverDb = await this.loadDatabase(serverVaultBase64);

      try {
        const tableNames = await core.getSyncableTableNames();

        // Read all tables from both databases as JSON
        const localTables: RustTableData[] = tableNames.map(name => ({
          name,
          records: this.readTableAsJson(localDb, name),
        }));

        const serverTables: RustTableData[] = tableNames.map(name => ({
          name,
          records: this.readTableAsJson(serverDb, name),
        }));

        devLog('[VaultMerge] Merge input:', {
          localTableCount: localTables.length,
          serverTableCount: serverTables.length,
          localTables: localTables.map(t => ({ name: t.name, recordCount: t.records.length })),
          serverTables: serverTables.map(t => ({ name: t.name, recordCount: t.records.length })),
        });

        // JSON roundtrip so no undefined value reaches Rust/serde.
        const mergeOutput = await core.mergeVaults(JSON.parse(JSON.stringify({ local_tables: localTables, server_tables: serverTables })));

        /*
         * Execute SQL statements from Rust on the SERVER database (the merge base). The exported
         * server DB carries the newest codec overflow carrier untouched.
         */
        for (const stmt of mergeOutput.statements) {
          serverDb.run(stmt.sql, stmt.params.map(toBindableParam));
        }

        // Export the merged (server-based) database
        const mergedVaultBase64 = this.exportDatabase(serverDb);

        return {
          success: mergeOutput.success,
          mergedVaultBase64,
          stats: {
            tablesProcessed: mergeOutput.stats.tablesProcessed,
            recordsFromLocal: mergeOutput.stats.recordsFromLocal,
            recordsFromServer: mergeOutput.stats.recordsFromServer,
            recordsCreatedLocally: mergeOutput.stats.recordsCreatedLocally,
            conflicts: mergeOutput.stats.conflicts,
          },
        };
      } finally {
        // Clean up databases
        localDb.close();
        serverDb.close();
      }
    } catch (error) {
      console.error('Vault merge failed:', error);
      throw error;
    }
  }

  /**
   * Prune expired trash items directly on a live SQLite client: items that have been in the trash (DeletedAt
   * set) for longer than the retention period are permanently deleted (IsDeleted = true).
   *
   * @param client - The live SQLite client to prune
   * @param retentionDays - Number of days to keep items in trash (defaults to TRASH_RETENTION_DAYS)
   * @returns Number of SQL statements executed (0 when nothing was expired)
   */
  public async pruneInPlace(client: SqliteClient, retentionDays: number = TRASH_RETENTION_DAYS): Promise<number> {
    const core = rustCore();

    const tableQueries = await core.getPruneTableQueries();
    const tables: RustTableData[] = tableQueries.map(({ name, query }) => ({ name, records: client.executeQuery<JsonRecord>(query) }));

    // JSON roundtrip converts undefined to null and ensures clean JSON types for Rust/serde.
    const pruneOutput = await core.pruneVault(JSON.parse(JSON.stringify({ tables, retention_days: retentionDays, current_time: new Date().toISOString() })));

    for (const stmt of pruneOutput.statements) {
      client.executeUpdate(stmt.sql, stmt.params.map(toBindableParam));
    }

    if (pruneOutput.statements.length > 0) {
      devLog(`[VaultMerge] Pruned expired items from trash (${pruneOutput.statements.length} SQL statements executed)`);
    }

    return pruneOutput.statements.length;
  }

  /**
   * Load a SQLite database from base64 string.
   * @param base64String - The base64 encoded database
   * @returns The loaded database
   */
  private loadDatabase(base64String: string): Promise<ISqliteDatabase> {
    return getPlatform().sqlite.open(base64ToBytes(base64String));
  }

  /**
   * Export a SQLite database to base64 string.
   * @param db - The database to export
   * @returns The base64 encoded database
   */
  private exportDatabase(db: ISqliteDatabase): string {
    db.exec('VACUUM');
    return bytesToBase64(db.export());
  }

  /**
   * Read all records from a table as JSON objects.
   * @param db - The database to query
   * @param tableName - The name of the table
   * @returns Array of records as JSON objects
   */
  private readTableAsJson(db: ISqliteDatabase, tableName: string): JsonRecord[] {
    const exists = db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`).length > 0;
    if (!exists) {
      return [];
    }
    return this.readQueryAsJson(db, `SELECT * FROM ${tableName}`);
  }

  /**
   * Read all rows of a query as JSON objects. BLOB columns come back from the engine as Uint8Array,
   * which neither JSON nor serde can round-trip; they are encoded as `{ __b64 }` payloads that
   * {@link toBindableParam} decodes when a merge statement writes them back.
   * @param db - The database to query
   * @param query - The SELECT query to run
   * @returns Array of records as JSON objects
   */
  private readQueryAsJson(db: ISqliteDatabase, query: string): JsonRecord[] {
    return db.query(query).map(row => {
      const record: JsonRecord = {};
      for (const [column, value] of Object.entries(row)) {
        record[column] = value instanceof Uint8Array ? { __b64: bytesToBase64(value) } : value ?? null;
      }
      return record;
    });
  }
}

/**
 * Decode one Rust-returned SQL parameter into a bindable value: `{ __b64 }` byte payloads
 * become Uint8Array, undefined becomes null.
 * @param param - the parameter as returned by the Rust merge
 */
function toBindableParam(param: RustSqlStatement['params'][number] | undefined): SqliteValue {
  if (param !== null && param !== undefined && typeof param === 'object' && '__b64' in param) {
    return base64ToBytes(param.__b64);
  }
  return param ?? null;
}
