import { ItemTypes, VaultDataBucketCategory } from '@aliasvault/models/vault';
import { VaultSqlGenerator } from '@aliasvault/vault';
import { beforeEach, describe, expect, it } from 'vitest';

import { StorageKeys } from '../../constants/StorageKeys';
import { getPlatform } from '../../platform/ClientPlatform';
import { SqliteClient } from '../SqliteClient';

import type { Item } from '@aliasvault/models/vault';

const PERSONAL = '11111111-1111-4111-8111-111111111111';

/**
 * A client over an empty vault on the real schema, with the repositories wired as the hosts get them.
 * @returns The opened client
 */
async function openClient(): Promise<SqliteClient> {
  const db = await getPlatform().sqlite.open();
  db.exec(new VaultSqlGenerator().getCompleteSchemaSql());
  const bytes = db.export();

  await getPlatform().storage.set(StorageKeys.VAULT_PERSONAL_MANIFEST_ID, PERSONAL);
  const client = new SqliteClient();
  await client.initializeFromBytes(bytes);
  return client;
}

/**
 * A minimal item as the form hands it over.
 * @param name - The item's name
 * @returns The draft
 */
function draftItem(name: string): Item {
  return { Name: name, ManifestId: PERSONAL, ItemType: ItemTypes.Note, Fields: [], CreatedAt: '', UpdatedAt: '' } as unknown as Item;
}

describe('mutation scopes', () => {
  let client: SqliteClient;

  beforeEach(async () => {
    client = await openClient();
  });

  it('records nothing for a read', () => {
    client.settings.getSetting('CredentialsSortOrder');
    expect(client.takeMutationScopes()).toEqual([]);
  });

  it('records the bucket a scoped repository writes into', () => {
    client.settings.updateSetting('DefaultIdentityLanguage', 'nl');
    expect(client.takeMutationScopes()).toEqual([VaultDataBucketCategory.Settings]);
  });

  it('records a full manifest change for an unscoped repository', async () => {
    await client.items.create(draftItem('Note'));
    expect(client.takeMutationScopes()).toEqual(['Main']);
  });

  it('records every scope a single mutation touched, so a bucket-only push cannot swallow an item change', async () => {
    client.settings.updateSetting('DefaultIdentityLanguage', 'nl');
    await client.items.create(draftItem('Note'));

    const scopes = client.takeMutationScopes();
    expect(scopes).toContain(VaultDataBucketCategory.Settings);
    expect(scopes).toContain('Main');
  });

  it('clears what it hands out', () => {
    client.settings.updateSetting('DefaultIdentityLanguage', 'nl');
    expect(client.takeMutationScopes()).toHaveLength(1);
    expect(client.takeMutationScopes()).toEqual([]);
  });
});
