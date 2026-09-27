import { describe, expect, it } from 'vitest';

import { readFixtureBytes } from '../../../__tests__/testHelpers';
import { AvexDecryptionError, AvexImportService } from '../AvexImportService';
import { AvuxImportService } from '../AvuxImportService';

describe('AvexImportService', () => {
  const TEST_AVEX_PASSWORD = 'testexportpass123';

  it('decrypts the reference .avex fixture', async () => {
    const avuxBytes = await AvexImportService.decryptAvex(readFixtureBytes(import.meta.dirname, 'aliasvault.avex'), TEST_AVEX_PASSWORD);
    const imported = AvuxImportService.importFromAvux(avuxBytes);
    const reference = AvuxImportService.importFromAvux(readFixtureBytes(import.meta.dirname, 'aliasvault.avux'));
    expect(imported.map(c => c.ServiceName).sort()).toEqual(reference.map(c => c.ServiceName).sort());
  });

  it('rejects a wrong password', async () => {
    await expect(AvexImportService.decryptAvex(readFixtureBytes(import.meta.dirname, 'aliasvault.avex'), 'wrong-password')).rejects.toBeInstanceOf(AvexDecryptionError);
  });
});
