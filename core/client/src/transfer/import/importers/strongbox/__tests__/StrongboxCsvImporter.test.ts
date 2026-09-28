import { describe, expect, it } from 'vitest';

import { readFixtureText, byName } from '../../../__tests__/testHelpers';
import { importStrongboxCsv } from '../StrongboxCsvImporter';

describe('StrongboxCsvImporter', () => {
  it('imports Strongbox CSV', () => {
    const imported = importStrongboxCsv(readFixtureText(import.meta.dirname, 'strongbox.csv'));
    expect(imported).toHaveLength(6);

    const tutaNota = byName(imported, 'TutaNota');
    expect(tutaNota.Username).toBe('avtest2@tutamail.com');
    expect(tutaNota.Password).toBe('blabla');
    expect(tutaNota.TwoFactorSecret).toBe('otpauth://totp/Strongbox?secret=PLW4SB3PQ7MKVXY2MXF4NEXS6Y&algorithm=SHA1&digits=6&period=30');
    expect(tutaNota.Notes).toContain('Recovery code for main account');

    const sample = byName(imported, 'Sample');
    expect(sample.ServiceUrls?.[0]).toBe('https://strongboxsafe.com');
    expect(sample.Username).toBe('username');
    expect(sample.Password).toBe('&3V_$z?Aiw-_x+nbYj');
  });
});
