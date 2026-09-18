import { bytesToBase64 } from '../utilities/Base64';

/**
 * What the QR code of a mobile login request carries.
 */
export type MobileLoginQrPayload = {
  requestId: string;
  publicKeyHash: string;
}

/**
 * Client-side rules of the mobile login (QR unlock) handshake, shared by the client that shows the QR code and the
 * mobile app that scans it.
 */
export class MobileLoginProtocol {
  public static readonly QR_PREFIX = 'aliasvault://open/mobile-unlock/';

  public static readonly VERIFICATION_CODE_LENGTH = 2;

  private static readonly VERIFICATION_CODE_CONTEXT = 'AliasVault.MobileLogin.VerificationCode.v1:';

  private static readonly REQUEST_ID_PATTERN = /^[0-9a-f]{32}$/;

  private static readonly PUBLIC_KEY_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;

  /**
   * SHA-256 hash of the public key JWK string, base64url encoded without padding (43 characters).
   */
  public static async computePublicKeyHash(publicKeyJwk: string): Promise<string> {
    const digest = await MobileLoginProtocol.sha256(publicKeyJwk);
    return bytesToBase64(digest).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /**
   * The verification code for a public key: a fixed number of digits, zero padded.
   */
  public static async computeVerificationCode(publicKeyJwk: string): Promise<string> {
    const digest = await MobileLoginProtocol.sha256(MobileLoginProtocol.VERIFICATION_CODE_CONTEXT + publicKeyJwk);
    const value = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0, false);
    const modulus = 10 ** MobileLoginProtocol.VERIFICATION_CODE_LENGTH;
    return (value % modulus).toString().padStart(MobileLoginProtocol.VERIFICATION_CODE_LENGTH, '0');
  }

  /**
   * Whether the public key is the one the QR code was made for.
   */
  public static async isExpectedPublicKey(publicKeyJwk: string, expectedPublicKeyHash: string): Promise<boolean> {
    if (!MobileLoginProtocol.PUBLIC_KEY_HASH_PATTERN.test(expectedPublicKeyHash)) {
      return false;
    }
    return await MobileLoginProtocol.computePublicKeyHash(publicKeyJwk) === expectedPublicKeyHash;
  }

  /**
   * The text to put in the QR code.
   */
  public static buildQrPayload(requestId: string, publicKeyHash: string): string {
    return `${MobileLoginProtocol.QR_PREFIX}${requestId}?pk=${publicKeyHash}`;
  }

  /**
   * Parse scanned QR code text. Returns null unless it is a complete mobile login payload: the public key hash is
   * mandatory, a QR code without it is never accepted.
   */
  public static parseQrPayload(data: string): MobileLoginQrPayload | null {
    if (!data.startsWith(MobileLoginProtocol.QR_PREFIX)) {
      return null;
    }

    const [requestId, query, ...rest] = data.substring(MobileLoginProtocol.QR_PREFIX.length).split('?');
    if (rest.length > 0 || !query || !MobileLoginProtocol.REQUEST_ID_PATTERN.test(requestId)) {
      return null;
    }

    const publicKeyHash = query.split('&').find(part => part.startsWith('pk='))?.substring(3) ?? '';
    if (!MobileLoginProtocol.PUBLIC_KEY_HASH_PATTERN.test(publicKeyHash)) {
      return null;
    }

    return { requestId, publicKeyHash };
  }

  /**
   * SHA-256 of a UTF-8 string.
   */
  private static async sha256(data: string): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)));
  }
}
