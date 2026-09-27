import { FieldKey, ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { byName, utc } from '../../import/__tests__/testHelpers';
import { AliasVaultCsvImportService } from '../../import/importers/aliasvault/AliasVaultCsvImportService';
import { convertToItems } from '../../import/writers/ItemConverter';
import { AliasVaultCsvExportService } from '../AliasVaultCsvExportService';

import { createAppItem, csvText } from './testHelpers';

describe('AliasVaultCsvExportService', () => {
  it('re-imports an exported item from CSV unchanged', () => {
    const item = createAppItem('Test Service', ItemTypes.Login, {
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
    expect(credential.CreatedAt?.toISOString().substring(0, 10)).toBe(item.CreatedAt.substring(0, 10));
    expect(credential.UpdatedAt?.toISOString().substring(0, 10)).toBe(item.UpdatedAt.substring(0, 10));
    expect(credential.Alias!.Gender).toBe('Male');
    expect(credential.Alias!.FirstName).toBe('John');
    expect(credential.Alias!.LastName).toBe('Doe');
    expect(credential.Alias!.BirthDate?.getTime()).toBe(utc(1990, 1, 1).getTime());
    expect(credential.Password).toBe('password123');
  });

  it('re-imports an exported credit card item from CSV unchanged', () => {
    const loginItem = createAppItem('Login service', ItemTypes.Login, { [FieldKey.LoginUsername]: 'loginuser', [FieldKey.LoginPassword]: 'loginpass' });
    const cardItem = createAppItem('My Visa', ItemTypes.CreditCard, {
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
    const item = createAppItem('Multi url service', ItemTypes.Login, {
      [FieldKey.LoginUsername]: 'testuser',
      [FieldKey.LoginUrl]: ['https://www.aliasvault.com', 'https://app.aliasvault.com', 'https://downloads.aliasvault.com'],
    });

    const csv = csvText(AliasVaultCsvExportService.exportItemsToCsv([item]));
    const imported = AliasVaultCsvImportService.importItemsFromCsv(csv);

    expect(csv).toContain('"https://www.aliasvault.com,https://app.aliasvault.com,https://downloads.aliasvault.com"');
    expect(imported).toHaveLength(1);
    expect(imported[0].ServiceUrls).toEqual(['https://www.aliasvault.com', 'https://app.aliasvault.com', 'https://downloads.aliasvault.com']);

    const convertedItem = convertToItems(imported)[0];
    const urlFieldValues = convertedItem.FieldValues.filter(fv => fv.FieldKey === FieldKey.LoginUrl).sort((a, b) => a.Weight - b.Weight);
    expect(urlFieldValues.map(fv => fv.Value)).toEqual(['https://www.aliasvault.com', 'https://app.aliasvault.com', 'https://downloads.aliasvault.com']);
  });
});
