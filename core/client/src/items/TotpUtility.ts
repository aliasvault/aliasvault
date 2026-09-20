import { normalizeTotpAlgorithm, normalizeTotpDigits, normalizeTotpPeriod } from '@aliasvault/models/vault';
import * as OTPAuth from 'otpauth';

import { logExpected } from '../utilities/Diagnostics';

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
    logExpected('[Totp] The stored secret cannot generate a code', error);
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
