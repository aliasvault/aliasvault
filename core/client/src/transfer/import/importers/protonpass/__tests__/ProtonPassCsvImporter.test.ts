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
});
