import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { convertToItems, itemByName, itemByUsername, readFixtureText } from '../../../__tests__/testHelpers';
import { ImportException, ImportStage } from '../../../models/ImportException';
import { importTwoFas } from '../TwoFasImporter';

/**
 * A 2FAS service.
 * @param name - The service name
 * @param account - The account
 * @param otp - Overrides of the otp object
 * @returns The service
 */
function service(name: string, account: string, otp: object = {}): object {
  return { name, secret: 'JBSWY3DPEHPK3PXP', updatedAt: 0, otp: { account, issuer: name, digits: 6, period: 30, algorithm: 'SHA1', tokenType: 'TOTP', source: 'Link', ...otp }, order: { position: 0 }, icon: null, groupId: null };
}

/**
 * A 2FAS backup holding the given services.
 * @param services - The services
 * @param extra - Extra root properties
 * @returns The file content
 */
function backup(services: object[], extra: object = {}): string {
  return JSON.stringify({ services, groups: [{ id: 'g1', name: 'Work', isExpanded: true }], updatedAt: 0, schemaVersion: 4, appVersionCode: 5000000, appVersionName: '5.0.0', appOrigin: 'android', ...extra });
}

describe('TwoFasImporter', () => {
  it('imports the 2FA dataset from a 2FAS backup', () => {
    const result = importTwoFas(readFixtureText(import.meta.dirname, '2fas.2fas'));
    const items = convertToItems(result.Credentials);

    expect(result.Credentials.map(credential => `${credential.ServiceName} / ${credential.Username}`)).toEqual([
      'AV Login TOTP / av-totp@example.com',
      'AV Login Basic / av-basic',
      'webauthn.io / av-passkey',
      'Folder / av-folder@example.com',
      'AV Login Basic / av-other',
      'AV Standalone äöü 日本 / av-standalone@example.org',
    ]);
    // Every code becomes a plain login in the root, without a password, URL or folder; 2FAS has no notes.
    for (const credential of result.Credentials) {
      expect(credential.ItemType).toBe(ItemTypes.Login);
      expect(credential.Password ?? null).toBeNull();
      expect(credential.ServiceUrls ?? null).toBeNull();
      expect(credential.FolderPath ?? null).toBeNull();
      expect(credential.Notes ?? null).toBeNull();
    }

    expect(itemByName(items, 'AV Login TOTP').TotpCodes).toEqual([expect.objectContaining({ Name: '', SecretKey: 'JBSWY3DPEHPK3PXP', Algorithm: 'SHA1', Digits: 6, Period: 30 })]);
    expect(itemByUsername(items, 'av-basic').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'IFLC2MSGIEWUEYLTNFRS2MBQGAYDAMBS' })]);
    expect(itemByUsername(items, 'av-other').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'IFLC2MSGIEWU65DIMVZC2MBQGAYDAMBV' })]);
    expect(itemByName(items, 'webauthn.io').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'IFLC2MSGIEWVAYLTONVWK6JNGAYDAMBT' })]);
    expect(itemByName(items, 'Folder').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'IFLC2MSGIEWUM33MMRSXELJQGAYDAMBU' })]);
    expect(itemByName(items, 'AV Standalone äöü 日本').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'IFLC2MSGIEWVG5DBNZSGC3DPNZSS2MBW', Algorithm: 'SHA256', Digits: 8, Period: 60 })]);

    // AliasVault only stores TOTP codes, so the HOTP service is reported instead of imported.
    expect(result.FailedItems).toEqual([{ Index: 6, ItemTitle: 'AV Counter', ExceptionType: 'UnsupportedOtpCodeError', Message: 'HOTP codes are not supported, only TOTP.' }]);
  });

  it('imports every code as a login in the root, with its parameters', () => {
    const json = backup([
      { ...service('AV Login Basic', 'av-basic'), groupId: 'g1' },
      service('AV Standalone äöü 日本', 'av-standalone@example.org', { algorithm: 'SHA256', digits: 8, period: 60 }),
      { ...service('', 'no-name'), otp: { account: 'no-name', issuer: 'Issuer only', tokenType: 'TOTP' } },
    ]);

    const result = importTwoFas(json);
    const items = convertToItems(result.Credentials);

    expect(result.FailedItems).toEqual([]);
    expect(result.Credentials.map(credential => `${credential.ServiceName} / ${credential.Username} / ${credential.FolderPath ?? 'root'}`)).toEqual([
      'AV Login Basic / av-basic / root',
      'AV Standalone äöü 日本 / av-standalone@example.org / root',
      'Issuer only / no-name / root',
    ]);
    expect(itemByName(items, 'AV Login Basic').TotpCodes).toEqual([expect.objectContaining({ Name: '', SecretKey: 'JBSWY3DPEHPK3PXP', Algorithm: 'SHA1', Digits: 6, Period: 30 })]);
    expect(itemByName(items, 'AV Standalone äöü 日本').TotpCodes).toEqual([expect.objectContaining({ Algorithm: 'SHA256', Digits: 8, Period: 60 })]);
    // Missing parameters fall back to the RFC 6238 defaults.
    expect(itemByName(items, 'Issuer only').TotpCodes).toEqual([expect.objectContaining({ Algorithm: 'SHA1', Digits: 6, Period: 30 })]);
  });

  it('reports codes it cannot generate per service', () => {
    const json = backup([
      service('Counter', 'av-counter', { tokenType: 'HOTP', counter: 5 }),
      service('Steam', 'av-steam', { tokenType: 'STEAM', digits: 5 }),
      service('OK', 'av-ok'),
    ]);

    const result = importTwoFas(json);

    expect(result.Credentials.map(credential => credential.ServiceName)).toEqual(['OK']);
    expect(result.FailedItems).toEqual([
      { Index: 0, ItemTitle: 'Counter', ExceptionType: 'UnsupportedOtpCodeError', Message: 'HOTP codes are not supported, only TOTP.' },
      { Index: 1, ItemTitle: 'Steam', ExceptionType: 'UnsupportedOtpCodeError', Message: 'STEAM codes are not supported, only TOTP.' },
    ]);
  });

  it('reports a password protected or unreadable backup clearly', () => {
    /**
     * The import error of a file.
     * @param json - The file content
     * @returns The error
     */
    const errorOf = (json: string): ImportException => {
      try {
        importTwoFas(json);
      } catch (error) {
        expect(error).toBeInstanceOf(ImportException);
        expect((error as ImportException).stage).toBe(ImportStage.Parse);
        return error as ImportException;
      }
      throw new Error('The import did not fail');
    };

    // A password protected backup holds its services as one encrypted string and sets "reference".
    expect(errorOf(backup([], { servicesEncrypted: 'ZGF0YQ==:c2FsdA==:aXY=', reference: 'cmVm:c2FsdA==:aXY=' })).message).toBe('Password protected 2FAS backups are not supported. Please export without a password.');
    expect(errorOf('{"schemaVersion":4}').message).toContain('no services found');
    expect(errorOf('otpauth://totp/a?secret=b').message).toContain('Failed to parse the 2FAS backup');
  });
});
