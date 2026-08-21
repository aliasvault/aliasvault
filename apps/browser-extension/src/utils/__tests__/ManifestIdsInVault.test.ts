import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';

import { VaultCodec } from '../VaultCodec';

import type SqliteClient from '../SqliteClient';
import type { Database } from 'sql.js';

const PERSONAL = 'PERSONAL-MANIFEST';
const SHARED = 'SHARED-MANIFEST';

/**
 * Wrap an in-memory database as the sliver of {@link SqliteClient} the codec reads through.
 * @param db - the database to read
 * @returns A client that can answer `executeQuery`
 */
function asClient(db: Database): SqliteClient {
  return {
    /**
     * Run a statement and return its rows as plain objects.
     * @param query - the statement
     * @param params - bound parameters
     * @returns The rows
     */
    executeQuery: <T>(query: string, params: unknown[] = []): T[] => {
      const stmt = db.prepare(query);
      stmt.bind(params as never);
      const out: T[] = [];
      while (stmt.step()) {
        out.push(stmt.getAsObject() as T);
      }
      stmt.free();
      return out;
    },
  } as unknown as SqliteClient;
}

/**
 * Build a vault holding a stamped table, an unstamped one, and a table this check must discover on its own.
 * @returns The prepared database
 */
async function makeDb(): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE Folders (ManifestId TEXT NOT NULL, Id TEXT NOT NULL, Name TEXT, PRIMARY KEY (ManifestId, Id));
    CREATE TABLE Items (ManifestId TEXT NOT NULL, Id TEXT NOT NULL, PRIMARY KEY (ManifestId, Id));
    CREATE TABLE __EFMigrationsHistory (MigrationId TEXT NOT NULL PRIMARY KEY, ProductVersion TEXT NOT NULL);
    INSERT INTO Folders VALUES ('${PERSONAL}', 'FOLDER-MINE', 'Mine'), ('${SHARED}', 'FOLDER-SHARED', 'Team');
    INSERT INTO Items VALUES ('${PERSONAL}', 'ITEM-MINE');
    INSERT INTO __EFMigrationsHistory VALUES ('20260101_Init', '9.0.0');
  `);
  return db;
}

describe('VaultCodec.manifestIdsInVault', () => {
  it('reports every manifest the vault holds a row for, from every stamped table', async () => {
    const ids = VaultCodec.manifestIdsInVault(asClient(await makeDb()));
    expect([...ids].sort()).toEqual([PERSONAL, SHARED]);
  });

  it('finds a table nothing lists, because it reads the stamp column off the schema', async () => {
    const db = await makeDb();
    db.run(`CREATE TABLE SomethingNewer (ManifestId TEXT NOT NULL, Id TEXT NOT NULL); INSERT INTO SomethingNewer VALUES ('THIRD-MANIFEST', 'X');`);
    expect(VaultCodec.manifestIdsInVault(asClient(db)).has('THIRD-MANIFEST')).toBe(true);
  });

  it('keeps the stamp exactly as written, since that is how the codec routes it', async () => {
    const db = await makeDb();
    db.run(`INSERT INTO Items VALUES ('${SHARED.toLowerCase()}', 'ITEM-OTHERCASE');`);
    const ids = VaultCodec.manifestIdsInVault(asClient(db));
    expect(ids.has(SHARED)).toBe(true);
    expect(ids.has(SHARED.toLowerCase())).toBe(true);
  });

  it('ignores unstamped rows and unstamped tables', async () => {
    const db = await makeDb();
    db.run(`CREATE TABLE Unstamped (Id TEXT NOT NULL); INSERT INTO Unstamped VALUES ('X');`);
    db.run(`CREATE TABLE Loose (ManifestId TEXT, Id TEXT NOT NULL); INSERT INTO Loose VALUES (NULL, 'A'), ('', 'B');`);
    expect([...VaultCodec.manifestIdsInVault(asClient(db))].sort()).toEqual([PERSONAL, SHARED]);
  });

  it('is empty for a vault predating the stamps, so a legacy vault never looks unwritable', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`CREATE TABLE Folders (Id TEXT NOT NULL PRIMARY KEY, Name TEXT); INSERT INTO Folders VALUES ('FOLDER-LEGACY', 'Mine');`);
    expect(VaultCodec.manifestIdsInVault(asClient(db)).size).toBe(0);
  });
});
