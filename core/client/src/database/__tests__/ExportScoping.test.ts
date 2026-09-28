import { VaultSqlGenerator } from '@aliasvault/vault';
import { describe, expect, it } from 'vitest';

import { getPlatform } from '../../platform/ClientPlatform';
import { runSync } from '../DbOp';
import { ImportExportRepository } from '../repositories/ImportExportRepository';
import { LogoRepository } from '../repositories/LogoRepository';

import type { ISqliteDatabase, SqliteValue } from '../../platform/SqliteEngine';
import type { ISyncDatabaseClient, SqliteBindValue } from '../BaseRepository';

const PERSONAL = '11111111-1111-4111-8111-111111111111';
const SHARED = '22222222-2222-4222-8222-222222222222';

/**
 * A database client over an in-memory vault on the real schema.
 */
class TestDatabaseClient implements ISyncDatabaseClient {
  /**
   * Constructor for the TestDatabaseClient class.
   * @param db - The opened database
   * @param personalManifestId - The personal manifest this client reports
   */
  public constructor(private readonly db: ISqliteDatabase, private readonly personalManifestId: string | null) {}

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
  public beginTransaction(): void {}

  /**
   * Commit the transaction.
   */
  public async commitTransaction(): Promise<void> {}

  /**
   * Roll the transaction back.
   */
  public rollbackTransaction(): void {}

  /**
   * Whether a transaction is open.
   * @returns Always false
   */
  public isInTransaction(): boolean {
    return false;
  }

  /**
   * Get the personal manifest.
   * @returns The personal manifest id
   */
  public getPersonalManifestId(): string | null {
    return this.personalManifestId;
  }
}

/**
 * Seed one manifest with an item and every row kind an export reads, all sharing the same ids across manifests.
 * @param db - The database
 * @param manifestId - The manifest to seed
 * @param label - Tells the manifests apart in the exported values
 */
function seedManifest(db: ISqliteDatabase, manifestId: string, label: string): void {
  const t = '2026-01-01 00:00:00.000';
  db.run('INSERT INTO Folders (ManifestId, Id, Name, ParentFolderId, Weight, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, NULL, 0, ?, ?, 0)', [manifestId, 'FOLDER', `${label} folder`, t, t]);
  db.run('INSERT INTO Logos (ManifestId, Id, Kind, Source, FileData, MimeType, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, 0)', [manifestId, 'LOGO', 'favicon', `${label}.example`, t, t]);
  db.run('INSERT INTO Items (ManifestId, Id, Name, ItemType, FolderId, LogoId, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)', [manifestId, 'ITEM', `${label} item`, 'Login', 'FOLDER', 'LOGO', t, t]);
  db.run('INSERT INTO FieldDefinitions (ManifestId, Id, FieldType, Label, IsMultiValue, IsHidden, EnableHistory, Weight, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, 0)', [manifestId, 'DEF', 'Text', `${label} field`, t, t]);
  db.run('INSERT INTO FieldValues (ManifestId, Id, ItemId, FieldKey, Value, Weight, ValueIndex, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, 0)', [manifestId, 'VALUE', 'ITEM', 'login.username', `${label} user`, t, t]);
  db.run('INSERT INTO TotpCodes (ManifestId, Id, ItemId, Name, SecretKey, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0)', [manifestId, 'TOTP', 'ITEM', `${label} totp`, 'SECRET', t, t]);
  db.run('INSERT INTO Tags (ManifestId, Id, Name, DisplayOrder, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, 0, ?, ?, 0)', [manifestId, 'TAG', `${label} tag`, t, t]);
  db.run('INSERT INTO ItemTags (ManifestId, ItemId, TagId, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, ?, 0)', [manifestId, 'ITEM', 'TAG', t, t]);
}

/**
 * Build a vault holding a personal and a shared manifest.
 * @param personalManifestId - The personal manifest the client reports
 * @returns The repository to export with
 */
async function vaultWithSharedManifest(personalManifestId: string | null): Promise<{ repository: ImportExportRepository; client: TestDatabaseClient }> {
  const db = await getPlatform().sqlite.open();
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(new VaultSqlGenerator().getCompleteSchemaSql());
  seedManifest(db, PERSONAL, 'personal');
  seedManifest(db, SHARED, 'shared');
  const client = new TestDatabaseClient(db, personalManifestId);
  return { repository: new ImportExportRepository(client, new LogoRepository(client)), client };
}

describe('vault export scoping', () => {
  it('exports only the personal manifest, never a shared one', async () => {
    const { repository, client } = await vaultWithSharedManifest(PERSONAL);

    const data = runSync(repository.getExportData(), client);

    expect(data.items.map(item => item.Name)).toEqual(['personal item']);
    expect(data.items[0].FieldValues.map(value => value.Value)).toEqual(['personal user']);
    expect(data.items[0].TotpCodes.map(code => code.Name)).toEqual(['personal totp']);
    expect(data.folders.map(folder => folder.Name)).toEqual(['personal folder']);
    expect(data.tags.map(tag => tag.Name)).toEqual(['personal tag']);
    expect(data.itemTags).toHaveLength(1);
    expect(data.fieldDefinitions.map(definition => definition.Label)).toEqual(['personal field']);
    expect(data.logos.map(logo => logo.Source)).toEqual(['personal.example']);
  });

  it('writes only the personal manifest to a CSV export, archived items included', async () => {
    const { repository, client } = await vaultWithSharedManifest(PERSONAL);
    client.getDb().run('INSERT INTO Items (ManifestId, Id, Name, ItemType, CreatedAt, UpdatedAt, IsDeleted, ArchivedAt) VALUES (?, ?, ?, ?, ?, ?, 0, ?)', [PERSONAL, 'ARCHIVED', 'personal archived', 'Login', 't', 't', 't']);

    const csv = new TextDecoder().decode(runSync(repository.exportToCsv(), client));

    expect(csv).toContain('personal item');
    expect(csv).toContain('personal archived');
    expect(csv).toContain('SECRET');
    expect(csv).not.toContain('shared');
  });

  it('refuses to export when no personal manifest is recorded', async () => {
    const { repository, client } = await vaultWithSharedManifest(null);

    expect(() => runSync(repository.getExportData(), client)).toThrow();
    expect(() => runSync(repository.exportToCsv(), client)).toThrow();
  });
});
