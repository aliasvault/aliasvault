import { isOtpAuthUri, resolveTotpEntry, type TotpEntry } from '../../../items/OtpAuthUri';

/**
 * Sanitize an imported TOTP secret that may be given as an otpauth:// URI.
 * @param secretKey - The bare Base32 secret or an otpauth://totp/ URI
 * @returns The secret, name (derived from the URI's label and issuer, else blank) and parameters
 * @throws {Error} When the URI is malformed or the secret is not Base32.
 */
export function sanitizeTotpSecretKey(secretKey: string): TotpEntry {
  const entry = resolveTotpEntry(secretKey, '');
  if (!entry) {
    throw new Error(isOtpAuthUri(secretKey) ? 'Invalid TOTP URI format. Please check and try again.' : 'Invalid secret key. Please check and try again.');
  }
  return entry;
}
