import { describe, expect, it } from 'vitest';

import { base64UrlToBytes, bytesToBase64 } from '../../../../../utilities/Base64';
import { generateEd25519Seed, generatePasskeyKey, readFixtureBytes, testPasskeyKeys } from '../../../__tests__/testHelpers';
import { openArchive, readArchiveJson } from '../../../readers/ArchiveImport';
import { readStringOrNull } from '../../../readers/JsonReader';
import { parseProtonPassItem, parseProtonPassJsonExport } from '../ProtonPassJson';
import { readProtonPassPasskey, readStoredPasskey } from '../ProtonPassPasskey';

import { protonPasskeyContent, protonStoredPasskey } from './protonPasskeyFixtures';

/*
 * The one passkey in protonpass.zip, registered on webauthn.io as av-passkey. Its key is random on every
 * registration, so the tests compare it with the rest of the export and never with fixed bytes.
 */
const EXPORT = parseProtonPassJsonExport(readArchiveJson(openArchive(readFixtureBytes(import.meta.dirname, 'protonpass.zip')), 'Proton Pass/data.json'));
const EXPORTED_PASSKEY = [...EXPORT.Vaults.values()].flatMap(vault => vault.Items.map(parseProtonPassItem)).flatMap(item => item.Data?.Content?.Passkeys ?? [])[0];
const EXPORTED_CONTENT = base64UrlToBytes(readStringOrNull(EXPORTED_PASSKEY, 'content') ?? '');

describe('ProtonPassPasskey', () => {
  it('reads the passkey of a Proton Pass export', async () => {
    const stored = readStoredPasskey(EXPORTED_CONTENT);
    expect(stored.rid).toBe('webauthn.io');
    expect(stored.un).toBe('av-passkey');
    expect((stored.key as { kty: object }).kty).toEqual({ t: 'assign', c: 'OKP' });

    const passkey = await readProtonPassPasskey(EXPORTED_PASSKEY, testPasskeyKeys);
    expect(passkey.RpId).toBe('webauthn.io');
    expect(passkey.DisplayName).toBe('av-passkey');
    expect(passkey.PrfKey).toBeNull();
    // The export repeats the credential id and user handle next to the content: the stored ones must match them.
    expect(passkey.CredentialId).toEqual(base64UrlToBytes(readStringOrNull(EXPORTED_PASSKEY, 'credentialId')!));
    expect(passkey.UserHandle).toEqual(base64UrlToBytes(readStringOrNull(EXPORTED_PASSKEY, 'userHandle')!));
    expect(JSON.parse(passkey.PrivateKey)).toMatchObject({ kty: 'OKP', crv: 'Ed25519', d: expect.any(String) as string });
  });

  it('reads a passkey with its key, PRF secret and names', async () => {
    const { pkcs8, scalar } = await generatePasskeyKey();
    const passkey = await readProtonPassPasskey({ content: protonPasskeyContent(protonStoredPasskey(scalar)), rpId: 'example.com', userName: 'ignored' }, testPasskeyKeys);

    expect(passkey.RpId).toBe('example.com');
    expect(Array.from(passkey.CredentialId!)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(Array.from(passkey.UserHandle!)).toEqual([200, 201, 202]);
    expect(Array.from(passkey.PrfKey!)).toEqual(new Array(32).fill(7));
    expect(passkey.DisplayName).toBe('Jane Doe');
    expect(Array.from(base64UrlToBytes((JSON.parse(passkey.PrivateKey) as { d: string }).d))).toEqual(Array.from(scalar));

    // The public key is derived from the scalar: the same key as PKCS#8 gives the same pair.
    const fromPkcs8 = await testPasskeyKeys.fromPkcs8(pkcs8);
    expect(JSON.parse(passkey.PublicKey)).toEqual(JSON.parse(fromPkcs8.publicKeyJwk));
  });

  it('refuses content it cannot read', async () => {
    const { scalar } = await generatePasskeyKey();
    const seed = generateEd25519Seed();
    /**
     * A stored passkey with another key type than its curve calls for.
     * @param stored - The stored passkey
     * @param kty - The key type to write
     * @returns The stored passkey
     */
    const withKeyType = (stored: object, kty: string): object => ({ ...stored, key: { ...(stored as { key: object }).key, kty: { t: 'assign', c: kty } } });
    const unreadable = [
      { content: protonPasskeyContent(protonStoredPasskey(scalar), 2) },
      { content: protonPasskeyContent(protonStoredPasskey(scalar, 2)) },
      { content: protonPasskeyContent(withKeyType(protonStoredPasskey(seed, 6), 'EC2')) },
      { content: protonPasskeyContent(withKeyType(protonStoredPasskey(scalar), 'OKP')) },
      { content: protonPasskeyContent(protonStoredPasskey(seed.subarray(0, 31), 6)) },
      { content: protonPasskeyContent(protonStoredPasskey(new Uint8Array(0))) },
      { content: protonPasskeyContent({ ...protonStoredPasskey(scalar), cid: [] }) },
      { content: bytesToBase64(EXPORTED_CONTENT.subarray(0, 300)) },
      { content: bytesToBase64(new Uint8Array(5000).fill(0x91)) },
      { content: 'not base64 !' },
      { rpId: 'example.com' },
    ];
    for (const passkey of unreadable) {
      await expect(readProtonPassPasskey(passkey, testPasskeyKeys)).rejects.toThrow();
    }
  });
});
