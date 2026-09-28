import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { byName, convertToItems, itemByName, readFixtureBytes } from '../../../__tests__/testHelpers';
import { importOnePassword1pux } from '../OnePassword1puxImporter';

describe('OnePassword1puxImporter', () => {
  it('imports a 1Password .1pux export', () => {
    const imported = (importOnePassword1pux(readFixtureBytes(import.meta.dirname, '1password_8.1pux'))).Credentials;
    expect(imported).toHaveLength(6);

    const login = byName(imported, 'Example Login');
    expect(login.Username).toBe('jdoe');
    expect(login.Password).toBe('mySecurePassword123');
    expect(login.ServiceUrls).toEqual(['https://example.com']);
    expect(login.TwoFactorSecret).toBe('otpauth://totp/Example:jdoe?secret=JBSWY3DPEHPK3PXP&issuer=Example');
    expect(login.Notes).toBe('My login notes here');
    // The single "Personal" vault is promoted to root.
    expect(login.FolderPath).toBeNull();
    expect(login.ItemType).toBe(ItemTypes.Login);
    expect(login.Tags).toHaveLength(2);
    expect(login.Tags).toContain('work');
    expect(login.Tags).toContain('important');
    expect(login.CustomFieldValues!.find(f => f.Label === 'Recovery Email')!.Value).toBe('recovery@example.com');

    // Timestamps come from Unix time.
    expect(login.CreatedAt?.getTime()).toBe(1614298956 * 1000);
    expect(login.UpdatedAt?.getTime()).toBe(1635346445 * 1000);

    const card = byName(imported, 'My Visa Card');
    expect(card.Notes).toBe('Primary credit card');
    expect(card.FolderPath).toBeNull();
    expect(card.ItemType).toBe(ItemTypes.CreditCard);
    expect(card.Creditcard!.CardholderName).toBe('John Doe');
    expect(card.Creditcard!.Number).toBe('4111111111111111');
    expect(card.Creditcard!.Cvv).toBe('123');
    expect(card.Creditcard!.Pin).toBe('1234');
    expect(card.Creditcard!.ExpiryYear).toBe('2025');
    expect(card.Creditcard!.ExpiryMonth).toBe('12');

    const identity = byName(imported, 'My Identity');
    expect(identity.ItemType).toBe(ItemTypes.Alias);
    expect(identity.Alias!.FirstName).toBe('Jane');
    expect(identity.Alias!.LastName).toBe('Smith');
    expect(identity.Alias!.Gender).toBe('Female');
    expect(identity.Alias!.BirthDate?.getTime()).toBe(631152000 * 1000);

    const note = byName(imported, 'Secure Note');
    expect(note.Notes).toBe('This is a secure note with important information.');
    expect(note.ItemType).toBe(ItemTypes.Note);

    const workLogin = byName(imported, 'Work Portal');
    expect(workLogin.Username).toBe('admin');
    expect(workLogin.Password).toBe('WorkPassword789!');
    expect(workLogin.FolderPath).toBe('Work');
    expect(workLogin.ItemType).toBe(ItemTypes.Login);

    const doc = byName(imported, 'Sample Document');
    expect(doc.Notes).toBe('Test document with attachment');
    expect(doc.FolderPath).toBeNull();
    expect(doc.ItemType).toBe(ItemTypes.Note);
    expect(doc.Attachments).toHaveLength(1);
    expect(doc.Attachments![0].Filename).toBe('sample-document.pdf');
    expect(doc.Attachments![0].Blob.length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(doc.Attachments![0].Blob)).toContain('Sample document content');

    const convertedItems = convertToItems(imported);
    expect(convertedItems).toHaveLength(6);
    const convertedLogin = itemByName(convertedItems, 'Example Login');
    expect(convertedLogin.ItemType).toBe(ItemTypes.Login);
    expect(convertedLogin.TotpCodes).toHaveLength(1);
    expect(convertedLogin.TotpCodes[0].SecretKey).toBe('JBSWY3DPEHPK3PXP');
  });
});
