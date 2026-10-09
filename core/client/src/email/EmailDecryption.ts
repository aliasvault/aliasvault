/**
 * Email decryption logic.
 *
 * 1. Pick the email's decryption key whose public key the caller holds ({@link resolveSymmetricKey}).
 * 2. Unwrap the email's symmetric key with that keypair's RSA-OAEP-256 private key.
 * 3. Decrypt the header fields, the message source and attachments with AES-256-GCM (`IV | ciphertext | tag`).
 * 4. Hand the decrypted source to the Rust email parser for the bodies and attachment list.
 *
 * The crypto primitives run on WebCrypto in the browser extension and web app, which is about 10x faster than the Rust
 * core compiled to WebAssembly for RSA and for large sources. The mobile app has no WebCrypto and uses the native Rust
 * core (core/rust/src/crypto) instead. Both produce and read the same formats.
 */
import { devWarn } from '../platform/Logger';
import { parseEmailSource, rustCore, type ParsedEmailAttachment } from '../rust/RustCore';
import { base64ToBytes, bytesToBase64 } from '../utilities/Base64';

import type { EncryptionKey } from '@aliasvault/models/vault';
import type { Email, EmailDecryptionKey, MailboxEmail } from '@aliasvault/models/webapi';

/**
 * A decrypted email. Its metadata (subject, sender) is decrypted from the individually encrypted fields, while
 * the bodies and attachments are derived from the raw RFC 822 source.
 */
export type DecryptedEmail = {
  /** The email with its metadata fields decrypted. */
  email: Email;
  /** The html body parsed out of the source, null when the message has no html part. */
  htmlBody: string | null;
  /** The plain text body parsed out of the source, null when the message has no text part. */
  textBody: string | null;
  /** The attachments contained in the source, in the index order `extractEmailAttachment` expects. */
  attachments: ParsedEmailAttachment[];
  /** The decrypted source bytes. */
  sourceBytes: Uint8Array | null;
};

/**
 * Decrypts a full email and parses its source.
 */
export async function decryptEmail(email: Email, encryptionKeys: EncryptionKey[]): Promise<DecryptedEmail> {
  try {
    const symmetricKey = await resolveSymmetricKey(email.decryptionKeys, email.publicKeys, encryptionKeys);

    const decryptedEmail: Email = {
      ...email,
      subject: await decryptText(email.subject, symmetricKey),
      fromDisplay: await decryptText(email.fromDisplay, symmetricKey),
      fromDomain: await decryptText(email.fromDomain, symmetricKey),
      fromLocal: await decryptText(email.fromLocal, symmetricKey),
      messageSource: '',
    };

    const sourceBytes = email.messageSource ? await decryptBytes(base64ToBytes(email.messageSource), symmetricKey) : null;

    let htmlBody: string | null = null;
    let textBody: string | null = null;
    let attachments: ParsedEmailAttachment[] = [];
    if (sourceBytes) {
      try {
        ({ htmlBody, textBody, attachments } = await parseEmailSource(sourceBytes));
      } catch (err) {
        // A parse failure costs the bodies, not the email: the raw source view renders without the parser.
        devWarn(`[Email] Could not parse the source of email ${email.id}:`, err);
      }
    }

    return { email: decryptedEmail, htmlBody, textBody, attachments, sourceBytes };
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to decrypt email');
  }
}

/**
 * Decrypts the header fields of a page of mailbox emails. The publicKeys table is the one the API sent alongside the
 * emails; each email's decryption keys reference it by index.
 *
 * Emails that cannot be decrypted are skipped rather than failing the batch. The server only serves mail the caller
 * holds a key for, so this should not happen, but one unreadable record must not break the whole list view.
 */
export async function decryptEmailList(emails: MailboxEmail[], publicKeys: string[], encryptionKeys: EncryptionKey[]): Promise<MailboxEmail[]> {
  const results = await Promise.all(emails.map(async (email): Promise<MailboxEmail | null> => {
    try {
      const symmetricKey = await resolveSymmetricKey(email.decryptionKeys, publicKeys, encryptionKeys);
      return {
        ...email,
        subject: await decryptText(email.subject, symmetricKey),
        fromDisplay: await decryptText(email.fromDisplay, symmetricKey),
        fromDomain: await decryptText(email.fromDomain, symmetricKey),
        fromLocal: await decryptText(email.fromLocal, symmetricKey),
        messagePreview: await decryptText(email.messagePreview, symmetricKey),
      };
    } catch (err) {
      devWarn(`[Email] Skipping email ${email.id}, it could not be decrypted:`, err);
      return null;
    }
  }));

  return results.filter((email): email is MailboxEmail => email !== null);
}

