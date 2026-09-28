import { FieldKey, ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { byName, convertToItems, itemByName, readFixtureText } from '../../../__tests__/testHelpers';
import { importLastPassCsv } from '../LastPassCsvImporter';

describe('LastPassCsvImporter', () => {
  it('imports LastPass CSV', () => {
    const imported = importLastPassCsv(readFixtureText(import.meta.dirname, 'lastpass.csv'));
    expect(imported).toHaveLength(5);

    const example = byName(imported, 'Examplename');
    expect(example.ServiceUrls?.[0]).toBe('https://example.com');
    expect(example.Username).toBe('Exampleusername');
    expect(example.Password).toBe('examplepassword');
    expect(example.Notes).toBe('Examplenotes');
    expect(example.TwoFactorSecret).toBe('');

    // LastPass writes "http://" for entries without a URL.
    const withoutUrl = byName(imported, 'Userwithouturlornotes');
    expect(withoutUrl.ServiceUrls?.[0]).toBeUndefined();
    expect(withoutUrl.Username).toBe('userwithouturlornotes');
    expect(withoutUrl.Password).toBe('userpass');
    expect(withoutUrl.Notes).toBe('');
    expect(withoutUrl.TwoFactorSecret).toBe('');

    // Secure notes use "http://sn".
    const secureNote = byName(imported, 'securenote1');
    expect(secureNote.ServiceUrls?.[0]).toBeUndefined();
    expect(secureNote.Username).toBe('');
    expect(secureNote.Password).toBe('');
    expect(secureNote.Notes).toBe('Securenotecontent here');
    expect(secureNote.TwoFactorSecret).toBe('');

    const creditCard = byName(imported, 'Paymentcard1');
    expect(creditCard.ServiceUrls?.[0]).toBeUndefined();
    expect(creditCard.Username).toBe('');
    expect(creditCard.Password).toBe('');
    expect(creditCard.ItemType).toBe(ItemTypes.CreditCard);
    expect(creditCard.Creditcard).toBeDefined();
    expect(creditCard.Creditcard!.CardholderName).toBe('Cardname');
    expect(creditCard.Creditcard!.Number).toBe('123456781234');
    expect(creditCard.Creditcard!.Cvv).toBe('1234');
    expect(creditCard.Notes).toBe('Creditcardnotes here');
    expect(creditCard.TwoFactorSecret).toBe('');
  });

  it('detects LastPass secure notes', () => {
    const items = convertToItems(importLastPassCsv(readFixtureText(import.meta.dirname, 'lastpass.csv')));
    expect(itemByName(items, 'securenote1').ItemType).toBe(ItemTypes.Note);
  });

  it('detects and converts LastPass credit cards', () => {
    const imported = importLastPassCsv(readFixtureText(import.meta.dirname, 'lastpass.csv'));
    const creditCard = byName(imported, 'Paymentcard1');
    expect(creditCard.ItemType).toBe(ItemTypes.CreditCard);
    expect(creditCard.Creditcard!.CardholderName).toBe('Cardname');
    expect(creditCard.Creditcard!.Number).toBe('123456781234');
    expect(creditCard.Creditcard!.Cvv).toBe('1234');

    const item = convertToItems([creditCard])[0];
    expect(item.ItemType).toBe(ItemTypes.CreditCard);
    expect(item.FieldValues.find(fv => fv.FieldKey === FieldKey.CardNumber)?.Value).toBe('123456781234');
    expect(item.FieldValues.find(fv => fv.FieldKey === FieldKey.CardCardholderName)?.Value).toBe('Cardname');
  });

  it('imports LastPass folders', () => {
    const imported = importLastPassCsv(readFixtureText(import.meta.dirname, 'lastpass.csv'));
    const withFolder = imported.find(c => !!c.FolderPath);
    expect(withFolder).toBeDefined();
    expect(withFolder!.FolderPath).toBe('examplefolder');
  });
});
