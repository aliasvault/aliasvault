import * as dateFormatter from '../utilities/DateFormatter';

import { runAsync } from './DbOp';
import { BaseQueries } from './queries/BaseQueries';

import type { DbOp, ManifestScope } from './DbOp';
import type { ISqliteDatabase } from '../platform/SqliteEngine';

export type SqliteBindValue = string | number | null | Uint8Array;

/**
 * The database operations repositories need from their host, answered synchronously (sql.js) or asynchronously
 * (the mobile native bridge).
 */
export interface IDatabaseClient {
  /** True when writes only persist once a transaction commits; a write outside a transaction then gets its own. */
  readonly persistsOnCommit?: boolean;
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
 */
export abstract class BaseRepository {
  /**
   * Constructor for the BaseRepository class.
   * @param client - The database client to use for the repository
   */
  public constructor(protected client: IDatabaseClient) {}

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
   * The id of the user's personal manifest, as recorded by the last pull.
   * @returns The personal manifest id, or null when absent
   */
  protected *personalManifestId(): DbOp<string | null> {
    return (yield* this.manifestScope()).personal;
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
   * The manifest a manifest-scoped row belongs to, looked up from the row itself.
   * @param table - The manifest-scoped table to look in
   * @param id - The row id
   * @param column - The column `id` names, when it is not the primary key
   * @returns The manifest id, or null when no such row exists
   */
  protected *resolveRowManifestId(table: string, id: string, column: string = 'Id'): DbOp<string | null> {
    const rows = yield* this.query<{ ManifestId: string }>(`SELECT ManifestId FROM ${table} WHERE ${column} = ? ORDER BY ManifestId`, [id]);
    if (rows.length === 0) {
      return null;
    }

    const { active, personal } = yield* this.manifestScope();
    const preferredId = active ?? personal;
    return (rows.find(row => row.ManifestId === preferredId) ?? rows[0]).ManifestId;
  }

  /**
   * The manifest a row placed in the given folder belongs to: that folder's, or the write manifest when the row
   * sits outside any folder. The same value the write path stamps (see {@link BaseQueries.MANIFEST_OF_FOLDER}).
   * @param folderId - The folder the row is placed in, or null for none
   * @returns The manifest id to stamp the row with
   */
  protected *manifestOfFolder(folderId: string | null): DbOp<string> {
    const fallbackManifestId = yield* this.writeManifestId();
    const rows = yield* this.query<{ ManifestId: string | null }>(BaseQueries.GET_MANIFEST_OF_FOLDER, [folderId, fallbackManifestId]);
    const manifestId = rows[0]?.ManifestId;
    if (!manifestId) {
      throw new Error('BaseRepository: could not resolve the manifest for this write; refusing to write a row that names no manifest.');
    }
    return manifestId;
  }

  /**
   * Hard delete manifest-scoped records by a foreign key, within one manifest.
   * @param table - The table name
   * @param foreignKey - The foreign key column name
   * @param foreignKeyValue - The foreign key value
   * @param manifestId - The manifest whose rows may be deleted
   * @returns Number of rows affected
   */
  protected *hardDeleteByScopedForeignKey(table: string, foreignKey: string, foreignKeyValue: string, manifestId: string): DbOp<number> {
    return yield* this.execute(`DELETE FROM ${table} WHERE ${foreignKey} = ? AND ManifestId = ?`, [foreignKeyValue, manifestId]);
  }

  /**
   * Run a DbOp from an async method.
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
}
