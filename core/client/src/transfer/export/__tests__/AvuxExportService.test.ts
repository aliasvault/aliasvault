import { FieldKey, FieldTypes, ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { byName, itemByName } from '../../import/__tests__/testHelpers';
import { AvuxImportService } from '../../import/importers/aliasvault/AvuxImportService';
import { convertToItems } from '../../import/writers/ItemConverter';
import { ZipArchive } from '../../shared/ZipArchive';
import { AvuxExportService } from '../AvuxExportService';

import { createTestItem, addCustomFieldValue, addTotpCode, addAttachment, exportItems } from './testHelpers';

import type { FieldDefinitionEntity, FolderEntity, ItemTagEntity, LogoEntity, TagEntity } from '../../shared/VaultEntities';

describe('AvuxExportService', () => {
  it('writes the manifest and attachments', () => {
    const login = createTestItem('Basic Login', ItemTypes.Login, { [FieldKey.LoginUsername]: 'testuser', [FieldKey.LoginPassword]: 'testpass', [FieldKey.LoginUrl]: 'https://example.com', [FieldKey.NotesContent]: 'Test notes' });
    const loginWithTotp = createTestItem('Login with 2FA', ItemTypes.Login, { [FieldKey.LoginUsername]: 'user2fa', [FieldKey.LoginPassword]: 'pass2fa' });
    addTotpCode(loginWithTotp, 'JBSWY3DPEHPK3PXP');
    const card = createTestItem('Test Card', ItemTypes.CreditCard, { [FieldKey.CardNumber]: '4111111111111111', [FieldKey.CardCardholderName]: 'Test Holder' });
    const note = createTestItem('Test Note', ItemTypes.Note, { [FieldKey.NotesContent]: 'This is a test secure note.' });
    const withAttachment = createTestItem('Item with Attachment', ItemTypes.Login, { [FieldKey.LoginUsername]: 'attachuser' });
    addAttachment(withAttachment, 'test-file.txt', 'Test attachment content');
    const items = [login, loginWithTotp, card, note, withAttachment];
    const folders: FolderEntity[] = [{ Id: crypto.randomUUID(), Name: 'Test Folder', ParentFolderId: null, Weight: 0, CreatedAt: new Date(), UpdatedAt: new Date(), IsDeleted: false }];
    const tags: TagEntity[] = [{ Id: crypto.randomUUID(), Name: 'Test Tag', Color: '#FF0000', DisplayOrder: 0, CreatedAt: new Date(), UpdatedAt: new Date(), IsDeleted: false }];
    const itemTags: ItemTagEntity[] = [{ ItemId: items[0].Id, TagId: tags[0].Id, IsDeleted: false }];

    const avuxBytes = AvuxExportService.exportToAvux(items, folders, tags, itemTags, [], [], 'test@example.com');

    expect(avuxBytes.length).toBeGreaterThan(0);

    const archive = ZipArchive.open(avuxBytes);
    const manifestJson = archive.readText('manifest.json');
    expect(manifestJson).not.toBeNull();
    expect(manifestJson).toContain('"version"');
    expect(manifestJson).toContain('"items"');
    expect(manifestJson).toContain('"folders"');
    expect(manifestJson).toContain('Basic Login');
    expect(manifestJson).toContain('Test Folder');
    expect(archive.has(`attachments/${withAttachment.Id}_${withAttachment.Attachments[0].Id}_test-file.txt`)).toBe(true);
  });

  it('re-imports exported logins, TOTP codes and credit cards', () => {
    const loginWithTotp = createTestItem('Import 2FA', ItemTypes.Login, { [FieldKey.LoginUsername]: 'user2fa', [FieldKey.LoginPassword]: 'pass2fa' });
    addTotpCode(loginWithTotp, 'JBSWY3DPEHPK3PXP');
    const items = [
      createTestItem('Import Test Item', ItemTypes.Login, { [FieldKey.LoginUsername]: 'importuser', [FieldKey.LoginPassword]: 'importpass', [FieldKey.LoginUrl]: 'https://import.example.com' }),
      loginWithTotp,
      createTestItem('Test Card', ItemTypes.CreditCard, { [FieldKey.CardNumber]: '4111111111111111', [FieldKey.CardCardholderName]: 'Test Holder' }),
    ];

    const imported = AvuxImportService.importFromAvux(exportItems(items));

    expect(imported).toHaveLength(3);

    const basicLogin = byName(imported, 'Import Test Item');
    expect(basicLogin.Username).toBe('importuser');
    expect(basicLogin.Password).toBe('importpass');
    expect(basicLogin.ServiceUrls?.[0]).toBe('https://import.example.com');

    const twoFa = byName(imported, 'Import 2FA');
    expect(twoFa.Username).toBe('user2fa');
    expect(twoFa.Password).toBe('pass2fa');
    expect(convertToItems([twoFa])[0].TotpCodes[0]).toMatchObject({ Name: 'Test TOTP', SecretKey: 'JBSWY3DPEHPK3PXP' });

    const creditCard = imported.find(c => c.ItemType === ItemTypes.CreditCard)!;
    expect(creditCard.Creditcard).toBeDefined();
    expect(creditCard.Creditcard!.Number).toBe('4111111111111111');
    expect(creditCard.Creditcard!.CardholderName).toBe('Test Holder');
  });

  it('preserves all data when re-importing an .avux export', () => {
    const original = createTestItem('Reimport Test', ItemTypes.Login, {
      [FieldKey.LoginUsername]: 'reimportuser',
      [FieldKey.LoginPassword]: 'reimportpass',
      [FieldKey.LoginUrl]: 'https://reimport.example.com',
      [FieldKey.NotesContent]: 'Reimport notes',
      [FieldKey.AliasFirstName]: 'John',
      [FieldKey.AliasLastName]: 'Doe',
    });
    addTotpCode(original, 'JBSWY3DPEHPK3PXP');

    const imported = AvuxImportService.importFromAvux(exportItems([original]));

    expect(imported).toHaveLength(1);
    const credential = imported[0];
    expect(credential.ServiceName).toBe('Reimport Test');
    expect(credential.Username).toBe('reimportuser');
    expect(credential.Password).toBe('reimportpass');
    expect(credential.ServiceUrls?.[0]).toBe('https://reimport.example.com');
    expect(credential.Notes).toBe('Reimport notes');
    expect(credential.Alias?.FirstName).toBe('John');
    expect(credential.Alias?.LastName).toBe('Doe');
    expect(convertToItems([credential])[0].TotpCodes[0]).toMatchObject({ Name: 'Test TOTP', SecretKey: 'JBSWY3DPEHPK3PXP' });
    expect(credential.CreatedAt?.getTime()).toBe(original.CreatedAt.getTime());
  });

  it('preserves the TOTP name and parameters when re-importing an .avux export', () => {
    const sha512 = createTestItem('Sha512', ItemTypes.Login, {});
    addTotpCode(sha512, 'JBSWY3DPEHPK3PXP', { Name: 'GitHub: user@example.com', Algorithm: 'SHA512', Digits: 8, Period: 60 });
    const sha256 = createTestItem('Sha256', ItemTypes.Login, {});
    addTotpCode(sha256, 'JBSWY3DPEHPK3PXP', { Name: '', Algorithm: 'SHA256', Digits: 7, Period: 45 });

    const items = convertToItems(AvuxImportService.importFromAvux(exportItems([sha512, sha256])));

    expect(itemByName(items, 'Sha512').TotpCodes[0]).toMatchObject({ Name: 'GitHub: user@example.com', SecretKey: 'JBSWY3DPEHPK3PXP', Algorithm: 'SHA512', Digits: 8, Period: 60 });
    expect(itemByName(items, 'Sha256').TotpCodes[0]).toMatchObject({ Name: '', SecretKey: 'JBSWY3DPEHPK3PXP', Algorithm: 'SHA256', Digits: 7, Period: 45 });
  });

  it('preserves custom fields when re-importing an .avux export', () => {
    const item = createTestItem('Custom Field Item', ItemTypes.Login, { [FieldKey.LoginUsername]: 'customuser' });
    const textFieldDef: FieldDefinitionEntity = { Id: crypto.randomUUID(), Label: 'Security Question', FieldType: 'Text', IsMultiValue: false, IsHidden: false, EnableHistory: false, Weight: 3, ApplicableToTypes: null, CreatedAt: new Date(), UpdatedAt: new Date(), IsDeleted: false };
    const hiddenFieldDef: FieldDefinitionEntity = { Id: crypto.randomUUID(), Label: 'Recovery Code', FieldType: 'Password', IsMultiValue: false, IsHidden: true, EnableHistory: false, Weight: 5, ApplicableToTypes: null, CreatedAt: new Date(), UpdatedAt: new Date(), IsDeleted: false };
    addCustomFieldValue(item, textFieldDef, 'My first pet');
    addCustomFieldValue(item, hiddenFieldDef, 'super-secret-recovery');

    const imported = AvuxImportService.importFromAvux(exportItems([item], [], [textFieldDef, hiddenFieldDef]));

    expect(imported).toHaveLength(1);
    const credential = imported[0];
    expect(credential.CustomFieldValues).toHaveLength(2);

    const textField = credential.CustomFieldValues!.find(f => f.Label === 'Security Question')!;
    expect(textField.Value).toBe('My first pet');
    expect(textField.FieldType).toBe(FieldTypes.Text);
    expect(textField.IsHidden).toBe(false);
    expect(textField.Weight).toBe(3);

    const hiddenField = credential.CustomFieldValues!.find(f => f.Label === 'Recovery Code')!;
    expect(hiddenField.Value).toBe('super-secret-recovery');
    expect(hiddenField.FieldType).toBe(FieldTypes.Password);
    expect(hiddenField.IsHidden).toBe(true);
    expect(hiddenField.Weight).toBe(5);

    // Converting to items recreates the custom definitions and their values.
    const convertedItem = convertToItems(imported)[0];
    const customFieldValues = convertedItem.FieldValues.filter(fv => fv.FieldKey === null && fv.FieldDefinition);
    expect(customFieldValues).toHaveLength(2);

    const recoveryValue = customFieldValues.find(fv => fv.FieldDefinition!.Label === 'Recovery Code')!;
    expect(recoveryValue.Value).toBe('super-secret-recovery');
    expect(recoveryValue.FieldDefinition!.FieldType).toBe('Password');
    expect(recoveryValue.FieldDefinition!.IsHidden).toBe(true);
    expect(recoveryValue.FieldDefinition!.Weight).toBe(5);
  });

  it('re-imports exported logos', () => {
    const logoId1 = crypto.randomUUID();
    const logoId2 = crypto.randomUUID();

    const item1 = createTestItem('GitHub', ItemTypes.Login, { [FieldKey.LoginUsername]: 'testuser', [FieldKey.LoginPassword]: 'password123', [FieldKey.LoginUrl]: 'https://github.com' });
    item1.LogoId = logoId1;
    const item2 = createTestItem('Google', ItemTypes.Login, { [FieldKey.LoginUsername]: 'user@gmail.com', [FieldKey.LoginPassword]: 'pass456', [FieldKey.LoginUrl]: 'https://google.com' });
    item2.LogoId = logoId2;
    // Shares the logo of item1 (deduplication).
    const item3 = createTestItem('GitHub Issue Tracker', ItemTypes.Login, { [FieldKey.LoginUsername]: 'issueuser', [FieldKey.LoginPassword]: 'issuepass' });
    item3.LogoId = logoId1;

    const logos: LogoEntity[] = [
      { Id: logoId1, Source: 'github.com', FileData: new Uint8Array([1, 2, 3, 4, 5]), MimeType: 'image/png', FetchedAt: new Date(), IsDeleted: false },
      { Id: logoId2, Source: 'google.com', FileData: new Uint8Array([6, 7, 8, 9, 10]), MimeType: 'image/png', FetchedAt: new Date(), IsDeleted: false },
    ];

    const imported = AvuxImportService.importFromAvux(exportItems([item1, item2, item3], logos));

    expect(imported).toHaveLength(3);

    const github = byName(imported, 'GitHub');
    expect(github.Username).toBe('testuser');
    expect(github.Password).toBe('password123');
    expect(Array.from(github.FaviconBytes!)).toEqual([1, 2, 3, 4, 5]);

    const google = byName(imported, 'Google');
    expect(google.Username).toBe('user@gmail.com');
    expect(google.Password).toBe('pass456');
    expect(Array.from(google.FaviconBytes!)).toEqual([6, 7, 8, 9, 10]);

    expect(Array.from(byName(imported, 'GitHub Issue Tracker').FaviconBytes!)).toEqual([1, 2, 3, 4, 5]);
  });
});
