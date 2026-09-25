import { Buffer } from 'buffer';

import type { IDatabaseClient, SqliteBindValue } from '@aliasvault/client/database/BaseRepository';
import { DEFAULT_VAULT_MUTATION_SCOPE, type VaultMutationScope } from '@aliasvault/client/sync/VaultMutationScope';

import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Prefix the bridge puts in front of a base64 BLOB result, so it is not mistaken for text.
 */
const BLOB_RESULT_PREFIX = 'av-blob-base64:';

/**
 * The client core's database client over the native vault store. Every call crosses the React Native bridge, so
 * every call is asynchronous, and the native store persists the vault and marks it dirty when a transaction commits.
 */
export class NativeDatabaseClient implements IDatabaseClient {
  /**
   * Native only persists the vault on commit, so a write outside a transaction gets one of its own.
   */
  public readonly persistsOnCommit = true;

  private transactionOpen = false;

  /**
   * Run a SELECT and return its rows, with BLOB columns as bytes.
   */
  public async executeQuery<T>(query: string, params: SqliteBindValue[] = []): Promise<T[]> {
    try {
      const rows = (await NativeVaultManager.executeQuery(query, toBridgeParams(params))) as unknown as Record<string, unknown>[];
      return rows.map(decodeBlobColumns) as T[];
    } catch (error) {
      throw withStatement(error, query, 'Error executing query:');
    }
  }

  /**
   * Run an INSERT, UPDATE or DELETE and return the number of rows it changed.
   */
  public async executeUpdate(query: string, params: SqliteBindValue[] = []): Promise<number> {
    try {
      return await NativeVaultManager.executeUpdate(query, toBridgeParams(params));
    } catch (error) {
      throw withStatement(error, query, 'Error executing update:');
    }
  }

  /**
   * Begin a transaction.
   */
  public async beginTransaction(): Promise<void> {
    await NativeVaultManager.beginTransaction();
    this.transactionOpen = true;
  }

  /**
   * Commit the transaction, which persists the vault and marks it dirty for the given scope.
   * @param scope - what the mutation touched; a full-manifest change when omitted
   */
  public async commitTransaction(scope?: VaultMutationScope): Promise<void> {
    await NativeVaultManager.commitTransaction(scope ?? DEFAULT_VAULT_MUTATION_SCOPE);
    this.transactionOpen = false;
  }

  /**
   * Roll the transaction back.
   */
  public async rollbackTransaction(): Promise<void> {
    try {
      await NativeVaultManager.rollbackTransaction();
    } finally {
      this.transactionOpen = false;
    }
  }

  /**
   * Whether a transaction opened through this client is still open.
   */
  public isInTransaction(): boolean {
    return this.transactionOpen;
  }

  /**
   * The personal manifest id, as the last sync recorded it in the native sync engine state.
   */
  public getPersonalManifestId(): Promise<string | null> {
    return NativeVaultManager.getPersonalManifestId();
  }
}

/**
 * Encode parameters for the bridge, which only carries strings, numbers and null. Bytes travel as base64 behind a
 * prefix the native side recognizes and binds as a BLOB again.
 */
function toBridgeParams(params: SqliteBindValue[]): (string | number | null)[] {
  return params.map((param) => param instanceof Uint8Array ? 'av-base64-to-blob:' + Buffer.from(param).toString('base64') : param);
}

/**
 * Turn the BLOB columns of a result row, which the bridge sends as prefixed base64, back into bytes.
 */
function decodeBlobColumns(row: Record<string, unknown>): Record<string, unknown> {
  for (const [column, value] of Object.entries(row)) {
    if (typeof value === 'string' && value.startsWith(BLOB_RESULT_PREFIX)) {
      row[column] = new Uint8Array(Buffer.from(value.slice(BLOB_RESULT_PREFIX.length), 'base64'));
    }
  }
  return row;
}

/**
 * Attach the failing statement to a bridge error, so the log shows which SQL failed.
 */
function withStatement(error: unknown, query: string, logPrefix: string): Error {
  const enriched = new Error(error instanceof Error ? error.message : String(error));
  enriched.stack = `SQL: ${query.trim().substring(0, 200)}\n\n${error instanceof Error && error.stack ? error.stack : ''}`;
  console.error(logPrefix, enriched.message);
  return enriched;
}