/**
 * Decrypts a separately fetched attachment body with the email's symmetric key.
 */
export async function decryptEmailAttachment(encryptedBytes: Uint8Array, email: Email, encryptionKeys: EncryptionKey[]): Promise<Uint8Array> {
  try {
    return await decryptBytes(encryptedBytes, await resolveSymmetricKey(email.decryptionKeys, email.publicKeys, encryptionKeys));
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to decrypt attachment');
  }
}

/**
 * Forget the imported RSA private keys, called when the vault is locked or reset.
 */
export function clearEmailKeyCache(): void {
  privateKeyCache.clear();
}

/**
 * The email's symmetric key (base64), unwrapped from the first decryption key whose public key the caller holds. A
 * decryption key names its public key by index into the response's publicKeys table, so the email's own list of
 * decryption keys is not aligned with the caller's keys.
 */
async function resolveSymmetricKey(decryptionKeys: EmailDecryptionKey[], publicKeys: string[], encryptionKeys: EncryptionKey[]): Promise<string> {
  for (const decryptionKey of decryptionKeys) {
    const publicKey = publicKeys[decryptionKey.keyIndex];
    const encryptionKey = publicKey ? encryptionKeys.find(key => key.PublicKey === publicKey) : undefined;
    if (encryptionKey) {
      return unwrapSymmetricKey(decryptionKey.encryptedSymmetricKey, encryptionKey);
    }
  }

  throw new Error('Encryption key not found');
}

/*
 * Crypto primitives: WebCrypto where the host has it, the native Rust core otherwise (mobile).
 */

/** Imported non-extractable RSA private keys, by public key, so a page of emails imports each keypair once. */
const privateKeyCache = new Map<string, Promise<CryptoKey>>();

/**
 * Whether the host has WebCrypto; the mobile app does not.
 */
function hasWebCrypto(): boolean {
  return typeof crypto !== 'undefined' && crypto.subtle !== undefined;
}

/**
 * RSA-OAEP-256 decrypt an email's symmetric key with the keypair's private key. Returns the key as base64.
 */
async function unwrapSymmetricKey(encryptedSymmetricKey: string, encryptionKey: EncryptionKey): Promise<string> {
  if (!hasWebCrypto()) {
    return bytesToBase64(await rustCore().rsaDecrypt(encryptedSymmetricKey, encryptionKey.PrivateKey));
  }

  let privateKey = privateKeyCache.get(encryptionKey.PublicKey);
  if (!privateKey) {
    privateKey = crypto.subtle.importKey('jwk', JSON.parse(encryptionKey.PrivateKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    privateKey.catch(() => privateKeyCache.delete(encryptionKey.PublicKey));
    privateKeyCache.set(encryptionKey.PublicKey, privateKey);
  }

  return bytesToBase64(new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, await privateKey, base64ToBytes(encryptedSymmetricKey))));
}

/**
 * AES-256-GCM decrypt a base64 `IV | ciphertext | tag` field into UTF-8. An empty field stays empty.
 */
async function decryptText(base64Ciphertext: string, symmetricKey: string): Promise<string> {
  if (!base64Ciphertext) {
    return base64Ciphertext;
  }

  if (!hasWebCrypto()) {
    return rustCore().symmetricDecrypt(base64Ciphertext, symmetricKey);
  }

  return new TextDecoder().decode(await decryptBytes(base64ToBytes(base64Ciphertext), symmetricKey));
}

/**
 * AES-256-GCM decrypt `IV | ciphertext | tag` bytes.
 */
async function decryptBytes(encrypted: Uint8Array, symmetricKey: string): Promise<Uint8Array> {
  if (encrypted.length === 0) {
    return encrypted;
  }

  if (!hasWebCrypto()) {
    return rustCore().symmetricDecryptBytes(encrypted, symmetricKey);
  }

  const key = await crypto.subtle.importKey('raw', base64ToBytes(symmetricKey), { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: encrypted.slice(0, 12) }, key, encrypted.slice(12)));
}
