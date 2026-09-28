/**
 * Minimum length the register, change password and export password forms accept; it is also where the strength
 * scale reaches "Fair". Not to be confused with the password generator's MIN_PASSWORD_LENGTH.
 */
export const MIN_ACCEPTED_PASSWORD_LENGTH = 12;

/**
 * Strength score of a password, 0 (very weak) to 4 (strong), by length.
 * @param password - the password to rate
 */
export function getPasswordStrength(password: string): number {
  const length = password.length;
  if (length < 8) {
    return 0;
  }
  if (length < MIN_ACCEPTED_PASSWORD_LENGTH) {
    return 1;
  }
  if (length < 16) {
    return 2;
  }
  if (length < 20) {
    return 3;
  }
  return 4;
}
