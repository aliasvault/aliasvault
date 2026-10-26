import { rustCore } from '../../../../rust/RustCore';

import type { AvexHeader } from '../../../../rust/RustCoreTypes';

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
 * Reads the .avex encrypted vault export format; the container lives in the Rust core (crypto/avex.rs).
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
    await AvexImportService.parseAvexHeader(avexBytes);

    try {
      return await rustCore().avexDecrypt(avexBytes, exportPassword);
    } catch (error) {
      throw new AvexDecryptionError(error);
    }
  }

  /**
   * Parse and check the header of an .avex file.
   * @param avexBytes - The .avex file bytes
   * @returns The header
   * @throws {Error} When the file is not a supported .avex file.
   */
  public static async parseAvexHeader(avexBytes: Uint8Array): Promise<AvexHeader> {
    try {
      return await rustCore().avexParseHeader(avexBytes);
    } catch (error) {
      throw new Error(String(error));
    }
  }
}
