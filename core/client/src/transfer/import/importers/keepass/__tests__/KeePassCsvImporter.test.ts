import { describe, expect, it } from 'vitest';

import { readFixtureText, byName } from '../../../__tests__/testHelpers';
import { importKeePassCsv } from '../KeePassCsvImporter';

describe('KeePassCsvImporter', () => {
  it('imports KeePass CSV', () => {
    const imported = importKeePassCsv(readFixtureText(import.meta.dirname, 'keepass.csv'));
    expect(imported).toHaveLength(2);

    const sample = byName(imported, 'Sample Entry');
    expect(sample.ServiceUrls?.[0]).toBe('https://keepass.info/');
    expect(sample.Username).toBe('User Name');
    expect(sample.Password).toBe('Password');
    expect(sample.Notes).toBe('Notes');

    const sample2 = byName(imported, 'Sample Entry #2');
    expect(sample2.ServiceUrls?.[0]).toBe('https://keepass.info/help/kb/testform.html');
    expect(sample2.Username).toBe('Michael321');
    expect(sample2.Password).toBe('12345');
    expect(sample2.Notes).toBe('');
  });

  it('imports KeePass CSV with special characters and double quotes', () => {
    const imported = importKeePassCsv(readFixtureText(import.meta.dirname, 'keepass_special_chars.csv'));
    expect(imported).toHaveLength(3);

    const special = imported.find(c => c.ServiceName?.startsWith('Entry with'))!;
    expect(special.ServiceName).toBe('Entry with "notes" special chars');
    expect(special.ServiceUrls?.[0]).toBeUndefined();
    expect(special.Username).toBe('');
    expect(special.Password).toBe('DVfIsb4TGkL7oKCwyiet');
    expect(special.Notes).toBe('Note "with quotes"\'as\'d as/d/asd/ z\'s\'sd a8e89A)_@()@\'":ÄS"d\';asd;á\'sd');

    const sample = byName(imported, 'Sample Entry');
    expect(sample.ServiceUrls?.[0]).toBe('https://keepass.info/');
    expect(sample.Username).toBe('User Name');
    expect(sample.Password).toBe('Password');
    expect(sample.Notes).toBe('Notes');
  });
});
