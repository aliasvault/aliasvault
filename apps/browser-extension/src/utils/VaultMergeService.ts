import initSqlJs, { Database, SqlJsStatic, SqlValue } from 'sql.js';
import { browser } from 'wxt/browser';

import init, { getSyncableTableNames, mergeVaults, pruneVault } from './dist/core/rust/aliasvault_core.js';

/**
 * Record type for JSON data passed to/from Rust.
 */
type JsonRecord = { [key: string]: unknown };

/**
 * Table data structure for Rust merge input/output.
 */
type TableData = {
  name: string;
  records: JsonRecord[];
}

/**
 * Input structure for Rust merge function.
 */
type MergeInput = {
  local_tables: TableData[];
  server_tables: TableData[];
}

/**
 * SQL statement with parameters from Rust.
 */
type SqlStatement = {
  sql: string;
  params: SqlValue[];
}

/**
 * Statistics from Rust merge.
 */
type RustMergeStats = {
  tables_processed: number;
  records_from_local: number;
  records_from_server: number;
  records_created_locally: number;
  conflicts: number;
  records_inserted: number;
}

/**
 * Output structure from Rust merge function.
 */
type MergeOutput = {
  success: boolean;
  statements: SqlStatement[];
  stats: RustMergeStats;
}

/**
 * Input structure for Rust prune function.
 */
type PruneInput = {
  tables: TableData[];
  retention_days: number;
  /** Current time in ISO 8601 format (YYYY-MM-DDTHH:MM:SS.sssZ). Use new Date().toISOString() */
  current_time: string;
}

/**
 * Output structure from Rust prune function.
 */
type PruneOutput = {
  success: boolean;
  statements: SqlStatement[];
}

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
 * Result of a prune operation.
 */
export type PruneResult = {
  success: boolean;
  prunedVaultBase64: string;
  statementCount: number;
}

/**
 * Service for merging two vault SQLite databases using Last-Write-Wins (LWW) strategy.
 *
 * This implementation uses Rust WASM for the core merge logic, ensuring consistency
 * across all platforms (browser, iOS, Android, server).
 *
 * The merge uses UpdatedAt timestamps on all SyncableEntity records to determine
 * which version of a record wins in case of conflict.
 */
export class VaultMergeService {
  private sqlJsInstance: SqlJsStatic | null = null;
  private rustInitialized = false;

  /**
   * Initialize the Rust WASM module.
   * Called automatically by merge() if not already initialized.
   */
  private async initRust(): Promise<void> {
    if (this.rustInitialized) {
      return;
    }
    /*
     * Fetch WASM bytes using browser.runtime.getURL for correct extension path.
     * Cast to string to bypass WXT's strict PublicPath typing.
     */
    const wasmUrl = (browser.runtime.getURL as (path: string) => string)('src/aliasvault_core_bg.wasm');
    const wasmResponse = await fetch(wasmUrl);
    const wasmBytes = await wasmResponse.arrayBuffer();
    await init(wasmBytes);
    this.rustInitialized = true;
  }

