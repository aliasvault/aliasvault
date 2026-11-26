import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { base64UrlToBytes, bytesToBase64Url } from '../../../../../utilities/Base64';
import { byName, convertToItems, customFieldsOf, generatePasskeyKey, itemByName, readFixtureText, testPasskeyKeys } from '../../../__tests__/testHelpers';
import { ImportException } from '../../../models/ImportException';
import { convertToItem } from '../../../writers/ItemConverter';
import { importCxf, type CxfImportResult } from '../CxfImporter';

/** The `key` of the passkey in import-sample.json: a PKCS#8 P-256 key as another provider exports it. */
const IMPORTED_PKCS8 = 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgZkI_HKUqwf92OuNcpCqiP2cpkmDmfipoxQKFYUBOuq-hRANCAAT2guVy3bmMeu-kvucgQBxEXc61ynLYe9RkU6UU5sbINYxxZmpjJgIK8NPsx13Mpl0rvdCcQysDnepSyZb-PkG2';

const PASSWORD = { type: 'basic-auth', password: { fieldType: 'concealed-string', value: 'pw' } };

/**
 * Import a fixture of this folder.
 * @param name - The file name
 * @returns The import result
 */
const importFixture = (name: string): Promise<CxfImportResult> => importCxf(readFixtureText(import.meta.dirname, name), testPasskeyKeys);

/**
 * Import a one-item document holding the given credentials.
 * @param credentials - The credentials of the item
 * @returns The import result
 */
const importItem = (credentials: object[]): Promise<CxfImportResult> => importCxf(JSON.stringify({ accounts: [{ id: 'YQ', username: 'u', email: 'e', collections: [], items: [{ id: 'aQ', title: 'Item', credentials }] }] }), testPasskeyKeys);

/**
 * A passkey credential with the given members replaced.
 * @param members - The members to replace
 * @returns The credential
 */
const passkey = (members: object): object => ({ type: 'passkey', credentialId: 'AQID', rpId: 'example.com', username: 'u', userDisplayName: 'u', userHandle: 'AQ', key: IMPORTED_PKCS8, ...members });

