import { describe, expect, it } from 'vitest';

import { readFixtureText, byName } from '../../../__tests__/testHelpers';
import { collectHierarchicalFolderPaths } from '../../../writers/ImportDuplicateDetection';
import { importDashlaneCsv } from '../DashlaneCsvImporter';

describe('DashlaneCsvImporter', () => {
  it('imports Dashlane CSV', () => {
    const imported = importDashlaneCsv(readFixtureText(import.meta.dirname, 'dashlane.csv'));
    expect(imported).toHaveLength(3);

    const test = byName(imported, 'Test');
    expect(test.ServiceUrls?.[0]).toBe('https://Test');
    expect(test.Username).toBe('Test username');
    expect(test.Password).toBe('password123');
    expect(test.Notes).toBeNull();

    const google = byName(imported, 'Google');
    expect(google.ServiceUrls?.[0]).toBe('https://www.google.com');
    expect(google.Username).toBe('googleuser');
    expect(google.Password).toBe('googlepassword');
    expect(google.Notes).toBeNull();

    const local = byName(imported, 'Local');
    expect(local.ServiceUrls?.[0]).toBe('https://www.testwebsite.local');
    expect(local.Username).toBe('testusername');
    expect(local.Password).toBe('testpassword');
    expect(local.Notes).toBe('testnote\nAlternative username 1: testusernamealternative');
  });

  it('imports Dashlane categories', () => {
    const imported = importDashlaneCsv(readFixtureText(import.meta.dirname, 'dashlane.csv'));
    expect(Array.isArray(collectHierarchicalFolderPaths(imported))).toBe(true);
  });
});
