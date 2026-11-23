import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { convertToItems, itemByName, readFixtureText } from '../../../__tests__/testHelpers';
import { ImportException, ImportStage } from '../../../models/ImportException';
import { importAegisJson } from '../AegisJsonImporter';

import type { ItemEntity } from '../../../../shared/VaultEntities';

/**
 * The item holding a code for an account.
 * @param items - The items
 * @param account - The account (username)
 * @returns The item
 */
function itemOfAccount(items: ItemEntity[], account: string): ItemEntity {
  const item = items.find(candidate => candidate.FieldValues.some(field => field.FieldKey === 'login.username' && field.Value === account));
  if (!item) {
    throw new Error(`No item for '${account}'`);
  }
  return item;
}

/**
 * An Aegis export holding the given entries.
 * @param entries - The db entries
 * @param groups - The db groups
 * @returns The file content
 */
function aegisExport(entries: object[], groups: object[] = []): string {
  return JSON.stringify({ version: 1, header: { slots: null, params: null }, db: { version: 3, entries, groups } });
}

describe('AegisJsonImporter', () => {
  it('imports the 2FA dataset from an Aegis .json export', () => {
    const result = importAegisJson(readFixtureText(import.meta.dirname, 'aegis.json'));
    const items = convertToItems(result.Credentials);

    expect(result.Credentials.map(credential => `${credential.ServiceName} / ${credential.Username}`)).toEqual([
      'AV Login TOTP / av-totp@example.com',
      'AV Login Basic / av-basic',
      'webauthn.io / av-passkey',
      'Folder / av-folder@example.com',
      'AV Login Basic / av-other',
      'AV Standalone äöü 日本 / av-standalone@example.org',
    ]);
    // Every code becomes a plain login in the root, without a password, URL or folder.
    for (const credential of result.Credentials) {
      expect(credential.ItemType).toBe(ItemTypes.Login);
      expect(credential.Password ?? null).toBeNull();
      expect(credential.ServiceUrls ?? null).toBeNull();
      expect(credential.FolderPath ?? null).toBeNull();
    }
    expect(result.Credentials.map(credential => credential.Notes ?? null)).toEqual([null, '2FA note', null, null, null, null]);

    expect(itemByName(items, 'AV Login TOTP').TotpCodes).toEqual([expect.objectContaining({ Name: '', SecretKey: 'JBSWY3DPEHPK3PXP', Algorithm: 'SHA1', Digits: 6, Period: 30 })]);
    expect(itemOfAccount(items, 'av-basic').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'IFLC2MSGIEWUEYLTNFRS2MBQGAYDAMBS' })]);
    expect(itemOfAccount(items, 'av-other').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'IFLC2MSGIEWU65DIMVZC2MBQGAYDAMBV' })]);
    expect(itemByName(items, 'webauthn.io').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'IFLC2MSGIEWVAYLTONVWK6JNGAYDAMBT' })]);
    expect(itemByName(items, 'Folder').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'IFLC2MSGIEWUM33MMRSXELJQGAYDAMBU' })]);
    expect(itemByName(items, 'AV Standalone äöü 日本').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'IFLC2MSGIEWVG5DBNZSGC3DPNZSS2MBW', Algorithm: 'SHA256', Digits: 8, Period: 60 })]);

    // AliasVault only stores TOTP codes, so the HOTP entry is reported instead of imported.
    expect(result.FailedItems).toEqual([{ Index: 6, ItemTitle: 'AV Counter', ExceptionType: 'UnsupportedOtpCodeError', Message: 'HOTP codes are not supported, only TOTP.' }]);
  });

  it('leaves out groups, keeps notes and falls back to the account when there is no issuer', () => {
    const json = aegisExport([
      { type: 'totp', name: 'grouped', issuer: 'Grouped', note: 'A note', groups: ['g1'], info: { secret: 'JBSWY3DPEHPK3PXP', algo: 'SHA1', digits: 6, period: 30 } },
      { type: 'totp', name: 'no-issuer', issuer: '', note: '', groups: [], info: { secret: 'JBSWY3DPEHPK3PXP', algo: 'SHA1', digits: 6, period: 30 } },
    ], [{ uuid: 'g1', name: 'Work' }]);

    const [grouped, noIssuer] = importAegisJson(json).Credentials;

    expect(grouped.FolderPath ?? null).toBeNull();
    expect(grouped.Notes).toBe('A note');
    expect(noIssuer.ServiceName).toBe('no-issuer');
  });

  it('reports codes it cannot generate per entry', () => {
    const info = { secret: 'JBSWY3DPEHPK3PXP', algo: 'SHA1', digits: 6, period: 30 };
    const json = aegisExport([
      { type: 'steam', name: 'steam', issuer: 'Steam', info: { ...info, digits: 5 } },
      { type: 'totp', name: 'md5', issuer: 'MD5', info: { ...info, algo: 'MD5' } },
      { type: 'totp', name: 'ten-digits', issuer: 'Ten digits', info: { ...info, digits: 10 } },
      { type: 'totp', name: 'bad-secret', issuer: 'Bad secret', info: { ...info, secret: 'not base32!' } },
      { type: 'totp', name: 'ok', issuer: 'OK', info },
    ]);

    const result = importAegisJson(json);

    expect(result.Credentials.map(credential => credential.ServiceName)).toEqual(['OK']);
    expect(result.FailedItems.map(failure => `${failure.ItemTitle} (${failure.ExceptionType})`)).toEqual([
      'Steam (UnsupportedOtpCodeError)',
      'MD5 (UnsupportedOtpCodeError)',
      'Ten digits (UnsupportedOtpCodeError)',
      'Bad secret (Error)',
    ]);
  });

  it('reports an encrypted or unreadable Aegis export clearly', () => {
    /**
     * The import error of a file.
     * @param json - The file content
     * @returns The error
     */
    const errorOf = (json: string): ImportException => {
      try {
        importAegisJson(json);
      } catch (error) {
        expect(error).toBeInstanceOf(ImportException);
        expect((error as ImportException).stage).toBe(ImportStage.Parse);
        return error as ImportException;
      }
      throw new Error('The import did not fail');
    };

    // An encrypted export holds key slots in its header and the entries as one encrypted string.
    const encrypted = JSON.stringify({ version: 1, header: { slots: [{ type: 1, uuid: 'u', key: 'k', key_params: { nonce: 'n', tag: 't' } }], params: { nonce: 'n', tag: 't' } }, db: 'ZW5jcnlwdGVk' });
    expect(errorOf(encrypted).message).toBe('Encrypted Aegis exports are not supported. Please export without encryption.');
    expect(errorOf('{"version":1,"header":{"slots":null},"db":{"version":3}}').message).toContain('no entries found');
    expect(errorOf('name,secret').message).toContain('Failed to parse the Aegis export');
    expect(errorOf('[]').message).toContain('Failed to parse the Aegis export');
  });
});
