/**
 * Which generator a password setting uses.
 */
export type PasswordGeneratorType = 'basic' | 'diceware';

/**
 * Capitalization applied to each Diceware word.
 */
export type DicewareCapitalization = 'None' | 'TitleCase' | 'Uppercase' | 'Lowercase' | 'Random';

/**
 * Separator placed between Diceware words.
 */
export type DicewareSeparator = 'None' | 'Dash' | 'Space' | 'Underscore' | 'Dot';

/**
 * Optional random salt character added to a Diceware passphrase.
 */
export type DicewareSalt = 'None' | 'Prefix' | 'Sprinkle' | 'Suffix';

/**
 * Settings for password generation stored in SQLite database settings table as string.
 *
 * The Diceware fields are optional so that older stored blobs (which only contain the
 * basic-password fields) remain valid; defaults are applied when reading the settings.
 */
export type PasswordSettings = {
  /**
   * The length of the password (basic generator).
   */
  Length: number;

  /**
   * Whether to use lowercase letters (basic generator).
   */
  UseLowercase: boolean;

  /**
   * Whether to use uppercase letters (basic generator).
   */
  UseUppercase: boolean;

  /**
   * Whether to use numbers (basic generator).
   */
  UseNumbers: boolean;

  /**
   * Whether to use special characters (basic generator).
   */
  UseSpecialChars: boolean;

  /**
   * Whether to use non-ambiguous characters (basic generator).
   */
  UseNonAmbiguousChars: boolean;

  /**
   * Which generator to use. Defaults to 'basic' when absent.
   */
  Type?: PasswordGeneratorType;

  /**
   * Number of words in the passphrase (diceware generator).
   */
  WordCount?: number;

  /**
   * Wordlist language code (diceware generator).
   */
  Language?: string;

  /**
   * Capitalization applied to each word (diceware generator). Defaults to 'Lowercase'.
   */
  Capitalization?: DicewareCapitalization;

  /**
   * Separator between words (diceware generator). Defaults to 'Dash'.
   */
  Separator?: DicewareSeparator;

  /**
   * Optional random salt character (diceware generator). Defaults to 'None'.
   */
  Salt?: DicewareSalt;
}
