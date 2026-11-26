import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { byName, convertToItems, itemByName, passkeyCanSign, readFixtureText, testPasskeyKeys } from '../../../__tests__/testHelpers';
import { importKeePassXml } from '../../keepass/KeePassXmlImporter';

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

describe('KeePassXC XML export', () => {
  it('imports a KeePassXC XML export', async () => {
    const result = await importKeePassXml(readFixtureText(import.meta.dirname, 'keepassxc.xml'), testPasskeyKeys);
    expect(result.FailedItems).toEqual([]);
    const imported = result.Credentials;
    // KeePassXC has no card or identity entries; the card and the trashed login sit in the recycle bin and are left out.
    expect(imported).toHaveLength(14);
    expect(imported.find(credential => credential.Username === 'av-trashed' || credential.ServiceName === 'AV Card')).toBeUndefined();

    // The root group is the vault root; KDBX 4 dates are base64 seconds since year 1.
    const basic = byName(imported, 'AV Login Basic');
    expect(basic.ItemType).toBe(ItemTypes.Login);
    expect(basic.Username).toBe('av-basic');
    expect(basic.Password).toBe('Pw-Basic-1!');
    expect(basic.ServiceUrls).toEqual(['https://login.example.com']);
    expect(basic.Notes).toBe('Basic note');
    expect(basic.FolderPath).toBeNull();
    expect(basic.CreatedAt!.getUTCFullYear()).toBeGreaterThanOrEqual(2026);
    expect(basic.CreatedAt!.getTime()).toBeLessThanOrEqual(basic.UpdatedAt!.getTime());

    // KeePassXC keeps the TOTP code as an otpauth URI in the protected "otp" field, which is not imported as a custom field.
    const totp = byName(imported, 'AV Login TOTP');
    expect(totp.Username).toBe('av-totp@example.com');
    expect(totp.TwoFactorCodes?.[0].Secret).toBe('otpauth://totp/AV%20Login%20TOTP:av-totp%40example.com?secret=JBSWY3DPEHPK3PXP&period=30&digits=6&issuer=AV%20Login%20TOTP');
    expect(totp.CustomFieldValues).toBeUndefined();
    expect(basic.TwoFactorCodes).toBeNull();

    // Additional URLs follow the main URL; the entry's earlier versions in its history are left out.
    const multiUrl = byName(imported, 'AV Login Multi URL');
    expect(multiUrl.ServiceUrls).toEqual(['https://a.example.com', 'https://b.example.org/login', 'https://c.example.net:8443']);
    expect(multiUrl.CustomFieldValues).toBeUndefined();

    // KeePassXC fields are text, or hidden when protected; this export has one text field.
    expect(fieldsOf(imported, 'AV Login Custom Fields')).toEqual(['AV Text=Region EU (Text)']);

    // KeePassXC leaves the attachment contents out of the XML export of a KDBX 4 database.
    expect(byName(imported, 'AV Login Attachment').Attachments).toBeUndefined();

    // KeePassXC-Browser stores the passkey in KPEX_PASSKEY_* fields (here an Ed25519 key), which are not custom fields.
    const withPasskey = byName(imported, 'AV Login Passkey');
    expect(withPasskey.Username).toBe('av-passkey');
    expect(withPasskey.Password).toBe('Pw-Passkey-6!');
    expect(withPasskey.ServiceUrls).toEqual(['https://webauthn.io']);
    expect(withPasskey.CustomFieldValues).toBeUndefined();
    expect(withPasskey.Passkeys).toHaveLength(1);
    const passkey = withPasskey.Passkeys![0];
    expect(passkey.RpId).toBe('webauthn.io');
    expect(passkey.DisplayName).toBe('av-passkey');
    expect(passkey.CredentialId).toHaveLength(32);
    expect(passkey.UserHandle!.length).toBeGreaterThan(0);
    expect(passkeyCanSign(passkey)).toBe(true);

    expect(byName(imported, 'AV Login Folder').FolderPath).toBe('AV Work');
    expect(byName(imported, 'AV Login Nested Folder').FolderPath).toBe('AV Work/AV Sub');

    const emptyPassword = byName(imported, 'AV Login Empty Password');
    expect(emptyPassword.Username).toBe('av-empty');
    expect(emptyPassword.Password).toBeNull();

    const special = byName(imported, 'AV Login Special Chars äöü 日本');
    expect(special.Username).toBe('av-spécial, "quoted"');
    expect(special.Password).toBe('Pw,"10";\'\\ €ü');
    expect(special.ServiceUrls).toEqual(['https://special.example.com/path?a=1&b=2']);
    expect(special.Notes).toBe('Line one, with a comma and "quotes"\n\nLine three; semicolon');

    expect(byName(imported, 'AV Login No URL').ServiceUrls).toBeUndefined();

    // An entry without a user name, password, URL, TOTP code or passkey is a note.
    const note = byName(imported, 'AV Note');
    expect(note.ItemType).toBe(ItemTypes.Note);
    expect(note.Notes).toBe('Short secure note');
    expect(byName(imported, 'AV Note Long').Notes).toBe(new Array(100).fill('0123456789 The quick brown fox jumps over the lazy dog.').join('\n'));

    // Tags are not imported.
    const tags = byName(imported, 'AV Login Tags');
    expect(tags.Username).toBe('av-tags');
    expect(tags.Tags).toBeUndefined();

    // Conversion extracts the TOTP secret from the URI, names the code after its label (KeePassXC has no TOTP name) and keeps the passkey.
    const convertedItems = convertToItems(imported);
    expect(convertedItems).toHaveLength(14);
    const convertedTotp = itemByName(convertedItems, 'AV Login TOTP');
    expect(convertedTotp.TotpCodes).toHaveLength(1);
    expect(convertedTotp.TotpCodes[0]).toMatchObject({ Name: 'AV Login TOTP: av-totp@example.com', SecretKey: 'JBSWY3DPEHPK3PXP' });
    expect(itemByName(convertedItems, 'AV Login Passkey').Passkeys[0].RpId).toBe('webauthn.io');
  });
});
