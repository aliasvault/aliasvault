import * as dateFormatter from '@/utils/dateFormatter';

import NativeVaultManager from '@/specs/NativeVaultManager';

export type SqliteBindValue = string | number | null | Uint8Array;

/**
 * Interface for the core database operations needed by repositories.
 * Mobile app version is async as it communicates with native modules.
 */
export interface IDatabaseClient {
  executeQuery<T>(query: string, params?: SqliteBindValue[]): Promise<T[]>;
  executeUpdate(query: string, params?: SqliteBindValue[]): Promise<number>;
}

/**
 * Base repository class with common database operations.
 * Provides transaction handling, soft delete, and other shared functionality.
 *
 * Mobile-specific: All operations are async as they communicate with native modules.
 */
export abstract class BaseRepository {
  /**
   * Constructor for the BaseRepository class.
   * @param client - The database client to use for the repository
   */
  public constructor(protected client: IDatabaseClient) {}

  /**
   * Execute a function within a transaction.
   * Automatically handles begin, commit, and rollback.
   * @param fn - The function to execute within the transaction
   * @returns The result of the function
   */
  protected async withTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
    await NativeVaultManager.beginTransaction();
    try {
      const result = await fn();
      await NativeVaultManager.commitTransaction();
      return result;
    } catch (error) {
      await NativeVaultManager.rollbackTransaction();
      throw error;
    }
  }

  /**
   * Soft delete a record by setting IsDeleted = 1.
   * @param table - The table name
   * @param id - The record ID
   * @returns Number of rows affected
   */
  protected async softDelete(table: string, id: string): Promise<number> {
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
  protected async softDeleteByForeignKey(table: string, foreignKey: string, foreignKeyValue: string): Promise<number> {
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
  protected async hardDelete(table: string, id: string): Promise<number> {
    return this.client.executeUpdate(`DELETE FROM ${table} WHERE Id = ?`, [id]);
  }

  /**
   * Hard delete records by a foreign key.
   * @param table - The table name
   * @param foreignKey - The foreign key column name
   * @param foreignKeyValue - The foreign key value
   * @returns Number of rows affected
   */
  protected async hardDeleteByForeignKey(table: string, foreignKey: string, foreignKeyValue: string): Promise<number> {
    return this.client.executeUpdate(
      `DELETE FROM ${table} WHERE ${foreignKey} = ?`,
      [foreignKeyValue]
    );
  }

  /**
   * Check if a table exists in the database.
   * @param tableName - The name of the table to check
   * @returns True if the table exists
   */
  protected async tableExists(tableName: string): Promise<boolean> {
    const results = await this.client.executeQuery<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [tableName]
    );
    return results.length > 0;
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
