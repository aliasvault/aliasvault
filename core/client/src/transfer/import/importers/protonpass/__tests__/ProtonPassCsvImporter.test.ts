import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { readFixtureText, byName } from '../../../__tests__/testHelpers';
import { importProtonPassCsv } from '../ProtonPassCsvImporter';

describe('ProtonPassCsvImporter', () => {
  it('imports ProtonPass CSV', () => {
    const imported = importProtonPassCsv(readFixtureText(import.meta.dirname, 'protonpass.csv'));
    expect(imported).toHaveLength(4);

    const proton1 = byName(imported, 'Test proton 1');
    expect(proton1.ServiceUrls?.[0]).toBe('https://www.website.com/');
    expect(proton1.Username).toBe('user1');
    expect(proton1.Password).toBe('pass1');
    expect(proton1.TwoFactorSecret).toBe('otpauth://totp/Strongbox?secret=PLW4SB3PQ7MKVXY2MXF4NEXS6Y&algorithm=SHA1&digits=6&period=30');

    const proton2 = byName(imported, 'Test proton2');
    expect(proton2.Username).toBe('testuser2');
    expect(proton2.Password).toBe('testpassword2');

    const withoutPass = byName(imported, 'testwithoutpass');
    expect(withoutPass.Username).toBe('testuser');
    expect(withoutPass.Password).toBe('');

    expect(byName(imported, 'Test alias').Email).toBe('testalias.gating981@passinbox.com');
  });

  it('imports ProtonPass types and vaults', () => {
    const imported = importProtonPassCsv(readFixtureText(import.meta.dirname, 'protonpass.csv'));
    expect(imported.filter(c => !!c.FolderPath).length).toBeGreaterThan(0);
    expect(imported.find(c => c.ItemType === ItemTypes.Login)).toBeDefined();
  });

  it('reads every website URL from the autofillUrls column', () => {
    const autofillUrls = JSON.stringify([{ url: 'https://default.example.com/', mode: 0 }, { url: 'https://exact.example.com/', mode: 1 }, { url: 'https://never.example.com/', mode: 2 }, { url: '^https://re', mode: 5 }]);
    const csv = [
      'type,name,url,autofillUrls,email,username,password,note,totp,createTime,modifyTime,vault',
      `login,With modes,https://default.example.com/,"${autofillUrls.replace(/"/g, '""')}",,user,pw,,,1,1,Personal`,
      'login,Without modes,"https://a.example.com/, https://b.example.com/",,,user,pw,,,1,1,Personal',
    ].join('\n');

    const imported = importProtonPassCsv(csv);

    expect(byName(imported, 'With modes').ServiceUrls).toEqual(['https://default.example.com/', 'https://exact.example.com/']);
    expect(byName(imported, 'Without modes').ServiceUrls).toEqual(['https://a.example.com/', 'https://b.example.com/']);
  });
});
