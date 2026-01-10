import { Buffer } from 'buffer';

import AesGcmCrypto from 'react-native-aes-gcm-crypto';

import NativeVaultManager from '@/specs/NativeVaultManager';
import type { EncryptionKey } from '@/utils/dist/core/models/vault';
import type { Email, MailboxEmail } from '@/utils/dist/core/models/webapi';

/**
 * Utility class for encryption operations including:
 * - Argon2Id key derivation
 * - AES-GCM symmetric encryption/decryption
 * - RSA-OAEP asymmetric encryption/decryption
 */
class EncryptionUtility {
  /**
   * Derives a key from a password using Argon2Id
   */
  public static async deriveKeyFromPassword(
    password: string,
    salt: string,
    encryptionType: string = 'Argon2Id',
    encryptionSettings: string = '{"Iterations":2,"MemorySize":19456,"DegreeOfParallelism":1}'
  ): Promise<Uint8Array> {
    try {
      // Call the native method to derive the key via Argon2id
      const base64Key = await NativeVaultManager.deriveKeyFromPassword(
        password,
        salt,
        encryptionType,
        encryptionSettings
      );

      // Convert base64 string to Uint8Array
      const binaryString = atob(base64Key);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      return bytes;
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

    try {
      const result = await AesGcmCrypto.encrypt(plaintext, false, base64Key);
      // Combine IV, tag, and content into a single string for storage
      return JSON.stringify({
        iv: result.iv,
        tag: result.tag,
        content: result.content
      });
    } catch (error) {
      console.error('AES-GCM encryption failed:', error);
      throw error;
    }
  }

  /**
   * Decrypts data using AES-GCM symmetric encryption
   */
  public static async symmetricDecrypt(base64Ciphertext: string, base64Key: string): Promise<string> {
    if (!base64Ciphertext) {
      return base64Ciphertext;
    }

    try {
      const ciphertext = Uint8Array.from(atob(base64Ciphertext), c => c.charCodeAt(0));
      const iv = ciphertext.slice(0, 12);
      const tag = ciphertext.slice(-16);
      const content = ciphertext.slice(12, -16);

      const contentBase64 = Buffer.from(content).toString('base64');
      const ivHex = Buffer.from(iv).toString('hex');
      const tagHex = Buffer.from(tag).toString('hex');

      const decryptedData = await AesGcmCrypto.decrypt(
        contentBase64,
        base64Key,
        ivHex,
        tagHex,
        false
      );
      return decryptedData;
    } catch (error) {
      console.error('AES-GCM decryption failed:', error);
      throw error;
    }
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
   * Generates a new RSA key pair for asymmetric encryption
   */
  public static async generateRsaKeyPair(): Promise<{ publicKey: string, privateKey: string }> {
    /*
     * TODO: this method is currently unused. When we enable the app to actually generate keys, check if the key pair is
     * generated in the correct format  where private key is in expected JWK format that the WASM app already outputs.
     */
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
   * Decrypts data using RSA-OAEP asymmetric encryption with a private key
   */
  public static async decryptWithPrivateKey(ciphertext: string, privateKey: string): Promise<Uint8Array> {
    try {
      const privateKeyObj = await crypto.subtle.importKey(
        "jwk",
        JSON.parse(privateKey),
        {
          name: "RSA-OAEP",
          hash: "SHA-256",
        },
        true,
        ["decrypt"]
      );

      const cipherBuffer = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
      const plaintextBuffer = await crypto.subtle.decrypt(
        {
          name: "RSA-OAEP",
        },
        privateKeyObj,
        cipherBuffer
      );

      return new Uint8Array(plaintextBuffer);
    } catch (error) {
      console.error('RSA decryption failed:', error);
      throw new Error(`Failed to decrypt: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
      const symmetricKey = await EncryptionUtility.decryptWithPrivateKey(
        email.encryptedSymmetricKey,
        encryptionKey.PrivateKey
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
        const symmetricKey = await EncryptionUtility.decryptWithPrivateKey(
          email.encryptedSymmetricKey,
          encryptionKey.PrivateKey
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
      const symmetricKey = await EncryptionUtility.decryptWithPrivateKey(
        email.encryptedSymmetricKey,
        encryptionKey.PrivateKey
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
