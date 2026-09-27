import { describe, expect, it } from 'vitest';

import { readFixtureText, byName } from '../../../__tests__/testHelpers';
import { importChromeCsv } from '../ChromeCsvImporter';

describe('ChromeCsvImporter', () => {
  it('imports Chrome CSV', () => {
    const imported = importChromeCsv(readFixtureText(import.meta.dirname, 'chrome.csv'));
    expect(imported).toHaveLength(3);

    const example = byName(imported, 'example.com');
    expect(example.ServiceUrls?.[0]).toBe('https://example.com/');
    expect(example.Username).toBe('usernamegoogle');
    expect(example.Password).toBe('passwordgoogle');
    expect(example.Notes).toBe('Note for example password from Google');

    const facebook = byName(imported, 'facebook.com');
    expect(facebook.ServiceUrls?.[0]).toBe('https://facebook.com/');
    expect(facebook.Username).toBe('facebookuser');
    expect(facebook.Password).toBe('facebookpass');
    expect(facebook.Notes).toBe('Facebook comment');
  });
});
