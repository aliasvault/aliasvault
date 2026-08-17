import { beforeEach, describe, it, expect, vi } from 'vitest';

import type { EncryptionKey } from '@/utils/dist/core/models/vault';
import type { Email, MailboxEmail } from '@/utils/dist/core/models/webapi';
import EncryptionUtility from '@/utils/EncryptionUtility';

beforeEach(() => {
  EncryptionUtility.clearRsaPrivateKeyCache();
});

/**
 * Creates a mailbox email with fields encrypted by the supplied RSA key pair. The decryption key references the key
 * by its position in the response-level public key table, mirroring what the API sends.
 */
async function createMailboxEmail(
  id: number,
  encryptionKey: EncryptionKey,
  rawSymmetricKey: string,
  subject: string,
  keyIndex: number
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
    decryptionKeys: [{ keyIndex, encryptedSymmetricKey: await EncryptionUtility.encryptWithPublicKey(rawSymmetricKey, encryptionKey.PublicKey) }],
  };
}

/**
 * Creates an email with the supplied symmetric key encrypted by the RSA key pair. A single email carries its own
 * public key table, so the decryption key always references index 0.
 */
async function createEmail(
  encryptionKey: EncryptionKey,
  rawSymmetricKey: string
): Promise<Email> {
  return {
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
    decryptionKeys: [{ keyIndex: 0, encryptedSymmetricKey: await EncryptionUtility.encryptWithPublicKey(rawSymmetricKey, encryptionKey.PublicKey) }],
    publicKeys: [encryptionKey.PublicKey],
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
 * Gzip compresses a string.
 */
async function gzip(plaintext: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(plaintext) as BlobPart]).stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
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
    const publicKeys = [encryptionKeyA.PublicKey, encryptionKeyB.PublicKey];
    const emails = [
      await createMailboxEmail(1, encryptionKeyA, '0123456789abcdef0123456789abcdef', 'Subject A1', 0),
      await createMailboxEmail(2, encryptionKeyA, 'abcdef0123456789abcdef0123456789', 'Subject A2', 0),
      await createMailboxEmail(3, encryptionKeyB, 'fedcba9876543210fedcba9876543210', 'Subject B1', 1),
    ];
    const importKeySpy = vi.spyOn(crypto.subtle, 'importKey');

    try {
      const decryptedEmails = await EncryptionUtility.decryptEmailList(emails, publicKeys, [encryptionKeyA, encryptionKeyB]);

      expect(decryptedEmails.map(email => email.subject)).toEqual(['Subject A1', 'Subject A2', 'Subject B1']);
      expect(countPrivateKeyImports(importKeySpy.mock.calls as unknown[][])).toBe(2);

      await EncryptionUtility.decryptEmailList([emails[0]], publicKeys, [encryptionKeyA, encryptionKeyB]);
      expect(countPrivateKeyImports(importKeySpy.mock.calls as unknown[][])).toBe(2);

      EncryptionUtility.clearRsaPrivateKeyCache();
      await EncryptionUtility.decryptEmailList([emails[0]], publicKeys, [encryptionKeyA, encryptionKeyB]);
      expect(countPrivateKeyImports(importKeySpy.mock.calls as unknown[][])).toBe(3);
    } finally {
      importKeySpy.mockRestore();
    }
  });

  it('resolves the decryption key by key index rather than by list order', async () => {
    /*
     * The key table is shared by the whole response, so an email's own decryption key list is not aligned with it. Picking
     * the wrong entry would decrypt with a key that does not match and blank the row.
     */
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

    // Only the second key of the table is held locally, and it is the only decryption key on the email.
    const publicKeys = [encryptionKeyA.PublicKey, encryptionKeyB.PublicKey];
    const email = await createMailboxEmail(1, encryptionKeyB, '0123456789abcdef0123456789abcdef', 'Indexed', 1);

    const decryptedEmails = await EncryptionUtility.decryptEmailList([email], publicKeys, [encryptionKeyB]);

    expect(decryptedEmails.map(mail => mail.subject)).toEqual(['Indexed']);
  });

  it('skips an email whose decryption key points outside the key table', async () => {
    // A decryption key referencing an index the response never sent is a malformed response; it must cost that row only.
    const keyPair = await EncryptionUtility.generateRsaKeyPair();
    const encryptionKey: EncryptionKey = {
      Id: 'key-a',
      PublicKey: keyPair.publicKey,
      PrivateKey: keyPair.privateKey,
      IsPrimary: true,
    };
    const emails = [
      await createMailboxEmail(1, encryptionKey, '0123456789abcdef0123456789abcdef', 'Readable', 0),
      await createMailboxEmail(2, encryptionKey, 'abcdef0123456789abcdef0123456789', 'Dangling', 7),
    ];

    const decryptedEmails = await EncryptionUtility.decryptEmailList(emails, [encryptionKey.PublicKey], [encryptionKey]);

    expect(decryptedEmails.map(mail => mail.subject)).toEqual(['Readable']);
  });

  it('skips undecryptable emails instead of failing the whole batch', async () => {
    /*
     * A mailbox can legitimately contain a message this user has no key for, e.g. when an alias is moved from a personal manifest to a shared manifest
     * but previously emails have not been encrypted yet for the new manifest, so older emails are hidden.
     */
    const keyPair = await EncryptionUtility.generateRsaKeyPair();
    const strangerKeyPair = await EncryptionUtility.generateRsaKeyPair();
    const encryptionKey: EncryptionKey = {
      Id: 'key-a',
      PublicKey: keyPair.publicKey,
      PrivateKey: keyPair.privateKey,
      IsPrimary: true,
    };
    const strangerKey: EncryptionKey = {
      Id: 'key-stranger',
      PublicKey: strangerKeyPair.publicKey,
      PrivateKey: strangerKeyPair.privateKey,
      IsPrimary: false,
    };
    const publicKeys = [encryptionKey.PublicKey, strangerKey.PublicKey];
    const emails = [
      await createMailboxEmail(1, encryptionKey, '0123456789abcdef0123456789abcdef', 'Readable', 0),
      await createMailboxEmail(2, strangerKey, 'abcdef0123456789abcdef0123456789', 'Unreadable', 1),
      await createMailboxEmail(3, encryptionKey, 'fedcba9876543210fedcba9876543210', 'Also readable', 0),
    ];

    // Only the own key is held, so email 2 cannot be decrypted.
    const decryptedEmails = await EncryptionUtility.decryptEmailList(emails, publicKeys, [encryptionKey]);

    expect(decryptedEmails.map(email => email.subject)).toEqual(['Readable', 'Also readable']);
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

describe('decryptEmail message source', () => {
  const rawSource = 'Subject: Hello\r\nContent-Type: text/plain\r\n\r\nRaw RFC 822 body.';

  /**
   * Builds an email whose message source holds the supplied already-encoded bytes.
   */
  async function createEmailWithSource(
    sourceBytes: Uint8Array,
    encryptionKey: EncryptionKey,
    rawSymmetricKey: string
  ): Promise<Email> {
    const email = await createEmail(encryptionKey, rawSymmetricKey);
    const encryptedBytes = await encryptAttachmentBytes(sourceBytes, rawSymmetricKey);
    email.messageSource = Buffer.from(encryptedBytes).toString('base64');
    return email;
  }

  /**
   * Creates an RSA encryption key pair for the test.
   */
  async function createEncryptionKey(): Promise<EncryptionKey> {
    const keyPair = await EncryptionUtility.generateRsaKeyPair();
    return {
      Id: 'key-a',
      PublicKey: keyPair.publicKey,
      PrivateKey: keyPair.privateKey,
      IsPrimary: true,
    };
  }

  it('decrypts an uncompressed message source', async () => {
    const encryptionKey = await createEncryptionKey();
    const rawSymmetricKey = '0123456789abcdef0123456789abcdef';
    const sourceBytes = new TextEncoder().encode(rawSource);
    const email = await createEmailWithSource(sourceBytes, encryptionKey, rawSymmetricKey);

    const decrypted = await EncryptionUtility.decryptEmail(email, [encryptionKey]);

    expect(decrypted.sourceBytes).toEqual(sourceBytes);
    expect(decrypted.email.messageSource).toBe('');
  });

  it('hands a compressed message source to the parser untouched', async () => {
    const encryptionKey = await createEncryptionKey();
    const rawSymmetricKey = '0123456789abcdef0123456789abcdef';
    const compressed = await gzip(rawSource);
    const email = await createEmailWithSource(compressed, encryptionKey, rawSymmetricKey);

    const decrypted = await EncryptionUtility.decryptEmail(email, [encryptionKey]);

    // Gunzipping is the parser's job (see core/rust/src/email_parser); decryption only unwraps the ciphertext.
    expect(decrypted.sourceBytes).toEqual(compressed);
  });
});
