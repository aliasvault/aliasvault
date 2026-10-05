import { FieldKey, ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { AvexImportService } from '../../import/importers/aliasvault/AvexImportService';
import { AvuxImportService } from '../../import/importers/aliasvault/AvuxImportService';
import { AvexExportService } from '../AvexExportService';

import { createTestItem, exportItems } from './testHelpers';

describe('AvexExportService', () => {
  it('decrypts what it encrypted', async () => {
    const avuxBytes = exportItems([createTestItem('Encrypted item', ItemTypes.Login, { [FieldKey.LoginUsername]: 'user' })]);

    const avexBytes = await AvexExportService.encryptToAvex(avuxBytes, 'export-password');
    const { header } = AvexImportService.parseAvexHeader(avexBytes);
    expect(header.format).toBe('avex');
    expect(header.version).toBe('1.0.0');
    expect(header.kdf.type.toLowerCase()).toBe('argon2id');
    expect(header.kdf.params).toEqual({ DegreeOfParallelism: 1, MemorySize: 262144, Iterations: 3 });
    expect(header.metadata).not.toHaveProperty('exportedBy');

    const decrypted = await AvexImportService.decryptAvex(avexBytes, 'export-password');
    expect(Array.from(decrypted)).toEqual(Array.from(avuxBytes));
    expect(AvuxImportService.importFromAvux(decrypted)[0].ServiceName).toBe('Encrypted item');
  });
});
