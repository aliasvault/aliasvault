import { Buffer } from 'buffer';

import { base64ToBytes, bytesToBase64 } from '@/utils/Base64';
import { devWarn } from '@/utils/devLogger/DevLogger';
import type { EncryptionKey } from '@/utils/dist/core/models/vault';
import type { Email, EmailDecryptionKey, MailboxEmail } from '@/utils/dist/core/models/webapi';
import { argon2DeriveKey, parseEmailSource, type ParsedEmailAttachment } from '@/utils/RustCore';

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
 * Utility class for encryption operations including:
 * - Argon2Id key derivation
 * - AES-GCM symmetric encryption/decryption
 * - RSA-OAEP asymmetric encryption/decryption
 */
export class EncryptionUtility {
  private static rsaPrivateKeyCache = new Map<string, Promise<CryptoKey>>();

  /**
   * Derives a key from a password using Argon2Id
   */
  public static async deriveKeyFromPassword(
    password: string,
    salt: string,
    encryptionSettings: string = '{"Iterations":2,"MemorySize":19456,"DegreeOfParallelism":1}'
  ): Promise<Uint8Array> {
    try {
      return await argon2DeriveKey(password, salt, encryptionSettings);
    } catch (error) {
      console.error('Argon2 hashing failed:', error);
      throw error;
    }
  }

  /**
   * Encrypts data using AES-GCM symmetric encryption
   */
  public static async symmetricEncrypt(plaintext: string, base64Key: string): Promise<string> {
    if (!plaintext) {
      return plaintext;
    }

    const key = await crypto.subtle.importKey(
      "raw",
      base64ToBytes(base64Key),
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["encrypt"]
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const encoded = encoder.encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      encoded
    );

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return bytesToBase64(combined);
  }

