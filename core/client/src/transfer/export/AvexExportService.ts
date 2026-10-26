import { AppInfo } from '../../platform/AppInfo';
import { rustCore } from '../../rust/RustCore';

/**
 * Writes the .avex encrypted vault export format; the container lives in the Rust core (crypto/avex.rs).
 */
export class AvexExportService {
  /**
   * Encrypt .avux bytes to an .avex file.
   * @param avuxBytes - The unencrypted .avux bytes
   * @param exportPassword - The password to encrypt with
   * @returns The .avex file bytes
   */
  public static async encryptToAvex(avuxBytes: Uint8Array, exportPassword: string): Promise<Uint8Array> {
    return rustCore().avexEncrypt(avuxBytes, exportPassword, new Date().toISOString(), AppInfo.VERSION);
  }
}
