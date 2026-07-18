import { beforeEach, describe, it, expect, vi } from 'vitest';

import type { EncryptionKey } from '@/utils/dist/core/models/vault';
import type { Email, MailboxEmail } from '@/utils/dist/core/models/webapi';
import EncryptionUtility from '@/utils/EncryptionUtility';

beforeEach(() => {
  EncryptionUtility.clearRsaPrivateKeyCache();
});

/**
 * Creates a mailbox email with fields encrypted by the supplied RSA key pair.
 */
async function createMailboxEmail(
  id: number,
  encryptionKey: EncryptionKey,
  rawSymmetricKey: string,
  subject: string
): Promise<MailboxEmail> {
  const symmetricKeyBase64 = Buffer.from(rawSymmetricKey).toString('base64');

  return {
    messagePreview: await EncryptionUtility.symmetricEncrypt(`Preview ${id}`, symmetricKeyBase64),
    hasAttachments: false,
    id,
    subject: await EncryptionUtility.symmetricEncrypt(subject, symmetricKeyBase64),
    fromDisplay: await EncryptionUtility.symmetricEncrypt(`Sender ${id}`, symmetricKeyBase64),
    fromDomain: await EncryptionUtility.symmetricEncrypt('example.com', symmetricKeyBase64),
    fromLocal: await EncryptionUtility.symmetricEncrypt(`sender${id}`, symmetricKeyBase64),
    toDomain: 'aliasvault.net',
    toLocal: `alias${id}`,
    date: '2026-05-26T00:00:00Z',
    dateSystem: '2026-05-26T00:00:00Z',
    secondsAgo: id,
    encryptedSymmetricKey: await EncryptionUtility.encryptWithPublicKey(rawSymmetricKey, encryptionKey.PublicKey),
    encryptionKey: encryptionKey.PublicKey,
  };
}

/**
 * Creates an email with the supplied symmetric key encrypted by the RSA key pair.
 */
async function createEmail(
  encryptionKey: EncryptionKey,
  rawSymmetricKey: string
): Promise<Email> {
  return {
    messageHtml: '',
    messagePlain: '',
    messageSource: '',
    id: 1,
    subject: '',
    fromDisplay: '',
    fromDomain: '',
    fromLocal: '',
    toDomain: 'aliasvault.net',
    toLocal: 'alias',
    date: '2026-05-26T00:00:00Z',
    dateSystem: '2026-05-26T00:00:00Z',
    secondsAgo: 1,
    encryptedSymmetricKey: await EncryptionUtility.encryptWithPublicKey(rawSymmetricKey, encryptionKey.PublicKey),
    encryptionKey: encryptionKey.PublicKey,
    attachments: [],
  };
}

/**
 * Encrypts bytes in the same IV+ciphertext format used by attachment decryption.
 */
async function encryptAttachmentBytes(plaintext: Uint8Array, rawSymmetricKey: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(rawSymmetricKey, c => c.charCodeAt(0)),
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new Uint8Array(plaintext));
  const encryptedBytes = new Uint8Array(iv.length + ciphertext.byteLength);
  encryptedBytes.set(iv, 0);
  encryptedBytes.set(new Uint8Array(ciphertext), iv.length);
  return encryptedBytes;
}

/**
 * Counts non-extractable RSA private-key imports.
 */
function countPrivateKeyImports(importKeyCalls: unknown[][]): number {
  return importKeyCalls.filter(call =>
    call[0] === 'jwk' &&
    call[3] === false &&
    Array.isArray(call[4]) &&
    call[4].includes('decrypt')
  ).length;
}

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

describe('email RSA private key cache', () => {
  it('caches multiple non-extractable private keys by matching public key', async () => {
    const keyPairA = await EncryptionUtility.generateRsaKeyPair();
    const keyPairB = await EncryptionUtility.generateRsaKeyPair();
    const encryptionKeyA: EncryptionKey = {
      Id: 'key-a',
      PublicKey: keyPairA.publicKey,
      PrivateKey: keyPairA.privateKey,
      IsPrimary: true,
    };
    const encryptionKeyB: EncryptionKey = {
      Id: 'key-b',
      PublicKey: keyPairB.publicKey,
      PrivateKey: keyPairB.privateKey,
      IsPrimary: false,
    };
    const emails = [
      await createMailboxEmail(1, encryptionKeyA, '0123456789abcdef0123456789abcdef', 'Subject A1'),
      await createMailboxEmail(2, encryptionKeyA, 'abcdef0123456789abcdef0123456789', 'Subject A2'),
      await createMailboxEmail(3, encryptionKeyB, 'fedcba9876543210fedcba9876543210', 'Subject B1'),
    ];
    const importKeySpy = vi.spyOn(crypto.subtle, 'importKey');

    try {
      const decryptedEmails = await EncryptionUtility.decryptEmailList(emails, [encryptionKeyA, encryptionKeyB]);

      expect(decryptedEmails.map(email => email.subject)).toEqual(['Subject A1', 'Subject A2', 'Subject B1']);
      expect(countPrivateKeyImports(importKeySpy.mock.calls as unknown[][])).toBe(2);

      await EncryptionUtility.decryptEmailList([emails[0]], [encryptionKeyA, encryptionKeyB]);
      expect(countPrivateKeyImports(importKeySpy.mock.calls as unknown[][])).toBe(2);

      EncryptionUtility.clearRsaPrivateKeyCache();
      await EncryptionUtility.decryptEmailList([emails[0]], [encryptionKeyA, encryptionKeyB]);
      expect(countPrivateKeyImports(importKeySpy.mock.calls as unknown[][])).toBe(3);
    } finally {
      importKeySpy.mockRestore();
    }
  });

  it('reuses cached private keys when decrypting attachments', async () => {
    const keyPair = await EncryptionUtility.generateRsaKeyPair();
    const encryptionKey: EncryptionKey = {
      Id: 'key-a',
      PublicKey: keyPair.publicKey,
      PrivateKey: keyPair.privateKey,
      IsPrimary: true,
    };
    const rawSymmetricKey = '0123456789abcdef0123456789abcdef';
    const email = await createEmail(encryptionKey, rawSymmetricKey);
    const encryptedBytes = await encryptAttachmentBytes(
      new TextEncoder().encode('attachment body'),
      rawSymmetricKey
    );
    const importKeySpy = vi.spyOn(crypto.subtle, 'importKey');

    try {
      const decryptedBytes = await EncryptionUtility.decryptAttachment(encryptedBytes, email, [encryptionKey]);
      expect(new TextDecoder().decode(decryptedBytes)).toBe('attachment body');
      expect(countPrivateKeyImports(importKeySpy.mock.calls as unknown[][])).toBe(1);

      await EncryptionUtility.decryptAttachment(encryptedBytes, email, [encryptionKey]);
      expect(countPrivateKeyImports(importKeySpy.mock.calls as unknown[][])).toBe(1);
    } finally {
      importKeySpy.mockRestore();
    }
  });
});
