import { EncryptionUtility } from '../../crypto/EncryptionUtility';
import { AppInfo } from '../../platform/AppInfo';
import { argon2DeriveKey } from '../../rust/RustCore';
import { base64ToBytes, bytesToBase64 } from '../../utilities/Base64';

import { AvexConstants } from './AvexConstants';

import type { AvexHeader } from './AvexHeader';

/**
 * The Argon2id parameters a new export is encrypted with.
 */
const ARGON2_KDF_PARAMS = { DegreeOfParallelism: 1, MemorySize: 262144, Iterations: 3 };

/** The KDF the export key is derived with: plain Argon2id, independent of the account's login encryption type. */
const AVEX_KDF_TYPE = 'Argon2Id';

/**
 * Writes the .avex encrypted vault export format: a JSON header, a PEM-style delimiter and the encrypted .avux payload
 * keyed with Argon2id from the export password.
 */
export class AvexExportService {
  /**
   * Encrypt .avux bytes to an .avex file.
   * @param avuxBytes - The unencrypted .avux bytes
   * @param exportPassword - The password to encrypt with
   * @returns The .avex file bytes
   */
  public static async encryptToAvex(avuxBytes: Uint8Array, exportPassword: string): Promise<Uint8Array> {
    // 1. A random salt and a key derived from it with Argon2id.
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const saltBase64 = bytesToBase64(salt);
    const key = await argon2DeriveKey(exportPassword, saltBase64, JSON.stringify(ARGON2_KDF_PARAMS));

    // 2. AES-256-GCM over the .avux bytes.
    const encryptedPayload = base64ToBytes(await EncryptionUtility.symmetricEncryptBytes(avuxBytes, bytesToBase64(key)));

    // 3. The header.
    const header: AvexHeader = {
      format: AvexConstants.FormatIdentifier,
      version: AvexConstants.FormatVersion,
      kdf: { type: AVEX_KDF_TYPE, salt: saltBase64, params: { ...ARGON2_KDF_PARAMS } },
      encryption: { algorithm: 'AES-256-GCM', encryptedDataOffset: 0 },
      metadata: { exportedAt: new Date().toISOString(), appVersion: AppInfo.VERSION },
    };

    const encoder = new TextEncoder();
    const delimiterBytes = encoder.encode(AvexConstants.HeaderDelimiter);

    // 4. The offset of the payload is recorded in the header, so serialize, measure and serialize again.
    let headerBytes = encoder.encode(JSON.stringify(header, null, 2));
    header.encryption.encryptedDataOffset = headerBytes.length + delimiterBytes.length;
    headerBytes = encoder.encode(JSON.stringify(header, null, 2));

    // 5. header + delimiter + payload.
    const avexFile = new Uint8Array(headerBytes.length + delimiterBytes.length + encryptedPayload.length);
    avexFile.set(headerBytes, 0);
    avexFile.set(delimiterBytes, headerBytes.length);
    avexFile.set(encryptedPayload, headerBytes.length + delimiterBytes.length);

    return avexFile;
  }
}
