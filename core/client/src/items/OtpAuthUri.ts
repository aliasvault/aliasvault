import { normalizeTotpAlgorithm, normalizeTotpDigits, normalizeTotpPeriod, TOTP_DEFAULT_ALGORITHM, TOTP_DEFAULT_DIGITS, TOTP_DEFAULT_PERIOD } from '@aliasvault/models/vault';

import type { TotpParameters } from './TotpUtility';

/**
 * Parsed `otpauth://totp/` URI components.
 */
export type OtpAuthUri = {
  /** URL-decoded path component, typically "Issuer:account". */
  label: string;
  /** The label without its "Issuer:" prefix. */
  account: string;
  /** Base32 secret from the `secret` query parameter. */
  secret: string;
  /** Optional `issuer` query parameter. */
  issuer?: string;
  /** HMAC algorithm from the `algorithm` parameter, normalized. */
  algorithm: string;
  /** Code length from the `digits` parameter, normalized. */
  digits: number;
  /** Time step from the `period` parameter, normalized. */
  period: number;
};

/**
 * Parse an `otpauth://totp/` URI (https://github.com/google/google-authenticator/wiki/Key-Uri-Format). HOTP URIs are
 * rejected, the vault only stores TOTP codes. The Base32 alphabet of the secret is not validated here; callers do that.
 * @param uri - The URI
 * @returns The parsed components, or null when the input is not a TOTP otpauth URI carrying a secret
 */
export function parseOtpAuthUri(uri: string): OtpAuthUri | null {
  const trimmed = uri.trim();
  const prefix = 'otpauth://totp/';
  if (trimmed.toLowerCase().slice(0, prefix.length) !== prefix) {
    return null;
  }

  const rest = trimmed.slice(prefix.length);
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
  const issuerSeparator = label.indexOf(':');
  return {
    label,
    account: issuerSeparator >= 0 ? label.slice(issuerSeparator + 1).trim() : label,
    secret,
    ...(issuer ? { issuer } : {}),
    algorithm: normalizeTotpAlgorithm(params.get('algorithm')),
    digits: normalizeTotpDigits(params.get('digits')),
    period: normalizeTotpPeriod(params.get('period')),
  };
}

/**
 * Serialize a TOTP code back to an `otpauth://` URI. Non-default parameters are written out so a
 * scanned QR reproduces the same codes.
 *
 * @param label - URL-encoded label, typically "Issuer:account"
 * @param secretKey - Base32 secret
 * @param issuer - Issuer name
 * @param parameters - Stored algorithm/digits/period
 * @returns The otpauth:// URI
 */
export function buildOtpAuthUri(label: string, secretKey: string, issuer: string, parameters?: TotpParameters): string {
  const algorithm = normalizeTotpAlgorithm(parameters?.Algorithm);
  const digits = normalizeTotpDigits(parameters?.Digits);
  const period = normalizeTotpPeriod(parameters?.Period);

  let uri = `otpauth://totp/${label}?secret=${secretKey}&issuer=${encodeURIComponent(issuer)}`;
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
