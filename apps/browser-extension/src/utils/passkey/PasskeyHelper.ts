import { bytesToBase64Url } from '@aliasvault/client/utilities/Base64';

import type { Passkey } from '@aliasvault/models/vault';

/**
 * The WebAuthn credential id of a stored passkey, and GUID to bytes conversions.
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
   * Convert GUID to base64url for WebAuthn credential ID
   */
  public static guidToBase64url(guid: string): string {
    return bytesToBase64Url(PasskeyHelper.guidToBytes(guid));
  }

  /**
   * The WebAuthn credential id of a stored passkey: its CredentialId, or the bytes of its Id when it has none.
   */
  public static credentialIdBytes(passkey: Pick<Passkey, 'Id' | 'CredentialId'>): Uint8Array {
    return passkey.CredentialId ? new Uint8Array(passkey.CredentialId) : PasskeyHelper.guidToBytes(passkey.Id);
  }

  /**
   * The WebAuthn credential id of a stored passkey as base64url, the form relying parties send in allowCredentials.
   */
  public static credentialIdBase64url(passkey: Pick<Passkey, 'Id' | 'CredentialId'>): string {
    return bytesToBase64Url(PasskeyHelper.credentialIdBytes(passkey));
  }
}
