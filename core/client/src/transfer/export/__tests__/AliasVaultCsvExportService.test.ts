import { FieldKey, ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { byName, convertToItems, itemByName, utc } from '../../import/__tests__/testHelpers';
import { AliasVaultCsvImportService } from '../../import/importers/aliasvault/AliasVaultCsvImportService';
import { AliasVaultCsvExportService } from '../AliasVaultCsvExportService';

import { addFieldValue, addTotpCode, createTestItem, csvText } from './testHelpers';

describe('AliasVaultCsvExportService', () => {
  it('re-imports an exported item from CSV unchanged', () => {
    const item = createTestItem('Test Service', ItemTypes.Login, {
      [FieldKey.LoginUsername]: 'testuser',
      [FieldKey.NotesContent]: 'Test notes',
      [FieldKey.LoginUrl]: 'https://testservice.com',
      [FieldKey.LoginPassword]: 'password123',
      [FieldKey.LoginEmail]: 'johndoe',
      [FieldKey.AliasGender]: 'Male',
      [FieldKey.AliasFirstName]: 'John',
      [FieldKey.AliasLastName]: 'Doe',
      [FieldKey.AliasBirthdate]: '1990-01-01',
    });

    const csv = csvText(AliasVaultCsvExportService.exportItemsToCsv([item]));
    const imported = AliasVaultCsvImportService.importItemsFromCsv(csv);

    expect(imported).toHaveLength(1);
    const credential = imported[0];
    expect(credential.ServiceName).toBe(item.Name);
    expect(credential.ServiceUrls?.[0]).toBe('https://testservice.com');
    expect(credential.Username).toBe('testuser');
    expect(credential.Notes).toBe('Test notes');
    expect(credential.CreatedAt?.toISOString().substring(0, 10)).toBe(item.CreatedAt.toISOString().substring(0, 10));
    expect(credential.UpdatedAt?.toISOString().substring(0, 10)).toBe(item.UpdatedAt.toISOString().substring(0, 10));
    expect(credential.Alias!.Gender).toBe('Male');
    expect(credential.Alias!.FirstName).toBe('John');
    expect(credential.Alias!.LastName).toBe('Doe');
    expect(credential.Alias!.BirthDate?.getTime()).toBe(utc(1990, 1, 1).getTime());
    expect(credential.Password).toBe('password123');
  });

  it('re-imports an exported credit card item from CSV unchanged', () => {
    const loginItem = createTestItem('Login service', ItemTypes.Login, { [FieldKey.LoginUsername]: 'loginuser', [FieldKey.LoginPassword]: 'loginpass' });
    const cardItem = createTestItem('My Visa', ItemTypes.CreditCard, {
      [FieldKey.CardCardholderName]: 'John Doe',
      [FieldKey.CardNumber]: '4111111111111111',
      [FieldKey.CardExpiryMonth]: '12',
      [FieldKey.CardExpiryYear]: '2030',
      [FieldKey.CardCvv]: '123',
      [FieldKey.CardPin]: '9876',
      [FieldKey.NotesContent]: 'Card notes',
    });

    const csv = csvText(AliasVaultCsvExportService.exportItemsToCsv([loginItem, cardItem]));
    const headerLine = csv.split('\n')[0];
    for (const column of ['CardholderName', 'CardNumber', 'CardExpiryMonth', 'CardExpiryYear', 'CardCvv', 'CardPin']) {
      expect(headerLine).toContain(column);
    }

    const imported = AliasVaultCsvImportService.importItemsFromCsv(csv);
    expect(imported).toHaveLength(2);

    const importedLogin = byName(imported, 'Login service');
    expect(importedLogin.ItemType).toBeUndefined();
    expect(importedLogin.Creditcard).toBeUndefined();
    expect(importedLogin.Username).toBe('loginuser');

    const importedCard = byName(imported, 'My Visa');
    expect(importedCard.ItemType).toBe(ItemTypes.CreditCard);
    expect(importedCard.Creditcard).toBeDefined();
    expect(importedCard.Creditcard!.CardholderName).toBe('John Doe');
    expect(importedCard.Creditcard!.Number).toBe('4111111111111111');
    expect(importedCard.Creditcard!.ExpiryMonth).toBe('12');
    expect(importedCard.Creditcard!.ExpiryYear).toBe('2030');
    expect(importedCard.Creditcard!.Cvv).toBe('123');
    expect(importedCard.Creditcard!.Pin).toBe('9876');
    expect(importedCard.Notes).toBe('Card notes');
  });

  it('re-imports multiple service URLs', () => {
    const item = createTestItem('Multi url service', ItemTypes.Login, { [FieldKey.LoginUsername]: 'testuser' });
    addFieldValue(item, FieldKey.LoginUrl, 'https://www.aliasvault.com', 0);
    addFieldValue(item, FieldKey.LoginUrl, 'https://app.aliasvault.com', 1);
    addFieldValue(item, FieldKey.LoginUrl, 'https://downloads.aliasvault.com', 2);

    const csv = csvText(AliasVaultCsvExportService.exportItemsToCsv([item]));
    const imported = AliasVaultCsvImportService.importItemsFromCsv(csv);

    expect(csv).toContain('"https://www.aliasvault.com,https://app.aliasvault.com,https://downloads.aliasvault.com"');
    expect(imported).toHaveLength(1);
    expect(imported[0].ServiceUrls).toEqual(['https://www.aliasvault.com', 'https://app.aliasvault.com', 'https://downloads.aliasvault.com']);

    const convertedItem = convertToItems(imported)[0];
    const urlFieldValues = convertedItem.FieldValues.filter(fv => fv.FieldKey === FieldKey.LoginUrl).sort((a, b) => a.Weight - b.Weight);
    expect(urlFieldValues.map(fv => fv.Value)).toEqual(['https://www.aliasvault.com', 'https://app.aliasvault.com', 'https://downloads.aliasvault.com']);
  });

  it('writes the folder path and the first 2FA secret', () => {
    const item = createTestItem('In a folder', ItemTypes.Login, { [FieldKey.LoginUsername]: 'testuser' });
    addTotpCode(item, 'JBSWY3DPEHPK3PXP');
    const now = new Date();
    const folders = [
      { Id: 'PARENT', Name: 'Work', ParentFolderId: null, Weight: 0, CreatedAt: now, UpdatedAt: now, IsDeleted: false },
      { Id: 'CHILD', Name: 'Projects', ParentFolderId: 'PARENT', Weight: 0, CreatedAt: now, UpdatedAt: now, IsDeleted: false },
    ];
    item.FolderId = 'CHILD';

    const imported = AliasVaultCsvImportService.importItemsFromCsv(csvText(AliasVaultCsvExportService.exportItemsToCsv([item], folders)));

    expect(imported[0].FolderPath).toBe('Work/Projects');
    expect(imported[0].TwoFactorSecret).toBe('JBSWY3DPEHPK3PXP');
  });

  it('writes a non-default TOTP code as an otpauth URI that re-imports with its name and parameters', () => {
    const sha512 = createTestItem('Sha512', ItemTypes.Login, {});
    addTotpCode(sha512, 'JBSWY3DPEHPK3PXP', { Name: 'GitHub: user@example.com', Algorithm: 'SHA512', Digits: 8, Period: 60 });
    const sha256 = createTestItem('Sha256', ItemTypes.Login, {});
    addTotpCode(sha256, 'JBSWY3DPEHPK3PXP', { Name: 'Work account', Algorithm: 'SHA256', Digits: 6, Period: 30 });
    const sha1 = createTestItem('Sha1', ItemTypes.Login, {});
    addTotpCode(sha1, 'JBSWY3DPEHPK3PXP');

    const imported = AliasVaultCsvImportService.importItemsFromCsv(csvText(AliasVaultCsvExportService.exportItemsToCsv([sha512, sha256, sha1])));
    const items = convertToItems(imported);

    expect(byName(imported, 'Sha1').TwoFactorSecret).toBe('JBSWY3DPEHPK3PXP');
    expect(byName(imported, 'Sha512').TwoFactorSecret).toMatch(/^otpauth:\/\/totp\//);
    expect(itemByName(items, 'Sha512').TotpCodes[0]).toMatchObject({ Name: 'GitHub: user@example.com', SecretKey: 'JBSWY3DPEHPK3PXP', Algorithm: 'SHA512', Digits: 8, Period: 60 });
    expect(itemByName(items, 'Sha256').TotpCodes[0]).toMatchObject({ Name: 'Work account', SecretKey: 'JBSWY3DPEHPK3PXP', Algorithm: 'SHA256', Digits: 6, Period: 30 });
    expect(itemByName(items, 'Sha1').TotpCodes[0]).toMatchObject({ SecretKey: 'JBSWY3DPEHPK3PXP', Algorithm: 'SHA1', Digits: 6, Period: 30 });
  });
});
