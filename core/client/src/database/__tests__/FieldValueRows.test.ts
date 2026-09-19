import { FieldTypes, ItemTypes } from '@aliasvault/models/vault';
import { VaultSqlGenerator } from '@aliasvault/vault';
import { describe, expect, it } from 'vitest';

import { getPlatform } from '../../platform/ClientPlatform';
import { ItemRepository } from '../repositories/ItemRepository';
import { LogoRepository } from '../repositories/LogoRepository';

import type { ISqliteDatabase, SqliteValue } from '../../platform/SqliteEngine';
import type { ISyncDatabaseClient, SqliteBindValue } from '../BaseRepository';
import type { Item, ItemField } from '@aliasvault/models/vault';

const PERSONAL = '11111111-1111-4111-8111-111111111111';
const ITEM = '33333333-3333-4333-8333-333333333333';

type StoredRow = { Id: string; Value: string; ValueIndex: number; IsDeleted: number };

/**
 * A database client over an in-memory vault on the real schema.
 */
class TestDatabaseClient implements ISyncDatabaseClient {
  private inTransaction = false;

  /**
   * Constructor for the TestDatabaseClient class.
   * @param db - The opened database
   */
  public constructor(private readonly db: ISqliteDatabase) {}

  /**
   * Get the database.
   * @returns The database
   */
  public getDb(): ISqliteDatabase {
    return this.db;
  }

  /**
   * Run a SELECT.
   * @param query - The statement
   * @param params - The bound parameters
   * @returns The rows
   */
  public executeQuery<T>(query: string, params: SqliteBindValue[] = []): T[] {
    return this.db.query<T>(query, params as SqliteValue[]);
  }

  /**
   * Run a write.
   * @param query - The statement
   * @param params - The bound parameters
   * @returns The number of rows changed
   */
  public executeUpdate(query: string, params: SqliteBindValue[] = []): number {
    return this.db.run(query, params as SqliteValue[]);
  }

  /**
   * Begin a transaction.
   */
  public beginTransaction(): void {
    this.inTransaction = true;
  }

  /**
   * Commit the transaction.
   */
  public async commitTransaction(): Promise<void> {
    this.inTransaction = false;
  }

  /**
   * Roll the transaction back.
   */
  public rollbackTransaction(): void {
    this.inTransaction = false;
  }

  /**
   * Whether a transaction is open.
   * @returns True while one is
   */
  public isInTransaction(): boolean {
    return this.inTransaction;
  }

  /**
   * Get the manifest new rows are written into.
   * @returns The personal manifest id
   */
  public getActiveManifestId(): string {
    return PERSONAL;
  }

  /**
   * Get the personal manifest.
   * @returns The personal manifest id
   */
  public getPersonalManifestId(): string {
    return PERSONAL;
  }
}

/**
 * A system field as the item form hands it to the repository.
 * @param fieldKey - The system field key
 * @param value - The field's value or values
 * @returns The field
 */
function field(fieldKey: string, value: string | string[]): ItemField {
  return { FieldKey: fieldKey, Label: fieldKey, FieldType: FieldTypes.Text, Value: value, IsHidden: false, DisplayOrder: 0, IsCustomField: false, EnableHistory: false };
}

/**
 * Build a vault holding one item, saved with the given fields.
 * @param fields - The fields of the first save
 * @returns The database and a way to save the item again
 */
async function vaultWithItem(fields: ItemField[]): Promise<{ db: ISqliteDatabase; save: (fields: ItemField[]) => Promise<void> }> {
  const db = await getPlatform().sqlite.open();
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(new VaultSqlGenerator().getCompleteSchemaSql());
  const client = new TestDatabaseClient(db);
  const repository = new ItemRepository(client, new LogoRepository(client));
  /**
   * The item as the form hands it over, holding the given fields.
   */
  const draft = (itemFields: ItemField[]): Item => ({ Id: ITEM, ManifestId: PERSONAL, Name: 'Note', ItemType: ItemTypes.Note, Fields: itemFields, CreatedAt: '', UpdatedAt: '' } as Item);

  await repository.create(draft(fields));
  return {
    db,
    /**
     * Save the item again with the given fields.
     */
    save: async (next: ItemField[]): Promise<void> => {
      expect(await repository.update({ Id: ITEM, ManifestId: PERSONAL }, draft(next))).toEqual({ Id: ITEM, ManifestId: PERSONAL });
    },
  };
}

/**
 * The stored rows of one field, tombstones included.
 * @param db - The database
 * @param fieldKey - The system field key
 * @returns The rows, in value order
 */
function rowsOf(db: ISqliteDatabase, fieldKey: string): StoredRow[] {
  return db.query<StoredRow>('SELECT Id, Value, ValueIndex, IsDeleted FROM FieldValues WHERE ItemId = ? AND FieldKey = ? ORDER BY IsDeleted, ValueIndex', [ITEM, fieldKey]);
}

describe('field value rows', () => {
  it('brings a removed field back on its own row instead of adding a second one', async () => {
    /*
     * Two rows for one single-value field collapse to the newest on the next sync, and a tombstone stamped
     * by a device whose clock runs ahead would then beat the value the user just typed.
     */
    const { db, save } = await vaultWithItem([field('login.username', 'first')]);
    const original = rowsOf(db, 'login.username')[0];

    await save([]);
    expect(rowsOf(db, 'login.username')).toMatchObject([{ Id: original.Id, IsDeleted: 1 }]);

    await save([field('login.username', 'second')]);
    expect(rowsOf(db, 'login.username')).toMatchObject([{ Id: original.Id, Value: 'second', IsDeleted: 0 }]);
  });

  it('keeps every url on its own row when one before it is removed', async () => {
    // Shifting values across rows makes a concurrent edit of the last url come back as a near duplicate.
    const { db, save } = await vaultWithItem([field('login.url', ['https://a.example', 'https://b.example', 'https://c.example'])]);
    const [a, b, c] = rowsOf(db, 'login.url');
    expect([a.ValueIndex, b.ValueIndex, c.ValueIndex]).toEqual([0, 1, 2]);

    await save([field('login.url', ['https://b.example', 'https://c.example'])]);

    expect(rowsOf(db, 'login.url')).toMatchObject([
      { Id: b.Id, Value: 'https://b.example', ValueIndex: 0, IsDeleted: 0 },
      { Id: c.Id, Value: 'https://c.example', ValueIndex: 1, IsDeleted: 0 },
      { Id: a.Id, Value: 'https://a.example', IsDeleted: 1 },
    ]);
  });

  it('appends a new url after the existing ones and edits a url in place', async () => {
    const { db, save } = await vaultWithItem([field('login.url', ['https://a.example', 'https://b.example'])]);
    const [a, b] = rowsOf(db, 'login.url');

    await save([field('login.url', ['https://a.example', 'https://b-edited.example', 'https://c.example'])]);

    const rows = rowsOf(db, 'login.url');
    expect(rows).toMatchObject([
      { Id: a.Id, Value: 'https://a.example', ValueIndex: 0 },
      { Id: b.Id, Value: 'https://b-edited.example', ValueIndex: 1 },
      { Value: 'https://c.example', ValueIndex: 2 },
    ]);
    expect(rows).toHaveLength(3);
  });
});
