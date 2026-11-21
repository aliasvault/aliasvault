import { randomBytes } from 'node:crypto';

import { FieldTypes } from '@aliasvault/models/vault';
import { gzipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { bytesToBase64, bytesToBase64Url } from '../../../../../utilities/Base64';
import { byName, convertToItems, generatePasskeyKey, itemByName, passkeyCanSign, testPasskeyKeys } from '../../../__tests__/testHelpers';
import { ImportException } from '../../../models/ImportException';
import { importKeePassXml } from '../KeePassXmlImporter';

/**
 * A String element of an entry.
 * @param key - The field name
 * @param value - The field value
 * @param isProtected - Whether the value is protected
 * @returns The XML
 */
const field = (key: string, value: string, isProtected = false): string => `<String><Key>${key}</Key><Value${isProtected ? ' ProtectInMemory="True"' : ''}>${value.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</Value></String>`;

/**
 * An Entry element.
 * @param title - The title
 * @param content - The other elements of the entry
 * @returns The XML
 */
const entry = (title: string, ...content: string[]): string => `<Entry><UUID>${bytesToBase64(randomBytes(16))}</UUID>${field('Title', title)}${content.join('')}</Entry>`;

/**
 * A KeePass XML document.
 * @param rootContent - The content of the root group
 * @param meta - The content of the Meta element
 * @returns The XML
 */
const keePassXml = (rootContent: string, meta = ''): string => `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\r\n<KeePassFile><Meta><Generator>KeePass</Generator>${meta}</Meta><Root><Group><UUID>cm9vdHJvb3Ryb290cm9vdA==</UUID><Name>Database</Name>${rootContent}</Group><DeletedObjects/></Root></KeePassFile>`;

/**
 * A private key as PEM.
 * @param pkcs8 - The PKCS#8 DER key
 * @param lineBreaks - Whether to wrap the base64 at 64 characters
 * @returns The PEM text
 */
const pem = (pkcs8: Uint8Array, lineBreaks: boolean): string => {
  const base64 = bytesToBase64(pkcs8);
  return `-----BEGIN PRIVATE KEY-----\n${lineBreaks ? base64.match(/.{1,64}/g)!.join('\n') : base64}\n-----END PRIVATE KEY-----`;
};

describe('KeePassXmlImporter', () => {
  it('reads ISO dates and the attachment pool of a KeePass 2 export, and leaves out the recycle bin and old versions', async () => {
    const recycleBin = 'cmVjeWNsZWJpbnJlY3ljbA==';
    const meta = `<Binaries><Binary ID="0" Compressed="True">${bytesToBase64(gzipSync(strToU8('attachment-1')))}</Binary><Binary ID="1">${bytesToBase64(strToU8('attachment-2'))}</Binary></Binaries><RecycleBinEnabled>True</RecycleBinEnabled><RecycleBinUUID>${recycleBin}</RecycleBinUUID>`;
    const root = entry(
      'With files',
      '<Times><CreationTime>2026-11-20T10:00:00Z</CreationTime><LastModificationTime>2026-11-20T11:30:00Z</LastModificationTime></Times>',
      field('UserName', 'user'),
      field('Notes', 'line one\r\nline two'),
      '<Binary><Key>a.txt</Key><Value Ref="0"/></Binary><Binary><Key>b.txt</Key><Value Ref="1"/></Binary>',
      `<History>${entry('With files', field('Password', 'old'))}</History>`,
    ) + `<Group><UUID>${recycleBin}</UUID><Name>Recycle Bin</Name>${entry('Trashed', field('UserName', 'trashed'))}</Group>`
      + `<Group><UUID>d29ya3dvcmt3b3Jrd29yaw==</UUID><Name>Work</Name>${entry('In work', field('UserName', 'work'))}</Group>`;

    const result = await importKeePassXml(keePassXml(root, meta), testPasskeyKeys);

    expect(result.FailedItems).toEqual([]);
    expect(result.Credentials.map(credential => [credential.ServiceName, credential.FolderPath])).toEqual([['With files', null], ['In work', 'Work']]);
    const withFiles = byName(result.Credentials, 'With files');
    expect(withFiles.CreatedAt).toEqual(new Date('2026-11-20T10:00:00Z'));
    expect(withFiles.UpdatedAt).toEqual(new Date('2026-11-20T11:30:00Z'));
    expect(withFiles.Password).toBeNull();
    expect(withFiles.Notes).toBe('line one\nline two');
    expect(withFiles.Attachments?.map(attachment => `${attachment.Filename}=${new TextDecoder().decode(attachment.Blob)}`)).toEqual(['a.txt=attachment-1', 'b.txt=attachment-2']);
  });

  it('reads the TOTP code of KeePassXC, KeePass 2, KeeOtp, KeeTrayTOTP and KeeWeb, and skips a Steam code', async () => {
    // The bytes 48656c6c6f21deadbeef.
    const secret = 'JBSWY3DPEHPK3PXP';
    const root = [
      entry('KeePassXC', field('UserName', 'u'), field('otp', `otpauth://totp/AV:u?secret=${secret}&period=30&digits=6&issuer=AV`, true)),
      entry('KeePass 2', field('UserName', 'u'), field('TimeOtp-Secret-Base32', secret, true), field('TimeOtp-Length', '8'), field('TimeOtp-Period', '60'), field('TimeOtp-Algorithm', 'HMAC-SHA-512')),
      entry('KeePass 2 hex', field('UserName', 'u'), field('TimeOtp-Secret-Hex', '48 65 6c 6c 6f 21 de ad be ef', true)),
      entry('KeePass 2 base64', field('UserName', 'u'), field('TimeOtp-Secret-Base64', 'SGVsbG8h3q2+7w==', true)),
      entry('KeePass 2 text', field('UserName', 'u'), field('TimeOtp-Secret', '12345678901234567890', true)),
      entry('KeeOtp', field('UserName', 'u'), field('otp', `key=${secret}&step=60&size=8&otpHashMode=Sha256`, true)),
      entry('KeeTrayTOTP', field('UserName', 'u'), field('TOTP Seed', secret, true), field('TOTP Settings', '60;8')),
      entry('KeeWeb', field('UserName', 'u'), field('otp', secret, true)),
      entry('Steam', field('UserName', 'u'), field('TOTP Seed', secret, true), field('TOTP Settings', '30;S')),
    ].join('');

    const imported = (await importKeePassXml(keePassXml(root), testPasskeyKeys)).Credentials;

    // TOTP fields never become custom fields.
    expect(imported.some(credential => credential.CustomFieldValues)).toBe(false);
    expect(byName(imported, 'Steam').TwoFactorSecret).toBeNull();
    const items = convertToItems(imported);
    expect(itemByName(items, 'KeePassXC').TotpCodes).toEqual([expect.objectContaining({ SecretKey: secret, Digits: 6, Period: 30, Algorithm: 'SHA1' })]);
    expect(itemByName(items, 'KeePass 2').TotpCodes).toEqual([expect.objectContaining({ SecretKey: secret, Digits: 8, Period: 60, Algorithm: 'SHA512' })]);
    expect(itemByName(items, 'KeePass 2 hex').TotpCodes).toEqual([expect.objectContaining({ SecretKey: secret, Digits: 6, Period: 30 })]);
    expect(itemByName(items, 'KeePass 2 base64').TotpCodes).toEqual([expect.objectContaining({ SecretKey: secret })]);
    // The RFC 6238 test secret.
    expect(itemByName(items, 'KeePass 2 text').TotpCodes).toEqual([expect.objectContaining({ SecretKey: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' })]);
    expect(itemByName(items, 'KeeWeb').TotpCodes).toEqual([expect.objectContaining({ SecretKey: secret })]);
    expect(itemByName(items, 'KeeOtp').TotpCodes).toEqual([expect.objectContaining({ SecretKey: secret, Digits: 8, Period: 60, Algorithm: 'SHA256' })]);
    expect(itemByName(items, 'KeeTrayTOTP').TotpCodes).toEqual([expect.objectContaining({ SecretKey: secret, Digits: 8, Period: 60, Algorithm: 'SHA1' })]);
    expect(itemByName(items, 'Steam').TotpCodes).toEqual([]);
  });

  it('reads additional URLs in order and protected fields as hidden, and skips the settings of other apps', async () => {
    const root = entry(
      'Fields',
      field('URL', 'https://a.example.com'),
      field('KP2A_URL_2', 'https://d.example.com'),
      field('KP2A_URL', 'https://b.example.com'),
      field('KP2A_URL_1', 'https://c.example.com'),
      field('AV Text', 'Region EU'),
      field('AV Hidden', '1234', true),
      field('Empty', ''),
      field('KeePassXC-Browser Settings', '{"Allow":[]}'),
    );

    const imported = (await importKeePassXml(keePassXml(root), testPasskeyKeys)).Credentials;

    const credential = byName(imported, 'Fields');
    expect(credential.ServiceUrls).toEqual(['https://a.example.com', 'https://b.example.com', 'https://c.example.com', 'https://d.example.com']);
    expect(credential.CustomFieldValues?.map(custom => [custom.Label, custom.Value, custom.FieldType])).toEqual([['AV Text', 'Region EU', FieldTypes.Text], ['AV Hidden', '1234', FieldTypes.Hidden]]);
  });

  it('imports the passkeys of KeePassXC and Strongbox entries and reports one it cannot read', async () => {
    const keePassXcKey = await generatePasskeyKey();
    const strongboxKey = await generatePasskeyKey();
    const credentialId = randomBytes(32);
    const userHandle = strToU8('webauthnio-av-passkey');
    const root = [
      entry(
        'KeePassXC',
        field('UserName', 'av-passkey'),
        field('URL', 'https://webauthn.io'),
        field('KPEX_PASSKEY_CREDENTIAL_ID', bytesToBase64Url(credentialId), true),
        field('KPEX_PASSKEY_PRIVATE_KEY_PEM', pem(keePassXcKey.pkcs8, true), true),
        field('KPEX_PASSKEY_USER_HANDLE', bytesToBase64Url(userHandle), true),
        field('KPEX_PASSKEY_USERNAME', 'av-passkey'),
        field('KPEX_PASSKEY_RELYING_PARTY', 'webauthn.io'),
        field('KPEX_PASSKEY_FLAG_BE', '1'),
      ),
      // Strongbox keeps the credential id and user name in fields of its own, and the key on one line.
      entry(
        'Strongbox',
        field('KPEX_PASSKEY_GENERATED_USER_ID', bytesToBase64Url(credentialId), true),
        field('KPEX_PASSKEY_PRIVATE_KEY_PEM', pem(strongboxKey.pkcs8, false), true),
        field('KPXC_PASSKEY_USERNAME', 'strongbox-user'),
        field('KPEX_PASSKEY_RELYING_PARTY', 'example.com'),
      ),
      entry('Broken', field('UserName', 'joe'), field('KPEX_PASSKEY_CREDENTIAL_ID', 'AAAA'), field('KPEX_PASSKEY_PRIVATE_KEY_PEM', 'not a key'), field('KPEX_PASSKEY_RELYING_PARTY', 'example.com')),
    ].join('');

    const result = await importKeePassXml(keePassXml(root), testPasskeyKeys);

    const keePassXc = byName(result.Credentials, 'KeePassXC');
    expect(keePassXc.CustomFieldValues).toBeUndefined();
    expect(keePassXc.Passkeys).toHaveLength(1);
    const passkey = keePassXc.Passkeys![0];
    expect(passkey.RpId).toBe('webauthn.io');
    expect(passkey.DisplayName).toBe('av-passkey');
    expect(passkey.CredentialId).toEqual(new Uint8Array(credentialId));
    expect(passkey.UserHandle).toEqual(userHandle);
    expect(passkeyCanSign(passkey)).toBe(true);

    // A passkey-only entry is a login and gets the relying party as its URL.
    const strongbox = byName(result.Credentials, 'Strongbox');
    expect(strongbox.ItemType).toBe('Login');
    expect(strongbox.ServiceUrls).toEqual(['https://example.com']);
    expect(strongbox.Passkeys![0].DisplayName).toBe('strongbox-user');
    expect(strongbox.Passkeys![0].UserHandle).toBeNull();
    expect(passkeyCanSign(strongbox.Passkeys![0])).toBe(true);

    // The entry with the unreadable passkey is kept and reported.
    expect(byName(result.Credentials, 'Broken').Passkeys).toBeUndefined();
    expect(result.FailedItems.map(failure => [failure.Index, failure.ItemTitle, failure.ExceptionType])).toEqual([[2, 'Broken', 'PasskeyImportError']]);
  });

  it.each([
    ['XML that is not a KeePass export', '<?xml version="1.0"?><vault><item/></vault>'],
    ['text that is not XML', 'Title,Username\nA,b'],
  ])('rejects %s', async (_, content) => {
    await expect(importKeePassXml(content, testPasskeyKeys)).rejects.toThrow(ImportException);
  });
});
