/**
 * VaultCodec: SQLite materialization methods for the manifest-v1 storage format.
 */

import type {
  CodecManifest,
  CodecDataBucket,
  CodecMaterialized,
  CodecTableData,
} from './RustCore';
import type SqliteClient from './SqliteClient';

/** A single table's rows, byte columns rendered as `{ __b64 }`. */
export type TableData = CodecTableData;

/** Manifest-v1 manifest. */
export type VaultManifest = CodecManifest;

/** A manifest-v1 data bucket. */
export type VaultDataBucket = CodecDataBucket;

/**
 * A decoded blob entry held platform-side during upload: kind + plaintext bytes.
 */
export type BlobEntry = {
  kind: 'favicon' | 'attachment';
  bytes: Uint8Array;
};

/**
 * Marker for an extracted blob reference inside a materialized row.
 */
type BlobRef = {
  __blobRef: string;
  __blobKind?: string;
};

/**
 * VaultCodec — sql.js read/insert methods.
 */
export class VaultCodec {
  /**
   * Read every user table into `TableData[]`, normalizing SQLite byte columns to `{ __b64 }`.
   * @param sqliteClient - client wrapping the open SQLite DB
   */
  public static readTables(sqliteClient: SqliteClient): TableData[] {
    const tableNames = this.listUserTables(sqliteClient);
    const tables: TableData[] = [];
    for (const name of tableNames) {
      const rows = sqliteClient.executeQuery<Record<string, unknown>>(`SELECT * FROM "${name}"`);
      tables.push({ name, records: rows.map(r => this.normalizeRowForJson(r)) });
    }
    return tables;
  }

  /**
   * Read the named tables (normalized), keyed by table name.
   * @param sqliteClient - client wrapping the open SQLite DB
   * @param names - the table names to read (a bucket's tables)
   */
  public static readNamedTables(sqliteClient: SqliteClient, names: string[]): Record<string, Array<Record<string, unknown>>> {
    const existing = new Set(this.listUserTables(sqliteClient));
    const out: Record<string, Array<Record<string, unknown>>> = {};
    for (const name of names) {
      if (!existing.has(name)) {
        continue;
      }
      const rows = sqliteClient.executeQuery<Record<string, unknown>>(`SELECT * FROM "${name}"`);
      out[name] = rows.map(r => this.normalizeRowForJson(r));
    }
    return out;
  }

  /**
   * Read the latest EF migration ID from `__EFMigrationsHistory` (empty string if not stamped).
   * @param sqliteClient - opened client
   */
  public static getLatestMigrationId(sqliteClient: SqliteClient): string {
    try {
      const rows = sqliteClient.executeQuery<{ MigrationId: string }>(
        'SELECT MigrationId FROM __EFMigrationsHistory ORDER BY MigrationId DESC LIMIT 1'
      );
      return rows[0]?.MigrationId ?? '';
    } catch {
      return '';
    }
  }

