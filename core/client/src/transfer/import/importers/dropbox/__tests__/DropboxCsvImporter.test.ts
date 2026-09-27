import { describe, expect, it } from 'vitest';

import { readFixtureText, byName } from '../../../__tests__/testHelpers';
import { importDropboxCsv } from '../DropboxCsvImporter';

describe('DropboxCsvImporter', () => {
  it('imports Dropbox CSV', () => {
    const imported = importDropboxCsv(readFixtureText(import.meta.dirname, 'dropbox.csv'));
    expect(imported).toHaveLength(5);

    const gmail = byName(imported, 'Gmail');
    expect(gmail.ServiceUrls?.[0]).toBe('https://gmail.com');
    expect(gmail.Username).toBe('testuser@gmail.com');
    expect(gmail.Password).toBe('gmailpass123');
    expect(gmail.Notes).toBe('Important email account');

    const github = byName(imported, 'GitHub');
    expect(github.ServiceUrls?.[0]).toBe('https://github.com');
    expect(github.Username).toBe('devuser');
    expect(github.Password).toBe('devpass789');
    expect(github.Notes).toBe('Development platform');

    const secureNote = byName(imported, 'Secure Note');
    expect(secureNote.ServiceUrls?.[0]).toBeUndefined();
    expect(secureNote.Username).toBe('');
    expect(secureNote.Password).toBe('');
    expect(secureNote.Notes).toBe('Important information stored securely');
  });
});
