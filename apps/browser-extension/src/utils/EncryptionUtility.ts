import { Buffer } from 'buffer';

import argon2 from 'argon2-browser/dist/argon2-bundled.min.js';

import type { EncryptionKey } from '@/utils/dist/core/models/vault';
import type { Email, MailboxEmail } from '@/utils/dist/core/models/webapi';

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
    encryptionType: string = 'Argon2Id',
    encryptionSettings: string = '{"Iterations":2,"MemorySize":19456,"DegreeOfParallelism":1}'
  ): Promise<Uint8Array> {
    const settings = JSON.parse(encryptionSettings);

    try {
      if (encryptionType !== 'Argon2Id') {
        throw new Error('Unsupported encryption type');
      }

      const hash = await argon2.hash({
        pass: password,
        salt: salt,
        time: settings.Iterations,
        mem: settings.MemorySize,
        parallelism: settings.DegreeOfParallelism,
        hashLen: 32,
        type: 2, // 0 = Argon2d, 1 = Argon2i, 2 = Argon2id
      });

      // Return bytes
      return hash.hash;
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
      Uint8Array.from(atob(base64Key), c => c.charCodeAt(0)),
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

    return btoa(
      Array.from(combined)
        .map(byte => String.fromCharCode(byte))
        .join('')
    );
  }

  /**
   * Encrypts raw bytes using AES-GCM symmetric encryption.
   */
  public static async symmetricEncryptBytes(plaintextBytes: Uint8Array, base64Key: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(atob(base64Key), c => c.charCodeAt(0)),
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

    return btoa(
      Array.from(combined)
        .map(byte => String.fromCharCode(byte))
        .join('')
    );
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
      Uint8Array.from(atob(base64Key), c => c.charCodeAt(0)),
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["decrypt"]
    );

    const ivAndCiphertext = Uint8Array.from(atob(base64Ciphertext), c => c.charCodeAt(0));
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
      Uint8Array.from(atob(base64Key), c => c.charCodeAt(0)),
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
   * changes; it is stored server-side only in wrapped form (encrypted with a KEK derived from an unlock method).
   */
  public static generateVaultEncryptionKey(): string {
    const vek = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...vek));
  }

  /**
   * Wraps (encrypts) a VEK with a KEK using AES-256-GCM. Returns base64(IV | ciphertext | authTag).
   */
  public static async wrapVaultEncryptionKey(vekBase64: string, kekBase64: string): Promise<string> {
    const vekBytes = Uint8Array.from(atob(vekBase64), c => c.charCodeAt(0));
    return this.symmetricEncryptBytes(vekBytes, kekBase64);
  }

  /**
   * Unwraps (decrypts) a wrapped VEK with a KEK. Returns the VEK as base64.
   */
  public static async unwrapVaultEncryptionKey(wrappedVekBase64: string, kekBase64: string): Promise<string> {
    const wrappedBytes = Uint8Array.from(atob(wrappedVekBase64), c => c.charCodeAt(0));
    const vekBytes = await this.symmetricDecryptBytes(wrappedBytes, kekBase64);
    return btoa(String.fromCharCode(...vekBytes));
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

    return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(cipherBuffer))));
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
    const cipherBuffer = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
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
   * Decrypts an individual email based on the provided public/private key pairs.
   */
  public static async decryptEmail(
    email: Email,
    encryptionKeys: EncryptionKey[]
  ): Promise<Email> {
    try {
      const encryptionKey = encryptionKeys.find(key => key.PublicKey === email.encryptionKey);

      if (!encryptionKey) {
        throw new Error('Encryption key not found');
      }

      // Decrypt symmetric key with asymmetric private key
      const privateKey = await EncryptionUtility.getPrivateKeyObject(encryptionKey);
      const symmetricKey = await EncryptionUtility.decryptWithPrivateKeyObject(
        email.encryptedSymmetricKey,
        privateKey
      );
      const symmetricKeyBase64 = Buffer.from(symmetricKey).toString('base64');

      // Create a new object to avoid mutating the original
      const decryptedEmail = { ...email };

      // Decrypt all email fields
      decryptedEmail.subject = await EncryptionUtility.symmetricDecrypt(email.subject, symmetricKeyBase64);
      decryptedEmail.fromDisplay = await EncryptionUtility.symmetricDecrypt(email.fromDisplay, symmetricKeyBase64);
      decryptedEmail.fromDomain = await EncryptionUtility.symmetricDecrypt(email.fromDomain, symmetricKeyBase64);
      decryptedEmail.fromLocal = await EncryptionUtility.symmetricDecrypt(email.fromLocal, symmetricKeyBase64);

      if (email.messageHtml) {
        decryptedEmail.messageHtml = await EncryptionUtility.symmetricDecrypt(email.messageHtml, symmetricKeyBase64);
      }
      if (email.messagePlain) {
        decryptedEmail.messagePlain = await EncryptionUtility.symmetricDecrypt(email.messagePlain, symmetricKeyBase64);
      }
      if (email.messageSource) {
        decryptedEmail.messageSource = await EncryptionUtility.symmetricDecrypt(email.messageSource, symmetricKeyBase64);
      }

      return decryptedEmail;
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Failed to decrypt email');
    }
  }

  /**
   * Decrypts a list of emails based on the provided public/private key pairs.
   */
  public static async decryptEmailList(
    emails: MailboxEmail[],
    encryptionKeys: EncryptionKey[]
  ): Promise<MailboxEmail[]> {
    return Promise.all(emails.map(async email => {
      try {
        const encryptionKey = encryptionKeys.find(key => key.PublicKey === email.encryptionKey);

        if (!encryptionKey) {
          throw new Error('Encryption key not found');
        }

        // Decrypt symmetric key with asymmetric private key
        const privateKey = await EncryptionUtility.getPrivateKeyObject(encryptionKey);
        const symmetricKey = await EncryptionUtility.decryptWithPrivateKeyObject(
          email.encryptedSymmetricKey,
          privateKey
        );
        const symmetricKeyBase64 = Buffer.from(symmetricKey).toString('base64');

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
        throw new Error(err instanceof Error ? err.message : 'Failed to decrypt email');
      }
    }));
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
      const encryptionKey = encryptionKeys.find(key => key.PublicKey === email.encryptionKey);

      if (!encryptionKey) {
        throw new Error('Encryption key not found');
      }

      // Decrypt the symmetric key using private key (returns raw bytes)
      const privateKey = await EncryptionUtility.getPrivateKeyObject(encryptionKey);
      const symmetricKey = await EncryptionUtility.decryptWithPrivateKeyObject(
        email.encryptedSymmetricKey,
        privateKey
      );

      // Convert symmetric key to base64 string if symmetricDecrypt expects it
      const symmetricKeyBase64 = Buffer.from(symmetricKey).toString('base64');

      // Decrypt the attachment using raw bytes
      return await EncryptionUtility.symmetricDecryptBytes(encryptedBytes, symmetricKeyBase64);
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Failed to decrypt attachment');
    }
  }
}

export default EncryptionUtility;
