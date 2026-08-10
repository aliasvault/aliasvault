import * as OTPAuth from 'otpauth';

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
 * Build an OTPAuth.TOTP for a secret using the stored parameters, falling back to the RFC 6238
 * defaults for anything missing or unsupported.
 *
 * @param secretKey - Base32-encoded TOTP secret
 * @param parameters - Stored algorithm/digits/period
 * @returns A configured OTPAuth.TOTP instance
 */
function createTotp(secretKey: string, parameters?: TotpParameters): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    secret: secretKey,
    algorithm: normalizeTotpAlgorithm(parameters?.Algorithm),
    digits: normalizeTotpDigits(parameters?.Digits),
    period: normalizeTotpPeriod(parameters?.Period)
  });
}

/**
 * Generate the current TOTP code for a secret using its stored parameters.
 *
 * @param secretKey - Base32-encoded TOTP secret
 * @param parameters - Stored algorithm/digits/period
 * @returns The current code, or null when the secret cannot be used
 */
export function generateTotpCode(secretKey: string, parameters?: TotpParameters): string | null {
  try {
    return createTotp(secretKey, parameters).generate();
  } catch (error) {
    console.error('Error generating TOTP code:', error);
    return null;
  }
}

/**
 * Seconds remaining in the current time step of a TOTP code.
 *
 * @param parameters - Stored algorithm/digits/period; only the period matters here
 * @returns Seconds until the code rolls over
 */
export function getTotpRemainingSeconds(parameters?: TotpParameters): number {
  const period = normalizeTotpPeriod(parameters?.Period);
  return period - (Math.floor(Date.now() / 1000) % period);
}

/**
 * How far the current time step has progressed, as a percentage. Used to drive the countdown ring.
 *
 * @param parameters - Stored algorithm/digits/period; only the period matters here
 * @returns A value between 0 and 100
 */
export function getTotpElapsedPercentage(parameters?: TotpParameters): number {
  const period = normalizeTotpPeriod(parameters?.Period);
  return Math.floor(((period - getTotpRemainingSeconds(parameters)) / period) * 100);
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
