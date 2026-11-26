import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { byName, convertToItems, itemByName, readFixtureText } from '../../../__tests__/testHelpers';
import { importBitwardenCsv } from '../BitwardenCsvImporter';

import { fieldsOf } from './bitwardenTemplate';

describe('BitwardenCsvImporter', () => {
  it('imports a Bitwarden CSV export', () => {
    const imported = importBitwardenCsv(readFixtureText(import.meta.dirname, 'bitwarden.csv'));
    // The CSV holds only logins and notes, so it has no card or identity; trashed items are left out.
    expect(imported).toHaveLength(14);
    expect(imported.map(credential => credential.ItemType).filter(type => type !== ItemTypes.Login)).toEqual([ItemTypes.Note, ItemTypes.Note]);
    // It has no attachments or passkeys.
    expect(imported.some(credential => credential.Attachments || credential.Passkeys)).toBe(false);

    const basic = byName(imported, 'AV Login Basic');
    expect(basic.Username).toBe('av-basic');
    expect(basic.Password).toBe('Pw-Basic-1!');
    expect(basic.ServiceUrls).toEqual(['https://login.example.com/']);
    expect(basic.Notes).toBe('Basic note');
    expect(basic.FolderPath).toBeNull();

    const totp = byName(imported, 'AV Login TOTP');
    expect(totp.Username).toBe('av-totp@example.com');
    expect(totp.TwoFactorCodes?.[0].Secret).toBe('JBSWY3DPEHPK3PXP');

    // The URLs of a login are one comma separated column.
    expect(byName(imported, 'AV Login Multi URL').ServiceUrls).toEqual(['https://a.example.com/', 'https://b.example.org/login', 'https://c.example.net:8443/']);

    // The fields column has a "name: value" line per field, without the field type.
    expect(fieldsOf(imported, 'AV Login Custom Fields')).toEqual(['AV Text=Region EU (Text)', 'AV Hidden=1234 (Text)', 'AV Bool=true (Text)']);

    const withPasskey = byName(imported, 'AV Login Passkey');
    expect(withPasskey.Username).toBe('av-passkey');
    expect(withPasskey.Notes).toBe('');

    expect(byName(imported, 'AV Login Folder').FolderPath).toBe('AV Work');
    expect(byName(imported, 'AV Login Nested Folder').FolderPath).toBe('AV Work/AV Sub');
    expect(byName(imported, 'AV Login Empty Password').Password).toBe('');

    const special = byName(imported, 'AV Login Special Chars äöü 日本');
    expect(special.Username).toBe('av-spécial, "quoted"');
    expect(special.Password).toBe('Pw,"10";\'\\ €ü');
    expect(special.ServiceUrls).toEqual(['https://special.example.com/path?a=1&b=2']);
    expect(special.Notes).toBe('Line one, with a comma and "quotes"\n\nLine three; semicolon');

    expect(byName(imported, 'AV Login No URL').ServiceUrls).toBeNull();

    expect(byName(imported, 'AV Note').Notes).toBe('Short secure note');
    expect(byName(imported, 'AV Note Long').Notes).toBe(new Array(100).fill('0123456789 The quick brown fox jumps over the lazy dog.').join('\n'));

    // Bitwarden has no tags; the favorite column has no AliasVault equivalent.
    const tags = byName(imported, 'AV Login Tags');
    expect(tags.Username).toBe('av-tags');
    expect(tags.ServiceUrls).toEqual(['https://tags.example.com']);

    const convertedItems = convertToItems(imported);
    expect(convertedItems).toHaveLength(14);
    expect(itemByName(convertedItems, 'AV Login TOTP').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'JBSWY3DPEHPK3PXP' })]);
  });

  it('splits each line of the fields column on its first ": "', () => {
    const csv = [
      'folder,favorite,type,name,notes,fields,reprompt,archivedDate,login_uri,login_username,login_password,login_totp',
      ',,login,Fields,,"Question: Where: here\r\n\r\nNo separator\r\nEmpty: \r\n: No name",0,,,user,pw,',
    ].join('\r\n');

    expect(fieldsOf(importBitwardenCsv(csv), 'Fields')).toEqual(['Question=Where: here (Text)']);
  });
});
