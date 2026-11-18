import { describe, expect, it } from 'vitest';

import { base64UrlToBytes, bytesToBase64 } from '../../../../../utilities/Base64';
import { generateEd25519Seed, generatePasskeyKey, readFixtureBytes, testPasskeyKeys } from '../../../__tests__/testHelpers';
import { readProtonPassPasskey, readStoredPasskey } from '../ProtonPassPasskey';

import { protonPasskeyContent, protonStoredPasskey } from './protonPasskeyFixtures';

/*
 * protonpass-passkey-v3.msgpack is the SERIALIZED_V3 regression vector of Proton's own serializer
 * (proton-pass-common, passkey_handling.rs): a stored passkey in the current layout. Its key is filler, not a
 * usable P-256 key.
 */
const PROTON_VECTOR = readFixtureBytes(import.meta.dirname, 'protonpass-passkey-v3.msgpack');

describe('ProtonPassPasskey', () => {
  it('reads the stored passkey of the vector of Proton itself', async () => {
    const stored = readStoredPasskey(PROTON_VECTOR);
    expect(stored.rid).toBe('some_rp_id');
    expect(stored.cid).toEqual([1, 2, 3, 4, 5]);
    expect(stored.udn).toBe('user_display_name');
    expect(stored.un).toBe('username');
    expect((stored.key as { kty: object }).kty).toEqual({ t: 'assign', c: 'EC2' });
    expect(stored.ext).toEqual({ hmac_secret: { cred_with_uv: [1, 2, 3, 4], cred_without_uv: [5, 6, 7, 8] } });

    // The vector's key holds no P-256 scalar, so the passkey is refused instead of stored without a key.
    await expect(readProtonPassPasskey({ content: bytesToBase64(PROTON_VECTOR) }, testPasskeyKeys)).rejects.toThrow('not a P-256 or Ed25519 private key');
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
      { content: bytesToBase64(PROTON_VECTOR.subarray(0, 300)) },
      { content: bytesToBase64(new Uint8Array(5000).fill(0x91)) },
      { content: 'not base64 !' },
      { rpId: 'example.com' },
    ];
    for (const passkey of unreadable) {
      await expect(readProtonPassPasskey(passkey, testPasskeyKeys)).rejects.toThrow();
    }
  });
});
