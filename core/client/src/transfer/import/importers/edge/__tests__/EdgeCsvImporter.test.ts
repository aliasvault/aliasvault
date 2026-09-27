import { describe, expect, it } from 'vitest';

import { readFixtureText, byName } from '../../../__tests__/testHelpers';
import { importEdgeCsv } from '../EdgeCsvImporter';

describe('EdgeCsvImporter', () => {
  it('imports Edge CSV', () => {
    const imported = importEdgeCsv(readFixtureText(import.meta.dirname, 'edge.csv'));
    expect(imported).toHaveLength(4);

    const exampleApp = byName(imported, 'example.app.tld');
    expect(exampleApp.ServiceUrls?.[0]).toBe('https://example.app.tld/');
    expect(exampleApp.Username).toBe('exampleu');
    expect(exampleApp.Password).toBe('examplep');
    expect(exampleApp.Notes).toBe('');

    const google = byName(imported, 'google.nl');
    expect(google.ServiceUrls?.[0]).toBe('https://google.nl/');
    expect(google.Username).toBe('myuser');
    expect(google.Password).toBe('mypass');
    expect(google.Notes).toBe('Google note here microsoft edge');

    const youtube = byName(imported, 'youtube.com');
    expect(youtube.ServiceUrls?.[0]).toBe('https://youtube.com/');
    expect(youtube.Username).toBe('youtubeuser');
    expect(youtube.Password).toBe('ytpassword');
    expect(youtube.Notes).toBe('Youtubenotes');
  });
});
