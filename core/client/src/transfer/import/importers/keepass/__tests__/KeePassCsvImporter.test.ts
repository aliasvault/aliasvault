import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { byName, convertToItems, readFixtureText } from '../../../__tests__/testHelpers';
import { importKeePassCsv } from '../KeePassCsvImporter';

describe('KeePassCsvImporter', () => {
  it('imports a KeePass CSV export', () => {
    const imported = importKeePassCsv(readFixtureText(import.meta.dirname, 'keepass.csv'));
    // The CSV has no groups, so the card and the trashed login in the recycle bin are included; KeePass has no identity entries.
    expect(imported).toHaveLength(16);
    expect(byName(imported, 'AV Login Thrashed').Username).toBe('av-trashed');
    // The CSV has fixed columns, so no folders, dates, TOTP codes, custom fields, attachments or passkeys.
    expect(imported.some(credential => credential.FolderPath || credential.CreatedAt || credential.TwoFactorCodes || credential.CustomFieldValues || credential.Attachments || credential.Passkeys)).toBe(false);

    const basic = byName(imported, 'AV Login Basic');
    expect(basic.ItemType).toBe(ItemTypes.Login);
    expect(basic.Username).toBe('av-basic');
    expect(basic.Password).toBe('Pw-Basic-1!');
    expect(basic.ServiceUrls).toEqual(['https://login.example.com']);
    expect(basic.Notes).toBe('Basic note');

    expect(byName(imported, 'AV Login TOTP').Username).toBe('av-totp@example.com');
    // The CSV holds only the main URL.
    expect(byName(imported, 'AV Login Multi URL').ServiceUrls).toEqual(['https://a.example.com']);
    expect(byName(imported, 'AV Login Folder').Password).toBe('Pw-Folder-7!');
    expect(byName(imported, 'AV Login Empty Password').Password).toBe('');

    // KeePass writes quotes as \" and backslashes as \\.
    const special = byName(imported, 'AV Login Special Chars äöü 日本');
    expect(special.Username).toBe('av-spécial, "quoted"');
    expect(special.Password).toBe('Pw,"10";\'\\ €ü');
    expect(special.ServiceUrls).toEqual(['https://special.example.com/path?a=1&b=2']);
    expect(special.Notes).toBe('Line one, with a comma and "quotes"\n\nLine three; semicolon');

    expect(byName(imported, 'AV Login No URL').ServiceUrls).toBeNull();

    // An entry without a user name, password or URL is a note.
    const note = byName(imported, 'AV Note');
    expect(note.ItemType).toBe(ItemTypes.Note);
    expect(note.Notes).toBe('Short secure note');
    expect(byName(imported, 'AV Note Long').Notes).toBe(new Array(100).fill('0123456789 The quick brown fox jumps over the lazy dog.').join('\n'));
    expect(byName(imported, 'AV Card').ItemType).toBe(ItemTypes.Note);

    expect(byName(imported, 'AV Login Tags').Username).toBe('av-tags');

    expect(convertToItems(imported)).toHaveLength(16);
  });

  it('reads a value that ends with a backslash or has a backslash before a quote', () => {
    const imported = importKeePassCsv('"Account","Login Name","Password","Web Site","Comments"\r\n"Entry","user\\\\","a\\\\\\"b","",""\r\n');

    expect(imported[0].Username).toBe('user\\');
    expect(imported[0].Password).toBe('a\\"b');
  });
});
