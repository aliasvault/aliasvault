/**
 * A value bound to or read from a SQLite statement.
 */
export type SqliteValue = string | number | null | Uint8Array;

/**
 * A row as the engine returns it: column name to value. Byte columns come back as Uint8Array.
 */
export type SqliteRow = Record<string, SqliteValue>;

/**
 * A compiled statement, for bulk inserts that bind the same SQL many times.
 */
export interface ISqliteStatement {
  /** Bind the parameters and run the statement to completion. */
  run(params: SqliteValue[]): void;

  /** Release the statement. */
  finalize(): void;
}

/**
 * One open SQLite database. Every call is synchronous: the repositories and the codec drive the database
 * step by step, which only a synchronous engine can do without turning every read into a promise.
 */
export interface ISqliteDatabase {
  /**
   * Run a statement that returns no rows and report how many rows it changed.
   */
  run(sql: string, params?: SqliteValue[]): number;

  /**
   * Run a statement and return its rows.
   */
  query<T = SqliteRow>(sql: string, params?: SqliteValue[]): T[];

  /**
   * Run one or more statements separated by semicolons, without parameters.
   */
  exec(sql: string): void;

  /**
   * Compile a statement for repeated execution.
   */
  prepare(sql: string): ISqliteStatement;

  /**
   * The database as SQLite file bytes.
   */
  export(): Uint8Array;

  /**
   * Close the database and free its memory.
   */
  close(): void;
}

/**
 * The SQLite engine a host provides. The browser and web hosts use sql.js (see SqlJsEngine); the mobile host uses
 * expo-sqlite. Databases live in memory only: the vault at rest is the encrypted blob, never a database file.
 */
export interface ISqliteEngine {
  /**
   * Open a database in memory, from the given SQLite file bytes or empty when omitted.
   */
  open(bytes?: Uint8Array): Promise<ISqliteDatabase>;
}
