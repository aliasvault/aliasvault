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
    generateRandomIdentity(gender?: string | 'random', birthdateOptions?: IBirthdateOptions | null): Identity;
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
    protected generateRandomDateOfBirth(birthdateOptions?: IBirthdateOptions | null): Date;
    /**
     * Select appropriate firstnames based on birthdate.
     * Falls back to generic names if no decade-specific data is available.
     */
    protected selectFirstnamesForBirthdate(birthdate: Date, isMale: boolean): string[];
    /**
     * Generate a random identity.
     */
    generateRandomIdentity(gender?: string | 'random', birthdateOptions?: IBirthdateOptions | null): Identity;
}

/**
 * Identity generator for Danish language using Danish word dictionaries.
 */
declare class IdentityGeneratorDa extends IdentityGenerator {
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
 * Identity generator for German language using German dictionaries with decade-based firstname support.
 * This implementation demonstrates how to use age-appropriate names based on birthdate.
 */
declare class IdentityGeneratorDe extends IdentityGenerator {
    /**
     * Get the male first names (generic fallback - empty as we use decade-based).
     */
    protected getFirstNamesMaleJson(): string[];
    /**
     * Get the female first names (generic fallback - empty as we use decade-based).
     */
    protected getFirstNamesFemaleJson(): string[];
    /**
     * Get the last names.
     */
    protected getLastNamesJson(): string[];
    /**
     * Get decade-based male first names.
     * Each range covers a specific decade with names popular during that period.
     */
    protected getFirstNamesMaleByDecade(): IDecadeFirstnames[];
    /**
     * Get decade-based female first names.
     * Each range covers a specific decade with names popular during that period.
     */
    protected getFirstNamesFemaleByDecade(): IDecadeFirstnames[];
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
 * Identity generator for Spanish language using Spanish word dictionaries.
 */
declare class IdentityGeneratorEs extends IdentityGenerator {
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
 * Identity generator for Persian (Farsi) language using Persian word dictionaries.
 */
declare class IdentityGeneratorFa extends IdentityGenerator {
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
 * Identity generator for French language using French word dictionaries.
 */
declare class IdentityGeneratorFr extends IdentityGenerator {
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
 * Identity generator for Italian language using Italian dictionaries with decade-based firstname support.
 * This implementation uses age-appropriate names based on birthdate.
 */
declare class IdentityGeneratorIt extends IdentityGenerator {
    /**
     * Get the male first names (generic fallback - empty as we use decade-based).
     */
    protected getFirstNamesMaleJson(): string[];
    /**
     * Get the female first names (generic fallback - empty as we use decade-based).
     */
    protected getFirstNamesFemaleJson(): string[];
    /**
     * Get the last names.
     */
    protected getLastNamesJson(): string[];
    /**
     * Get decade-based male first names.
     * Each range covers a specific decade with names popular during that period.
     */
    protected getFirstNamesMaleByDecade(): IDecadeFirstnames[];
    /**
     * Get decade-based female first names.
     * Each range covers a specific decade with names popular during that period.
     */
    protected getFirstNamesFemaleByDecade(): IDecadeFirstnames[];
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
 * Identity generator for Romanian language using Romanian dictionaries with decade-based firstname support.
 * This implementation uses age-appropriate names based on birthdate.
 */
declare class IdentityGeneratorRo extends IdentityGenerator {
    /**
     * Get the male first names (generic fallback - empty as we use decade-based).
     */
    protected getFirstNamesMaleJson(): string[];
    /**
     * Get the female first names (generic fallback - empty as we use decade-based).
     */
    protected getFirstNamesFemaleJson(): string[];
    /**
     * Get the last names.
     */
    protected getLastNamesJson(): string[];
    /**
     * Get decade-based male first names.
     * Each range covers a specific decade with names popular during that period.
     */
    protected getFirstNamesMaleByDecade(): IDecadeFirstnames[];
    /**
     * Get decade-based female first names.
     * Each range covers a specific decade with names popular during that period.
     */
    protected getFirstNamesFemaleByDecade(): IDecadeFirstnames[];
}

/**
 * Identity generator for Swedish language using Swedish word dictionaries.
 */
declare class IdentityGeneratorSv extends IdentityGenerator {
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
 * Identity generator for Urdu language using Urdu word dictionaries.
 */
declare class IdentityGeneratorUr extends IdentityGenerator {
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
     * Normalize a birth date to the standard format: "yyyy-MM-dd".
     * Handles various input formats including ISO strings with time components.
     * Returns empty string for invalid/empty dates.
     */
    static normalizeBirthDate(input: string | undefined): string;
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
     * Generate a random email prefix that is not based on any identity.
     * Uses random alphanumeric characters, suitable for login-type credentials
     * where no persona fields are available to base the email on.
     */
    generateRandomEmailPrefix(length?: number): string;
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
 * Gets all available language codes for identity generation.
 * @returns Array of ISO language codes (e.g. ["da", "de", "en", ...]).
 */
declare function getAvailableLanguages(): string[];

/**
 * Creates a new identity generator based on the language.
 * Falls back to English if the requested language is not supported.
 * @param language - The language to use for generating the identity (e.g. "da", "de", "en", "es", "fa", "fr", "it", "nl", "ro", "sv", "ur").
 * @returns A new identity generator instance.
 */
declare const CreateIdentityGenerator: (language: string) => IdentityGenerator;

/**
 * Creates a new username email generator. This is used by the .NET Blazor WASM JSinterop
 * as it cannot create instances of classes directly, it has to use a factory method.
 * @returns A new username email generator instance.
 */
declare const CreateUsernameEmailGenerator: () => UsernameEmailGenerator;

export { CreateIdentityGenerator, CreateUsernameEmailGenerator, Gender, type IAgeRangeOption, type IBirthdateOptions, type IDecadeFirstnames, type IIdentityGenerator, type Identity, IdentityGenerator, IdentityGeneratorDa, IdentityGeneratorDe, IdentityGeneratorEn, IdentityGeneratorEs, IdentityGeneratorFa, IdentityGeneratorFr, IdentityGeneratorIt, IdentityGeneratorNl, IdentityGeneratorRo, IdentityGeneratorSv, IdentityGeneratorUr, IdentityHelperUtils, UsernameEmailGenerator, convertAgeRangeToBirthdateOptions, getAvailableAgeRanges, getAvailableLanguages };
