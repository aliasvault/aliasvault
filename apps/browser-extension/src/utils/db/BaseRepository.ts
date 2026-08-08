import * as dateFormatter from '@/utils/DateFormatter';

import { BaseQueries } from './queries/BaseQueries';

import type { Database } from 'sql.js';

export type SqliteBindValue = string | number | null | Uint8Array;

/**
 * Interface for the core database operations needed by repositories.
 */
export interface IDatabaseClient {
  getDb(): Database | null;
  executeQuery<T>(query: string, params?: SqliteBindValue[]): T[];
  executeUpdate(query: string, params?: SqliteBindValue[]): number;
  beginTransaction(): void;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): void;
  getActiveManifestId(): string | null;
  getPersonalManifestId(): string | null;
}

/**
 * Base repository class with common database operations.
 * Provides transaction handling, soft delete, and other shared functionality.
 */
export abstract class BaseRepository {
  /**
   * Constructor for the BaseRepository class.
   * @param client - The database client to use for the repository
   */
  public constructor(protected client: IDatabaseClient) {}

  /**
   * Sync the manifest of every item-scoped row based on the item it hangs off.
   * This method should be called after anything that moves items between manifests, inside the same transaction.
   * @returns The number of child rows re-stamped
   */
  protected resyncItemChildManifests(): number {
    return BaseQueries.RESYNC_ITEM_CHILD_MANIFESTS.reduce((total, sql) => total + this.client.executeUpdate(sql), 0);
  }

  /**
   * Execute a function within a transaction.
   * Automatically handles begin, commit, and rollback.
   * @param fn - The function to execute within the transaction
   * @returns The result of the function
   */
  protected async withTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
    this.client.beginTransaction();
    try {
      const result = await fn();
      await this.client.commitTransaction();
      return result;
    } catch (error) {
      this.client.rollbackTransaction();
      throw error;
    }
  }

  /**
   * Soft delete a record by setting IsDeleted = 1.
   * @param table - The table name
   * @param id - The record ID
   * @returns Number of rows affected
   */
  protected softDelete(table: string, id: string): number {
    const now = dateFormatter.now();
    return this.client.executeUpdate(
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
    return this.client.executeUpdate(
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
    return this.client.executeUpdate(`DELETE FROM ${table} WHERE Id = ?`, [id]);
  }

  /**
   * Hard delete records by a foreign key.
   * @param table - The table name
   * @param foreignKey - The foreign key column name
   * @param foreignKeyValue - The foreign key value
   * @returns Number of rows affected
   */
  protected hardDeleteByForeignKey(table: string, foreignKey: string, foreignKeyValue: string): number {
    return this.client.executeUpdate(
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
    return this.client.executeUpdate(
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
    const results = this.client.executeQuery<{ name: string }>(
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
    const rows = this.client.executeQuery<{ ManifestId: string }>(
      `SELECT ManifestId FROM ${table} WHERE ${column} = ? ORDER BY ManifestId`,
      [id]
    );
    if (rows.length === 0) {
      return null;
    }

    const activeId = this.client.getActiveManifestId() ?? this.personalManifestId();
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
    const rows = this.client.executeQuery<{ ManifestId: string | null }>(BaseQueries.GET_MANIFEST_OF_FOLDER, [folderId, this.activeManifestId()]);
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
    const manifestId = this.client.getActiveManifestId() ?? this.personalManifestId();
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
    return this.client.getPersonalManifestId();
  }

  /**
   * Generate a new UUID in uppercase format.
   * @returns A new UUID string
   */
  protected generateId(): string {
    return crypto.randomUUID().toUpperCase();
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
