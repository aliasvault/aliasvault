/**
 * TotpCode SQLite database type.
 */
export type TotpCode = {
    /** The ID of the TOTP code */
    Id: string;

    /** The name of the TOTP code */
    Name: string;

    /** The secret key for the TOTP code */
    SecretKey: string;

    /** The HMAC algorithm used to derive the code: SHA1, SHA256 or SHA512 */
    Algorithm: string;

    /** The number of digits in the generated code, typically 6 or 8 */
    Digits: number;

    /** The time step in seconds a code stays valid for, typically 30 or 60 */
    Period: number;

    /** The item ID this TOTP code belongs to */
    ItemId: string;

    /** Whether the TOTP code has been deleted (soft delete) */
    IsDeleted?: boolean;
}

/** The HMAC algorithm RFC 6238 assumes when an otpauth:// URI omits the `algorithm` parameter. */
export const TOTP_DEFAULT_ALGORITHM = 'SHA1';

/** The code length RFC 6238 assumes when an otpauth:// URI omits the `digits` parameter. */
export const TOTP_DEFAULT_DIGITS = 6;

/** The time step RFC 6238 assumes when an otpauth:// URI omits the `period` parameter. */
export const TOTP_DEFAULT_PERIOD = 30;

/** The HMAC algorithms the TOTP generators implement. Anything else falls back to {@link TOTP_DEFAULT_ALGORITHM}. */
export const TOTP_SUPPORTED_ALGORITHMS = ['SHA1', 'SHA256', 'SHA512'] as const;

/**
 * Normalizes a raw `algorithm` value (from an otpauth:// URI or an older vault row) to one of
 * {@link TOTP_SUPPORTED_ALGORITHMS}, falling back to {@link TOTP_DEFAULT_ALGORITHM}.
 *
 * @param value - Raw algorithm value, e.g. "sha256" or undefined
 * @returns A supported algorithm name in uppercase
 */
export function normalizeTotpAlgorithm(value: string | null | undefined): string {
  const normalized = (value ?? '').trim().toUpperCase().replace(/[-_\s]/g, '');
  return (TOTP_SUPPORTED_ALGORITHMS as readonly string[]).includes(normalized) ? normalized : TOTP_DEFAULT_ALGORITHM;
}

/**
 * Normalizes a raw `digits` value to a supported code length, falling back to {@link TOTP_DEFAULT_DIGITS}.
 *
 * The 6-8 range is what the authenticator ecosystem actually issues, and it keeps the modulo below 2^32
 * so the native generators can compute it in a 32-bit integer without overflowing.
 *
 * @param value - Raw digits value, e.g. "8" or undefined
 * @returns A usable digit count
 */
export function normalizeTotpDigits(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed >= 6 && parsed <= 8 ? parsed : TOTP_DEFAULT_DIGITS;
}

/**
 * Normalizes a raw `period` value to a positive time step, falling back to {@link TOTP_DEFAULT_PERIOD}.
 *
 * @param value - Raw period value, e.g. "60" or undefined
 * @returns A usable period in seconds
 */
export function normalizeTotpPeriod(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 300 ? parsed : TOTP_DEFAULT_PERIOD;
}
