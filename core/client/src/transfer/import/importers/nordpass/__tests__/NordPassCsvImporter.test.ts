import { FieldKey, ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { readFixtureText, byName } from '../../../__tests__/testHelpers';
import { collectHierarchicalFolderPaths } from '../../../writers/ImportDuplicateDetection';
import { convertToItems } from '../../../writers/ItemConverter';
import { importNordPassCsv } from '../NordPassCsvImporter';

describe('NordPassCsvImporter', () => {
  it('imports NordPass CSV', () => {
    const imported = importNordPassCsv(readFixtureText(import.meta.dirname, 'nordpass.csv'));
    // The folder row is skipped.
    expect(imported).toHaveLength(4);

    const password = byName(imported, 'Password title');
    expect(password.ServiceUrls?.[0]).toBe('http://google.nl');
    expect(password.Username).toBe('email@example.tld');
    expect(password.Password).toBe('password');
    expect(password.FolderPath).toBe('Business');
    expect(password.ItemType).toBe(ItemTypes.Login);
    expect(password.Notes).toContain('[{"type":"text","label":"CustomFieldName1","value":"Test"}]');

    const secureNote = byName(imported, 'SecureNote1');
    expect(secureNote.ServiceUrls?.[0]).toBeUndefined();
    expect(secureNote.Username).toBe('');
    expect(secureNote.Password).toBe('');
    expect(secureNote.ItemType).toBe(ItemTypes.Note);
    expect(secureNote.Notes).toContain('This is my secure note content');
    expect(secureNote.Notes).toContain('Test test');

    const creditCard = byName(imported, 'Creditcard Visa');
    expect(creditCard.ItemType).toBe(ItemTypes.CreditCard);
    expect(creditCard.Creditcard).toBeDefined();
    expect(creditCard.Creditcard!.CardholderName).toBe('Holdername');
    expect(creditCard.Creditcard!.Number).toBe('1234123412341234123');
    expect(creditCard.Creditcard!.Cvv).toBe('1231');
    expect(creditCard.Creditcard!.Pin).toBe('1231');
    expect(creditCard.Creditcard!.ExpiryMonth).toBe('12');
    expect(creditCard.Creditcard!.ExpiryYear).toBe('28');

    const rootItem = byName(imported, 'Root item');
    expect(rootItem.Username).toBe('rootuser');
    expect(rootItem.Password).toBe('rootpass');
    expect(rootItem.FolderPath).toBeNull();
    expect(rootItem.ItemType).toBe(ItemTypes.Login);
  });

  it('collects NordPass folders', () => {
    const imported = importNordPassCsv(readFixtureText(import.meta.dirname, 'nordpass.csv'));
    expect(collectHierarchicalFolderPaths(imported)).toContain('Business');
    expect(imported.find(c => c.FolderPath === 'Business')!.ServiceName).toBe('Password title');
  });

  it('detects and converts NordPass credit cards', () => {
    const imported = importNordPassCsv(readFixtureText(import.meta.dirname, 'nordpass.csv'));
    const creditCard = byName(imported, 'Creditcard Visa');
    expect(creditCard.ItemType).toBe(ItemTypes.CreditCard);
    expect(creditCard.Creditcard!.CardholderName).toBe('Holdername');
    expect(creditCard.Creditcard!.Number).toBe('1234123412341234123');
    expect(creditCard.Creditcard!.Cvv).toBe('1231');
    expect(creditCard.Creditcard!.Pin).toBe('1231');
    expect(creditCard.Creditcard!.ExpiryMonth).toBe('12');
    expect(creditCard.Creditcard!.ExpiryYear).toBe('28');

    const item = convertToItems([creditCard])[0];
    expect(item.ItemType).toBe(ItemTypes.CreditCard);
    expect(item.FieldValues.find(fv => fv.FieldKey === FieldKey.CardNumber)?.Value).toBe('1234123412341234123');
    expect(item.FieldValues.find(fv => fv.FieldKey === FieldKey.CardCardholderName)?.Value).toBe('Holdername');
    expect(item.FieldValues.find(fv => fv.FieldKey === FieldKey.CardPin)?.Value).toBe('1231');
  });
});
