import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';

import { BaseQueries } from '../queries/BaseQueries';
import { LogoQueries } from '../queries/LogoQueries';

import type { Database } from 'sql.js';

const ROOT = 'ROOT-MANIFEST';
const SHARED = 'SHARED-MANIFEST';

/**
 * Build an in-memory vault holding the tables these queries touch, shaped like the real schema
 * (composite (ManifestId, Id) keys, NOT NULL stamps).
 * @returns The prepared database
 */
async function makeDb(): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE Settings ("Key" TEXT NOT NULL PRIMARY KEY, Value TEXT NULL, CreatedAt TEXT NOT NULL, UpdatedAt TEXT NOT NULL, IsDeleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE Folders (ManifestId TEXT NOT NULL, Id TEXT NOT NULL, Name TEXT, ParentFolderId TEXT, PRIMARY KEY (ManifestId, Id));
    CREATE TABLE Logos (ManifestId TEXT NOT NULL, Id TEXT NOT NULL, Kind TEXT NOT NULL DEFAULT 'favicon', Source TEXT NOT NULL, FileData BLOB, MimeType TEXT, Name TEXT, CreatedAt TEXT NOT NULL, UpdatedAt TEXT NOT NULL, IsDeleted INTEGER NOT NULL, PRIMARY KEY (ManifestId, Id));
    CREATE UNIQUE INDEX IX_Logos_ManifestId_Kind_Source ON Logos (ManifestId, Kind, Source);
    CREATE TABLE Items (ManifestId TEXT NOT NULL, Id TEXT NOT NULL, LogoId TEXT, FolderId TEXT, IsDeleted INTEGER NOT NULL, PRIMARY KEY (ManifestId, Id));
    INSERT INTO Settings VALUES ('RootManifestId', '${ROOT}', 't', 't', 0);
    INSERT INTO Folders VALUES ('${SHARED}', 'FOLDER-SHARED', 'Team', NULL), ('${ROOT}', 'FOLDER-MINE', 'Mine', NULL);
  `);
  return db;
}

/**
 * Run a query and return its rows as plain objects.
 * @param db - The database
 * @param sql - The statement
 * @param params - Bound parameters
 * @returns The rows
 */
function rows(db: Database, sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  stmt.bind(params as never);
  const out: Record<string, unknown>[] = [];
  while (stmt.step()) {
    out.push(stmt.getAsObject());
  }
  stmt.free();
  return out;
}

describe('logo manifest scoping', () => {
  it('GET_MANIFEST_OF_FOLDER agrees with what an insert would stamp', async () => {
    const db = await makeDb();
    expect(rows(db, BaseQueries.GET_MANIFEST_OF_FOLDER, ['FOLDER-SHARED', ROOT])[0].ManifestId).toBe(SHARED);
    expect(rows(db, BaseQueries.GET_MANIFEST_OF_FOLDER, ['FOLDER-MINE', ROOT])[0].ManifestId).toBe(ROOT);
    expect(rows(db, BaseQueries.GET_MANIFEST_OF_FOLDER, [null, ROOT])[0].ManifestId).toBe(ROOT);
    expect(rows(db, BaseQueries.GET_MANIFEST_OF_FOLDER, [null, SHARED])[0].ManifestId).toBe(SHARED);
  });

  it('GET_BEST_FOR_KEY prefers the copy that actually carries bytes', async () => {
    const db = await makeDb();
    db.run(`INSERT INTO Logos VALUES ('${SHARED}','L-SHARED','favicon','github.com',NULL,NULL,'empty','t','2026-01-02',0)`);
    db.run(`INSERT INTO Logos VALUES ('${ROOT}','L-ROOT','favicon','github.com',X'0102',NULL,'real','t','2026-01-01',0)`);
    expect(rows(db, LogoQueries.GET_BEST_FOR_KEY, ['favicon', 'github.com'])[0].Name).toBe('real');
  });

  it('finds an item whose logo lives in another manifest, and only that item', async () => {
    const db = await makeDb();
    db.run(`INSERT INTO Logos VALUES ('${ROOT}','L-ROOT','favicon','github.com',X'0102',NULL,NULL,'t','t',0)`);
    db.run(`INSERT INTO Logos VALUES ('${SHARED}','L-SHARED','favicon','gitlab.com',X'0304',NULL,NULL,'t','t',0)`);
    // Moved into the shared folder by a restamp, still pointing at the personal logo row.
    db.run(`INSERT INTO Items VALUES ('${SHARED}','ITEM-MOVED','L-ROOT','FOLDER-SHARED',0)`);
    // Correctly scoped rows of both kinds, plus one with no logo at all.
    db.run(`INSERT INTO Items VALUES ('${ROOT}','ITEM-MINE','L-ROOT','FOLDER-MINE',0)`);
    db.run(`INSERT INTO Items VALUES ('${SHARED}','ITEM-THEIRS','L-SHARED','FOLDER-SHARED',0)`);
    db.run(`INSERT INTO Items VALUES ('${ROOT}','ITEM-BARE',NULL,NULL,0)`);

    const found = rows(db, LogoQueries.FIND_ITEMS_WITH_FOREIGN_LOGO);
    expect(found).toEqual([{ Id: 'ITEM-MOVED', ManifestId: SHARED, Kind: 'favicon', Source: 'github.com' }]);
  });

  it('repointing clears the defect and leaves the origin manifest its own copy', async () => {
    const db = await makeDb();
    db.run(`INSERT INTO Logos VALUES ('${ROOT}','L-ROOT','favicon','github.com',X'0102',NULL,NULL,'t','t',0)`);
    db.run(`INSERT INTO Items VALUES ('${SHARED}','ITEM-MOVED','L-ROOT','FOLDER-SHARED',0)`);
    db.run(`INSERT INTO Items VALUES ('${ROOT}','ITEM-MINE','L-ROOT','FOLDER-MINE',0)`);

    // What adoptIntoScope does: clone under the target manifest's own derived id, then repoint.
    const clonedId = 'L-SHARED-DERIVED';
    db.run(`INSERT INTO Logos VALUES ('${SHARED}','${clonedId}','favicon','github.com',X'0102',NULL,NULL,'t','t',0)`);
    db.run(LogoQueries.REPOINT_ITEM_LOGO, [clonedId, 'ITEM-MOVED', SHARED]);

    expect(rows(db, LogoQueries.FIND_ITEMS_WITH_FOREIGN_LOGO)).toEqual([]);
    // The personal item is untouched and its own copy still exists.
    expect(rows(db, `SELECT LogoId FROM Items WHERE Id = 'ITEM-MINE'`)[0].LogoId).toBe('L-ROOT');
    expect(rows(db, LogoQueries.GET_ID_FOR_KEY, [ROOT, 'favicon', 'github.com'])[0].Id).toBe('L-ROOT');
  });

  it('GET_ID_FOR_KEY will not hand one manifest another manifest row', async () => {
    const db = await makeDb();
    db.run(`INSERT INTO Logos VALUES ('${ROOT}','L-ROOT','custom','hash-abc',X'0102',NULL,NULL,'t','t',0)`);
    expect(rows(db, LogoQueries.GET_ID_FOR_KEY, [SHARED, 'custom', 'hash-abc'])).toEqual([]);
    // ...but the vault-wide probe still sees it, which is what lets the copy-on-use path find the bytes.
    expect(rows(db, LogoQueries.FIND_ANY_ID_FOR_KEY, ['custom', 'hash-abc'])[0].Id).toBe('L-ROOT');
  });
});
