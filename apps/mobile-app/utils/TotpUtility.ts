import NativeVaultManager from '@/specs/NativeVaultManager';
import { normalizeTotpAlgorithm, normalizeTotpDigits, normalizeTotpPeriod, TOTP_DEFAULT_ALGORITHM, TOTP_DEFAULT_DIGITS, TOTP_DEFAULT_PERIOD } from '@/utils/dist/core/models/vault';

/**
 * The RFC 6238 parameters a TOTP code was created with, as stored on the vault row.
 */
export type TotpParameters = {
  /** HMAC algorithm: "SHA1", "SHA256" or "SHA512". */
  Algorithm?: string;
  /** Number of digits in the generated code. */
  Digits?: number;
  /** Time step in seconds. */
  Period?: number;
};

/**
 * Generates the current TOTP code for the given secret key.
 *
 * Delegates to the platform-native TOTP generator (Swift on iOS, Kotlin on
 * Android) so the React Native layer, the iOS Autofill extension, and the
 * Android Autofill service all share one RFC 6238 implementation.
 *
 * @param secretKey - Base32-encoded TOTP secret
 * @param parameters - Stored algorithm/digits/period; each falls back to the RFC 6238 default when absent
 * @returns The current TOTP code, or empty string on error
 */
export async function generateTotpCode(secretKey: string, parameters?: TotpParameters): Promise<string> {
  try {
    const code = await NativeVaultManager.generateTotpCode(
      secretKey,
      normalizeTotpAlgorithm(parameters?.Algorithm),
      normalizeTotpDigits(parameters?.Digits),
      normalizeTotpPeriod(parameters?.Period)
    );
    return code ?? '';
  } catch (error) {
    console.error('Error generating TOTP code:', error);
    return '';
  }
}

/**
 * Parsed `otpauth://` URI components.
 */
export type OtpAuthUri = {
  /** "totp" or "hotp" — only "totp" is supported elsewhere in the app. */
  type: 'totp' | 'hotp';
  /** URL-decoded path component, typically "Issuer:account". */
  label: string;
  /** Base32 secret from the `secret` query parameter. */
  secret: string;
  /** Optional `issuer` query parameter. */
  issuer?: string;
  /** HMAC algorithm from the `algorithm` parameter, normalized; SHA1 when absent or unsupported. */
  algorithm: string;
  /** Code length from the `digits` parameter, normalized; 6 when absent or out of range. */
  digits: number;
  /** Time step from the `period` parameter, normalized; 30 when absent or out of range. */
  period: number;
};

/**
 * Parse an `otpauth://` URI per
 * https://github.com/google/google-authenticator/wiki/Key-Uri-Format.
 * 
 * Returns null when the input is not a valid `otpauth://` URI or is missing
 * a `secret` parameter. Does NOT validate the Base32 alphabet of the secret —
 * callers (e.g. `sanitizeSecretKey` in TotpEditor) handle that separately.
 */
export function parseOtpAuthUri(uri: string): OtpAuthUri | null {
  const trimmed = uri.trim();
  const prefix = 'otpauth://';
  if (trimmed.toLowerCase().slice(0, prefix.length) !== prefix) {
    return null;
  }

  const afterScheme = trimmed.slice(prefix.length);
  const slashIdx = afterScheme.indexOf('/');
  if (slashIdx < 0) {
    return null;
  }

  const typeRaw = afterScheme.slice(0, slashIdx).toLowerCase();
  if (typeRaw !== 'totp' && typeRaw !== 'hotp') {
    return null;
  }

  const rest = afterScheme.slice(slashIdx + 1);
  const queryIdx = rest.indexOf('?');
  const labelEncoded = queryIdx >= 0 ? rest.slice(0, queryIdx) : rest;
  const queryString = queryIdx >= 0 ? rest.slice(queryIdx + 1) : '';

  let label: string;
  try {
    label = decodeURIComponent(labelEncoded);
  } catch {
    label = labelEncoded;
  }

  const params = new URLSearchParams(queryString);
  const secret = params.get('secret');
  if (!secret) {
    return null;
  }

  const issuer = params.get('issuer');
  return {
    type: typeRaw,
    label,
    secret,
    ...(issuer ? { issuer } : {}),
    algorithm: normalizeTotpAlgorithm(params.get('algorithm')),
    digits: normalizeTotpDigits(params.get('digits')),
    period: normalizeTotpPeriod(params.get('period')),
  };
}

/**
 * Serialize a TOTP code back to an `otpauth://` URI. Non-default parameters are written out so an
 * exported or re-scanned URI reproduces the same codes.
 *
 * @param label - URL-encoded label, typically "Issuer:account"
 * @param secret - Base32 secret
 * @param issuer - Issuer name
 * @param parameters - Stored algorithm/digits/period
 * @returns The otpauth:// URI
 */
export function buildOtpAuthUri(label: string, secret: string, issuer: string, parameters?: TotpParameters): string {
  const algorithm = normalizeTotpAlgorithm(parameters?.Algorithm);
  const digits = normalizeTotpDigits(parameters?.Digits);
  const period = normalizeTotpPeriod(parameters?.Period);

  let uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
  if (algorithm !== TOTP_DEFAULT_ALGORITHM) {
    uri += `&algorithm=${algorithm}`;
  }
  if (digits !== TOTP_DEFAULT_DIGITS) {
    uri += `&digits=${digits}`;
  }
  if (period !== TOTP_DEFAULT_PERIOD) {
    uri += `&period=${period}`;
  }
  return uri;
}
