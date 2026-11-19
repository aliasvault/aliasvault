import { describe, expect, it } from 'vitest';

import { byName, readFixtureText, testPasskeyKeys } from '../../../__tests__/testHelpers';
import { ImportException, ImportStage } from '../../../models/ImportException';
import { importBitwardenJson } from '../BitwardenJsonImporter';

import { expectBitwardenTemplateItems, fieldsOf } from './bitwardenTemplate';

describe('BitwardenJsonImporter', () => {
  it('imports a Bitwarden .json export', async () => {
    const result = await importBitwardenJson(readFixtureText(import.meta.dirname, 'bitwarden.json'), testPasskeyKeys);

    expectBitwardenTemplateItems(result);
    // A .json export has no attachments.
    expect(result.Credentials.some(credential => credential.Attachments)).toBe(false);
  });

  it('skips linked custom fields and keeps the title and company of an identity', async () => {
    const json = JSON.stringify({
      encrypted: false,
      folders: [],
      items: [
        { id: 'a', type: 1, name: 'Linked', fields: [{ type: 0, name: 'Text', value: 'kept' }, { type: 3, name: 'Linked', value: null, linkedId: 100 }], login: { uris: [], username: 'user', password: 'pw' } },
        { id: 'b', type: 4, name: 'Identity', fields: [], identity: { title: 'Dr', firstName: 'Jane', lastName: 'Doe', company: 'Example Corp', email: 'jane@example.com' } },
      ],
    });

    const imported = (await importBitwardenJson(json)).Credentials;

    expect(fieldsOf(imported, 'Linked')).toEqual(['Text=kept (Text)']);
    expect(fieldsOf(imported, 'Identity')).toEqual(['Title=Dr (Text)', 'Company=Example Corp (Text)']);
    expect(byName(imported, 'Identity').Email).toBe('jane@example.com');
  });

  it('reports an encrypted or unreadable Bitwarden .json export clearly', async () => {
    /**
     * The import error of a .json file.
     * @param json - The file content
     * @returns The error
     */
    const errorOf = async (json: string): Promise<ImportException> => {
      try {
        await importBitwardenJson(json);
      } catch (error) {
        expect(error).toBeInstanceOf(ImportException);
        expect((error as ImportException).stage).toBe(ImportStage.Parse);
        return error as ImportException;
      }
      throw new Error('The import did not fail');
    };

    // A password protected export holds its items encrypted in "data".
    const passwordProtected = JSON.stringify({ encrypted: true, passwordProtected: true, salt: 'salt', kdfType: 0, kdfIterations: 600000, encKeyValidation_DO_NOT_EDIT: '2.a|b|c', data: '2.d|e|f' });
    expect((await errorOf(passwordProtected)).message).toBe('Encrypted Bitwarden exports are not supported. Please export as unencrypted.');
    expect((await errorOf('{"encrypted":true,"folders":[],"items":[]}')).message).toContain('Encrypted Bitwarden');
    expect((await errorOf('name,login_uri')).message).toContain('Failed to parse the Bitwarden export');
    expect((await errorOf('[]')).message).toContain('Failed to parse the Bitwarden export');
  });
});
