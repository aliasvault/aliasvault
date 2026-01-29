/**
 * Settings for password generation stored in SQLite database settings table as string.
 */
export type PasswordSettings = {
  /**
   * The length of the password.
   */
  Length: number;

  /**
   * Whether to use lowercase letters.
   */
  UseLowercase: boolean;

  /**
   * Whether to use uppercase letters.
   */
  UseUppercase: boolean;

  /**
   * Whether to use numbers.
   */
  UseNumbers: boolean;

  /**
   * Whether to use special characters.
   */
  UseSpecialChars: boolean;

  /**
   * Whether to use non-ambiguous characters.
   */
  UseNonAmbiguousChars: boolean;
}