  /**
   * The column set of the local client schema, per table: the input Rust's materialize uses to
   * split off anything a newer writer stored that this schema cannot hold (see `CodecOverflow`).
   * @param schemaSql - the COMPLETE_SCHEMA_SQL string for the target client version
   */
  public static async getSchemaColumns(schemaSql: string): Promise<Record<string, string[]>> {
    const db = await this.createDatabase();
    try {
      db.run(schemaSql);
      const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0]?.values.map(v => String(v[0])) ?? [];
      const out: Record<string, string[]> = {};
      for (const table of tables) {
        out[table] = db.exec(`PRAGMA table_info("${table}")`)[0]?.values.map(v => String(v[1])) ?? [];
      }
      return out;
    } finally {
      db.close();
    }
  }

  /**
   * Insert the materialized tables into a fresh SQLite database and export it (base64).
   * @param materialized - tables + migration id produced by the Rust `materialize_as_sqlite`
   * @param blobs - map of `hash -> plaintext bytes` (caller fetched + decrypted these)
   * @param schemaSql - the COMPLETE_SCHEMA_SQL string for the target client version
   * @returns A base64-encoded SQLite database identical (in row content) to the original.
   */
  public static async insertTables(materialized: CodecMaterialized, blobs: Map<string, Uint8Array>, schemaSql: string): Promise<string> {
    const db = await this.createDatabase();

    try {
      // 1) Apply the schema.
      db.run(schemaSql);
      console.info('[VaultCodec] Schema applied.');

      // 2) Stamp __EFMigrationsHistory so VaultSqlGenerator pickup of the version matches what was exported.
      try {
        db.run('INSERT OR IGNORE INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion") VALUES (?, ?)', [
          materialized.migrationId,
          'manifest-v1',
        ]);
      } catch {
        // Tolerate schema variations — some COMPLETE_SCHEMA_SQL forms stamp it themselves.
      }

      /*
       * SQLite enforces foreign keys immediately (no deferral), and tables are inserted in the order Rust
       * emitted them, so child rows (e.g. Attachments) may precede their parents (Items). Disable enforcement
       * for the bulk load; an explicit foreign_key_check below validates the fully-assembled result instead.
       */
      db.run('PRAGMA foreign_keys = OFF');
      db.run('BEGIN TRANSACTION');

      // Tables present in the freshly-created schema; rows for tables outside it cannot be inserted.
      const schemaTables = new Set<string>(db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0]?.values.map(v => String(v[0])) ?? []);

      // 3) Insert every materialized table's rows.
      for (const { name: tableName, records: rows } of materialized.tables) {
        if (rows.length === 0) {
          continue;
        }

        if (!schemaTables.has(tableName)) {
          // Skip tables that are not present in the schema definition.
          console.warn(`[VaultCodec] Skipping table "${tableName}" (${rows.length} rows), not present in the schema.`);
          continue;
        }

        console.info(`[VaultCodec] Inserting ${rows.length} rows into "${tableName}"...`);
        for (const row of rows) {
          const cols = Object.keys(row);
          const placeholders = cols.map(() => '?').join(', ');
          const values: unknown[] = cols.map(c => {
            const v = row[c];
            if (this.isBlobRef(v)) {
              return blobs.get((v as BlobRef).__blobRef) ?? null;
            }
            // Decode inlined byte payloads ({ __b64 }) back to raw bytes.
            if (this.isInlineB64(v)) {
              return this.base64ToBytes((v as { __b64: string }).__b64);
            }
            return v as unknown;
          });

          const quotedCols = cols.map(c => `"${c}"`).join(', ');
          try {
            db.run(`INSERT INTO "${tableName}" (${quotedCols}) VALUES (${placeholders})`, values as never);
          } catch (e) {
            throw new Error(`VaultCodec: failed to insert row into "${tableName}" (columns: ${cols.join(', ')}): ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }

      db.run('COMMIT');

      // 4) Verify referential integrity of the fully-assembled database.
      const fkViolations = db.exec('PRAGMA foreign_key_check');
      if (fkViolations.length > 0) {
        const sample = fkViolations[0].values.slice(0, 5).map(v => `${v[0]} row ${v[1]} → missing parent in ${v[2]}`).join('; ');
        throw new Error(`VaultCodec: materialized database fails foreign key check (${fkViolations[0].values.length} violations): ${sample}`);
      }
      console.info('[VaultCodec] Foreign key check passed.');

      // 5) Export.
      const bytes = db.export();
      console.info(`[VaultCodec] Reassembly complete: exported SQLite of ${bytes.length} bytes.`);
      let binaryString = '';
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i]);
      }
      return btoa(binaryString);
    } finally {
      db.close();
    }
  }

  /**
   * Open a fresh in-memory sql.js database.
   */
  private static async createDatabase(): Promise<import('sql.js').Database> {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs({
      /**
       * Locates SQL.js files from the local file system.
       * @param file - The name of the file to locate
       * @returns The complete URL path to the file
       */
      locateFile: (file: string): string => `src/${file}`
    });
    return new SQL.Database();
  }

  /**
   * Enumerate the names of all user tables in the database (excluding SQLite internals).
   * @param sqliteClient - opened client
   */
  private static listUserTables(sqliteClient: SqliteClient): string[] {
    const rows = sqliteClient.executeQuery<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    return rows.map(r => r.name);
  }

  /**
   * Normalize a SQLite-returned row into a JSON-safe shape — Uint8Array bytes become `{ __b64: ... }`.
   * @param row - raw row from sql.js
   */
  private static normalizeRowForJson(row: Record<string, unknown>): Record<string, unknown> {
    /*
     * SQLite returns BLOB columns as Uint8Array. JSON.stringify turns those into an object of numeric keys
     * which round-trips poorly, so we encode any byte-shaped values as base64 with a discriminator. Rust then
     * decides which columns are extracted blobs vs. inline bytes.
     */
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (v == null) {
        out[k] = null;
        continue;
      }

      if (this.looksLikeBytes(v)) {
        out[k] = { __b64: this.bytesToBase64(this.toUint8Array(v)) };
        continue;
      }

      out[k] = v;
    }
    return out;
  }

  /**
   * Heuristic: true if the value looks like a byte buffer (Uint8Array, number array, or sparse number map).
   * @param v - value to inspect
   */
  private static looksLikeBytes(v: unknown): boolean {
    return v instanceof Uint8Array
      || Array.isArray(v)
      || (typeof v === 'object' && v !== null && Object.values(v).every(x => typeof x === 'number'));
  }

  /**
   * Coerce a byte-shaped value into a Uint8Array. Counterpart of {@link looksLikeBytes}.
   * @param v - value to coerce
   */
  private static toUint8Array(v: unknown): Uint8Array {
    if (v instanceof Uint8Array) {
      return v;
    }

    if (Array.isArray(v)) {
      return new Uint8Array(v as number[]);
    }

    const obj = v as { [key: number]: number };
    const length = Object.keys(obj).length;
    const arr = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      arr[i] = obj[i];
    }
    return arr;
  }

  /**
   * Type guard: true if `v` is a manifest-row blob reference (the marker Rust substitutes for extracted bytes).
   * @param v - value to inspect
   */
  private static isBlobRef(v: unknown): v is BlobRef {
    return typeof v === 'object' && v !== null && '__blobRef' in v;
  }

  /**
   * Type guard: true if `v` is an inlined byte payload (`{ __b64 }`).
   * @param v - value to inspect
   */
  private static isInlineB64(v: unknown): v is { __b64: string } {
    return typeof v === 'object' && v !== null && '__b64' in v;
  }

  /**
   * Decode a base64 string back into raw bytes. Counterpart of {@link bytesToBase64}.
   * @param base64 - base64-encoded bytes
   */
  public static base64ToBytes(base64: string): Uint8Array {
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  }

  /**
   * Base64-encode a byte array via latin-1 character codes.
   * @param bytes - bytes to encode
   */
  private static bytesToBase64(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
      s += String.fromCharCode(bytes[i]);
    }
    return btoa(s);
  }
}

export default VaultCodec;
