import { FieldKey, ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { byName, convertToItems, readFixtureText, utc } from '../../../__tests__/testHelpers';
import { importEnpassCsv } from '../EnpassCsvImporter';

describe('EnpassCsvImporter', () => {
  it('imports Enpass CSV', () => {
    const imported = importEnpassCsv(readFixtureText(import.meta.dirname, 'enpass.csv'));
    expect(imported).toHaveLength(5);

    const creditCard = byName(imported, 'Credit Card');
    expect(creditCard.ItemType).toBe(ItemTypes.CreditCard);
    expect(creditCard.Creditcard).toBeDefined();
    expect(creditCard.Creditcard!.CardholderName).toBe('ccholder');
    expect(creditCard.Creditcard!.Number).toBe('1234123412341234');
    expect(creditCard.Creditcard!.Cvv).toBe('1234');
    expect(creditCard.Creditcard!.Pin).toBe('1234');
    expect(creditCard.Creditcard!.ExpiryMonth).toBe('12');
    expect(creditCard.Creditcard!.ExpiryYear).toBe('28');

    const google = byName(imported, 'Google');
    expect(google.ItemType).toBe(ItemTypes.Login);
    expect(google.Username).toBe('usergoogle');
    expect(google.Email).toBe('email@email.com');
    expect(google.Password).toBe('password');
    expect(google.ServiceUrls?.[0]).toBe('https://accounts.google.com/');
    expect(google.TwoFactorSecret).toBe('PLW4SB3PQ7MKVXY2MXF4NEXS6Y');
    expect(google.Notes).toContain('Security question: secquestion');
    expect(google.Notes).toContain('Security answer: secanswer');

    const identity = byName(imported, 'Identity');
    expect(identity.ItemType).toBe(ItemTypes.Alias);
    expect(identity.Alias).toBeDefined();
    expect(identity.Alias!.FirstName).toBe('John');
    expect(identity.Alias!.LastName).toBe('Johnson');
    expect(identity.Alias!.Gender).toBe('Male');
    expect(identity.Alias!.BirthDate?.getTime()).toBe(utc(1970, 1, 1).getTime());

    const password = byName(imported, 'Password');
    expect(password.ItemType).toBe(ItemTypes.Login);
    expect(password.Username).toBe('loginpw1');
    expect(password.Password).toBe('password');

    const secureNote = byName(imported, 'Securenote');
    expect(secureNote.ItemType).toBe(ItemTypes.Note);
    expect(secureNote.Notes).toBe('Note only content here');
  });

  it('converts Enpass credit cards', () => {
    const imported = importEnpassCsv(readFixtureText(import.meta.dirname, 'enpass.csv'));
    const item = convertToItems([byName(imported, 'Credit Card')])[0];

    expect(item.ItemType).toBe(ItemTypes.CreditCard);
    expect(item.FieldValues.find(fv => fv.FieldKey === FieldKey.CardNumber)?.Value).toBe('1234123412341234');
    expect(item.FieldValues.find(fv => fv.FieldKey === FieldKey.CardCardholderName)?.Value).toBe('ccholder');
    expect(item.FieldValues.find(fv => fv.FieldKey === FieldKey.CardCvv)?.Value).toBe('1234');
    expect(item.FieldValues.find(fv => fv.FieldKey === FieldKey.CardPin)?.Value).toBe('1234');
  });
});
