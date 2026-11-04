import { FieldTypes, ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { createZipArchive, textToZipBytes } from '../../../../shared/ZipArchive';
import { byName, convertToItems, itemByName, readFixtureBytes } from '../../../__tests__/testHelpers';
import { ImportException, ImportStage } from '../../../models/ImportException';
import { importBitwardenZip } from '../BitwardenZipImporter';

describe('BitwardenZipImporter', () => {
  it('imports a Bitwarden ZIP with attachments', () => {
    const result = importBitwardenZip(readFixtureBytes(import.meta.dirname, 'bitwarden.zip'));
    const imported = result.Credentials;
    expect(imported).toHaveLength(5);

    const login = byName(imported, 'Example Login');
    expect(login.Username).toBe('testuser@example.com');
    expect(login.Password).toBe('SecurePassword123!');
    expect(login.ServiceUrls).toEqual(['https://example.com']);
    expect(login.TwoFactorSecret).toBe('otpauth://totp/Example:testuser@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example');
    expect(login.FolderPath).toBe('Personal');
    expect(login.ItemType).toBe(ItemTypes.Login);

    // Custom fields of every type (Text=0, Hidden=1, Boolean=2); linked fields (3) are skipped.
    expect(login.CustomFieldValues).toHaveLength(3);
    const securityQuestion = login.CustomFieldValues!.find(f => f.Label === 'Security Question')!;
    expect(securityQuestion.Value).toBe('My first pet');
    expect(securityQuestion.FieldType).toBe(FieldTypes.Text);
    const apiKey = login.CustomFieldValues!.find(f => f.Label === 'API Key')!;
    expect(apiKey.Value).toBe('sk_test_123456789');
    expect(apiKey.FieldType).toBe(FieldTypes.Hidden);
    const twoFactorEnabled = login.CustomFieldValues!.find(f => f.Label === 'Two Factor Enabled')!;
    expect(twoFactorEnabled.Value).toBe('true');
    expect(twoFactorEnabled.FieldType).toBe(FieldTypes.Text);
    expect(login.Notes).toBe('This is a test login item');

    const note = byName(imported, 'Secure Note');
    expect(note.Notes).toBe('This is a secure note with sensitive information');
    expect(note.ItemType).toBe(ItemTypes.Note);
    expect(note.FolderPath).toBeNull();

    const card = byName(imported, 'My Credit Card');
    expect(card.Notes).toBe('Primary card');
    expect(card.FolderPath).toBe('Work');
    expect(card.ItemType).toBe(ItemTypes.CreditCard);
    expect(card.Creditcard!.CardholderName).toBe('John Doe');
    expect(card.Creditcard!.Number).toBe('4111111111111111');
    expect(card.Creditcard!.ExpiryMonth).toBe('12');
    expect(card.Creditcard!.ExpiryYear).toBe('2025');
    expect(card.Creditcard!.Cvv).toBe('123');

    const identity = byName(imported, 'Personal Identity');
    expect(identity.ItemType).toBe(ItemTypes.Alias);
    expect(identity.Alias!.FirstName).toBe('John');
    expect(identity.Alias!.LastName).toBe('Doe');
    expect(identity.Email).toBe('john@example.com');
    expect(identity.Notes).toContain('Company: Example Corp');
    expect(identity.Notes).toContain('Phone: +1234567890');
    expect(identity.Notes).toContain('Address: 123 Main St, Apt 4B, New York, NY, 10001, US');

    const withAttachment = byName(imported, 'Login with Attachment');
    expect(withAttachment.Username).toBe('admin');
    expect(withAttachment.Password).toBe('AdminPass456!');

    const convertedItems = convertToItems(imported);
    expect(convertedItems).toHaveLength(5);
    const convertedLogin = itemByName(convertedItems, 'Example Login');
    expect(convertedLogin.ItemType).toBe(ItemTypes.Login);
    expect(convertedLogin.TotpCodes).toHaveLength(1);
    expect(convertedLogin.TotpCodes[0].SecretKey).toBe('JBSWY3DPEHPK3PXP');
  });

  it('ignores directory entries when reading Bitwarden ZIP attachments', () => {
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

    const imported = (importBitwardenZip(zipBytes)).Credentials;

    expect(imported).toHaveLength(1);
    const credential = imported[0];
    expect(credential.Attachments).toHaveLength(1);
    expect(credential.Attachments![0].Filename).toBe(fileName);
    expect(Array.from(credential.Attachments![0].Blob)).toEqual(Array.from(fileBytes));
    expect(credential.Attachments!.some(a => a.Filename.length === 0)).toBe(false);
    expect(credential.Attachments!.some(a => a.Blob.length === 0)).toBe(false);
  });

  it('reports an encrypted Bitwarden export clearly', () => {
    const zipBytes = createZipArchive({ 'data.json': textToZipBytes('{"encrypted":true,"folders":[],"items":[]}') });

    let caught: unknown;
    try {
      importBitwardenZip(zipBytes);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ImportException);
    expect((caught as ImportException).stage).toBe(ImportStage.Parse);
    expect((caught as ImportException).message).toContain('Encrypted Bitwarden');
    expect((caught as ImportException).message).toContain('unencrypted');
  });

  it('reads attachments from the folder named after the item, numbering items with the same name', () => {
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

    const imported = importBitwardenZip(zipBytes).Credentials;

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

  it('imports SSH key, bank account, driver\'s license and passport items as notes with their fields', () => {
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

    const imported = importBitwardenZip(createZipArchive({ 'data.json': textToZipBytes(dataJson) })).Credentials;

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
});
