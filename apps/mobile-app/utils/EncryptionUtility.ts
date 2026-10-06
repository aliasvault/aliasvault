import { Buffer } from 'buffer';

import { gunzipSync, strFromU8 } from 'fflate';
import AesGcmCrypto from 'react-native-aes-gcm-crypto';

import { rsaDecrypt } from '@/platform/NativeRustCore';
import NativeVaultManager from '@/specs/NativeVaultManager';
import type { EncryptionKey } from '@aliasvault/models/vault';
import type { Email, EmailDecryptionKey, MailboxEmail } from '@aliasvault/models/webapi';
import { parseEmailSource, type ParsedEmailAttachment } from '@aliasvault/client/rust/RustCore';

/**
 * An email after decryption: the metadata fields decrypted in place, and the bodies and attachments the Rust
 * parser derived from the raw RFC 822 source.
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
class EncryptionUtility {
  /**
   * Derives a key from a password using Argon2Id
   */
  public static async deriveKeyFromPassword(
    password: string,
    salt: string,
    encryptionType: string,
    encryptionSettings: string
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

    const iv = encryptedBytes.slice(0, 12);
    const tag = encryptedBytes.slice(-16);
    const content = encryptedBytes.slice(12, -16);

    const decryptedBase64 = await AesGcmCrypto.decrypt(
      Buffer.from(content).toString('base64'),
      base64Key,
      Buffer.from(iv).toString('hex'),
      Buffer.from(tag).toString('hex'),
      true
    );
    return new Uint8Array(Buffer.from(decryptedBase64, 'base64'));
  }

  /**
   * Decrypts a base64 AES-GCM payload that may be gzip compressed after decryption.
   */
  public static async symmetricDecryptMaybeCompressed(base64Ciphertext: string, base64Key: string): Promise<string> {
    if (!base64Ciphertext) {
      return base64Ciphertext;
    }

    const encryptedBytes = Uint8Array.from(atob(base64Ciphertext), c => c.charCodeAt(0));
    const decryptedBytes = await EncryptionUtility.symmetricDecryptBytes(encryptedBytes, base64Key);

    // Gzip magic number (0x1f 0x8b); anything else is treated as plain UTF-8.
    if (decryptedBytes.length >= 2 && decryptedBytes[0] === 0x1f && decryptedBytes[1] === 0x8b) {
      return strFromU8(gunzipSync(decryptedBytes));
    }

    return Buffer.from(decryptedBytes).toString('utf8');
  }

  /**
   * Finds the decryption key of an email's symmetric key that one of the locally held keypairs can open. An email
   * carries one decryption key per manifest keypair the caller holds; it names its public key by index into the
   * publicKeys table the API sends once per response.
   */
  private static resolveEmailDecryptionKey(decryptionKeys: EmailDecryptionKey[], publicKeys: string[], encryptionKeys: EncryptionKey[]): { encryptionKey: EncryptionKey, encryptedSymmetricKey: string } {
    for (const decryptionKey of decryptionKeys) {
      const publicKey = publicKeys[decryptionKey.keyIndex];
      const key = publicKey ? encryptionKeys.find(k => k.PublicKey === publicKey) : undefined;
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
    const symmetricKey = await rsaDecrypt(match.encryptedSymmetricKey, match.encryptionKey.PrivateKey);
    return Buffer.from(symmetricKey).toString('base64');
  }

  /**
   * Decrypts an individual email based on the provided public/private key pairs and parses its source.
   */
  public static async decryptEmail(
    email: Email,
    encryptionKeys: EncryptionKey[]
  ): Promise<DecryptedEmail> {
    try {
      const symmetricKeyBase64 = await EncryptionUtility.resolveEmailSymmetricKey(email.decryptionKeys, email.publicKeys, encryptionKeys);

      // Create a new object to avoid mutating the original
      const decryptedEmail = { ...email };

      // Decrypt all email fields
      decryptedEmail.subject = await EncryptionUtility.symmetricDecrypt(email.subject, symmetricKeyBase64);
      decryptedEmail.fromDisplay = await EncryptionUtility.symmetricDecrypt(email.fromDisplay, symmetricKeyBase64);
      decryptedEmail.fromDomain = await EncryptionUtility.symmetricDecrypt(email.fromDomain, symmetricKeyBase64);
      decryptedEmail.fromLocal = await EncryptionUtility.symmetricDecrypt(email.fromLocal, symmetricKeyBase64);

      const sourceBytes = email.messageSource ? await EncryptionUtility.symmetricDecryptBytes(Uint8Array.from(atob(email.messageSource), c => c.charCodeAt(0)), symmetricKeyBase64) : null;
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
          console.warn(`[Email] Could not parse the source of email ${email.id}:`, err);
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
   * Emails that cannot be decrypted are skipped rather than failing the batch, so one unreadable record cannot
   * break the whole list view.
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
        console.warn(`[Email] Skipping email ${email.id}, it could not be decrypted:`, err);
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
