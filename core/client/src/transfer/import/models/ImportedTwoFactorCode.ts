import { isBlank } from '../../shared/StringUtils';

/**
 * A 2FA code in the intermediary import format.
 */
export type ImportedTwoFactorCode = {
  /** The secret key, either bare or as an otpauth:// URI. */
  Secret: string;
  /** Name of the code; when blank, the name comes from the otpauth:// URI label (if available, otherwise it stays null). */
  Name?: string | null;
};

/**
 * One 2FA code as the list a credential holds.
 * @param secret - The secret key or otpauth:// URI
 * @param name - The name of the code
 * @returns The code as a list, or null when the secret is blank
 */
export function twoFactorCode(secret: string | null | undefined, name?: string | null): ImportedTwoFactorCode[] | null {
  return isBlank(secret) ? null : [{ Secret: secret, Name: name ?? null }];
}
