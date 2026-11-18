import { ItemTypes } from '@aliasvault/models/vault';
import { VaultSqlGenerator } from '@aliasvault/vault';
import { beforeEach, describe, expect, it } from 'vitest';

import { StorageKeys } from '../../constants/StorageKeys';
import { customField, systemField } from '../../items/__tests__/testFields';
import { getPlatform } from '../../platform/ClientPlatform';
import { SqliteClient } from '../SqliteClient';

import type { ItemRef } from '../ItemRef';
import type { Item, ItemField, ItemType, TotpCode } from '@aliasvault/models/vault';

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
 * A system field that keeps history.
 * @param fieldKey - The system field key
 * @param value - The value
 * @returns The field
 */
function historyField(fieldKey: string, value: string): ItemField {
  return systemField(fieldKey, value, { EnableHistory: true });
}

/**
 * An item as the form hands it over.
 * @param name - The item's name
 * @param fields - The item's fields
 * @param itemType - The item type
 * @returns The draft
 */
function draft(name: string, fields: ItemField[] = [], itemType: ItemType = ItemTypes.Login): Item {
  return { Id: '', Name: name, ManifestId: PERSONAL, ItemType: itemType, Fields: fields, CreatedAt: '', UpdatedAt: '' } as Item;
}

/**
 * A 2FA code as the form hands it over.
 * @param secret - The secret
 * @returns The code
 */
function totp(secret: string): TotpCode {
  return { Id: crypto.randomUUID(), Name: 'code', SecretKey: secret, ItemId: '' } as TotpCode;
}

