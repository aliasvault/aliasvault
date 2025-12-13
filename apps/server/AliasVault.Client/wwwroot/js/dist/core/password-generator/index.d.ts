/**
 * Settings for password generation stored in SQLite database settings table as string.
 */
type PasswordSettings = {
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
};

/**
 * Generate a random password.
 */
declare class PasswordGenerator {
    private readonly lowercaseChars;
    private readonly uppercaseChars;
    private readonly numberChars;
    private readonly specialChars;
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
    private readonly ambiguousChars;
    private length;
    private useLowercase;
    private useUppercase;
    private useNumbers;
    private useSpecial;
    private useNonAmbiguous;
    /**
     * Create a new instance of PasswordGenerator.
     * @param settings Optional password settings to initialize with.
     */
    constructor(settings?: PasswordSettings);
    /**
     * Apply password settings to this generator.
     */
    applySettings(settings: PasswordSettings): this;
    /**
     * Set the length of the password.
     */
    setLength(length: number): this;
    /**
     * Set if lowercase letters should be used.
     */
    useLowercaseLetters(use: boolean): this;
    /**
     * Set if uppercase letters should be used.
     */
    useUppercaseLetters(use: boolean): this;
    /**
     * Set if numeric characters should be used.
     */
    useNumericCharacters(use: boolean): this;
    /**
     * Set if special characters should be used.
     */
    useSpecialCharacters(use: boolean): this;
    /**
     * Set if only non-ambiguous characters should be used.
     */
    useNonAmbiguousCharacters(use: boolean): this;
    /**
     * Get a random index from the crypto module.
     */
    private getUnbiasedRandomIndex;
    /**
     * Generate a random password.
     */
    generateRandomPassword(): string;
    /**
     * Build character set based on selected options.
     */
    private buildCharacterSet;
    /**
     * Remove ambiguous characters from a character set.
     */
    private removeAmbiguousCharacters;
    /**
     * Generate initial random password.
     */
    private generateInitialPassword;
    /**
     * Ensure the generated password meets all specified requirements.
     */
    private ensureRequirements;
    /**
     * Get a character set with ambiguous characters removed if needed.
     */
    private getSafeCharacterSet;
    /**
     * Add a character from the given set at a random position in the password.
     */
    private addCharacterFromSet;
}

/**
 * Creates a new password generator.
 * @param settings - The settings for the password generator.
 * @returns A new password generator instance.
 */
declare const CreatePasswordGenerator: (settings: PasswordSettings) => PasswordGenerator;

export { CreatePasswordGenerator, PasswordGenerator, type PasswordSettings };
