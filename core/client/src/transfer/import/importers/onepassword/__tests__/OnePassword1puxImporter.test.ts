import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { formatDateOnly } from '../../../../shared/DateTimeUtils';
import { createZipArchive, textToZipBytes } from '../../../../shared/ZipArchive';
import { byName, convertToItems, itemByName, readFixtureBytes } from '../../../__tests__/testHelpers';
import { importOnePassword1pux } from '../OnePassword1puxImporter';

import type { ImportedCredential } from '../../../models/ImportedCredential';

/**
 * The custom fields of a credential as "label=value (type)".
 * @param credentials - The credentials
 * @param name - The service name
 * @returns The fields, or undefined when it has none
 */
function fieldsOf(credentials: ImportedCredential[], name: string): string[] | undefined {
  return byName(credentials, name).CustomFieldValues?.map(field => `${field.Label}=${field.Value} (${field.FieldType})`);
}

describe('OnePassword1puxImporter', () => {
  it('imports a 1Password .1pux export', () => {
    const result = importOnePassword1pux(readFixtureBytes(import.meta.dirname, '1password.1pux'));
    expect(result.FailedItems).toEqual([]);
    const imported = result.Credentials;
    // 1Password vaults do not nest, so the export has no nested folder item; trashed items are left out.
    expect(imported).toHaveLength(15);
    expect(imported.find(credential => credential.ServiceName === 'AV Login Nested Folder')).toBeUndefined();
    expect(imported.find(credential => credential.ServiceName === 'AV Login Trashed')).toBeUndefined();
    // The "Private" vault is promoted to root, the "AV Work" vault becomes a folder and the empty "Shared" vault adds nothing.
    expect(imported.filter(credential => credential.FolderPath !== null).map(credential => credential.ServiceName)).toEqual(['AV Login Folder']);

    const basic = byName(imported, 'AV Login Basic');
    expect(basic.ItemType).toBe(ItemTypes.Login);
    expect(basic.Username).toBe('av-basic');
    expect(basic.Password).toBe('Pw-Basic-1!');
    expect(basic.ServiceUrls).toEqual(['https://login.example.com']);
    expect(basic.Notes).toBe('Basic note');
    expect(basic.CreatedAt!.getTime()).toBeLessThanOrEqual(basic.UpdatedAt!.getTime());

    // The label of the one-time password field names the code.
    const totp = byName(imported, 'AV Login TOTP');
    expect(totp.Username).toBe('av-totp@example.com');
    expect(totp.Password).toBe('Pw-Totp-2!');
    expect(totp.TwoFactorSecret).toBe('JBSWY3DPEHPK3PXP');
    expect(totp.TwoFactorName).toBe('TOTP name');
    expect(totp.CustomFieldValues).toBeUndefined();

    expect(byName(imported, 'AV Login Multi URL').ServiceUrls).toEqual(['https://a.example.com', 'https://b.example.org/login', 'https://c.example.net:8443']);

    // 1Password has no boolean field, and the "AV Section" section is flattened.
    expect(fieldsOf(imported, 'AV Login Custom Fields')).toEqual([
      'AV Text=Region EU (Text)',
      'AV Hidden=1234 (Hidden)',
      'AV Link=https://link.example.org (URL)',
      'AV Date=2030-12-31 (Date)',
      'AV Email=field@example.com (Email)',
      'AV Phone=+31201234567 (Phone)',
    ]);

    // Attachments are read from "files/<document id>__<name>"; the icon of the "AV Work" vault in files/ is not one.
    const attachments = byName(imported, 'AV Login Attachment').Attachments?.map(attachment => `${attachment.Filename}=${new TextDecoder().decode(attachment.Blob)}`);
    expect(attachments).toEqual(['av-attachment.txt=attachment-1', 'av-attachment-2.txt=attachment-2']);
    expect(imported.filter(credential => credential.Attachments).map(credential => credential.ServiceName)).toEqual(['AV Login Attachment']);

    // 1Password leaves passkeys out of its .1pux export.
    const withPasskey = byName(imported, 'AV Login Passkey');
    expect(withPasskey.Username).toBe('av-passkey');
    expect(withPasskey.Password).toBe('Pw-Passkey-6!');
    expect(withPasskey.ServiceUrls).toEqual(['https://webauthn.io']);
    expect(withPasskey.Passkeys).toBeUndefined();

    const inFolder = byName(imported, 'AV Login Folder');
    expect(inFolder.Username).toBe('av-folder');
    expect(inFolder.Password).toBe('Pw-Folder-7!');
    expect(inFolder.FolderPath).toBe('AV Work');

    // An empty password has no login field; the password 1Password generated for the new item is only in its history.
    const emptyPassword = byName(imported, 'AV Login Empty Password');
    expect(emptyPassword.Username).toBe('av-empty');
    expect(emptyPassword.Password).toBeUndefined();
    expect(emptyPassword.ServiceUrls).toEqual(['https://empty.example.com']);

    const special = byName(imported, 'AV Login Special Chars äöü 日本');
    expect(special.Username).toBe('av-spécial, "quoted"');
    expect(special.Password).toBe('Pw,"10";\'\\ €ü');
    expect(special.ServiceUrls).toEqual(['https://special.example.com/path?a=1&b=2']);
    expect(special.Notes).toBe('Line one, with a comma and "quotes"\n\nLine three; semicolon');

    const noUrl = byName(imported, 'AV Login No URL');
    expect(noUrl.Username).toBe('av-nourl');
    expect(noUrl.ServiceUrls).toBeUndefined();

    // The card type (visa) has no AliasVault slot and is left out.
    const card = byName(imported, 'AV Card');
    expect(card.ItemType).toBe(ItemTypes.CreditCard);
    expect(card.Notes).toBe('Card note');
    expect(card.Creditcard).toEqual({ CardholderName: 'AV Cardholder', Number: '4111111111111111', Cvv: '123', ExpiryYear: '2030', ExpiryMonth: '12', Pin: '4321' });
    expect(card.CustomFieldValues).toBeUndefined();

    // 1Password stores the country as a code.
    const identity = byName(imported, 'AV Identity');
    expect(identity.ItemType).toBe(ItemTypes.Alias);
    expect(identity.Alias).toEqual({ FirstName: 'Avery', LastName: 'Vault', Gender: 'Female', BirthDate: expect.any(Date) });
    expect(formatDateOnly(identity.Alias!.BirthDate!)).toBe('1990-02-03');
    expect(identity.Email).toBe('identity@example.com');
    expect(identity.Notes).toBeNull();
    expect(fieldsOf(imported, 'AV Identity')).toEqual(['address=Examplestreet 1, Exampletown, 1234 AB, nl (Text)', 'default phone=+31201234567 (Phone)']);

    const note = byName(imported, 'AV Note');
    expect(note.ItemType).toBe(ItemTypes.Note);
    expect(note.Notes).toBe('Short secure note');
    expect(byName(imported, 'AV Note Long').Notes).toBe(new Array(100).fill('0123456789 The quick brown fox jumps over the lazy dog.').join('\n'));

    // Tags are not imported; the item is also a favorite, which AliasVault has no equivalent for.
    const tags = byName(imported, 'AV Login Tags');
    expect(tags.Username).toBe('av-tags');
    expect(tags.Password).toBe('Pw-Tags-17!');
    expect(tags.ServiceUrls).toEqual(['https://tags.example.com']);
    expect(tags.Tags).toBeUndefined();

    // Conversion keeps the TOTP code with its name and the attachments.
    const convertedItems = convertToItems(imported);
    expect(convertedItems).toHaveLength(15);
    expect(itemByName(convertedItems, 'AV Login TOTP').TotpCodes).toEqual([expect.objectContaining({ Name: 'TOTP name', SecretKey: 'JBSWY3DPEHPK3PXP' })]);
    expect(itemByName(convertedItems, 'AV Login Attachment').Attachments).toHaveLength(2);
  });

  it('imports the file of a Document item', () => {
    const document = { uuid: 'item1', state: 'active', categoryUuid: '006', overview: { title: 'Document' }, details: { notesPlain: 'Document note', documentAttributes: { fileName: 'doc.txt', documentId: 'doc1', decryptedSize: 7 } } };
    const exportData = JSON.stringify({ accounts: [{ vaults: [{ attrs: { name: 'Private', type: 'P' }, items: [document] }] }] });
    const archive = createZipArchive({ 'export.attributes': textToZipBytes('{"version":3}'), 'export.data': textToZipBytes(exportData), 'files/doc1__doc.txt': textToZipBytes('content') });

    const doc = byName(importOnePassword1pux(archive).Credentials, 'Document');
    expect(doc.ItemType).toBe(ItemTypes.Note);
    expect(doc.Notes).toBe('Document note');
    expect(doc.FolderPath).toBeNull();
    expect(doc.Attachments?.map(attachment => `${attachment.Filename}=${new TextDecoder().decode(attachment.Blob)}`)).toEqual(['doc.txt=content']);
  });
});
