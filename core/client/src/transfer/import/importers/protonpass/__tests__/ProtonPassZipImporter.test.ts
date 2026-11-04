import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { createZipArchive, textToZipBytes } from '../../../../shared/ZipArchive';
import { byName, convertToItems, itemByName, readFixtureBytes } from '../../../__tests__/testHelpers';
import { importProtonPassZip } from '../ProtonPassZipImporter';

describe('ProtonPassZipImporter', () => {
  it('imports a Proton Pass .zip export', () => {
    const imported = (importProtonPassZip(readFixtureBytes(import.meta.dirname, 'protonpass.zip'))).Credentials;
    expect(imported).toHaveLength(10);

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

    // Attachments are read from "Proton Pass/files/<name>" and lose the export id Proton Pass adds to the name.
    const withAttachments = byName(imported, 'Login with attachments');
    expect(withAttachments.Username).toBe('attachuser');
    expect(withAttachments.ServiceUrls).toEqual(['https://files.example.com/login', 'https://files.example.com/']);
    expect(withAttachments.Attachments?.map(attachment => attachment.Filename)).toEqual(['ConfigBackup.txt', 'README']);
    expect(new TextDecoder().decode(withAttachments.Attachments![0].Blob)).toBe('config backup contents\n');

    // URLs come from autofillUrls, skipping the Never, Pattern and RegularExpression modes.
    const withModes = byName(imported, 'Login with autofill modes');
    expect(withModes.ServiceUrls).toEqual(['https://exact.example.com/', 'https://start.example.com/app', 'https://exactpath.example.com/path']);
    expect(withModes.FolderPath).toBe('Banking');

    // A folder inside a non-default vault nests below the vault folder.
    expect(byName(imported, 'Work login').FolderPath).toBe('Work/Projects/Active');

    // Conversion extracts the TOTP secret from the URI.
    const convertedItems = convertToItems(imported);
    expect(convertedItems).toHaveLength(10);
    const convertedLogin = itemByName(convertedItems, 'Test proton 1');
    expect(convertedLogin.ItemType).toBe(ItemTypes.Login);
    expect(convertedLogin.TotpCodes).toHaveLength(1);
    expect(convertedLogin.TotpCodes[0].SecretKey).toBe('PLW4SB3PQ7MKVXY2MXF4NEXS6Y');
  });

  it('reads "username" as the email and "urls" as the URLs when a login has no itemEmail or autofillUrls', () => {
    /**
     * A login item.
     * @param name - The item name
     * @param content - The login content
     * @returns The item JSON
     */
    const login = (name: string, content: object): object => ({ itemId: name, shareId: 's', state: 1, data: { metadata: { name, note: '' }, extraFields: [], type: 'login', content }, files: [] });
    const dataJson = JSON.stringify({
      vaults: {
        s: {
          name: 'Personal',
          items: [
            login('Username only', { username: 'john', password: 'pw', urls: ['https://username.example.com/'], totpUri: '', passkeys: [] }),
            login('Empty autofillUrls', { itemEmail: '', itemUsername: 'user', password: 'pw', urls: ['https://urls.example.com/'], autofillUrls: [], totpUri: '', passkeys: [] }),
          ],
        },
      },
    });

    const imported = importProtonPassZip(createZipArchive({ 'Proton Pass/data.json': textToZipBytes(dataJson) })).Credentials;

    const usernameOnly = byName(imported, 'Username only');
    expect(usernameOnly.Email).toBe('john');
    expect(usernameOnly.ServiceUrls).toEqual(['https://username.example.com/']);
    expect(byName(imported, 'Empty autofillUrls').ServiceUrls).toEqual(['https://urls.example.com/']);
  });
});
