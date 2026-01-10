import { PasswordSettings } from '../types/PasswordSettings';

/**
 * Generate a random password.
 */
export class PasswordGenerator {
  private readonly lowercaseChars = 'abcdefghijklmnopqrstuvwxyz';
  private readonly uppercaseChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  private readonly numberChars = '0123456789';
  private readonly specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  /**
   * Ambiguous characters that look similar and are easy to confuse when typing:
   * - I, l, 1, | (pipe) - all look like vertical lines
   * - O, 0, o - all look like circles
   * - Z, 2 - similar appearance
   * - S, 5 - similar appearance
   * - B, 8 - similar appearance
   * - G, 6 - similar appearance
   * - Brackets, braces, parentheses: [], {}, ()
   * - Quotes: ', ", `
   * - Punctuation pairs: ;:, .,
   * - Dashes: -, _
   * - Angle brackets: <>
   */
  private readonly ambiguousChars = 'Il1O0oZzSsBbGg2568|[]{}()<>;:,.`\'"_-';

  private length: number = 18;
  private useLowercase: boolean = true;
  private useUppercase: boolean = true;
  private useNumbers: boolean = true;
  private useSpecial: boolean = true;
  private useNonAmbiguous: boolean = false;

  /**
   * Create a new instance of PasswordGenerator.
   * @param settings Optional password settings to initialize with.
   */
  public constructor(settings?: PasswordSettings) {
    if (settings) {
      this.applySettings(settings);
    }
  }

  /**
   * Apply password settings to this generator.
   */
  public applySettings(settings: PasswordSettings): this {
    this.length = settings.Length;
    this.useLowercase = settings.UseLowercase;
    this.useUppercase = settings.UseUppercase;
    this.useNumbers = settings.UseNumbers;
    this.useSpecial = settings.UseSpecialChars;
    this.useNonAmbiguous = settings.UseNonAmbiguousChars;
    return this;
  }

  /**
   * Set the length of the password.
   */
  public setLength(length: number): this {
    this.length = length;
    return this;
  }

  /**
   * Set if lowercase letters should be used.
   */
  public useLowercaseLetters(use: boolean): this {
    this.useLowercase = use;
    return this;
  }

  /**
   * Set if uppercase letters should be used.
   */
  public useUppercaseLetters(use: boolean): this {
    this.useUppercase = use;
    return this;
  }

  /**
   * Set if numeric characters should be used.
   */
  public useNumericCharacters(use: boolean): this {
    this.useNumbers = use;
    return this;
  }

  /**
   * Set if special characters should be used.
   */
  public useSpecialCharacters(use: boolean): this {
    this.useSpecial = use;
    return this;
  }

  /**
   * Set if only non-ambiguous characters should be used.
   */
  public useNonAmbiguousCharacters(use: boolean): this {
    this.useNonAmbiguous = use;
    return this;
  }

  /**
   * Get a random index from the crypto module.
   */
  private getUnbiasedRandomIndex(max: number): number {
    // Calculate the largest multiple of max that fits within Uint32.
    const limit = Math.floor((2 ** 32) / max) * max;

    while (true) {
      const array = new Uint32Array(1);
      crypto.getRandomValues(array);
      const value = array[0];

      // Reject values that would introduce bias.
      if (value < limit) {
        return value % max;
      }
    }
  }

  /**
   * Generate a random password.
   */
  public generateRandomPassword(): string {
    // Build the character set based on settings
    const chars = this.buildCharacterSet();

    // Generate initial password.
    let password = this.generateInitialPassword(chars);

    // Ensure a character from each set is present as some websites require this.
    password = this.ensureRequirements(password);

    return password;
  }

  /**
   * Build character set based on selected options.
   */
  private buildCharacterSet(): string {
    let chars = '';

    if (this.useLowercase) {
      chars += this.lowercaseChars;
    }

    if (this.useUppercase) {
      chars += this.uppercaseChars;
    }

    if (this.useNumbers) {
      chars += this.numberChars;
    }

    if (this.useSpecial) {
      chars += this.specialChars;
    }

    // Ensure at least one character set is selected, otherwise default to lowercase.
    if (chars.length === 0) {
      chars = this.lowercaseChars;
    }

    // Remove ambiguous characters if needed.
    if (this.useNonAmbiguous) {
      chars = this.removeAmbiguousCharacters(chars);
    }

    return chars;
  }

  /**
   * Remove ambiguous characters from a character set.
   */
  private removeAmbiguousCharacters(chars: string): string {
    for (const ambChar of this.ambiguousChars) {
      chars = chars.replace(ambChar, '');
    }
    return chars;
  }

  /**
   * Generate initial random password.
   */
  private generateInitialPassword(chars: string): string {
    let password = '';
    for (let i = 0; i < this.length; i++) {
      password += chars[this.getUnbiasedRandomIndex(chars.length)];
    }
    return password;
  }

  /**
   * Ensure the generated password meets all specified requirements.
   */
  private ensureRequirements(password: string): string {
    if (this.useLowercase && !/[a-z]/.exec(password)) {
      password = this.addCharacterFromSet(
        password,
        this.getSafeCharacterSet(this.lowercaseChars)
      );
    }

    if (this.useUppercase && !/[A-Z]/.exec(password)) {
      password = this.addCharacterFromSet(
        password,
        this.getSafeCharacterSet(this.uppercaseChars)
      );
    }

    if (this.useNumbers && !/\d/.exec(password)) {
      password = this.addCharacterFromSet(
        password,
        this.getSafeCharacterSet(this.numberChars)
      );
    }

    if (this.useSpecial && !/[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.exec(password)) {
      password = this.addCharacterFromSet(
        password,
        this.getSafeCharacterSet(this.specialChars)
      );
    }

    return password;
  }

  /**
   * Get a character set with ambiguous characters removed if needed.
   */
  private getSafeCharacterSet(charSet: string): string {
    // If we're not using non-ambiguous characters, just return the original set.
    if (!this.useNonAmbiguous) {
      return charSet;
    }

    return this.removeAmbiguousCharacters(charSet);
  }

  /**
   * Add a character from the given set at a random position in the password.
   */
  private addCharacterFromSet(password: string, charSet: string): string {
    const pos = this.getUnbiasedRandomIndex(this.length);
    const char = charSet[this.getUnbiasedRandomIndex(charSet.length)];

    return password.substring(0, pos) + char + password.substring(pos + 1);
  }
}
