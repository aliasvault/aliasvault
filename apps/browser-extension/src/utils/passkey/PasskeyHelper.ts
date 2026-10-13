import { base64UrlToBytes, bytesToBase64Url } from '@aliasvault/client/utilities/Base64';

/**
 * Credential id conversions between GUID text, bytes and base64url.
 */
export class PasskeyHelper {
  /**
   * Private constructor to prevent instantiation
   */
  private constructor() {}

  /**
   * Convert GUID string to byte array
   */
  public static guidToBytes(guid: string): Uint8Array {
    // Remove dashes: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" → "3f2504e04f8911d39a0c0305e82c3301"
    const hex = guid.replace(/-/g, '');

    if (hex.length !== 32) {
      throw new Error('Invalid GUID format');
    }

    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  /**
   * Convert byte array to GUID string.
   */
  private static bytesToGuid(bytes: Uint8Array): string {
    if (bytes.length !== 16) {
      throw new Error('Invalid byte length for GUID');
    }
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    // Reinsert dashes in canonical format 8-4-4-4-12
    return [
      hex.substr(0, 8),
      hex.substr(8, 4),
      hex.substr(12, 4),
      hex.substr(16, 4),
      hex.substr(20)
    ].join('-');
  }

  /**
   * Convert GUID to base64url for WebAuthn credential ID
   */
  public static guidToBase64url(guid: string): string {
    return bytesToBase64Url(PasskeyHelper.guidToBytes(guid));
  }

  /**
   * Convert base64url to GUID for database lookup
   */
  public static base64urlToGuid(base64url: string): string {
    return PasskeyHelper.bytesToGuid(base64UrlToBytes(base64url));
  }
}
