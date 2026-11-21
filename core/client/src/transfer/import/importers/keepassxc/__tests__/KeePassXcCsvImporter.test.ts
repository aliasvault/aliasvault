import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { byName, convertToItems, readFixtureText } from '../../../__tests__/testHelpers';
import { importKeePassXcCsv } from '../KeePassXcCsvImporter';

describe('KeePassXcCsvImporter', () => {
  it('imports a KeePassXC CSV export', () => {
    const imported = importKeePassXcCsv(readFixtureText(import.meta.dirname, 'keepassxc.csv'));
    // KeePassXC has no card or identity entries; the card and the trashed login sit in the recycle bin and are left out.
    expect(imported).toHaveLength(14);
    expect(imported.find(credential => credential.Username === 'av-trashed' || credential.ServiceName === 'AV Card')).toBeUndefined();
    // The CSV has fixed columns, so no custom fields, attachments or passkeys.
    expect(imported.some(credential => credential.CustomFieldValues || credential.Attachments || credential.Passkeys)).toBe(false);

    // The root group is the vault root.
    const basic = byName(imported, 'AV Login Basic');
    expect(basic.ItemType).toBe(ItemTypes.Login);
    expect(basic.Username).toBe('av-basic');
    expect(basic.Password).toBe('Pw-Basic-1!');
    expect(basic.ServiceUrls).toEqual(['https://login.example.com']);
    expect(basic.Notes).toBe('Basic note');
    expect(basic.FolderPath).toBeNull();
    expect(basic.CreatedAt!.getTime()).toBeLessThanOrEqual(basic.UpdatedAt!.getTime());

    // KeePassXC writes the TOTP code as an otpauth URI.
    const totp = byName(imported, 'AV Login TOTP');
    expect(totp.Username).toBe('av-totp@example.com');
    expect(totp.TwoFactorSecret).toBe('otpauth://totp/AV%20Login%20TOTP:av-totp%40example.com?secret=JBSWY3DPEHPK3PXP&period=30&digits=6&issuer=AV%20Login%20TOTP');
    expect(byName(imported, 'AV Login Basic').TwoFactorSecret).toBe('');

    // The CSV holds only the main URL.
    expect(byName(imported, 'AV Login Multi URL').ServiceUrls).toEqual(['https://a.example.com']);

    expect(byName(imported, 'AV Login Folder').FolderPath).toBe('AV Work');
    expect(byName(imported, 'AV Login Nested Folder').FolderPath).toBe('AV Work/AV Sub');
    expect(byName(imported, 'AV Login Empty Password').Password).toBe('');

    const special = byName(imported, 'AV Login Special Chars äöü 日本');
    expect(special.Username).toBe('av-spécial, "quoted"');
    expect(special.Password).toBe('Pw,"10";\'\\ €ü');
    expect(special.ServiceUrls).toEqual(['https://special.example.com/path?a=1&b=2']);
    expect(special.Notes).toBe('Line one, with a comma and "quotes"\n\nLine three; semicolon');

    expect(byName(imported, 'AV Login No URL').ServiceUrls).toBeNull();

    // An entry without a user name, password, URL or TOTP code is a note.
    const note = byName(imported, 'AV Note');
    expect(note.ItemType).toBe(ItemTypes.Note);
    expect(note.Notes).toBe('Short secure note');
    expect(byName(imported, 'AV Note Long').Notes).toBe(new Array(100).fill('0123456789 The quick brown fox jumps over the lazy dog.').join('\n'));

    // Tags are not imported.
    expect(byName(imported, 'AV Login Tags').Username).toBe('av-tags');

    expect(convertToItems(imported)).toHaveLength(14);
  });
});
