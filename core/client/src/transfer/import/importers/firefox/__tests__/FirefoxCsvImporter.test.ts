import { describe, expect, it } from 'vitest';

import { readFixtureText, byName } from '../../../__tests__/testHelpers';
import { importFirefoxCsv } from '../FirefoxCsvImporter';

describe('FirefoxCsvImporter', () => {
  it('imports Firefox CSV', () => {
    const imported = importFirefoxCsv(readFixtureText(import.meta.dirname, 'firefox.csv'));
    expect(imported).toHaveLength(3);

    const example = byName(imported, 'example.com');
    expect(example.ServiceUrls?.[0]).toBe('https://example.com');
    expect(example.Username).toBe('username-example');
    expect(example.Password).toBe('examplepassword');

    const youtube = byName(imported, 'youtube.com');
    expect(youtube.ServiceUrls?.[0]).toBe('https://youtube.com');
    expect(youtube.Username).toBe('youtubeusername');
    expect(youtube.Password).toBe('youtubepassword');
  });
});
