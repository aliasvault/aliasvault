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

    const rootId = this.rootManifestId();
    return (rows.find(row => row.ManifestId === rootId) ?? rows[0]).ManifestId;
  }

  /**
   * Get the vault's root manifest id from the Manifests bookkeeping table.
   * @returns The root manifest id, or null when absent
   */
  protected rootManifestId(): string | null {
    if (!this.tableExists('Manifests')) {
      return null;
    }
    const results = this.client.executeQuery<{ Id: string }>(BaseQueries.GET_ROOT_MANIFEST_ID);
    return results.length > 0 ? results[0].Id : null;
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
