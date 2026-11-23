import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { convertToItems, itemByName, itemByUsername, readFixtureText } from '../../../__tests__/testHelpers';
import { ImportException, ImportStage } from '../../../models/ImportException';
import { importOtpAuthList } from '../OtpAuthListImporter';

describe('OtpAuthListImporter', () => {
  it('imports the 2FA dataset from an Ente Auth plain text export', () => {
    const result = importOtpAuthList(readFixtureText(import.meta.dirname, 'ente-auth.txt'));
    const items = convertToItems(result.Credentials);

    // Ente sorts its export by issuer, so the HOTP entry comes first.
    expect(result.Credentials.map(credential => `${credential.ServiceName} / ${credential.Username}`)).toEqual([
      'AV Login Basic / av-basic',
      'AV Login Basic / av-other',
      'AV Login TOTP / av-totp@example.com',
      'AV Standalone äöü 日本 / av-standalone@example.org',
      'Folder / av-folder@example.com',
      'webauthn.io / av-passkey',
    ]);
    // Every code becomes a plain login in the root, without a password, URL or folder; the note comes from codeDisplay.
    for (const credential of result.Credentials) {
      expect(credential.ItemType).toBe(ItemTypes.Login);
      expect(credential.Password ?? null).toBeNull();
      expect(credential.ServiceUrls ?? null).toBeNull();
      expect(credential.FolderPath ?? null).toBeNull();
    }
    expect(result.Credentials.map(credential => credential.Notes ?? null)).toEqual(['2FA note', null, null, null, null, null]);

    expect(itemByName(items, 'AV Login TOTP').TotpCodes).toEqual([expect.objectContaining({ Name: '', SecretKey: 'JBSWY3DPEHPK3PXP', Algorithm: 'SHA1', Digits: 6, Period: 30 })]);
    expect(itemByUsername(items, 'av-basic').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'IFLC2MSGIEWUEYLTNFRS2MBQGAYDAMBS' })]);
    expect(itemByUsername(items, 'av-other').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'IFLC2MSGIEWU65DIMVZC2MBQGAYDAMBV' })]);
    expect(itemByName(items, 'webauthn.io').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'IFLC2MSGIEWVAYLTONVWK6JNGAYDAMBT' })]);
    expect(itemByName(items, 'Folder').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'IFLC2MSGIEWUM33MMRSXELJQGAYDAMBU' })]);
    expect(itemByName(items, 'AV Standalone äöü 日本').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'IFLC2MSGIEWVG5DBNZSGC3DPNZSS2MBW', Algorithm: 'SHA256', Digits: 8, Period: 60 })]);

    // AliasVault only stores TOTP codes, so the HOTP entry is reported instead of imported.
    expect(result.FailedItems).toEqual([{ Index: 0, ItemTitle: 'AV Counter', ExceptionType: 'UnsupportedOtpCodeError', Message: 'HOTP codes are not supported, only TOTP.' }]);
  });

  it('imports every link as a login in the root, with its parameters', () => {
    const text = [
      'otpauth://totp/AV%20Login%20Basic:av-basic?secret=IFLC2MSGIEWUEYLTNFRS2MBQGAYDAMBS&issuer=AV%20Login%20Basic',
      // Ente writes the label unencoded once a code was edited, and escapes commas.
      'otpauth://totp/AV Standalone äöü 日本:av-standalone@example.org?algorithm=SHA256&digits=8&issuer=AV%20Standalone%20%C3%A4%C3%B6%C3%BC%20%E6%97%A5%E6%9C%AC&period=60&secret=IFLC2MSGIEWVG5DBNZSGC3DPNZSS2MBW',
      'otpauth://totp/Label%20Issuer:av-label?secret=JBSWY3DPEHPK3PXP',
      'otpauth://totp/av-account-only?secret=JBSWY3DPEHPK3PXP',
      '',
    ].join('\r\n');

    const result = importOtpAuthList(text);
    const items = convertToItems(result.Credentials);

    expect(result.FailedItems).toEqual([]);
    expect(result.Credentials.map(credential => `${credential.ServiceName} / ${credential.Username}`)).toEqual([
      'AV Login Basic / av-basic',
      'AV Standalone äöü 日本 / av-standalone@example.org',
      'Label Issuer / av-label',
      'av-account-only / av-account-only',
    ]);
    expect(itemByName(items, 'AV Login Basic').TotpCodes).toEqual([expect.objectContaining({ Name: '', SecretKey: 'IFLC2MSGIEWUEYLTNFRS2MBQGAYDAMBS', Algorithm: 'SHA1', Digits: 6, Period: 30 })]);
    expect(itemByName(items, 'AV Standalone äöü 日本').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'IFLC2MSGIEWVG5DBNZSGC3DPNZSS2MBW', Algorithm: 'SHA256', Digits: 8, Period: 60 })]);
  });

  it('keeps the Ente note and skips codes in the Ente trash', () => {
    /**
     * An Ente codeDisplay parameter value.
     * @param value - The display settings
     * @returns The encoded value
     */
    const display = (value: object): string => encodeURIComponent(JSON.stringify(value));
    const text = [
      `otpauth://totp/Noted:av-noted?secret=JBSWY3DPEHPK3PXP&issuer=Noted&codeDisplay=${display({ pinned: false, trashed: false, tags: ['Work'], note: '2FA note' })}`,
      `otpauth://totp/Trashed:av-trashed?secret=JBSWY3DPEHPK3PXP&issuer=Trashed&codeDisplay=${display({ trashed: true, note: '' })}`,
    ].join('\n');

    const result = importOtpAuthList(text);

    expect(result.Credentials.map(credential => `${credential.ServiceName}: ${credential.Notes} (${credential.FolderPath ?? 'root'})`)).toEqual(['Noted: 2FA note (root)']);
    expect(result.FailedItems).toEqual([]);
  });

  it('reports lines it cannot import per line', () => {
    const text = [
      'otpauth://hotp/AV%20Counter:av-counter?secret=IFLC2MSGIEWUG33VNZ2GK4RNGAYDAMBX&issuer=AV%20Counter&counter=5',
      'otpauth://steam/Steam:av-steam?secret=JBSWY3DPEHPK3PXP&issuer=Steam',
      'otpauth://totp/Ten:av-ten?secret=JBSWY3DPEHPK3PXP&issuer=Ten&digits=10',
      'not a link',
      'otpauth://totp/OK:av-ok?secret=JBSWY3DPEHPK3PXP&issuer=OK',
    ].join('\n');

    const result = importOtpAuthList(text);

    expect(result.Credentials.map(credential => credential.ServiceName)).toEqual(['OK']);
    expect(result.FailedItems.map(failure => `${failure.ItemTitle} (${failure.ExceptionType})`)).toEqual([
      'AV Counter (UnsupportedOtpCodeError)',
      'Steam (UnsupportedOtpCodeError)',
      'Ten (UnsupportedOtpCodeError)',
      'null (Error)',
    ]);
  });

  it('rejects a file without otpauth links', () => {
    for (const text of ['', 'name,secret\nGitHub,JBSWY3DPEHPK3PXP', '{"services":[]}']) {
      expect(() => importOtpAuthList(text)).toThrow(ImportException);
      try {
        importOtpAuthList(text);
      } catch (error) {
        expect((error as ImportException).stage).toBe(ImportStage.Parse);
        expect((error as ImportException).message).toBe('Failed to parse the file: no otpauth:// links found.');
      }
    }
  });
});
