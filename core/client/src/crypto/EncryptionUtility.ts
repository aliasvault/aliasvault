import { argon2DeriveKey } from '../rust/RustCore';
import { base64ToBytes, bytesToBase64 } from '../utilities/Base64';
import { logDefect } from '../utilities/Diagnostics';

/**
 * Utility class for encryption operations including:
 * - Argon2Id key derivation
 * - AES-GCM symmetric encryption/decryption
 * - RSA-OAEP asymmetric encryption/decryption
 */
export class EncryptionUtility {
  /**
   * Derives a key from a password using Argon2Id
   */
  public static async deriveKeyFromPassword(
    password: string,
    salt: string,
    encryptionSettings: string
  ): Promise<Uint8Array> {
    try {
      return await argon2DeriveKey(password, salt, encryptionSettings);
    } catch (error) {
      logDefect('[Crypto] Argon2 hashing failed', error);
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

    // WebCrypto accepts any Uint8Array at runtime; the cast satisfies the ArrayBuffer-only BufferSource typing.
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      plaintextBytes as Uint8Array<ArrayBuffer>
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
   * Decrypts data using RSA-OAEP asymmetric encryption with a JWK private key
   */
  public static async decryptWithPrivateKey(ciphertext: string, privateKey: string): Promise<Uint8Array> {
    try {
      const privateKeyObj = await EncryptionUtility.importPrivateKey(privateKey);

      return await EncryptionUtility.decryptWithPrivateKeyObject(ciphertext, privateKeyObj);
    } catch (error) {
      logDefect('[Crypto] RSA decryption failed', error);
      throw new Error(`Failed to decrypt: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Decrypts data using RSA-OAEP asymmetric encryption with a CryptoKey private key, under an OAEP label when given.
   */
  public static async decryptWithPrivateKeyObject(ciphertext: string, privateKey: CryptoKey, label?: string): Promise<Uint8Array> {
    const cipherBuffer = base64ToBytes(ciphertext);
    const plaintextBuffer = await crypto.subtle.decrypt(
      label === undefined ? { name: "RSA-OAEP" } : { name: "RSA-OAEP", label: new TextEncoder().encode(label) },
      privateKey,
      cipherBuffer
    );

    return new Uint8Array(plaintextBuffer);
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
}

export default EncryptionUtility;