  /**
   * Encrypts raw bytes using AES-GCM symmetric encryption.
   */
  public static async symmetricEncryptBytes(plaintextBytes: Uint8Array, base64Key: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw",
      base64ToBytes(base64Key),
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["encrypt"]
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      plaintextBytes
    );

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return bytesToBase64(combined);
  }

  /**
   * Decrypts data using AES-GCM symmetric encryption
   */
  public static async symmetricDecrypt(base64Ciphertext: string, base64Key: string): Promise<string> {
    if (!base64Ciphertext) {
      return base64Ciphertext;
    }

    const key = await crypto.subtle.importKey(
      "raw",
      base64ToBytes(base64Key),
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["decrypt"]
    );

    const ivAndCiphertext = base64ToBytes(base64Ciphertext);
    const iv = ivAndCiphertext.slice(0, 12);
    const ciphertext = ivAndCiphertext.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }

  /**
   * Decrypts data using AES-GCM symmetric encryption with raw bytes input/output
   */
  public static async symmetricDecryptBytes(encryptedBytes: Uint8Array, base64Key: string): Promise<Uint8Array> {
    if (!encryptedBytes || encryptedBytes.length === 0) {
      return encryptedBytes;
    }

    const key = await crypto.subtle.importKey(
      "raw",
      base64ToBytes(base64Key),
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["decrypt"]
    );

    const iv = encryptedBytes.slice(0, 12);
    const ciphertext = encryptedBytes.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );

    return new Uint8Array(decrypted);
  }

  /**
   * Generates a random 256-bit Vault Encryption Key (VEK) as base64. The VEK encrypts the vault content and never
   * changes; it is stored server-side only in encryped form (encrypted with a KEK derived from an unlock method).
   */
  public static generateVaultEncryptionKey(): string {
    const vek = crypto.getRandomValues(new Uint8Array(32));
    return bytesToBase64(vek);
  }

  /**
   * Encrypts a VEK with a KEK using AES-256-GCM. Returns base64(IV | ciphertext | authTag).
   */
  public static async encryptVaultEncryptionKey(vekBase64: string, kekBase64: string): Promise<string> {
    const vekBytes = base64ToBytes(vekBase64);
    return this.symmetricEncryptBytes(vekBytes, kekBase64);
  }

  /**
   * Decrypts an encrypted VEK with a KEK. Returns the VEK as base64.
   */
  public static async decryptVaultEncryptionKey(encryptedVekBase64: string, kekBase64: string): Promise<string> {
    const encryptedBytes = base64ToBytes(encryptedVekBase64);
    const vekBytes = await this.symmetricDecryptBytes(encryptedBytes, kekBase64);
    return bytesToBase64(vekBytes);
  }

  /**
   * Generates a new RSA key pair for asymmetric encryption
   */
  public static async generateRsaKeyPair(): Promise<{ publicKey: string, privateKey: string }> {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["encrypt", "decrypt"]
    );

    const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateKey = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

    return {
      publicKey: JSON.stringify(publicKey),
      privateKey: JSON.stringify(privateKey)
    };
  }

  /**
   * Generates a new RSA key pair with a non-extractable private key
   * Private key stays inside WebCrypto and public key is returned as JWK string for transport
   */
  public static async generateRsaKeyPairNonExtractable(): Promise<{ publicKeyJwk: string, privateKey: CryptoKey }> {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      false,
      ["encrypt", "decrypt"]
    );

    const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    return {
      publicKeyJwk: JSON.stringify(publicKey),
      privateKey: keyPair.privateKey,
    };
  }

  /**
   * Encrypts data using RSA-OAEP asymmetric encryption with a public key
   */
  public static async encryptWithPublicKey(plaintext: string, publicKey: string): Promise<string> {
    const publicKeyObj = await crypto.subtle.importKey(
      "jwk",
      JSON.parse(publicKey),
      {
        name: "RSA-OAEP",
        hash: "SHA-256",
      },
      false,
      ["encrypt"]
    );

    const encodedPlaintext = new TextEncoder().encode(plaintext);
    const cipherBuffer = await crypto.subtle.encrypt(
      {
        name: "RSA-OAEP"
      },
      publicKeyObj,
      encodedPlaintext
    );

    return bytesToBase64(new Uint8Array(cipherBuffer));
  }

  /**
   * Decrypts data using RSA-OAEP asymmetric encryption with a JWK private key
   */
  public static async decryptWithPrivateKey(ciphertext: string, privateKey: string): Promise<Uint8Array> {
    try {
      const privateKeyObj = await EncryptionUtility.importPrivateKey(privateKey);

      return await EncryptionUtility.decryptWithPrivateKeyObject(ciphertext, privateKeyObj);
    } catch (error) {
      console.error('RSA decryption failed:', error);
      throw new Error(`Failed to decrypt: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Decrypts data using RSA-OAEP asymmetric encryption with a CryptoKey private key.
   */
  public static async decryptWithPrivateKeyObject(ciphertext: string, privateKey: CryptoKey): Promise<Uint8Array> {
    const cipherBuffer = base64ToBytes(ciphertext);
    const plaintextBuffer = await crypto.subtle.decrypt(
      {
        name: "RSA-OAEP",
      },
      privateKey,
      cipherBuffer
    );

    return new Uint8Array(plaintextBuffer);
  }

  /**
   * Clears cached RSA private keys when the in-memory vault is locked or reset.
   */
  public static clearRsaPrivateKeyCache(): void {
    EncryptionUtility.rsaPrivateKeyCache.clear();
  }

  /**
   * Imports an RSA-OAEP private key as non-extractable.
   */
  private static async importPrivateKey(privateKey: string): Promise<CryptoKey> {
    return await crypto.subtle.importKey(
      "jwk",
      JSON.parse(privateKey),
      {
        name: "RSA-OAEP",
        hash: "SHA-256",
      },
      false,
      ["decrypt"]
    );
  }

  /**
   * Returns the cached non-extractable private key matching an email encryption public key.
   */
  private static async getPrivateKeyObject(encryptionKey: EncryptionKey): Promise<CryptoKey> {
    const cachedPrivateKey = EncryptionUtility.rsaPrivateKeyCache.get(encryptionKey.PublicKey);

    if (cachedPrivateKey) {
      return await cachedPrivateKey;
    }

    const privateKey = EncryptionUtility.importPrivateKey(encryptionKey.PrivateKey).catch(error => {
      EncryptionUtility.rsaPrivateKeyCache.delete(encryptionKey.PublicKey);
      throw error;
    });

    EncryptionUtility.rsaPrivateKeyCache.set(encryptionKey.PublicKey, privateKey);
    return await privateKey;
  }

  /**
   * Finds the decryption key of an email's symmetric key that one of the locally held keypairs can open. An email
   * carries one decryption key per manifest keypair the caller holds. It names its public key by index into the
   * publicKeys table that the API sends once per response.
   */
  private static resolveEmailDecryptionKey(decryptionKeys: EmailDecryptionKey[], publicKeys: string[], encryptionKeys: EncryptionKey[]): { encryptionKey: EncryptionKey, encryptedSymmetricKey: string } {
    for (const decryptionKey of decryptionKeys) {
      const publicKey = publicKeys[decryptionKey.keyIndex];
      if (!publicKey) {
        continue;
      }

      const key = encryptionKeys.find(k => k.PublicKey === publicKey);
      if (key) {
        return { encryptionKey: key, encryptedSymmetricKey: decryptionKey.encryptedSymmetricKey };
      }
    }

    throw new Error('Encryption key not found');
  }

  /**
   * Decrypts the symmetric key an email's contents are encrypted with, as base64.
   */
  private static async resolveEmailSymmetricKey(decryptionKeys: EmailDecryptionKey[], publicKeys: string[], encryptionKeys: EncryptionKey[]): Promise<string> {
    const match = EncryptionUtility.resolveEmailDecryptionKey(decryptionKeys, publicKeys, encryptionKeys);
    const privateKey = await EncryptionUtility.getPrivateKeyObject(match.encryptionKey);
    const symmetricKey = await EncryptionUtility.decryptWithPrivateKeyObject(match.encryptedSymmetricKey, privateKey);

    return Buffer.from(symmetricKey).toString('base64');
  }

  /**
   * Decrypts an individual email based on the provided public/private key pairs.
   */
  public static async decryptEmail(email: Email, encryptionKeys: EncryptionKey[]): Promise<DecryptedEmail> {
    try {
      const symmetricKeyBase64 = await EncryptionUtility.resolveEmailSymmetricKey(email.decryptionKeys, email.publicKeys, encryptionKeys);

      const decryptedEmail = { ...email };
      decryptedEmail.subject = await EncryptionUtility.symmetricDecrypt(email.subject, symmetricKeyBase64);
      decryptedEmail.fromDisplay = await EncryptionUtility.symmetricDecrypt(email.fromDisplay, symmetricKeyBase64);
      decryptedEmail.fromDomain = await EncryptionUtility.symmetricDecrypt(email.fromDomain, symmetricKeyBase64);
      decryptedEmail.fromLocal = await EncryptionUtility.symmetricDecrypt(email.fromLocal, symmetricKeyBase64);

      const sourceBytes = email.messageSource ? await EncryptionUtility.symmetricDecryptBytes(base64ToBytes(email.messageSource), symmetricKeyBase64) : null;
      decryptedEmail.messageSource = '';

      let htmlBody: string | null = null;
      let textBody: string | null = null;
      let attachments: ParsedEmailAttachment[] = [];

      if (sourceBytes) {
        try {
          const parsed = await parseEmailSource(sourceBytes);
          htmlBody = parsed.htmlBody;
          textBody = parsed.textBody;
          attachments = parsed.attachments;
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
   * Decrypts a list of emails based on the provided public/private key pairs. The publicKeys table is the one the
   * API sent alongside the emails; each email's decryption keys reference it by index.
   *
   * Emails that cannot be decrypted are skipped rather than failing the batch. The server only serves mail the
   * caller holds a key for, so this should not happen but we handle it gracefully to prevent one unreadable record
   * from breaking the whole list view.
   */
  public static async decryptEmailList(
    emails: MailboxEmail[],
    publicKeys: string[],
    encryptionKeys: EncryptionKey[]
  ): Promise<MailboxEmail[]> {
    const results = await Promise.all(emails.map(async email => {
      try {
        const symmetricKeyBase64 = await EncryptionUtility.resolveEmailSymmetricKey(email.decryptionKeys, publicKeys, encryptionKeys);

        // Create a new object to avoid mutating the original
        const decryptedEmail = { ...email };

        // Decrypt all email fields
        decryptedEmail.subject = await EncryptionUtility.symmetricDecrypt(email.subject, symmetricKeyBase64);
        decryptedEmail.fromDisplay = await EncryptionUtility.symmetricDecrypt(email.fromDisplay, symmetricKeyBase64);
        decryptedEmail.fromDomain = await EncryptionUtility.symmetricDecrypt(email.fromDomain, symmetricKeyBase64);
        decryptedEmail.fromLocal = await EncryptionUtility.symmetricDecrypt(email.fromLocal, symmetricKeyBase64);

        if (email.messagePreview) {
          decryptedEmail.messagePreview = await EncryptionUtility.symmetricDecrypt(email.messagePreview, symmetricKeyBase64);
        }

        return decryptedEmail;
      } catch (err) {
        devWarn(`[Email] Skipping email ${email.id}, it could not be decrypted:`, err);
        return null;
      }
    }));

    return results.filter((email): email is MailboxEmail => email !== null);
  }

  /**
   * Decrypts an attachment and returns the decrypted content as Uint8Array (raw bytes).
   */
  public static async decryptAttachment(
    encryptedBytes: Uint8Array,
    email: Email,
    encryptionKeys: EncryptionKey[]
  ): Promise<Uint8Array> {
    try {
      const symmetricKeyBase64 = await EncryptionUtility.resolveEmailSymmetricKey(email.decryptionKeys, email.publicKeys, encryptionKeys);

      // Decrypt the attachment using raw bytes
      return await EncryptionUtility.symmetricDecryptBytes(encryptedBytes, symmetricKeyBase64);
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Failed to decrypt attachment');
    }
  }
}

export default EncryptionUtility;
