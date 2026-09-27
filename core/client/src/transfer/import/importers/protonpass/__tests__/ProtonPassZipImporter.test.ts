import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { readFixtureBytes, byName, itemByName } from '../../../__tests__/testHelpers';
import { convertToItems } from '../../../writers/ItemConverter';
import { importProtonPassZip } from '../ProtonPassZipImporter';

describe('ProtonPassZipImporter', () => {
  it('imports a Proton Pass .zip export', () => {
    const imported = (importProtonPassZip(readFixtureBytes(import.meta.dirname, 'protonpass.zip'))).Credentials;
    expect(imported).toHaveLength(7);

    const loginWithTotp = byName(imported, 'Test proton 1');
    expect(loginWithTotp.ItemType).toBe(ItemTypes.Login);
    expect(loginWithTotp.Username).toBe('user1');
    expect(loginWithTotp.Password).toBe('pass1');
    expect(loginWithTotp.ServiceUrls).toEqual(['https://www.website.com/']);
    expect(loginWithTotp.TwoFactorSecret?.startsWith('otpauth://totp/')).toBe(true);
    // The "Personal" vault is promoted to root.
    expect(loginWithTotp.FolderPath).toBeNull();
    expect(loginWithTotp.Email).toBeNull();
    expect(loginWithTotp.CreatedAt?.getTime()).toBe(1744362003 * 1000);

    const alias = byName(imported, 'Test alias');
    expect(alias.ItemType).toBe(ItemTypes.Login);
    expect(alias.Email).toBe('testalias.gating981@passinbox.com');
    expect(alias.Username).toBe('testalias.gating981@passinbox.com');
    expect(alias.Password).toBeUndefined();
    expect(alias.FolderPath).toBeNull();

    const loginNoUrls = byName(imported, 'Test proton2');
    expect(loginNoUrls.Username).toBe('testuser2');
    expect(loginNoUrls.Password).toBe('testpassword2');
    expect(loginNoUrls.ServiceUrls).toBeUndefined();
    expect(loginNoUrls.TwoFactorSecret).toBeNull();

    const loginNoPass = byName(imported, 'testwithoutpass');
    expect(loginNoPass.Username).toBe('testuser');
    expect(loginNoPass.Password).toBeNull();

    const loginWithNote = byName(imported, 'Customfields');
    expect(loginWithNote.Username).toBe('usernamecustom');
    expect(loginWithNote.Password).toBe('passwordecustom');
    expect(loginWithNote.Notes).toBe('Notecustom');
    expect(loginWithNote.ServiceUrls).toEqual(['http://example.com/']);

    const note = byName(imported, 'Customnote');
    expect(note.ItemType).toBe(ItemTypes.Note);
    expect(note.Notes).toBe('Customnotecontent');

    const card = byName(imported, 'Testcreditcard');
    expect(card.ItemType).toBe(ItemTypes.CreditCard);
    expect(card.Notes).toBe('Custom note for creditcard');
    expect(card.FolderPath).toBeNull();
    expect(card.Creditcard!.CardholderName).toBe('J Johnson');
    expect(card.Creditcard!.Number).toBe('1234123412341234123');
    expect(card.Creditcard!.Cvv).toBe('123');
    expect(card.Creditcard!.Pin).toBe('1234');
    expect(card.Creditcard!.ExpiryYear).toBe('2029');
    expect(card.Creditcard!.ExpiryMonth).toBe('06');

    // Conversion extracts the TOTP secret from the URI.
    const convertedItems = convertToItems(imported);
    expect(convertedItems).toHaveLength(7);
    const convertedLogin = itemByName(convertedItems, 'Test proton 1');
    expect(convertedLogin.ItemType).toBe(ItemTypes.Login);
    expect(convertedLogin.TotpCodes).toHaveLength(1);
    expect(convertedLogin.TotpCodes[0].SecretKey).toBe('PLW4SB3PQ7MKVXY2MXF4NEXS6Y');
  });
});
