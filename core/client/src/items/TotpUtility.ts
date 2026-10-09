import { normalizeTotpAlgorithm, normalizeTotpDigits, normalizeTotpPeriod } from '@aliasvault/models/vault';

import { rustCore } from '../rust/RustCore';
import { logExpected } from '../utilities/Diagnostics';

/**
 * The RFC 6238 parameters a TOTP code was created with, as stored on the vault row.
 * Other platform implementations: TotpUtility.swift (iOS), TotpUtility.kt (Android).
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
 * Generate the TOTP code for a secret using its stored parameters, via the Rust core.
 *
 * @param secretKey - Base32-encoded TOTP secret
 * @param parameters - Stored algorithm/digits/period (when not set, use sha-1 common defaults instead)
 * @param unixSeconds - The moment to generate the code for, defaults to now
 * @returns The code, or null when the secret cannot be used
 */
export async function generateTotpCode(secretKey: string, parameters?: TotpParameters, unixSeconds: number = Math.floor(Date.now() / 1000)): Promise<string | null> {
  try {
    return await rustCore().generateTotpCode(secretKey, unixSeconds, normalizeTotpAlgorithm(parameters?.Algorithm), normalizeTotpDigits(parameters?.Digits), normalizeTotpPeriod(parameters?.Period));
  } catch (error) {
    logExpected('[Totp] Generating a code failed', error);
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
