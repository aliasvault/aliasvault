/**
 * PasskeyHelper - Utility class for passkey-related operations
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
   * Convert byte array to GUID string (uppercase)
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
    ].join('-').toUpperCase();
  }

  /**
   * Convert byte array to base64url string
   */
  private static bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /**
   * Convert base64url string to byte array
   * Handles both base64url (URL-safe) and regular base64 formats
   * Strips trailing '=' padding if present
   */
  private static base64UrlToBytes(base64url: string): Uint8Array {
    // Strip trailing '=' padding if present (handles regular base64 format)
    let input = base64url.replace(/=+$/, '');

    // Convert base64url to base64 (replace URL-safe characters)
    let base64 = input.replace(/-/g, '+').replace(/_/g, '/');

    // Add padding if needed
    while (base64.length % 4) {
      base64 += '=';
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Convert GUID to base64url for WebAuthn credential ID
   */
  public static guidToBase64url(guid: string): string {
    return this.bytesToBase64Url(this.guidToBytes(guid));
  }

  /**
   * Convert base64url to GUID for database lookup
   */
  public static base64urlToGuid(base64url: string): string {
    return this.bytesToGuid(this.base64UrlToBytes(base64url));
  }

  /**
   * Convert ArrayBuffer to base64 string (standard base64, not URL-safe)
   */
  public static arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert byte array to base64url string (public wrapper)
   */
  public static bytesToBase64url(bytes: Uint8Array | number[]): string {
    const uint8Array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return this.bytesToBase64Url(uint8Array);
  }

  /**
   * Convert base64url string to byte array (public wrapper)
   */
  public static base64urlToBytes(base64url: string): Uint8Array {
    return this.base64UrlToBytes(base64url);
  }
}
