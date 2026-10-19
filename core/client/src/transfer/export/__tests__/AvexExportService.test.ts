import { FieldKey, ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { EncryptionUtility } from '../../../crypto/EncryptionUtility';
import { argon2DeriveKey } from '../../../rust/RustCore';
import { bytesToBase64 } from '../../../utilities/Base64';
import { AvexImportService } from '../../import/importers/aliasvault/AvexImportService';
import { AvuxImportService } from '../../import/importers/aliasvault/AvuxImportService';
import { AvexExportService } from '../AvexExportService';

import { createTestItem, exportItems } from './testHelpers';

describe('AvexExportService', () => {
  it('writes a payload that WebCrypto decrypts, as released clients do', async () => {
    const avuxBytes = exportItems([createTestItem('Encrypted item', ItemTypes.Login, { [FieldKey.LoginUsername]: 'user' })]);

    const avexBytes = await AvexExportService.encryptToAvex(avuxBytes, 'export-password');
    const { header, payloadOffset } = AvexImportService.parseAvexHeader(avexBytes);
    const key = await argon2DeriveKey('export-password', header.kdf.salt, JSON.stringify(header.kdf.params));

    const decrypted = await EncryptionUtility.symmetricDecryptBytes(avexBytes.subarray(payloadOffset), bytesToBase64(key));
    expect(Array.from(decrypted)).toEqual(Array.from(avuxBytes));
  });

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
