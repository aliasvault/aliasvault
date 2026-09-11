/**
 * The SQLite engine backed by sql.js, for hosts with a WebAssembly runtime (browser extension, web app, Node
 * tests).
 */
import initSqlJs from 'sql.js';

import type { ISqliteDatabase, ISqliteEngine, ISqliteStatement, SqliteValue } from '../platform/SqliteEngine';
import type { Database, SqlJsStatic } from 'sql.js';

/**
 * A sql.js database behind the engine interface.
 */
class SqlJsDatabase implements ISqliteDatabase {
  /**
   * Wrap an open sql.js database.
   * @param db - the open sql.js database
   */
  public constructor(private readonly db: Database) {}

  /** @inheritdoc */
  public run(sql: string, params: SqliteValue[] = []): number {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      statement.step();
      return this.db.getRowsModified();
    } finally {
      statement.free();
    }
  }

  /** @inheritdoc */
  public query<T>(sql: string, params: SqliteValue[] = []): T[] {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      const rows: T[] = [];
      while (statement.step()) {
        rows.push(statement.getAsObject() as T);
      }
      return rows;
    } finally {
      statement.free();
    }
  }

  /** @inheritdoc */
  public exec(sql: string): void {
    this.db.run(sql);
  }

  /** @inheritdoc */
  public prepare(sql: string): ISqliteStatement {
    const statement = this.db.prepare(sql);
    return {
      /** Bind and run. */
      run: (params: SqliteValue[]): void => {
        statement.run(params);
      },
      /** Free the statement. */
      finalize: (): void => {
        statement.free();
      },
    };
  }

  /** @inheritdoc */
  public export(): Uint8Array {
    return this.db.export();
  }

  /** @inheritdoc */
  public close(): void {
    this.db.close();
  }
}

/**
 * Bind the engine interface to sql.js.
 * @param locateFile - resolves a sql.js support file (`sql-wasm.wasm`) to a URL the runtime can fetch
 */
export function createSqlJsEngine(locateFile: (file: string) => string): ISqliteEngine {
  let sqlJs: Promise<SqlJsStatic> | null = null;

  /**
   * Load sql.js once; a failed load is forgotten so the next caller retries.
   */
  const load = (): Promise<SqlJsStatic> => {
    sqlJs ??= initSqlJs({ locateFile }).catch((error: unknown) => {
      sqlJs = null;
      throw error;
    });
    return sqlJs;
  };

  return {
    /** @inheritdoc */
    open: async (bytes?: Uint8Array): Promise<ISqliteDatabase> => {
      const SQL = await load();
      return new SqlJsDatabase(bytes ? new SQL.Database(bytes) : new SQL.Database());
    },
  };
}
