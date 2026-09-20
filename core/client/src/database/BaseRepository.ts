import { multiManifestRendering } from '../sharing/MultiManifestRendering';
import { DEFAULT_VAULT_MUTATION_SCOPE } from '../sync/VaultMutationScope';
import * as dateFormatter from '../utilities/DateFormatter';

import { runAsync } from './DbOp';
import { FolderQueries } from './queries/FolderQueries';

import type { DbOp, ManifestScope } from './DbOp';
import type { Folder } from './repositories/FolderRepository';
import type { ISqliteDatabase } from '../platform/SqliteEngine';
import type { SharedManifest } from '../sharing/MultiManifestRendering';
import type { VaultMutationScope } from '../sync/VaultMutationScope';

export type SqliteBindValue = string | number | null | Uint8Array;

/**
 * The database operations repositories need from their host, answered synchronously or asynchronously
 * (the mobile native bridge).
 */
export interface IDatabaseClient {
  /** True when writes only persist once a transaction commits; a write outside a transaction then gets its own. */
  readonly persistsOnCommit?: boolean;
  executeQuery<T>(query: string, params?: SqliteBindValue[]): T[] | Promise<T[]>;
  executeUpdate(query: string, params?: SqliteBindValue[]): number | Promise<number>;
  beginTransaction(): void | Promise<void>;
  commitTransaction(scope?: VaultMutationScope): Promise<void>;
  rollbackTransaction(): void | Promise<void>;
  isInTransaction(): boolean;
  getActiveManifestId(): string | null;
  getPersonalManifestId(): string | null | Promise<string | null>;
  recordMutationScope?(scope: VaultMutationScope): void;
}

/**
 * A database client that answers every call synchronously.
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
   * What this repository's writes touch. Set by the wrapper that binds the repository to a client, and read
   * back on every write so that async methods report the same scope the wrapper does.
   */
  private mutationScope: VaultMutationScope = DEFAULT_VAULT_MUTATION_SCOPE;

  /**
   * Constructor for the BaseRepository class.
   * @param client - The database client to use for the repository
   */
  public constructor(protected client: IDatabaseClient) {}

  /**
   * Tell this repository which mutation scope its writes belong to.
   * @param scope - The scope
   */
  public setMutationScope(scope: VaultMutationScope): void {
    this.mutationScope = scope;
  }

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
   * The folders as the client presents them (see {@link multiManifestRendering}): the stored rows plus potentially shared manifests
   * as virtual folders.
   * @returns The rendered folders (empty array if the vault predates the Folders table or the manifest stamp)
   */
  protected *renderedFolders(): DbOp<Folder[]> {
    try {
      const stored = yield* this.query<Folder>(FolderQueries.GET_ALL);
      const personal = yield* this.personalManifestId();
      const shared = personal ? yield* this.query<SharedManifest>(FolderQueries.GET_SHARED_MANIFESTS, [personal]) : [];
      return multiManifestRendering.folders(stored, shared);
    } catch (error) {
      if (error instanceof Error && (error.message.includes('no such table') || error.message.includes('no such column'))) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Point rows at the folder they are presented in.
   * @param rows - Rows carrying a stored `FolderId`
   * @returns The same rows, re-pointed in place
   */
  protected *renderFolderIds<T extends { FolderId: string | null; ManifestId: string }>(rows: T[]): DbOp<T[]> {
    if (rows.length === 0) {
      return rows;
    }
    const personal = yield* this.personalManifestId();
    for (const row of rows) {
      row.FolderId = multiManifestRendering.renderedFolderId(row.FolderId, row.ManifestId, personal);
    }
    return rows;
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
    return runAsync(op, this.client, this.mutationScope);
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
      await this.client.commitTransaction(this.mutationScope);
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
