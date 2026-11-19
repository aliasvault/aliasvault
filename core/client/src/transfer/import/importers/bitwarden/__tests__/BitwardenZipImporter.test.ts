import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { bytesToBase64Url } from '../../../../../utilities/Base64';
import { createZipArchive, textToZipBytes } from '../../../../shared/ZipArchive';
import { byName, generatePasskeyKey, readFixtureBytes, testPasskeyKeys } from '../../../__tests__/testHelpers';
import { ImportException, ImportStage } from '../../../models/ImportException';
import { importBitwardenZip } from '../BitwardenZipImporter';

import { expectBitwardenTemplateItems } from './bitwardenTemplate';

describe('BitwardenZipImporter', () => {
  it('imports a Bitwarden .zip export', async () => {
    const result = await importBitwardenZip(readFixtureBytes(import.meta.dirname, 'bitwarden.zip'), testPasskeyKeys);

    expectBitwardenTemplateItems(result);
    // Attachments are read from "attachments/<item name>/"; data.json does not list them.
    const attachments = byName(result.Credentials, 'AV Login Attachment').Attachments?.map(attachment => `${attachment.Filename}=${new TextDecoder().decode(attachment.Blob)}`);
    expect(attachments).toEqual(['av-attachment.txt=attachment-1', 'av-attachment-2.txt=attachment-2']);
    expect(result.Credentials.filter(credential => credential.Attachments).map(credential => credential.ServiceName)).toEqual(['AV Login Attachment']);
  });

  it('ignores directory entries when reading Bitwarden ZIP attachments', async () => {
    const itemId = 'item-with-attachment-uuid';
    const fileName = 'dataset_Backup_keys.json';
    const fileBytes = new TextEncoder().encode('{"keys":"value"}');
    const dataJson = JSON.stringify({
      encrypted: false,
      folders: [],
      items: [{
        id: itemId, organizationId: null, folderId: null, type: 1, reprompt: 0, name: 'Login with Attachment', notes: 'This item has an attachment', favorite: false,
        revisionDate: '2023-08-15T16:30:00.000Z', fields: [], login: { uris: [{ match: null, uri: 'https://secure.example.com' }], username: 'admin', password: 'AdminPass456!', totp: null }, collectionIds: null,
      }],
    });

    // Directory entries (zero bytes, trailing slash) as many ZIP tools emit them.
    const zipBytes = createZipArchive({
      'data.json': textToZipBytes(dataJson),
      'attachments/': new Uint8Array(0),
      [`attachments/${itemId}/`]: new Uint8Array(0),
      [`attachments/${itemId}/${fileName}`]: fileBytes,
    });

    const imported = (await importBitwardenZip(zipBytes)).Credentials;

    expect(imported).toHaveLength(1);
    const credential = imported[0];
    expect(credential.Attachments).toHaveLength(1);
    expect(credential.Attachments![0].Filename).toBe(fileName);
    expect(Array.from(credential.Attachments![0].Blob)).toEqual(Array.from(fileBytes));
    expect(credential.Attachments!.some(a => a.Filename.length === 0)).toBe(false);
    expect(credential.Attachments!.some(a => a.Blob.length === 0)).toBe(false);
  });

  it('reports an encrypted Bitwarden export clearly', async () => {
    const zipBytes = createZipArchive({ 'data.json': textToZipBytes('{"encrypted":true,"folders":[],"items":[]}') });

    let caught: unknown;
    try {
      await importBitwardenZip(zipBytes);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ImportException);
    expect((caught as ImportException).stage).toBe(ImportStage.Parse);
    expect((caught as ImportException).message).toContain('Encrypted Bitwarden');
    expect((caught as ImportException).message).toContain('unencrypted');
  });

  it('reads attachments from the folder named after the item, numbering items with the same name', async () => {
    /**
     * A login item.
     * @param id - The item id
     * @param name - The item name
     * @returns The item JSON
     */
    const login = (id: string, name: string): object => ({ id, folderId: null, type: 1, name, notes: null, fields: [], login: { uris: [], username: 'user', password: 'pw', totp: null } });
    const dataJson = JSON.stringify({
      encrypted: false,
      folders: [],
      items: [login('id-1', 'Bank: main/backup?'), login('id-2', 'Server'), login('id-3', 'Server'), login('id-4', 'No attachments')],
    });
    const zipBytes = createZipArchive({
      'data.json': textToZipBytes(dataJson),
      'attachments/Bank_ main_backup_/statement.pdf': textToZipBytes('statement'),
      'attachments/Server/key.pem': textToZipBytes('first'),
      'attachments/Server_1/key.pem': textToZipBytes('second'),
    });

    const imported = (await importBitwardenZip(zipBytes)).Credentials;

    /**
     * The attachments of an imported item as "name=content".
     * @param index - The item index
     * @returns The attachments, or undefined when it has none
     */
    const attachmentsOf = (index: number): string[] | undefined => imported[index].Attachments?.map(attachment => `${attachment.Filename}=${new TextDecoder().decode(attachment.Blob)}`);
    expect(attachmentsOf(0)).toEqual(['statement.pdf=statement']);
    expect(attachmentsOf(1)).toEqual(['key.pem=first']);
    expect(attachmentsOf(2)).toEqual(['key.pem=second']);
    expect(attachmentsOf(3)).toBeUndefined();
  });

  it('imports SSH key, bank account, driver\'s license and passport items as notes with their fields', async () => {
    /**
     * An item of a type AliasVault has no type for.
     * @param type - The Bitwarden item type
     * @param name - The item name
     * @param property - The JSON property holding the type's data
     * @param data - The type's data
     * @returns The item JSON
     */
    const item = (type: number, name: string, property: string, data: object): object => ({ id: name, type, name, notes: 'note', fields: [], [property]: data });
    const dataJson = JSON.stringify({
      encrypted: false,
      folders: [],
      items: [
        item(5, 'SSH key', 'sshKey', { privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----', publicKey: 'ssh-ed25519 AAAA', keyFingerprint: 'SHA256:abc' }),
        item(6, 'Bank', 'bankAccount', { bankName: 'Example Bank', accountNumber: '12345678', iban: 'NL00BANK0123456789', pin: null }),
        item(7, 'License', 'driversLicense', { firstName: 'John', lastName: 'Doe', licenseNumber: 'D123' }),
        item(8, 'Passport', 'passport', { surname: 'Doe', givenName: 'John', passportNumber: 'X123' }),
      ],
    });

    const imported = (await importBitwardenZip(createZipArchive({ 'data.json': textToZipBytes(dataJson) }))).Credentials;

    expect(imported.every(credential => credential.ItemType === ItemTypes.Note && credential.Notes === 'note')).toBe(true);
    /**
     * The custom fields of an imported item as "label=value (type)".
     * @param name - The item name
     * @returns The fields
     */
    const fieldsOf = (name: string): string[] | undefined => byName(imported, name).CustomFieldValues?.map(field => `${field.Label}=${field.Value} (${field.FieldType})`);
    expect(fieldsOf('SSH key')).toEqual(['Private key=-----BEGIN OPENSSH PRIVATE KEY----- (Hidden)', 'Public key=ssh-ed25519 AAAA (Text)', 'Fingerprint=SHA256:abc (Text)']);
    expect(fieldsOf('Bank')).toEqual(['Bank name=Example Bank (Text)', 'Account number=12345678 (Hidden)', 'IBAN=NL00BANK0123456789 (Hidden)']);
    expect(fieldsOf('License')).toEqual(['First name=John (Text)', 'Last name=Doe (Text)', 'License number=D123 (Text)']);
    expect(fieldsOf('Passport')).toEqual(['Surname=Doe (Text)', 'Given name=John (Text)', 'Passport number=X123 (Text)']);
  });

  it('keeps an item whose passkey cannot be read and reports it', async () => {
    const key = bytesToBase64Url((await generatePasskeyKey()).pkcs8);
    /**
     * A login with one passkey.
     * @param name - The item name
     * @param passkey - The members of the passkey
     * @returns The item JSON
     */
    const login = (name: string, passkey: object): object => ({ id: name, type: 1, name, login: { uris: [], username: 'jane', password: 'pw', totp: null, fido2Credentials: [{ rpId: 'example.com', userDisplayName: 'Jane', ...passkey }] } });
    const dataJson = JSON.stringify({
      encrypted: false,
      folders: [],
      items: [
        login('Imported id', { credentialId: 'b64.AQIDBAU', keyValue: key }),
        login('No key', { credentialId: 'fc79010a-87c7-4131-8409-e71541605729', keyValue: '' }),
        login('Not a key', { credentialId: 'fc79010a-87c7-4131-8409-e71541605729', keyValue: 'AAECAwQFBg' }),
        login('Not a GUID', { credentialId: 'not-a-guid', keyValue: key }),
      ],
    });

    const result = await importBitwardenZip(createZipArchive({ 'data.json': textToZipBytes(dataJson) }), testPasskeyKeys);

    // A credential id Bitwarden imported itself is base64url behind a prefix; an item without a URL gets the relying party.
    const imported = byName(result.Credentials, 'Imported id');
    expect(Array.from(imported.Passkeys![0].CredentialId!)).toEqual([1, 2, 3, 4, 5]);
    expect(imported.Passkeys![0].UserHandle).toBeNull();
    expect(imported.ServiceUrls).toEqual(['https://example.com']);

    expect(result.Credentials).toHaveLength(4);
    expect(byName(result.Credentials, 'No key').Password).toBe('pw');
    expect(result.Credentials.filter(credential => credential.Passkeys)).toHaveLength(1);
    expect(result.FailedItems.map(failure => [failure.Index, failure.ItemTitle, failure.ExceptionType])).toEqual([[1, 'No key', 'PasskeyImportError'], [2, 'Not a key', 'PasskeyImportError'], [3, 'Not a GUID', 'PasskeyImportError']]);
    expect(result.FailedItems[0].Message).toBe('A passkey of this item could not be imported: see item #1 in the export.');
  });
});
