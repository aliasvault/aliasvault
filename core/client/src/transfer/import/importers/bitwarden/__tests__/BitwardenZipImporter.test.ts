import { FieldTypes, ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { createZipArchive, textToZipBytes } from '../../../../shared/ZipArchive';
import { readFixtureBytes, byName, itemByName } from '../../../__tests__/testHelpers';
import { ImportException, ImportStage } from '../../../models/ImportException';
import { convertToItems } from '../../../writers/ItemConverter';
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
});
