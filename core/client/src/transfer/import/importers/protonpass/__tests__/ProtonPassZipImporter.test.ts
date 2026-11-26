import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { createZipArchive, textToZipBytes } from '../../../../shared/ZipArchive';
import { byName, convertToItems, generatePasskeyKey, itemByName, passkeyCanSign, readFixtureBytes, testPasskeyKeys } from '../../../__tests__/testHelpers';
import { importProtonPassZip } from '../ProtonPassZipImporter';

import { protonPasskeyContent, protonStoredPasskey } from './protonPasskeyFixtures';

import type { ImportedCredential } from '../../../models/ImportedCredential';

/**
 * The custom fields of a credential as "label=value (type)".
 * @param credentials - The credentials
 * @param name - The service name
 * @returns The fields, or undefined when it has none
 */
function fieldsOf(credentials: ImportedCredential[], name: string): string[] | undefined {
  return byName(credentials, name).CustomFieldValues?.map(field => `${field.Label}=${field.Value} (${field.FieldType})`);
}

describe('ProtonPassZipImporter', () => {
  it('imports a Proton Pass .zip export', async () => {
    const result = await importProtonPassZip(readFixtureBytes(import.meta.dirname, 'protonpass.zip'), testPasskeyKeys);
    expect(result.FailedItems).toEqual([]);
    const imported = result.Credentials;
    // The trashed item is skipped. Proton Pass has no tags, so the export has no tags item.
    expect(imported).toHaveLength(15);
    expect(imported.find(credential => credential.ServiceName === 'AV Login Trashed')).toBeUndefined();

    const basic = byName(imported, 'AV Login Basic');
    expect(basic.ItemType).toBe(ItemTypes.Login);
    expect(basic.Username).toBe('av-basic');
    expect(basic.Email).toBeNull();
    expect(basic.Password).toBe('Pw-Basic-1!');
    expect(basic.ServiceUrls).toEqual(['https://login.example.com/']);
    expect(basic.Notes).toBe('Basic note');
    // The "Personal" vault is promoted to root.
    expect(basic.FolderPath).toBeNull();
    expect(basic.CreatedAt?.getTime()).toBe(1795031204 * 1000);

    // Proton Pass keeps the TOTP of a login in a totp field, whose name names the code, and an email address in its own slot.
    const totp = byName(imported, 'AV Login TOTP');
    expect(totp.Username).toBeNull();
    expect(totp.Email).toBe('av-totp@example.com');
    expect(totp.Password).toBe('Pw-Totp-2!');
    expect(totp.TwoFactorCodes?.[0].Secret).toBe('otpauth://totp/AV%20Login%20TOTP:av-totp%40example.com?issuer=AV%20Login%20TOTP&secret=JBSWY3DPEHPK3PXP&algorithm=SHA1&digits=6&period=30');
    expect(totp.TwoFactorCodes?.[0].Name).toBe('TOTP name');
    expect(totp.CustomFieldValues).toBeUndefined();

    expect(byName(imported, 'AV Login Multi URL').ServiceUrls).toEqual(['https://a.example.com/', 'https://b.example.org/login', 'https://c.example.net:8443/']);

    // Proton Pass has text, hidden and date custom fields, and no sections.
    expect(fieldsOf(imported, 'AV Login Custom Fields')).toEqual(['AV Text=Region EU (Text)', 'AV Hidden=1234 (Hidden)', 'AV Date=2030-12-31 (Date)']);

    // Attachments are read from "Proton Pass/files/<name>" and lose the export id Proton Pass adds to the name.
    const attachments = byName(imported, 'AV Login Attachment').Attachments?.map(attachment => `${attachment.Filename}=${new TextDecoder().decode(attachment.Blob)}`);
    expect(attachments).toEqual(['av-attachment.txt=attachment-1', 'av-attachment-2.txt=attachment-2']);

    const withPasskey = byName(imported, 'AV Login Passkey');
    expect(withPasskey.Username).toBe('av-passkey');
    expect(withPasskey.Password).toBe('Pw-Passkey-6!');
    expect(withPasskey.ServiceUrls).toEqual(['https://webauthn.io/']);
    expect(withPasskey.Notes).toBe('Autosaved on https://webauthn.io/');
    expect(withPasskey.Passkeys).toHaveLength(1);
    const passkey = withPasskey.Passkeys![0];
    expect(passkey.RpId).toBe('webauthn.io');
    expect(passkey.DisplayName).toBe('av-passkey');
    expect(passkeyCanSign(passkey)).toBe(true);

    const inFolder = byName(imported, 'AV Login Folder');
    expect(inFolder.Username).toBe('av-folder');
    expect(inFolder.Password).toBe('Pw-Folder-7!');
    expect(inFolder.FolderPath).toBe('AV Work');
    expect(byName(imported, 'AV Login Nested Folder').FolderPath).toBe('AV Work/AV Sub');
    const emptyPassword = byName(imported, 'AV Login Empty Password');
    expect(emptyPassword.Username).toBe('av-empty');
    expect(emptyPassword.Password).toBeNull();
    expect(emptyPassword.ServiceUrls).toEqual(['https://empty.example.com/']);

    const special = byName(imported, 'AV Login Special Chars äöü 日本');
    expect(special.Username).toBe('av-spécial, "quoted"');
    expect(special.Password).toBe('Pw,"10";\'\\ €ü');
    expect(special.ServiceUrls).toEqual(['https://special.example.com/path?a=1&b=2']);
    expect(special.Notes).toBe('Line one, with a comma and "quotes"\n\nLine three; semicolon');

    const noUrl = byName(imported, 'AV Login No URL');
    expect(noUrl.Username).toBe('av-nourl');
    expect(noUrl.ServiceUrls).toBeUndefined();

    const card = byName(imported, 'AV Card');
    expect(card.ItemType).toBe(ItemTypes.CreditCard);
    expect(card.Notes).toBe('Card note');
    expect(card.Creditcard).toEqual({ CardholderName: 'AV Cardholder', Number: '4111111111111111', Cvv: '123', Pin: '4321', ExpiryMonth: '12', ExpiryYear: '2030' });

    // Proton Pass names an identity after its first name and keeps only the full name.
    const identity = byName(imported, 'Avery');
    expect(identity.ItemType).toBe(ItemTypes.Alias);
    expect(identity.Alias).toEqual({ FirstName: 'Avery', LastName: 'Vault' });
    expect(fieldsOf(imported, 'Avery')).toEqual(['Phone=+31201234567 (Phone)', 'Address=Examplestreet 1, Exampletown, Noord-Holland, 1234 AB, Netherlands (Text)']);

    const note = byName(imported, 'AV Note');
    expect(note.ItemType).toBe(ItemTypes.Note);
    expect(note.Notes).toBe('Short secure note');
    expect(byName(imported, 'AV Note Long').Notes).toBe(new Array(100).fill('0123456789 The quick brown fox jumps over the lazy dog.').join('\n'));

    // Conversion extracts the TOTP secret from the URI, names the code after the field and keeps the passkey.
    const convertedItems = convertToItems(imported);
    expect(convertedItems).toHaveLength(15);
    const convertedTotp = itemByName(convertedItems, 'AV Login TOTP');
    expect(convertedTotp.TotpCodes).toHaveLength(1);
    expect(convertedTotp.TotpCodes[0]).toMatchObject({ Name: 'TOTP name', SecretKey: 'JBSWY3DPEHPK3PXP' });
    expect(itemByName(convertedItems, 'AV Login Passkey').Passkeys[0].RpId).toBe('webauthn.io');
  });

  it('imports aliases, other vaults as folders and the URLs of the website autofill modes', async () => {
    const dataJson = JSON.stringify({
      vaults: {
        personal: {
          name: 'Personal',
          items: [{ itemId: 'a', state: 1, aliasEmail: 'alias.123@passinbox.com', data: { metadata: { name: 'Alias', note: '' }, type: 'alias', content: {} } }],
        },
        work: {
          name: 'Work',
          folders: [{ folderId: 'f1', parentFolderId: null, name: 'Projects' }, { folderId: 'f2', parentFolderId: 'f1', name: 'Active' }],
          items: [{
            itemId: 'b',
            state: 1,
            folderId: 'f2',
            files: ['README.0a1b2c3d'],
            data: {
              metadata: { name: 'Modes', note: '' },
              type: 'login',
              content: {
                itemUsername: 'user',
                password: 'pw',
                urls: ['https://default.example.com/'],
                autofillUrls: [0, 1, 2, 3, 4, 5, 6].map(mode => ({ url: `https://mode${mode}.example.com/`, mode })),
              },
            },
          }],
        },
      },
    });
    const archive = createZipArchive({ 'Proton Pass/data.json': textToZipBytes(dataJson), 'Proton Pass/files/README.0a1b2c3d': textToZipBytes('readme') });

    const imported = (await importProtonPassZip(archive)).Credentials;

    const alias = byName(imported, 'Alias');
    expect(alias.ItemType).toBe(ItemTypes.Login);
    expect(alias.Email).toBe('alias.123@passinbox.com');
    expect(alias.Username).toBe('alias.123@passinbox.com');
    expect(alias.Password).toBeUndefined();
    expect(alias.FolderPath).toBeNull();

    // The Never, Pattern and RegularExpression modes hold no website.
    const modes = byName(imported, 'Modes');
    expect(modes.ServiceUrls).toEqual(['https://mode0.example.com/', 'https://mode1.example.com/', 'https://mode3.example.com/', 'https://mode6.example.com/']);
    expect(modes.FolderPath).toBe('Work/Projects/Active');
    expect(modes.Attachments?.map(attachment => attachment.Filename)).toEqual(['README']);
  });

  it('reads "username" as the email and "urls" as the URLs when a login has no itemEmail or autofillUrls', async () => {
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

    const imported = (await importProtonPassZip(createZipArchive({ 'Proton Pass/data.json': textToZipBytes(dataJson) }))).Credentials;

    const usernameOnly = byName(imported, 'Username only');
    expect(usernameOnly.Email).toBe('john');
    expect(usernameOnly.ServiceUrls).toEqual(['https://username.example.com/']);
    expect(byName(imported, 'Empty autofillUrls').ServiceUrls).toEqual(['https://urls.example.com/']);
  });

  it('imports the passkeys of a login', async () => {
    const { scalar } = await generatePasskeyKey();
    const passkey = { keyId: 'k1', content: protonPasskeyContent(protonStoredPasskey(scalar)), domain: 'example.com', rpId: 'example.com', rpName: 'Example', userName: 'jane' };
    const dataJson = JSON.stringify({
      encrypted: false,
      vaults: {
        v1: {
          name: 'Personal',
          items: [
            { itemId: 'a', state: 1, data: { metadata: { name: 'With passkey' }, type: 'login', content: { itemUsername: 'jane', password: '', urls: [], passkeys: [passkey] } } },
            { itemId: 'b', state: 2, data: { metadata: { name: 'Trashed' }, type: 'login', content: { passkeys: [passkey] } } },
            { itemId: 'c', state: 1, data: { metadata: { name: 'Broken passkey' }, type: 'login', content: { itemUsername: 'joe', passkeys: [{ ...passkey, content: 'gqFjkQGhdgE=' }] } } },
          ],
        },
      },
    });

    const result = await importProtonPassZip(createZipArchive({ 'Proton Pass/data.json': textToZipBytes(dataJson) }), testPasskeyKeys);

    expect(result.Credentials.map(credential => credential.ServiceName)).toEqual(['With passkey', 'Broken passkey']);
    const imported = byName(result.Credentials, 'With passkey');
    expect(imported.ServiceUrls).toEqual(['https://example.com']);
    expect(imported.Passkeys).toHaveLength(1);
    expect(itemByName(convertToItems(result.Credentials), 'With passkey').Passkeys[0].RpId).toBe('example.com');

    // The item with the unreadable passkey is kept and reported.
    expect(byName(result.Credentials, 'Broken passkey').Passkeys).toBeUndefined();
    expect(result.FailedItems.map(failure => [failure.Index, failure.ItemTitle, failure.ExceptionType])).toEqual([[2, 'Broken passkey', 'PasskeyImportError']]);
  });
});
