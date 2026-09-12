import * as dateFormatter from '../utilities/DateFormatter';

import { runAsync } from './DbOp';
import { BaseQueries } from './queries/BaseQueries';

import type { DbOp, ManifestScope } from './DbOp';
import type { ISqliteDatabase } from '../platform/SqliteEngine';

export type SqliteBindValue = string | number | null | Uint8Array;

/**
 * The database operations repositories need from their host. A host may answer synchronously (sql.js) or
 * asynchronously (the mobile native bridge); repositories reach it through DbOps and {@link BaseRepository.run}.
 */
export interface IDatabaseClient {
  executeQuery<T>(query: string, params?: SqliteBindValue[]): T[] | Promise<T[]>;
  executeUpdate(query: string, params?: SqliteBindValue[]): number | Promise<number>;
  beginTransaction(): void | Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): void | Promise<void>;
  isInTransaction(): boolean;
  getActiveManifestId(): string | null;
  getPersonalManifestId(): string | null | Promise<string | null>;
}

/**
 * A database client that answers every call synchronously, like sql.js.
 */
export interface ISyncDatabaseClient extends IDatabaseClient {
  getDb(): ISqliteDatabase | null;
  executeQuery<T>(query: string, params?: SqliteBindValue[]): T[];
  executeUpdate(query: string, params?: SqliteBindValue[]): number;
  beginTransaction(): void;
  rollbackTransaction(): void;
  getPersonalManifestId(): string | null;
}

/**
 * Base repository class with common database operations.
 * Provides transaction handling, soft delete, and other shared functionality.
 */
export abstract class BaseRepository<TClient extends IDatabaseClient = ISyncDatabaseClient> {
  /**
   * Constructor for the BaseRepository class.
   * @param client - The database client to use for the repository
   */
  public constructor(protected client: TClient) {}

  /**
   * Run a SELECT and return its rows.
   * @param sql - The statement
   * @param params - The bound parameters
   * @returns The rows
   */
  protected *query<T>(sql: string, params: SqliteBindValue[] = []): DbOp<T[]> {
    return (yield { kind: 'query', sql, params }) as T[];
  }

  /**
   * Run an INSERT, UPDATE or DELETE.
   * @param sql - The statement
   * @param params - The bound parameters
   * @returns The number of rows changed
   */
  protected *execute(sql: string, params: SqliteBindValue[] = []): DbOp<number> {
    return (yield { kind: 'execute', sql, params }) as number;
  }

  /**
   * The active and personal manifest ids of the client this op runs on.
   * @returns Both ids, each null when unknown
   */
  protected *manifestScope(): DbOp<ManifestScope> {
    return (yield { kind: 'manifestScope' }) as ManifestScope;
  }

  /**
   * The manifest new rows are written into: the active manifest, else the personal one.
   * @returns The manifest id
   */
  protected *writeManifestId(): DbOp<string> {
    const { active, personal } = yield* this.manifestScope();
    const manifestId = active ?? personal;
    if (!manifestId) {
      throw new Error('BaseRepository: this client has no manifest recorded yet (no active manifest and no personal manifest); sync once before writing.');
    }
    return manifestId;
  }

  /**
   * Run a DbOp from an async method, on whichever client this repository was given.
   * @param op - The op to run
   * @returns The op's result
   */
  protected run<T>(op: DbOp<T>): Promise<T> {
    return runAsync(op, this.client);
  }

