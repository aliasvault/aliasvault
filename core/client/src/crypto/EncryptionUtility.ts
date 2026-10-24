import { base64ToBytes, bytesToBase64 } from '../utilities/Base64';

/** AES-GCM IV length in bytes; every AES-GCM payload starts with it. */
const AES_GCM_IV_LENGTH = 12;

/**
 * The WebCrypto operations the web app and the browser extension run outside the Rust core, each for a reason:
 * - AES-256-GCM over the local vault blob and email fields: hardware accelerated, where wasm AES is not
 *   (the format is the Rust `aes_gcm.rs` format)
 * - RSA-OAEP decryption of email keys with an imported non-extractable private key, at WebCrypto speed
 * Everything else (Argon2id, the key chain, RSA key pair generation, SRP, signing, PIN wrap) runs in the Rust core only.
 */
export class EncryptionUtility {
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
   * Decrypts data using RSA-OAEP asymmetric encryption with a CryptoKey private key.
   */
  public static async decryptWithPrivateKeyObject(ciphertext: string, privateKey: CryptoKey): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, base64ToBytes(ciphertext)));
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
}

export default EncryptionUtility;
