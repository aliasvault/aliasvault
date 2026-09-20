import { ItemTypes } from '@aliasvault/models/vault';
import { VaultSqlGenerator } from '@aliasvault/vault';
import { beforeEach, describe, expect, it } from 'vitest';

import { StorageKeys } from '../../constants/StorageKeys';
import { getPlatform } from '../../platform/ClientPlatform';
import { SqliteClient } from '../SqliteClient';

import type { Item } from '@aliasvault/models/vault';

const PERSONAL = '11111111-1111-4111-8111-111111111111';
const SHARED = '22222222-2222-4222-8222-222222222222';
const SHARED_ROOT = { Id: SHARED, ManifestId: SHARED };

/**
 * A client over a vault that holds a shared manifest named "Family", the way a pull leaves it.
 * @returns The opened client
 */
async function openClient(): Promise<SqliteClient> {
  const db = await getPlatform().sqlite.open();
  db.exec(new VaultSqlGenerator().getCompleteSchemaSql());
  db.exec(`INSERT INTO Manifests (Id, Name) VALUES ('${PERSONAL}', NULL), ('${SHARED}', 'Family')`);
  const bytes = db.export();

  await getPlatform().storage.set(StorageKeys.VAULT_PERSONAL_MANIFEST_ID, PERSONAL);
  const client = new SqliteClient();
  await client.initializeFromBytes(bytes);
  return client;
}

/**
 * A minimal item as the form hands it over.
 * @param name - The item's name
 * @param manifestId - The manifest it is written into
 * @param folderId - The folder it is presented in
 * @returns The draft
 */
function draftItem(name: string, manifestId: string, folderId: string | null): Item {
  return { Name: name, ManifestId: manifestId, FolderId: folderId, ItemType: ItemTypes.Note, Fields: [], CreatedAt: '', UpdatedAt: '' } as unknown as Item;
}

describe('a shared manifest rendered as a folder', () => {
  let client: SqliteClient;

  beforeEach(async () => {
    client = await openClient();
  });

  it('shows up as a folder although the vault stores none', () => {
    expect(client.folders.getAll()).toEqual([{ Id: SHARED, Name: 'Family', ParentFolderId: null, Weight: 0, ManifestId: SHARED }]);
    expect(client.executeQuery('SELECT Id FROM Folders')).toEqual([]);
  });

  it('stores an item put into it at the top level of the manifest, and presents it inside the folder', async () => {
    const ref = await client.items.create(draftItem('Netflix', SHARED, SHARED));

    expect(client.executeQuery('SELECT FolderId, ManifestId FROM Items')).toEqual([{ FolderId: null, ManifestId: SHARED }]);
    expect(client.items.getById(ref)?.FolderId).toBe(SHARED);
    expect(client.items.getByFolder(SHARED_ROOT).map(item => item.Name)).toEqual(['Netflix']);
    expect(client.items.getAll()[0].FolderPath).toEqual(['Family']);
  });

  it('leaves a personal item outside every folder where it is', async () => {
    const ref = await client.items.create(draftItem('Mine', PERSONAL, null));
    expect(client.items.getById(ref)?.FolderId).toBeNull();
  });

  it('stores a folder created inside it at the top level of the manifest', async () => {
    const id = await client.folders.create('Bills', SHARED_ROOT);

    expect(client.executeQuery('SELECT ParentFolderId, ManifestId FROM Folders')).toEqual([{ ParentFolderId: null, ManifestId: SHARED }]);
    expect(client.folders.getById({ Id: id, ManifestId: SHARED })?.ParentFolderId).toBe(SHARED);
  });

  it('refuses to rename the folder, the shared vault is renamed from the sharing settings', async () => {
    await expect(client.folders.update(SHARED_ROOT, 'Household')).rejects.toThrow();
    expect(client.executeQuery('SELECT Name FROM Manifests WHERE Id = ?', [SHARED])).toEqual([{ Name: 'Family' }]);
  });

  it('keeps the items of a deleted top-level folder inside the manifest', async () => {
    const folderId = await client.folders.create('Bills', SHARED_ROOT);
    await client.items.create(draftItem('Power', SHARED, folderId));
    await client.folders.delete({ Id: folderId, ManifestId: SHARED });

    expect(client.executeQuery('SELECT FolderId, ManifestId FROM Items')).toEqual([{ FolderId: null, ManifestId: SHARED }]);
  });

  it('refuses to delete the folder', async () => {
    await expect(client.folders.delete(SHARED_ROOT)).rejects.toThrow();
  });
});