  /**
   * Merge local vault changes with server vault using LWW strategy.
   *
   * Uses Rust WASM for the merge logic:
   * 1. Load both SQLite databases with sql.js
   * 2. Read all tables as JSON
   * 3. Call Rust merge (returns SQL statements)
   * 4. Execute SQL statements on local database
   * 5. Export merged database
   *
   * @param localVaultBase64 - The local vault (with offline changes) as base64 SQLite
   * @param serverVaultBase64 - The server vault (latest version) as base64 SQLite
   * @returns MergeResult with the merged vault as base64
   */
  public async merge(localVaultBase64: string, serverVaultBase64: string): Promise<MergeResult> {
    try {
      // Initialize Rust WASM
      await this.initRust();

      // Use injected SQL.js instance or initialize a new one
      const SQL = this.sqlJsInstance ?? await initSqlJs({
        /**
         * Locate the SQL.js WASM file.
         * @param file - The file name to locate
         * @returns The path to the file
         */
        locateFile: (file: string) => `src/${file}`
      });

      // Load both databases
      const localDb = this.loadDatabase(SQL, localVaultBase64);
      const serverDb = this.loadDatabase(SQL, serverVaultBase64);

      try {
        // Get syncable table names from Rust (or injected function)
        const tableNames = getSyncableTableNames();

        // Read all tables from both databases as JSON
        const localTables: TableData[] = tableNames.map(name => ({
          name,
          records: this.readTableAsJson(localDb, name),
        }));

        const serverTables: TableData[] = tableNames.map(name => ({
          name,
          records: this.readTableAsJson(serverDb, name),
        }));

        /*
         * Call Rust WASM merge (or injected function).
         * Use JSON stringify/parse to ensure no undefined values reach Rust/serde.
         */
        const mergeInput: MergeInput = JSON.parse(JSON.stringify({
          local_tables: localTables,
          server_tables: serverTables,
        })) as MergeInput;

        console.debug('[VaultMerge] Merge input:', {
          localTableCount: localTables.length,
          serverTableCount: serverTables.length,
          localTables: localTables.map(t => ({ name: t.name, recordCount: t.records.length })),
          serverTables: serverTables.map(t => ({ name: t.name, recordCount: t.records.length })),
        });

        const mergeOutput = mergeVaults(mergeInput) as MergeOutput;

        // Execute SQL statements from Rust on local database
        for (const stmt of mergeOutput.statements) {
          // Convert undefined to null for sql.js (serde-wasm-bindgen may convert null to undefined)
          const sanitizedParams = stmt.params.map(p => p === undefined ? null : p);
          localDb.run(stmt.sql, sanitizedParams);
        }

        // Export the merged database
        const mergedVaultBase64 = this.exportDatabase(localDb);

        return {
          success: mergeOutput.success,
          mergedVaultBase64,
          stats: {
            tablesProcessed: mergeOutput.stats.tables_processed,
            recordsFromLocal: mergeOutput.stats.records_from_local,
            recordsFromServer: mergeOutput.stats.records_from_server,
            recordsCreatedLocally: mergeOutput.stats.records_created_locally,
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
   * Prune expired items from trash in a vault.
   *
   * This permanently deletes (sets IsDeleted = true) items that have been in the trash
   * (DeletedAt set) for longer than the retention period.
   *
   * Uses Rust WASM for the prune logic:
   * 1. Load SQLite database with sql.js
   * 2. Read relevant tables as JSON
   * 3. Call Rust prune (returns SQL statements)
   * 4. Execute SQL statements on database
   * 5. Export pruned database
   *
   * @param vaultBase64 - The vault as base64 SQLite
   * @param retentionDays - Number of days to keep items in trash (default: 30)
   * @returns PruneResult with the pruned vault as base64
   */
  public async prune(vaultBase64: string, retentionDays: number = 30): Promise<PruneResult> {
    try {
      // Initialize Rust WASM
      await this.initRust();

      // Use injected SQL.js instance or initialize a new one
      const SQL = this.sqlJsInstance ?? await initSqlJs({
        /**
         * Locate the SQL.js WASM file.
         * @param file - The file name to locate
         * @returns The path to the file
         */
        locateFile: (file: string) => `src/${file}`
      });

      // Load the database
      const db = this.loadDatabase(SQL, vaultBase64);

      try {
        // Tables needed for pruning
        const tableNames = ['Items', 'FieldValues', 'Attachments', 'TotpCodes', 'Passkeys'];

        // Read tables as JSON
        const tables: TableData[] = tableNames.map(name => ({
          name,
          records: this.readTableAsJson(db, name),
        }));

        // Call Rust WASM prune
        const pruneInput: PruneInput = JSON.parse(JSON.stringify({
          tables,
          retention_days: retentionDays,
          current_time: new Date().toISOString(),
        })) as PruneInput;

        const pruneOutput = pruneVault(pruneInput) as PruneOutput;

        // Execute SQL statements from Rust on database
        for (const stmt of pruneOutput.statements) {
          const sanitizedParams = stmt.params.map(p => p === undefined ? null : p);
          db.run(stmt.sql, sanitizedParams);
        }

        // Export the pruned database
        const prunedVaultBase64 = this.exportDatabase(db);
        const statementCount = pruneOutput.statements.length;

        if (statementCount > 0) {
          console.info(`[VaultMerge] Pruned expired items from trash (${statementCount} SQL statements executed)`);
        }

        return {
          success: pruneOutput.success,
          prunedVaultBase64,
          statementCount,
        };
      } finally {
        // Clean up database
        db.close();
      }
    } catch (error) {
      console.error('Vault prune failed:', error);
      throw error;
    }
  }

  /**
   * Load a SQLite database from base64 string.
   * @param SQL - The SQL.js instance
   * @param base64String - The base64 encoded database
   * @returns The loaded Database instance
   */
  private loadDatabase(SQL: SqlJsStatic, base64String: string): Database {
    const binaryString = atob(base64String);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new SQL.Database(bytes);
  }

  /**
   * Export a SQLite database to base64 string.
   * @param db - The database to export
   * @returns The base64 encoded database
   */
  private exportDatabase(db: Database): string {
    db.run('VACUUM');
    const binaryArray = db.export();
    let binaryString = '';
    for (let i = 0; i < binaryArray.length; i++) {
      binaryString += String.fromCharCode(binaryArray[i]);
    }
    return btoa(binaryString);
  }

  /**
   * Read all records from a table as JSON objects.
   * @param db - The database to query
   * @param tableName - The name of the table
   * @returns Array of records as JSON objects
   */
  private readTableAsJson(db: Database, tableName: string): JsonRecord[] {
    const records: JsonRecord[] = [];
    const stmt = db.prepare(`SELECT * FROM ${tableName}`);

    while (stmt.step()) {
      const obj = stmt.getAsObject();
      /*
       * Use JSON stringify/parse to sanitize the object for Rust/serde.
       * This converts undefined to null and ensures clean JSON types.
       */
      const record = JSON.parse(JSON.stringify(obj)) as JsonRecord;
      records.push(record);
    }
    stmt.free();

    return records;
  }
}

/**
 * Singleton instance for the vault merge service.
 */
export const vaultMergeService = new VaultMergeService();
