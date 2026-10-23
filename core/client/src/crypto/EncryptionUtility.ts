import { argon2DeriveKey } from '../rust/RustCore';
import { base64ToBytes, bytesToBase64 } from '../utilities/Base64';
import { logDefect } from '../utilities/Diagnostics';

/** AES-GCM IV length in bytes; every AES-GCM payload starts with it. */
const AES_GCM_IV_LENGTH = 12;

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
   * Encrypts bytes with AES-256-GCM (random 12-byte IV, no AAD) into base64 `IV | ciphertext | tag`.
   */
  public static async symmetricEncryptBytes(plaintextBytes: Uint8Array, base64Key: string): Promise<string> {
    const key = await EncryptionUtility.importAesKey(base64Key, 'encrypt');
    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintextBytes as Uint8Array<ArrayBuffer>);

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return bytesToBase64(combined);
  }

  /**
   * Decrypts `IV | ciphertext | tag` bytes with AES-256-GCM (no AAD).
   */
  public static async symmetricDecryptBytes(encryptedBytes: Uint8Array, base64Key: string): Promise<Uint8Array> {
    if (!encryptedBytes || encryptedBytes.length === 0) {
      return encryptedBytes;
    }

    const key = await EncryptionUtility.importAesKey(base64Key, 'decrypt');
    const iv = encryptedBytes.slice(0, AES_GCM_IV_LENGTH);
    const ciphertext = encryptedBytes.slice(AES_GCM_IV_LENGTH);

    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext));
  }

  /**
   * Generates an extractable RSA-OAEP-2048 (SHA-256) key pair, both halves exported as JWK strings.
   */
  public static async generateRsaKeyPair(): Promise<{ publicKey: string, privateKey: string }> {
    const keyPair = await EncryptionUtility.generateRsaOaepKeyPair(true);
    const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const privateKey = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

    return { publicKey: JSON.stringify(publicKey), privateKey: JSON.stringify(privateKey) };
  }

  /**
   * Generates an RSA-OAEP-2048 (SHA-256) key pair whose private key stays inside WebCrypto; the public key is a JWK string.
   */
  public static async generateRsaKeyPairNonExtractable(): Promise<{ publicKeyJwk: string, privateKey: CryptoKey }> {
    const keyPair = await EncryptionUtility.generateRsaOaepKeyPair(false);
    const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

    return { publicKeyJwk: JSON.stringify(publicKey), privateKey: keyPair.privateKey };
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
   * Imports a JWK RSA-OAEP (SHA-256) private key as a non-extractable decrypt-only CryptoKey.
   */
  public static async importPrivateKey(privateKey: string): Promise<CryptoKey> {
    return await crypto.subtle.importKey('jwk', JSON.parse(privateKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  }

  /**
   * Imports a raw 256-bit AES-GCM key for a single usage.
   */
  private static async importAesKey(base64Key: string, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
    return await crypto.subtle.importKey('raw', base64ToBytes(base64Key), { name: 'AES-GCM', length: 256 }, false, [usage]);
  }

  /**
   * Generates an RSA-OAEP-2048 key pair with SHA-256 and exponent 65537.
   */
  private static async generateRsaOaepKeyPair(extractable: boolean): Promise<CryptoKeyPair> {
    return await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      extractable,
      ['encrypt', 'decrypt']
    );
  }
}

export default EncryptionUtility;
