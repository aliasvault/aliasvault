import { EncryptionUtility } from '../../../../crypto/EncryptionUtility';
import { argon2DeriveKey } from '../../../../rust/RustCore';
import { bytesToBase64 } from '../../../../utilities/Base64';
import { AvexConstants } from '../../../export/AvexConstants';
import { getProperty, isJsonObject, parseJson, readNumber, readObject, readString, requireObject } from '../../readers/JsonReader';

import type { AvexHeader } from '../../../export/AvexHeader';

/**
 * Thrown when an .avex file cannot be decrypted; most likely the password is wrong.
 */
export class AvexDecryptionError extends Error {
  /**
   * Create the error.
   * @param innerError - The error the decryption raised
   */
  public constructor(public readonly innerError?: unknown) {
    super('Failed to decrypt .avex file. The password may be incorrect or the file may be corrupted.');
    this.name = 'AvexDecryptionError';
    Object.setPrototypeOf(this, AvexDecryptionError.prototype);
  }
}

/**
 * Reads the .avex encrypted vault export format written by AvexExportService.
 */
export class AvexImportService {
  /**
   * Decrypt an .avex file to .avux bytes.
   * @param avexBytes - The .avex file bytes
   * @param exportPassword - The password to decrypt with
   * @returns The decrypted .avux bytes
   * @throws {Error} When the file is not a supported .avex file.
   * @throws {AvexDecryptionError} When the payload does not decrypt (wrong password or corrupt file).
   */
  public static async decryptAvex(avexBytes: Uint8Array, exportPassword: string): Promise<Uint8Array> {
    const { header, payloadOffset } = AvexImportService.parseAvexHeader(avexBytes);

    if (header.version !== AvexConstants.FormatVersion) {
      throw new Error(`Unsupported .avex version: ${header.version}. Expected ${AvexConstants.FormatVersion}.`);
    }

    const encryptedPayload = avexBytes.subarray(payloadOffset);

    if (header.kdf.type.toLowerCase() !== 'argon2id') {
      throw new Error(`Unsupported KDF type: ${header.kdf.type}. Only Argon2id is supported.`);
    }

    const key = await argon2DeriveKey(exportPassword, header.kdf.salt, JSON.stringify(header.kdf.params));

    try {
      return await EncryptionUtility.symmetricDecryptBytes(encryptedPayload, bytesToBase64(key));
    } catch (error) {
      throw new AvexDecryptionError(error);
    }
  }

  /**
   * Parse the header of an .avex file.
   * @param avexBytes - The .avex file bytes
   * @returns The header and the byte offset of the payload
   * @throws {Error} When the delimiter is missing or the header is not an .avex header.
   */
  public static parseAvexHeader(avexBytes: Uint8Array): { header: AvexHeader; payloadOffset: number } {
    const delimiterBytes = new TextEncoder().encode(AvexConstants.HeaderDelimiter);
    const delimiterIndex = AvexImportService.indexOf(avexBytes, delimiterBytes);

    if (delimiterIndex === -1) {
      throw new Error('Invalid .avex file: header delimiter not found');
    }

    const headerJson = new TextDecoder('utf-8').decode(avexBytes.subarray(0, delimiterIndex));
    const root = requireObject(parseJson(headerJson), '.avex header');
    const format = readString(root, 'format');
    if (format !== AvexConstants.FormatIdentifier) {
      throw new Error(`Invalid .avex file: expected format '${AvexConstants.FormatIdentifier}', got '${format ?? 'null'}'`);
    }

    const kdf = readObject(root, 'kdf');
    const encryption = readObject(root, 'encryption');
    const metadata = readObject(root, 'metadata');
    const params = kdf ? getProperty(kdf, 'params') : undefined;

    const header: AvexHeader = {
      format,
      version: readString(root, 'version') ?? '',
      kdf: {
        type: (kdf ? readString(kdf, 'type') : null) ?? '',
        salt: (kdf ? readString(kdf, 'salt') : null) ?? '',
        params: isJsonObject(params) ? Object.fromEntries(Object.entries(params).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) : {},
      },
      encryption: {
        algorithm: (encryption ? readString(encryption, 'algorithm') : null) ?? '',
        encryptedDataOffset: (encryption ? readNumber(encryption, 'encryptedDataOffset') : null) ?? 0,
      },
      metadata: {
        exportedAt: (metadata ? readString(metadata, 'exportedAt') : null) ?? '',
        appVersion: metadata ? readString(metadata, 'appVersion') : null,
      },
    };

    return { header, payloadOffset: delimiterIndex + delimiterBytes.length };
  }

  /**
   * Find a byte pattern in a byte array.
   * @param source - The bytes to search
   * @param pattern - The pattern
   * @returns The index of the first match, or -1
   */
  private static indexOf(source: Uint8Array, pattern: Uint8Array): number {
    if (pattern.length > source.length) {
      return -1;
    }

    outer: for (let i = 0; i <= source.length - pattern.length; i++) {
      for (let j = 0; j < pattern.length; j++) {
        if (source[i + j] !== pattern[j]) {
          continue outer;
        }
      }
      return i;
    }

    return -1;
  }
}
