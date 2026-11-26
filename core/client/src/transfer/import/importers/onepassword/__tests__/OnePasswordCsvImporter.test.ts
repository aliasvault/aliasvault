import { describe, expect, it } from 'vitest';

import { byName, convertToItems, itemByName, readFixtureText } from '../../../__tests__/testHelpers';
import { importOnePasswordCsv } from '../OnePasswordCsvImporter';

describe('OnePasswordCsvImporter', () => {
  it('imports a 1Password CSV export', () => {
    const imported = importOnePasswordCsv(readFixtureText(import.meta.dirname, '1password.csv'));
    // The CSV holds only logins, so it has no card, identity or notes; 1Password vaults do not nest and trashed items are left out.
    expect(imported).toHaveLength(11);
    expect(imported.find(credential => credential.ServiceName === 'AV Login Nested Folder')).toBeUndefined();
    expect(imported.find(credential => credential.ServiceName === 'AV Login Trashed')).toBeUndefined();
    // It has no custom fields, attachments, passkeys or vault column; its tags column is not imported.
    expect(imported.some(credential => credential.CustomFieldValues || credential.Attachments || credential.Passkeys || credential.FolderPath || credential.Tags)).toBe(false);

    const basic = byName(imported, 'AV Login Basic');
    expect(basic.Username).toBe('av-basic');
    expect(basic.Password).toBe('Pw-Basic-1!');
    expect(basic.ServiceUrls).toEqual(['https://login.example.com']);
    expect(basic.Notes).toBe('Basic note');

    const totp = byName(imported, 'AV Login TOTP');
    expect(totp.Username).toBe('av-totp@example.com');
    expect(totp.TwoFactorCodes?.[0].Secret).toBe('otpauth://totp/?secret=JBSWY3DPEHPK3PXP&period=30&algorithm=SHA1&digits=6');

    // The CSV holds only the first URL of a login.
    expect(byName(imported, 'AV Login Multi URL').ServiceUrls).toEqual(['https://a.example.com']);

    // The CSV has no vault column, so the item in the "AV Work" vault lands in the root folder.
    const inFolder = byName(imported, 'AV Login Folder');
    expect(inFolder.Username).toBe('av-folder');
    expect(inFolder.Password).toBe('Pw-Folder-7!');

    expect(byName(imported, 'AV Login Empty Password').Password).toBe('');

    const special = byName(imported, 'AV Login Special Chars äöü 日本');
    expect(special.Username).toBe('av-spécial, "quoted"');
    expect(special.Password).toBe('Pw,"10";\'\\ €ü');
    expect(special.ServiceUrls).toEqual(['https://special.example.com/path?a=1&b=2']);
    expect(special.Notes).toBe('Line one, with a comma and "quotes"\n\nLine three; semicolon');

    expect(byName(imported, 'AV Login No URL').ServiceUrls).toBeNull();

    const withPasskey = byName(imported, 'AV Login Passkey');
    expect(withPasskey.Username).toBe('av-passkey');
    expect(withPasskey.Password).toBe('Pw-Passkey-6!');

    // The favorite column has no AliasVault equivalent.
    const tags = byName(imported, 'AV Login Tags');
    expect(tags.Username).toBe('av-tags');
    expect(tags.ServiceUrls).toEqual(['https://tags.example.com']);

    const convertedItems = convertToItems(imported);
    expect(convertedItems).toHaveLength(11);
    expect(itemByName(convertedItems, 'AV Login TOTP').TotpCodes).toEqual([expect.objectContaining({ Name: '', SecretKey: 'JBSWY3DPEHPK3PXP' })]);
  });
});