describe('merging items', () => {
  let client: SqliteClient;

  beforeEach(async () => {
    client = await openClient();
  });

  /**
   * Add a passkey to an item.
   * @param item - The item
   * @param id - The passkey id
   */
  async function addPasskey(item: ItemRef, id: string): Promise<void> {
    await client.passkeys.create({ Id: id, ItemId: item.Id, ManifestId: item.ManifestId, RpId: 'example.com', UserHandle: new Uint8Array([1]), PublicKey: '{}', PrivateKey: '{}', DisplayName: 'bob' } as Parameters<SqliteClient['passkeys']['create']>[0]);
  }

  /**
   * Tag an item, creating the tag when needed.
   * @param item - The item
   * @param name - The tag name, also its id
   */
  function addTag(item: ItemRef, name: string): void {
    client.executeUpdate('INSERT OR IGNORE INTO Tags (ManifestId, Id, Name, Color, DisplayOrder, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, NULL, 0, ?, ?, 0)', [PERSONAL, name, name, 't', 't']);
    client.executeUpdate('INSERT INTO ItemTags (ManifestId, ItemId, TagId, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, ?, 0)', [PERSONAL, item.Id, name, 't', 't']);
  }

  describe('a GitHub login and its copy, keeping the copy\'s password', () => {
    let target: ItemRef;
    let source: ItemRef;

    beforeEach(async () => {
      target = await client.items.create(draft('GitHub', [historyField('login.username', 'bob'), historyField('login.password', 'old'), systemField('login.url', 'https://github.com'), systemField('notes.content', 'Target')]));
      source = await client.items.create(
        draft('github.com', [
          historyField('login.username', 'bob'),
          historyField('login.password', 'new'),
          systemField('login.url', ['https://github.com/', 'https://github.com/login']),
          systemField('notes.content', 'Source'),
          customField('source-pin', 'PIN', '1234', 1),
        ]),
        [{ Id: 'attachment-1', Filename: 'codes.txt', Blob: new Uint8Array([1, 2, 3]), ItemId: '', CreatedAt: '', UpdatedAt: '' }],
        [totp('JBSWY3DPEHPK3PXP')]
      );
      await addPasskey(source, 'passkey-1');
      addTag(target, 'work');
      addTag(source, 'work');
      addTag(source, 'home');
      // A password the source held before, as an edit records it.
      client.executeUpdate(
        'INSERT INTO FieldHistories (Id, ItemId, ManifestId, FieldDefinitionId, FieldKey, ValueSnapshot, ChangedAt, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 0)',
        [crypto.randomUUID(), source.Id, PERSONAL, 'login.password', '["oldest"]', '2025-01-01 00:00:00.000', 't', 't']
      );

      expect(await client.items.merge(target, source, { 'login.password': 'source' })).toEqual(target);
    });

    it('fills the target with the chosen and combined values', () => {
      const merged = client.items.getById(target)!;
      /**
       * The value of a field of the merged item.
       */
      const valueOf = (key: string): ItemField['Value'] | undefined => merged.Fields.find(f => f.FieldKey === key)?.Value;

      expect(merged.Name).toBe('GitHub');
      expect(valueOf('login.password')).toBe('new');
      expect(valueOf('login.url')).toEqual(['https://github.com', 'https://github.com/login']);
      expect(valueOf('notes.content')).toBe('Target\n\nSource');
      expect(merged.Fields.find(f => f.Label === 'PIN')).toMatchObject({ Value: '1234', FieldKey: expect.not.stringMatching(/^source-pin$/) });
      expect(merged.Tags?.map(tag => tag.Name).sort()).toEqual(['home', 'work']);
    });

    it('keeps the replaced password and the source\'s password history in the target\'s history', () => {
      expect(client.items.getFieldHistory(target, 'login.password').map(entry => entry.ValueSnapshot)).toEqual(['["new"]', '["old"]', '["oldest"]']);
    });

    it('copies the 2FA code and attachment to the target and moves the passkey', () => {
      expect(client.items.getTotpCodesForItem(target).map(code => code.SecretKey)).toEqual(['JBSWY3DPEHPK3PXP']);
      const [attachment] = client.items.getAttachmentsForItem(target);
      expect(attachment).toMatchObject({ Filename: 'codes.txt', Id: expect.not.stringMatching(/^attachment-1$/) });
      expect(Array.from(attachment.Blob as Uint8Array)).toEqual([1, 2, 3]);
      expect(client.passkeys.getByItemId(target).map(passkey => passkey.Id)).toEqual(['passkey-1']);
    });

    it('trashes the source as-is, apart from the passkey that moved', () => {
      expect(client.items.getById(source)).toBeNull();
      const [trashed] = client.items.getRecentlyDeleted();
      expect(trashed.Id).toBe(source.Id);
      expect(trashed.Name).toBe('github.com');
      expect(trashed.Fields.find(f => f.FieldKey === 'login.password')?.Value).toBe('new');
      expect(trashed.Fields.find(f => f.FieldKey === 'source-pin')?.Value).toBe('1234');
      expect(client.items.getTotpCodesForItem(source).map(code => code.SecretKey)).toEqual(['JBSWY3DPEHPK3PXP']);
      expect(client.items.getAttachmentsForItem(source).map(attachment => attachment.Id)).toEqual(['attachment-1']);
      expect(client.passkeys.getByItemId(source)).toEqual([]);
    });
  });

  it('moves the passkey that is not kept to the trashed item', async () => {
    const target = await client.items.create(draft('Example'));
    const source = await client.items.create(draft('Example'));
    await addPasskey(target, 'passkey-target');
    await addPasskey(source, 'passkey-source');

    await client.items.merge(target, source, { passkeys: 'source' });

    expect(client.passkeys.getByItemId(target).map(passkey => passkey.Id)).toEqual(['passkey-source']);
    expect(client.passkeys.getByItemId(source).map(passkey => passkey.Id)).toEqual(['passkey-target']);
  });

  it('reads when an item last changed and when it was last used on any device', async () => {
    const ref = await client.items.create(draft('Example', [systemField('login.username', 'bob')]));
    expect(client.items.getActivity(ref)?.LastUsedAt).toBeNull();

    // A logo fetch or folder move only bumps Items.UpdatedAt, which is not a change of the content.
    client.executeUpdate('UPDATE Items SET CreatedAt = ?, UpdatedAt = ? WHERE Id = ?', ['2025-01-01 00:00:00.000', '2026-10-01 00:00:00.000', ref.Id]);
    client.executeUpdate('UPDATE FieldValues SET UpdatedAt = ? WHERE ItemId = ?', ['2026-03-01 00:00:00.000', ref.Id]);
    expect(client.items.getAll()[0]).toMatchObject({ LastChangedAt: '2026-03-01 00:00:00.000', LastUsedAt: undefined });
    for (const [device, usedAt] of [['phone', '2026-06-01 00:00:00.000'], ['laptop', '2026-05-01 00:00:00.000']]) {
      client.executeUpdate(
        'INSERT INTO ItemStats (ManifestId, Id, DeviceId, LastUsedAt, UseCount, LastAutofilledAt, AutofillCount, LastCopiedAt, CopyCount, LastPasskeyAuthAt, PasskeyAuthCount, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, 1, ?, 1, NULL, 0, NULL, 0, ?, ?, 0)',
        [PERSONAL, ref.Id, device, usedAt, usedAt, usedAt, usedAt]
      );
    }

    expect(client.items.getActivity(ref)).toEqual({ LastChangedAt: '2026-03-01 00:00:00.000', LastUsedAt: '2026-06-01 00:00:00.000' });
    expect(client.items.getMergeSide(ref)).toMatchObject({ lastChangedAt: '2026-03-01 00:00:00.000', lastUsedAt: '2026-06-01 00:00:00.000' });
    expect(client.items.getAll()[0]).toMatchObject({ LastChangedAt: '2026-03-01 00:00:00.000', LastUsedAt: '2026-06-01 00:00:00.000' });
  });

  it('refuses items that cannot be merged and leaves both as they are', async () => {
    const login = await client.items.create(draft('Login'));
    const card = await client.items.create(draft('Card', [], ItemTypes.CreditCard));

    await expect(client.items.merge(login, card, {})).rejects.toThrow('cannot be merged (type)');
    expect(client.items.getById(card)).not.toBeNull();
  });

  it('refuses a source that is already in the trash', async () => {
    const target = await client.items.create(draft('Target'));
    const source = await client.items.create(draft('Source'));
    await client.items.merge(target, source, {});

    await expect(client.items.merge(target, source, {})).rejects.toThrow('no longer exists');
  });
});
