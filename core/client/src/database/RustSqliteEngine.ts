/**
 * The SQLite engine backed by the Rust core's bundled SQLite.
 */
import * as core from '../../wasm/aliasvault_core.js';

import type { ISqliteDatabase, ISqliteEngine, SqliteValue } from '../platform/SqliteEngine';
import type { IRustCore } from '../rust/RustCoreBinding';

/**
 * A database held in the Rust core's memory, behind the engine interface.
 */
class RustSqliteDatabase implements ISqliteDatabase {
  /**
   * Wrap an open core database.
   * @param db - the open database
   */
  public constructor(private readonly db: core.SqliteMemoryDatabase) {}

  /** @inheritdoc */
  public run(sql: string, params: SqliteValue[] = []): number {
    return this.db.run(sql, params);
  }

  /** @inheritdoc */
  public query<T>(sql: string, params: SqliteValue[] = []): T[] {
    return this.db.query(sql, params) as T[];
  }

  /** @inheritdoc */
  public exec(sql: string): void {
    this.db.exec(sql);
  }

  /** @inheritdoc */
  public export(): Uint8Array {
    return this.db.export();
  }

  /** @inheritdoc */
  public close(): void {
    this.db.close();
    this.db.free();
  }
}

/**
 * Bind the engine interface to the Rust core's SQLite host.
 * @param rustCore - the core binding, initialized before the first open
 */
export function createRustSqliteEngine(rustCore: IRustCore): ISqliteEngine {
  return {
    /** @inheritdoc */
    open: async (bytes?: Uint8Array): Promise<ISqliteDatabase> => {
      await rustCore.init();
      return new RustSqliteDatabase(bytes ? core.SqliteMemoryDatabase.fromBytes(bytes) : core.SqliteMemoryDatabase.empty());
    },
  };
}
