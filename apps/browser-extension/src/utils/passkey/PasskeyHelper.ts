import { base64UrlToBytes, bytesToBase64Url } from '@aliasvault/client/utilities/Base64';

import type { Passkey } from '@aliasvault/models/vault';

/** The WebAuthn size limit of a credential id. */
const MAX_CREDENTIAL_ID_BYTES = 1023;

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
   * The WebAuthn credential id of a stored passkey: its CredentialId.
   */
  public static credentialIdBytes(passkey: Pick<Passkey, 'Id' | 'CredentialId'>): Uint8Array {
    /*
     * LEGACY: a row created before 0.32.0 has no CredentialId until a pull or schema rebuild rewrites the local vault, and
     * uses the bytes of its Id. TODO: remove once pre-0.32.0 clients are no longer supported.
     */
    return passkey.CredentialId ? new Uint8Array(passkey.CredentialId) : PasskeyHelper.guidToBytes(passkey.Id);
  }

  /**
   * The WebAuthn credential id of a stored passkey as base64url, the form relying parties send in allowCredentials.
   */
  public static credentialIdBase64url(passkey: Pick<Passkey, 'Id' | 'CredentialId'>): string {
    return bytesToBase64Url(PasskeyHelper.credentialIdBytes(passkey));
  }

  /**
   * The passkeys the relying party accepts in allowCredentials, or all of them when it lists none.
   * The page sends the ids as standard base64, so they are normalized to base64url before comparing; an id that is not
   * valid base64 or not 1 to 1023 bytes long matches nothing.
   */
  public static filterByAllowCredentials<T extends Pick<Passkey, 'Id' | 'CredentialId'>>(passkeys: T[], allowCredentialIds: string[] | undefined): T[] {
    if (!allowCredentialIds || allowCredentialIds.length === 0) {
      return passkeys;
    }
    const allowed = new Set(allowCredentialIds.flatMap(id => {
      try {
        const bytes = base64UrlToBytes(id);
        return bytes.length > 0 && bytes.length <= MAX_CREDENTIAL_ID_BYTES ? [bytesToBase64Url(bytes)] : [];
      } catch {
        return [];
      }
    }));
    return passkeys.filter(passkey => allowed.has(PasskeyHelper.credentialIdBase64url(passkey)));
  }
}
