import { ItemTypes } from '@aliasvault/models/vault';
import { expect } from 'vitest';

import { byName, convertToItems, itemByName, passkeyCanSign } from '../../../__tests__/testHelpers';

import type { ImportedCredential } from '../../../models/ImportedCredential';
import type { ImportFileResult } from '../../../models/ImportFileResult';

/**
 * The custom fields of a credential as "label=value (type)".
 * @param credentials - The credentials
 * @param name - The service name
 * @returns The fields, or undefined when it has none
 */
export function fieldsOf(credentials: ImportedCredential[], name: string): string[] | undefined {
  return byName(credentials, name).CustomFieldValues?.map(field => `${field.Label}=${field.Value} (${field.FieldType})`);
}

/**
 * Check the items of the import test template as the Bitwarden .json export and the data.json of the .zip export hold them.
 * Attachments are only in the .zip export, so the caller checks those.
 * @param result - The import result
 */
export function expectBitwardenTemplateItems(result: ImportFileResult): void {
  expect(result.FailedItems).toEqual([]);
  const imported = result.Credentials;
  // Bitwarden leaves trashed items out of its exports.
  expect(imported).toHaveLength(16);
  expect(imported.find(credential => credential.ServiceName === 'AV Login Trashed')).toBeUndefined();

  const basic = byName(imported, 'AV Login Basic');
  expect(basic.ItemType).toBe(ItemTypes.Login);
  expect(basic.Username).toBe('av-basic');
  expect(basic.Password).toBe('Pw-Basic-1!');
  expect(basic.ServiceUrls).toEqual(['https://login.example.com/']);
  expect(basic.Notes).toBe('Basic note');
  expect(basic.FolderPath).toBeNull();
  // The dates change with every export, even by a millisecond for the same vault.
  expect(basic.CreatedAt!.getTime()).toBeLessThan(basic.UpdatedAt!.getTime());

  // A Bitwarden login has one TOTP secret, without a name.
  const totp = byName(imported, 'AV Login TOTP');
  expect(totp.Username).toBe('av-totp@example.com');
  expect(totp.Password).toBe('Pw-Totp-2!');
  expect(totp.TwoFactorCodes?.[0].Secret).toBe('JBSWY3DPEHPK3PXP');
  expect(totp.CustomFieldValues).toBeUndefined();

  expect(byName(imported, 'AV Login Multi URL').ServiceUrls).toEqual(['https://a.example.com/', 'https://b.example.org/login', 'https://c.example.net:8443/']);

  // Bitwarden has text, hidden and boolean custom fields, and no sections; a boolean imports as text.
  expect(fieldsOf(imported, 'AV Login Custom Fields')).toEqual(['AV Text=Region EU (Text)', 'AV Hidden=1234 (Hidden)', 'AV Bool=true (Text)']);

  // The relying party, user name and a working key; the key and credential id are new on every registration.
  const withPasskey = byName(imported, 'AV Login Passkey');
  expect(withPasskey.Username).toBe('av-passkey');
  expect(withPasskey.Password).toBe('Pw-Passkey-6!');
  expect(withPasskey.ServiceUrls).toEqual(['https://webauthn.io/']);
  expect(withPasskey.Notes).toBe('');
  expect(withPasskey.Passkeys).toHaveLength(1);
  const passkey = withPasskey.Passkeys![0];
  expect(passkey.RpId).toBe('webauthn.io');
  expect(passkey.DisplayName).toBe('av-passkey');
  expect(new TextDecoder().decode(passkey.UserHandle!)).toBe('webauthnio-av-passkey');
  // A Bitwarden credential id is a GUID; its 16 bytes are what the relying party knows the passkey by.
  expect(passkey.CredentialId).toHaveLength(16);
  expect(passkey.PrfKey).toBeNull();
  expect(passkeyCanSign(passkey)).toBe(true);

  // A nested folder is a folder whose name holds the path.
  const inFolder = byName(imported, 'AV Login Folder');
  expect(inFolder.Username).toBe('av-folder');
  expect(inFolder.Password).toBe('Pw-Folder-7!');
  expect(inFolder.FolderPath).toBe('AV Work');
  expect(byName(imported, 'AV Login Nested Folder').FolderPath).toBe('AV Work/AV Sub');

  const emptyPassword = byName(imported, 'AV Login Empty Password');
  expect(emptyPassword.Username).toBe('av-empty');
  expect(emptyPassword.Password).toBeNull();
  expect(emptyPassword.ServiceUrls).toEqual(['https://empty.example.com/']);

  const special = byName(imported, 'AV Login Special Chars äöü 日本');
  expect(special.Username).toBe('av-spécial, "quoted"');
  expect(special.Password).toBe('Pw,"10";\'\\ €ü');
  expect(special.ServiceUrls).toEqual(['https://special.example.com/path?a=1&b=2']);
  expect(special.Notes).toBe('Line one, with a comma and "quotes"\n\nLine three; semicolon');

  const noUrl = byName(imported, 'AV Login No URL');
  expect(noUrl.Username).toBe('av-nourl');
  expect(noUrl.ServiceUrls).toBeUndefined();

  // A Bitwarden card has no PIN.
  const card = byName(imported, 'AV Card');
  expect(card.ItemType).toBe(ItemTypes.CreditCard);
  expect(card.Notes).toBe('Card note');
  expect(card.Creditcard).toEqual({ CardholderName: 'AV Cardholder', Number: '4111111111111111', ExpiryMonth: '12', ExpiryYear: '2030', Cvv: '123' });

  // A Bitwarden identity has no gender or birth date, and three address lines.
  const identity = byName(imported, 'AV Identity');
  expect(identity.ItemType).toBe(ItemTypes.Alias);
  expect(identity.Alias).toEqual({ FirstName: 'Avery', LastName: 'Vault' });
  expect(identity.Email).toBe('identity@example.com');
  expect(identity.Notes).toBeNull();
  expect(fieldsOf(imported, 'AV Identity')).toEqual(['Phone=+31201234567 (Phone)', 'Address=Examplestreet 1, Address 2, Address 3, Exampletown, Noord-Holland, 1234 AB, Netherlands (Text)']);

  const note = byName(imported, 'AV Note');
  expect(note.ItemType).toBe(ItemTypes.Note);
  expect(note.Notes).toBe('Short secure note');
  expect(byName(imported, 'AV Note Long').Notes).toBe(new Array(100).fill('0123456789 The quick brown fox jumps over the lazy dog.').join('\n'));

  // Bitwarden has no tags; the item is a favorite, which AliasVault has no equivalent for.
  const tags = byName(imported, 'AV Login Tags');
  expect(tags.Username).toBe('av-tags');
  expect(tags.Password).toBe('Pw-Tags-17!');
  expect(tags.ServiceUrls).toEqual(['https://tags.example.com']);
  expect(tags.Tags).toBeUndefined();

  // Conversion keeps the TOTP secret and the passkey.
  const convertedItems = convertToItems(imported);
  expect(convertedItems).toHaveLength(16);
  expect(itemByName(convertedItems, 'AV Login TOTP').TotpCodes).toEqual([expect.objectContaining({ Name: '', SecretKey: 'JBSWY3DPEHPK3PXP' })]);
  const stored = itemByName(convertedItems, 'AV Login Passkey').Passkeys[0];
  expect(stored.RpId).toBe('webauthn.io');
  expect(stored.CredentialId).toEqual(passkey.CredentialId);
  expect(stored.PrivateKey).toBe(passkey.PrivateKey);
}