  /**
   * Execute a function within a transaction.
   * Automatically handles begin, commit, and rollback.
   * @param fn - The function to execute within the transaction
   * @returns The result of the function
   */
  protected async withTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.client.beginTransaction();
    try {
      const result = await fn();
      await this.client.commitTransaction();
      return result;
    } catch (error) {
      await this.client.rollbackTransaction();
      throw error;
    }
  }

  /**
   * The client as a synchronous one, for the helpers below. Only repositories whose methods are not DbOps yet use
   * them, and those are only ever constructed on a synchronous client.
   */
  private get syncClient(): ISyncDatabaseClient {
    return this.client as unknown as ISyncDatabaseClient;
  }

  /**
   * Soft delete a record by setting IsDeleted = 1.
   * @param table - The table name
   * @param id - The record ID
   * @returns Number of rows affected
   */
  protected softDelete(table: string, id: string): number {
    const now = dateFormatter.now();
    return this.syncClient.executeUpdate(
      `UPDATE ${table} SET IsDeleted = 1, UpdatedAt = ? WHERE Id = ?`,
      [now, id]
    );
  }

  /**
   * Soft delete records by a foreign key.
   * @param table - The table name
   * @param foreignKey - The foreign key column name
   * @param foreignKeyValue - The foreign key value
   * @returns Number of rows affected
   */
  protected softDeleteByForeignKey(table: string, foreignKey: string, foreignKeyValue: string): number {
    const now = dateFormatter.now();
    return this.syncClient.executeUpdate(
      `UPDATE ${table} SET IsDeleted = 1, UpdatedAt = ? WHERE ${foreignKey} = ?`,
      [now, foreignKeyValue]
    );
  }

  /**
   * Hard delete a record permanently.
   * @param table - The table name
   * @param id - The record ID
   * @returns Number of rows affected
   */
  protected hardDelete(table: string, id: string): number {
    return this.syncClient.executeUpdate(`DELETE FROM ${table} WHERE Id = ?`, [id]);
  }

  /**
   * Hard delete records by a foreign key.
   * @param table - The table name
   * @param foreignKey - The foreign key column name
   * @param foreignKeyValue - The foreign key value
   * @returns Number of rows affected
   */
  protected hardDeleteByForeignKey(table: string, foreignKey: string, foreignKeyValue: string): number {
    return this.syncClient.executeUpdate(
      `DELETE FROM ${table} WHERE ${foreignKey} = ?`,
      [foreignKeyValue]
    );
  }

  /**
   * Hard delete manifest-scoped records by a foreign key, within one manifest.
   * @param table - The table name
   * @param foreignKey - The foreign key column name
   * @param foreignKeyValue - The foreign key value
   * @param manifestId - The manifest whose rows may be deleted
   * @returns Number of rows affected
   */
  protected hardDeleteByScopedForeignKey(table: string, foreignKey: string, foreignKeyValue: string, manifestId: string): number {
    return this.syncClient.executeUpdate(
      `DELETE FROM ${table} WHERE ${foreignKey} = ? AND ManifestId = ?`,
      [foreignKeyValue, manifestId]
    );
  }

  /**
   * Check if a table exists in the database.
   * @param tableName - The name of the table to check
   * @returns True if the table exists
   */
  protected tableExists(tableName: string): boolean {
    const results = this.syncClient.executeQuery<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [tableName]
    );
    return results.length > 0;
  }

  /**
   * The manifest a manifest-scoped row belongs to, looked up from the row itself.
   * @param table - The manifest-scoped table to look in
   * @param id - The row id
   * @param column - The column `id` names, when it is not the primary key
   * @returns The manifest id, or null when no such row exists
   */
  protected resolveRowManifestId(table: string, id: string, column: string = 'Id'): string | null {
    const rows = this.syncClient.executeQuery<{ ManifestId: string }>(
      `SELECT ManifestId FROM ${table} WHERE ${column} = ? ORDER BY ManifestId`,
      [id]
    );
    if (rows.length === 0) {
      return null;
    }

    const activeId = this.syncClient.getActiveManifestId() ?? this.personalManifestId();
    return (rows.find(row => row.ManifestId === activeId) ?? rows[0]).ManifestId;
  }

  /**
   * The manifest a row placed in the given folder belongs to: that folder's, or the active manifest when
   * the row sits outside any folder. This is the value the write path stamps onto the row itself (see
   * {@link BaseQueries.MANIFEST_OF_FOLDER}), resolved here for callers that need it a step earlier.
   * @param folderId - The folder the row is placed in, or null for none
   * @returns The manifest id to stamp the row with
   */
  protected manifestOfFolder(folderId: string | null): string {
    const rows = this.syncClient.executeQuery<{ ManifestId: string | null }>(BaseQueries.GET_MANIFEST_OF_FOLDER, [folderId, this.activeManifestId()]);
    const manifestId = rows[0]?.ManifestId;
    if (!manifestId) {
      throw new Error('BaseRepository: could not resolve the manifest for this write; refusing to write a row that names no manifest.');
    }
    return manifestId;
  }

  /**
   * The manifest this client is writing into (currently active manifest).
   * @returns The manifest id new rows are stamped with
   */
  protected activeManifestId(): string {
    const manifestId = this.syncClient.getActiveManifestId() ?? this.personalManifestId();
    if (!manifestId) {
      throw new Error('BaseRepository: this client has no manifest recorded yet (no active manifest and no personal manifest); sync once before writing.');
    }
    return manifestId;
  }

  /**
   * Get the id of the user's personal manifest, as recorded by the last pull. It is client state rather than
   * vault content, so it is read off the client instead of out of the database.
   * @returns The personal manifest id, or null when absent
   */
  protected personalManifestId(): string | null {
    return this.syncClient.getPersonalManifestId();
  }

  /**
   * Generate a new id.
   * @returns A new UUID string
   */
  protected generateId(): string {
    return crypto.randomUUID();
  }

  /**
   * Get the current timestamp in the standard format.
   * @returns Current timestamp string
   */
  protected now(): string {
    return dateFormatter.now();
  }

  /**
   * Build a parameterized IN clause for SQL queries.
   * @param values - Array of values for the IN clause
   * @returns Object with placeholders string and values array
   */
  protected buildInClause(values: string[]): { placeholders: string; values: string[] } {
    return {
      placeholders: values.map(() => '?').join(','),
      values
    };
  }
}