describe('CxfImporter', () => {
  it('imports a hand-written sample document', async () => {
    const result = await importFixture('import-sample.json');
    const imported = result.Credentials;

    const shop = byName(imported, 'Example Shop');
    expect(shop.Username).toBe('jane');
    expect(shop.Password).toBe('p@ssw0rd');
    expect(shop.ServiceUrls).toEqual(['https://shop.example.com', 'example.com', 'com.example.shop']);
    expect(shop.TwoFactorCodes?.[0].Secret).toBe('otpauth://totp/Example%20Shop%3Ajane?secret=JBSWY3DPEHPK3PXP&issuer=Example+Shop&algorithm=SHA1&digits=6&period=30');
    expect(shop.Notes).toBe('Loyalty number 1234');
    expect(shop.Tags).toEqual(['Shopping', 'Favorites']);
    expect(shop.FolderPath).toBe('Shopping');
    expect(shop.CreatedAt).toEqual(new Date(1_705_142_400_000));
    expect(shop.UpdatedAt).toEqual(new Date(1_705_228_800_000));
    expect(shop.ItemType).toBeUndefined();

    const withPasskey = byName(imported, 'passkeys.example.org').Passkeys![0];
    expect(Array.from(withPasskey.CredentialId!)).toEqual(Array.from({ length: 16 }, (_, index) => index + 1));
    expect(withPasskey.RpId).toBe('passkeys.example.org');
    expect(withPasskey.PrfKey).toBeNull();
    expect(withPasskey.AdditionalData).toBeNull();
    expect(JSON.parse(withPasskey.PrivateKey)).toMatchObject({ kty: 'EC', crv: 'P-256' });

    const address = byName(imported, 'Home address');
    expect(address.ItemType).toBe(ItemTypes.Note);
    expect(address.Notes).toBe('Ring twice');
    expect(customFieldsOf(address)).toEqual([['Address: Street address', '1 Main St', 'Text'], ['Address: City', 'Springfield', 'Text'], ['Address: Country', 'US', 'Text']]);

    // Members of a type the vault does not know keep their document order.
    expect(customFieldsOf(byName(imported, 'Linked'))).toEqual([['Wi-Fi: Ssid', 'HomeNet', 'Text'], ['Wi-Fi: Passphrase', 'wifi-secret', 'Hidden'], ['Wi-Fi: Network security type', 'wpa2-personal', 'Text']]);

    const person = byName(imported, 'Person');
    expect(person.Alias).toEqual({ FirstName: 'Jane', LastName: 'Doe' });
    expect(person.Username).toBe('jane.doe');

    expect(customFieldsOf(byName(imported, 'Future type'))).toEqual([['hologram: Serial', 'H-1', 'Text'], ['hologram: Flag', 'true', 'Text']]);

    // The item whose only credential is a passkey with an unusable key fails on its own; the other items import.
    expect(result.FailedItems).toHaveLength(1);
    expect(result.FailedItems[0].ItemTitle).toBe('Broken passkey');
    expect(imported).toHaveLength(7);
    expect(result.Summary).toEqual({ items: 7, passwords: 2, passkeys: 1, totpCodes: 1, notes: 2, creditCards: 1, savedAsCustomFields: 3, unsupported: 1, failedItems: 1 });
  });

  it('imports the credential id, PRF secret and extension data of a passkey', async () => {
    // A hand-written sample in the shape Bitwarden exports passkeys.
    const result = await importFixture('import-sample-passkeys.json');
    expect(result.FailedItems).toEqual([]);

    // A Bitwarden credential id is the 16 bytes of its own passkey GUID; it must be kept, since the row gets a new id.
    const github = byName(result.Credentials, 'GitHub');
    expect(github.Username).toBe('octocat');
    expect(github.Password).toBe('hunter2');
    expect(github.ServiceUrls).toEqual(['https://github.com']);
    const githubPasskey = github.Passkeys![0];
    expect(bytesToBase64Url(githubPasskey.CredentialId!)).toBe('6NiHiekW4ZY8vYHa-ucbvA');
    expect(new TextDecoder().decode(githubPasskey.UserHandle!)).toBe('bw-user-1');
    expect(githubPasskey.DisplayName).toBe('Octo Cat');
    expect(githubPasskey.PrfKey).toBeNull();
    expect(githubPasskey.AdditionalData).toBeNull();

    // A 32-byte credential id with hmac-secret credentials: the UV secret is the PRF key, the rest rides in the additional data.
    const prf = byName(result.Credentials, 'Vault with PRF');
    expect(prf.ServiceUrls).toEqual(['https://prf.example']);
    expect(prf.Username).toBe('prf-user');
    const prfPasskey = prf.Passkeys![0];
    expect(prfPasskey.CredentialId).toHaveLength(32);
    expect(Array.from(prfPasskey.PrfKey!)).toEqual(new Array(32).fill(7));
    expect(JSON.parse(new TextDecoder().decode(prfPasskey.AdditionalData!))).toEqual({ fido2Extensions: { credBlob: 'AQID', payments: true } });

    // The writer stores the credential id, PRF secret and extension data it was given.
    const stored = itemByName(convertToItems(result.Credentials), 'Vault with PRF').Passkeys[0];
    expect(stored.CredentialId).toEqual(prfPasskey.CredentialId);
    expect(stored.PrfKey).toEqual(prfPasskey.PrfKey);
    expect(stored.AdditionalData).toEqual(prfPasskey.AdditionalData);
  });

  it('imports what the AliasVault exporter produces', async () => {
    // The fixture is the document the Rust exporter writes for the vault its own tests seed.
    const result = await importFixture('aliasvault-export.json');
    expect(result.FailedItems).toEqual([]);
    expect(result.Credentials).toHaveLength(4);

    const login = byName(result.Credentials, 'Example');
    expect(login.Username).toBe('alice');
    expect(login.Password).toBe('s3cret');
    expect(login.ServiceUrls).toEqual(['example.com', 'https://login.example.com/']);
    expect(login.Notes).toBe('Some notes');
    expect(login.Tags).toBeNull();
    expect(login.FolderPath).toBe('Work/Banking');
    expect(login.TwoFactorCodes?.[0].Secret).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(login.TwoFactorCodes?.[0].Secret).toContain('algorithm=SHA256&digits=8&period=60');
    expect(login.Passkeys![0].RpId).toBe('example.com');
    expect(login.Passkeys![0].CredentialId).toHaveLength(16);
    expect(customFieldsOf(login)).toEqual([['Email', 'alice@example.com', 'Email'], ['Recovery code', 'ABC-123', 'Hidden']]);

    expect(byName(result.Credentials, 'Visa').Creditcard).toMatchObject({ Number: '4111111111111111', ExpiryYear: '2028', ExpiryMonth: '07' });
    const alias = byName(result.Credentials, 'Shop alias');
    expect(alias.Alias).toEqual({ FirstName: 'Ann', LastName: 'Lee' });
    expect(alias.Username).toBe('shop@alias.example');
    expect(byName(result.Credentials, 'Wifi').ItemType).toBe(ItemTypes.Note);
  });

  it('accepts a bare account and rejects anything else', async () => {
    const account = { id: 'YQ', username: 'u', email: 'e', collections: [], items: [{ id: 'aQ', title: 'Only', credentials: [PASSWORD] }] };
    const result = await importCxf(JSON.stringify(account), testPasskeyKeys);
    expect(result.Credentials).toHaveLength(1);
    expect(result.Credentials[0].Password).toBe('pw');

    for (const text of ['{"foo":1}', 'not json', '[]']) {
      await expect(importCxf(text, testPasskeyKeys)).rejects.toBeInstanceOf(ImportException);
    }
  });

  it('fails an item or credential of the wrong shape on its own', async () => {
    const text = JSON.stringify({ accounts: [{ items: ['text', { title: 'Bad', credentials: [1] }, { title: 'Good', credentials: [PASSWORD] }] }] });
    const result = await importCxf(text, testPasskeyKeys);
    expect(result.Credentials).toHaveLength(1);
    expect(result.FailedItems.map(failure => [failure.Index, failure.ItemTitle])).toEqual([[0, null], [1, 'Bad']]);
  });

  it('skips an unusable passkey without losing the rest of the item', async () => {
    const ed25519 = bytesToBase64Url(new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]));
    const unusable = [{ key: 'bm90LWEta2V5' }, { key: ed25519 }, { credentialId: bytesToBase64Url(new Uint8Array(1024)) }, { credentialId: '=' }, { userHandle: bytesToBase64Url(new Uint8Array(65)) }, { rpId: ' ' }];
    for (const members of unusable) {
      const result = await importItem([PASSWORD, passkey(members)]);
      expect(result.FailedItems).toEqual([]);
      expect(result.Credentials[0].Password).toBe('pw');
      expect(result.Credentials[0].Passkeys).toBeUndefined();
      expect(result.Summary.unsupported).toBe(1);
    }
  });

  it('ignores hmac credentials of an unknown algorithm or length', async () => {
    const hmacCredentials = [{ algorithm: 'hmac-sha512', credWithUV: bytesToBase64Url(new Uint8Array(32).fill(7)) }, { algorithm: 'hmac-sha256', credWithUV: 'AQID' }];
    for (const hmac of hmacCredentials) {
      const result = await importItem([passkey({ fido2Extensions: { hmacCredentials: hmac } })]);
      const imported = result.Credentials[0].Passkeys![0];
      expect(imported.PrfKey).toBeNull();
      expect(imported.AdditionalData).toBeNull();
      expect(bytesToBase64Url(imported.CredentialId!)).toBe('AQID');
    }
  });

  it('keeps every TOTP code of an item', async () => {
    /**
     * A TOTP credential.
     * @param secret - The secret
     * @returns The credential
     */
    const totp = (secret: string): object => ({ type: 'totp', secret, period: 30, digits: 6, algorithm: 'sha1' });
    const result = await importItem([totp('JBSWY3DPEHPK3PXP'), totp('GEZD GNBV GY3T QOJQ')]);
    const item = result.Credentials[0];
    expect(item.TwoFactorCodes).toHaveLength(2);
    expect(item.TwoFactorCodes![0].Secret).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(item.TwoFactorCodes![1].Secret).toContain('secret=GEZDGNBVGY3TQOJQ');
    expect(item.CustomFieldValues ?? []).toHaveLength(0);
    expect(result.Summary.totpCodes).toBe(2);
    expect(convertToItem(item, null).TotpCodes.map(code => code.SecretKey)).toEqual(['JBSWY3DPEHPK3PXP', 'GEZDGNBVGY3TQOJQ']);
  });

  it('stores the private key of an imported passkey', async () => {
    const { pkcs8, scalar } = await generatePasskeyKey();
    const imported = (await importItem([passkey({ key: bytesToBase64Url(pkcs8) })])).Credentials[0].Passkeys![0];
    expect(Array.from(base64UrlToBytes((JSON.parse(imported.PrivateKey) as { d: string }).d))).toEqual(Array.from(scalar));
  });
});
