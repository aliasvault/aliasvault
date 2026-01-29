import * as dateFormatter from '@/utils/dateFormatter';

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
