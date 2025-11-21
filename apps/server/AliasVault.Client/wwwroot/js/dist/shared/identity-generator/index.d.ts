declare enum Gender {
    Male = "Male",
    Female = "Female",
    Other = "Other"
}

/**
 * Identity.
 */
type Identity = {
    firstName: string;
    lastName: string;
    gender: Gender;
    birthDate: Date;
    emailPrefix: string;
    nickName: string;
};

/**
 * Options for birthdate generation.
 */
interface IBirthdateOptions {
    /**
     * The target year for the birthdate (e.g., 1990).
     */
    targetYear: number;
    /**
     * The random deviation in years (e.g., 5 means ±5 years from targetYear).
     * If 0, a random date within the target year will be chosen.
     */
    yearDeviation: number;
}
interface IIdentityGenerator {
    generateRandomIdentity(gender?: string | 'random', birthdateOptions?: IBirthdateOptions): Identity;
}

/**
 * Dictionary of firstnames organized by decade range.
 */
interface IDecadeFirstnames {
    startYear: number;
    endYear: number;
    names: string[];
}
/**
 * Base identity generator.
 */
declare abstract class IdentityGenerator implements IIdentityGenerator {
    protected firstNamesMale: string[];
    protected firstNamesFemale: string[];
    protected lastNames: string[];
    private readonly random;
    /**
     * Constructor.
     */
    constructor();
    protected abstract getFirstNamesMaleJson(): string[];
    protected abstract getFirstNamesFemaleJson(): string[];
    protected abstract getLastNamesJson(): string[];
    /**
     * Get decade-based male first names. Override this to provide age-specific names.
     * If not overridden, returns an empty array and falls back to generic names.
     */
    protected getFirstNamesMaleByDecade(): IDecadeFirstnames[];
    /**
     * Get decade-based female first names. Override this to provide age-specific names.
     * If not overridden, returns an empty array and falls back to generic names.
     */
    protected getFirstNamesFemaleByDecade(): IDecadeFirstnames[];
    /**
     * Generate a random date of birth.
     * @param birthdateOptions Optional birthdate configuration
     */
    protected generateRandomDateOfBirth(birthdateOptions?: IBirthdateOptions): Date;
    /**
     * Select appropriate firstnames based on birthdate.
     * Falls back to generic names if no decade-specific data is available.
     */
    protected selectFirstnamesForBirthdate(birthdate: Date, isMale: boolean): string[];
    /**
     * Generate a random identity.
     */
    generateRandomIdentity(gender?: string | 'random', birthdateOptions?: IBirthdateOptions): Identity;
}

/**
 * Identity generator for English language using English word dictionaries.
 */
declare class IdentityGeneratorEn extends IdentityGenerator {
    /**
     * Get the male first names.
     */
    protected getFirstNamesMaleJson(): string[];
    /**
     * Get the female first names.
     */
    protected getFirstNamesFemaleJson(): string[];
    /**
     * Get the last names.
     */
    protected getLastNamesJson(): string[];
}

/**
 * Identity generator for Dutch language using Dutch word dictionaries.
 */
declare class IdentityGeneratorNl extends IdentityGenerator {
    /**
     * Get the male first names.
     */
    protected getFirstNamesMaleJson(): string[];
    /**
     * Get the female first names.
     */
    protected getFirstNamesFemaleJson(): string[];
    /**
     * Get the last names.
     */
    protected getLastNamesJson(): string[];
}

/**
 * Helper utilities for identity generation that can be used by multiple client applications.
 */
declare class IdentityHelperUtils {
    /**
     * Normalize a birth date for display.
     */
    static normalizeBirthDateForDisplay(birthDate: string | undefined): string;
    /**
     * Normalize a birth date for database storage.
     * Converts any date format to the standard format: "yyyy-MM-dd 00:00:00" (19 characters).
     * BirthDate fields do not include time or milliseconds, just date with 00:00:00.
     */
    static normalizeBirthDateForDb(input: string | undefined): string;
    /**
     * Check if a birth date is valid.
     */
    static isValidBirthDate(input: string | undefined): boolean;
}

/**
 * Generate a username or email prefix.
 */
declare class UsernameEmailGenerator {
    private static readonly MIN_LENGTH;
    private static readonly MAX_LENGTH;
    private readonly symbols;
    /**
     * Generate a username based on an identity.
     */
    generateUsername(identity: Identity): string;
    /**
     * Generate an email prefix based on an identity.
     */
    generateEmailPrefix(identity: Identity): string;
    /**
     * Sanitize an email prefix.
     */
    private sanitizeEmailPrefix;
    /**
     * Get a random symbol.
     */
    private getRandomSymbol;
    /**
     * Generate a random string.
     */
    private generateRandomString;
    /**
     * Generate a secure random integer between 0 (inclusive) and max (exclusive)
     */
    private getSecureRandom;
}

/**
 * Represents an age range option for identity generation.
 */
interface IAgeRangeOption {
    /**
     * The value to store (e.g., "21-25", "random")
     */
    value: string;
    /**
     * The display label (e.g., "21-25", "Random")
     */
    label: string;
}
/**
 * Gets all available age range options for identity generation.
 * @returns Array of age range options
 */
declare function getAvailableAgeRanges(): IAgeRangeOption[];
/**
 * Converts an age range string (e.g., "21-25", "30-35", or "random") to birthdate options.
 * @param ageRange - The age range string
 * @returns An object containing targetYear and yearDeviation, or null if random
 */
declare function convertAgeRangeToBirthdateOptions(ageRange: string): IBirthdateOptions | null;

/**
 * Creates a new identity generator based on the language.
 * @param language - The language to use for generating the identity (e.g. "en", "nl").
 * @returns A new identity generator instance.
 */
declare const CreateIdentityGenerator: (language: string) => IdentityGenerator;

/**
 * Creates a new username email generator. This is used by the .NET Blazor WASM JSinterop
 * as it cannot create instances of classes directly, it has to use a factory method.
 * @returns A new username email generator instance.
 */
declare const CreateUsernameEmailGenerator: () => UsernameEmailGenerator;

export { CreateIdentityGenerator, CreateUsernameEmailGenerator, Gender, type IAgeRangeOption, type IBirthdateOptions, type IDecadeFirstnames, type IIdentityGenerator, type Identity, IdentityGenerator, IdentityGeneratorEn, IdentityGeneratorNl, IdentityHelperUtils, UsernameEmailGenerator, convertAgeRangeToBirthdateOptions, getAvailableAgeRanges };
