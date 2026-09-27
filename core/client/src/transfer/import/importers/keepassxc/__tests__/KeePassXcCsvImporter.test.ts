import { describe, expect, it } from 'vitest';

import { parseFolderPath } from '../../../../shared/FolderPaths';
import { readFixtureText, byName } from '../../../__tests__/testHelpers';
import { collectHierarchicalFolderPaths } from '../../../writers/ImportDuplicateDetection';
import { importKeePassXcCsv } from '../KeePassXcCsvImporter';

describe('KeePassXcCsvImporter', () => {
  it('imports KeePassXC CSV', () => {
    const imported = importKeePassXcCsv(readFixtureText(import.meta.dirname, 'keepassxc.csv'));
    expect(imported).toHaveLength(3);

    const sample = byName(imported, 'Sample Entry');
    expect(sample.ServiceUrls?.[0]).toBe('https://keepass.info/');
    expect(sample.Username).toBe('User Name');
    expect(sample.Password).toBe('Password');
    expect(sample.Notes).toBe('Notes');
    expect(sample.TwoFactorSecret).toBe('');

    const sample2 = byName(imported, 'Sample Entry #2');
    expect(sample2.ServiceUrls?.[0]).toBe('https://keepass.info/help/kb/testform.html');
    expect(sample2.Username).toBe('Michael321');
    expect(sample2.Password).toBe('12345');
    expect(sample2.Notes).toBe('');
    expect(sample2.TwoFactorSecret).toBe('');

    const nested = byName(imported, 'Nested Entry');
    expect(nested.ServiceUrls?.[0]).toBe('https://example.com/');
    expect(nested.Username).toBe('testuser');
    expect(nested.Password).toBe('testpass123');
    expect(nested.Notes).toBe('Nested folder test');
    expect(nested.FolderPath).toBe('Database/Windows/Windowssub1');
  });

  it('imports KeePassXC groups with nesting', () => {
    const imported = importKeePassXcCsv(readFixtureText(import.meta.dirname, 'keepassxc.csv'));

    expect(collectHierarchicalFolderPaths(imported)).toEqual(['Database', 'Test1', 'Database/Windows', 'Database/Windows/Windowssub1']);

    const nested = byName(imported, 'Nested Entry');
    expect(parseFolderPath(nested.FolderPath)).toEqual(['Database', 'Windows', 'Windowssub1']);
  });
});
