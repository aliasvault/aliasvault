import { base64ToBytes } from '../utilities/Base64';

/** AES-GCM IV length in bytes; every AES-GCM payload starts with it. */
const AES_GCM_IV_LENGTH = 12;

/**
 * The WebCrypto operations the web app and browser extension run instead of calling the Rust core because of
 * performance reasons (no hardware acceleration via Rust WASM). Same formats as `core/rust/src/crypto/aes_gcm.rs` and `rsa_oaep.rs`.
 */
export class EncryptionUtility {
  /**
   * Encrypts bytes with AES-256-GCM (random 12-byte IV, no AAD) into `IV | ciphertext | tag` bytes.
   */
  public static async symmetricEncryptBytes(plaintextBytes: Uint8Array, base64Key: string): Promise<Uint8Array> {
    const key = await EncryptionUtility.importAesKey(base64Key, 'encrypt');
    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintextBytes as Uint8Array<ArrayBuffer>);

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return combined;
  }

  /**
   * Decrypts `IV | ciphertext | tag` bytes with AES-256-GCM (no AAD). An empty ciphertext is an error.
   */
  public static async symmetricDecryptBytes(encryptedBytes: Uint8Array, base64Key: string): Promise<Uint8Array> {
    const key = await EncryptionUtility.importAesKey(base64Key, 'decrypt');
    const iv = encryptedBytes.slice(0, AES_GCM_IV_LENGTH);
    const ciphertext = encryptedBytes.slice(AES_GCM_IV_LENGTH);

    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext));
  }

  /**
   * Decrypts base64 RSA-OAEP ciphertext with an imported private key.
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
