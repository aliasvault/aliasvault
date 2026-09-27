import { describe, expect, it } from 'vitest';

import { readFixtureBytes } from '../../../__tests__/testHelpers';
import { AvuxImportService } from '../AvuxImportService';

describe('AvuxImportService', () => {
  it('imports the reference .avux fixture', () => {
    const imported = AvuxImportService.importFromAvux(readFixtureBytes(import.meta.dirname, 'aliasvault.avux'));
    expect(imported.length).toBeGreaterThan(0);
    expect(imported.every(c => c.CreatedAt instanceof Date && !isNaN(c.CreatedAt.getTime()))).toBe(true);
  });
});
