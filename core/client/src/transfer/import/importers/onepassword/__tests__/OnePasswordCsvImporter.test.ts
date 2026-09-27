import { describe, expect, it } from 'vitest';

import { readFixtureText, byName } from '../../../__tests__/testHelpers';
import { importOnePasswordCsv } from '../OnePasswordCsvImporter';

describe('OnePasswordCsvImporter', () => {
  it('imports 1Password CSV', () => {
    const imported = importOnePasswordCsv(readFixtureText(import.meta.dirname, '1password_8.csv'));
    expect(imported).toHaveLength(4);

    const twoFactor = imported.find(c => c.Username === 'username2fa')!;
    expect(twoFactor.ServiceName).toBe('Test record 2 with 2FA');
    expect(twoFactor.Password).toBe('password2fa');
    expect(twoFactor.TwoFactorSecret).toBe('otpauth://totp/Strongbox?secret=PLW4SB3PQ7MKVXY2MXF4NEXS6Y&period=30&algorithm=SHA1&digits=6');
    expect(twoFactor.Notes).toBe('Notes about 2FA record');

    const account = byName(imported, '1Password Account (dpatel)');
    expect(account.ServiceUrls?.[0]).toBe('https://my.1password.com');
    expect(account.Username).toBe('derekpatel@aliasvault.net');
    expect(account.Password).toBe('passwordexample');
    expect(account.Notes).toBe('You can use this login to sign in to your account on 1password.com.');
  });
});
