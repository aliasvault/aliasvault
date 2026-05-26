import { describe, it, expect } from 'vitest';

import EncryptionUtility from '@/utils/EncryptionUtility';

describe('generateRsaKeyPairNonExtractable', () => {
  it('returns a non-extractable CryptoKey for the private half', async () => {
    const { privateKey } = await EncryptionUtility.generateRsaKeyPairNonExtractable();

    expect(privateKey).toBeInstanceOf(CryptoKey);
    expect(privateKey.type).toBe('private');
    expect(privateKey.extractable).toBe(false);
  });

  it('rejects every attempt to export the private key', async () => {
    const { privateKey } = await EncryptionUtility.generateRsaKeyPairNonExtractable();

    await expect(crypto.subtle.exportKey('jwk', privateKey)).rejects.toBeDefined();
    await expect(crypto.subtle.exportKey('pkcs8', privateKey)).rejects.toBeDefined();
  });

  it('returns the public key as a JWK string without private fields', async () => {
    const { publicKeyJwk } = await EncryptionUtility.generateRsaKeyPairNonExtractable();

    const jwk = JSON.parse(publicKeyJwk);
    expect(jwk.kty).toBe('RSA');
    expect(jwk.n).toBeDefined();
    expect(jwk.e).toBeDefined();
    expect(jwk.d).toBeUndefined();
    expect(jwk.p).toBeUndefined();
    expect(jwk.q).toBeUndefined();
  });

  it('round-trips: encrypt with JWK public key, decrypt with CryptoKey', async () => {
    const { publicKeyJwk, privateKey } = await EncryptionUtility.generateRsaKeyPairNonExtractable();

    const ciphertext = await EncryptionUtility.encryptWithPublicKey('hello mobile login', publicKeyJwk);
    const plaintextBytes = await EncryptionUtility.decryptWithPrivateKeyObject(ciphertext, privateKey);

    expect(new TextDecoder().decode(plaintextBytes)).toBe('hello mobile login');
  });
});

describe('generateRsaKeyPair (legacy JWK path, used by vault email decrypt)', () => {
  it('still round-trips through the JWK-string decrypt path', async () => {
    const { publicKey, privateKey } = await EncryptionUtility.generateRsaKeyPair();

    const ciphertext = await EncryptionUtility.encryptWithPublicKey('email body', publicKey);
    const plaintextBytes = await EncryptionUtility.decryptWithPrivateKey(ciphertext, privateKey);

    expect(new TextDecoder().decode(plaintextBytes)).toBe('email body');
  });

  it('exposes private fields in JS string (leak surface the non-extractable variant closes)', async () => {
    const { privateKey } = await EncryptionUtility.generateRsaKeyPair();

    const jwk = JSON.parse(privateKey);
    expect(jwk.d).toBeDefined();
    expect(jwk.p).toBeDefined();
    expect(jwk.q).toBeDefined();
  });
});
