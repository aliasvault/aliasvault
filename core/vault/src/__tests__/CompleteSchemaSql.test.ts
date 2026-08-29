import initSqlJs from 'sql.js';
import { describe, it, expect } from 'vitest';

import { COMPLETE_SCHEMA_SQL } from '../sql/SqlConstants';

/*
 * The clients materialize every vault by applying COMPLETE_SCHEMA_SQL to an empty database, on SQLite builds
 * that are older than the one the EF tooling generates the script with (sql.js in the browser extension, the
 * system SQLite on iOS and Android). SQLite reparses every trigger in the schema while it rebuilds a table, so
 * a trigger whose body names a table that is momentarily dropped aborts the rebuild and the vault cannot be
 * opened at all. These tests run the script the way a client does.
 */
describe('COMPLETE_SCHEMA_SQL', () => {
  it('applies to an empty database', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();

    try {
      expect(() => db.run(COMPLETE_SCHEMA_SQL)).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('leaves every table a trigger writes to in place', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();

    try {
      db.run(COMPLETE_SCHEMA_SQL);

      const tables = new Set((db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values ?? []).map(row => String(row[0])));
      const triggers = (db.exec("SELECT name, sql FROM sqlite_master WHERE type = 'trigger'")[0]?.values ?? []);
      expect(triggers.length).toBeGreaterThan(0);

      for (const [name, sql] of triggers) {
        const referenced = [...String(sql).matchAll(/(?:UPDATE|INSERT INTO|DELETE FROM)\s+"([^"]+)"/g)].map(match => match[1]);
        expect(referenced.length).toBeGreaterThan(0);
        for (const table of referenced) {
          expect(tables.has(table), `trigger ${String(name)} writes to missing table ${table}`).toBe(true);
        }
      }
    } finally {
      db.close();
    }
  });
});
