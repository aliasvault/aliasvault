/**
 * Gender values used by generated identities and alias persona fields.
 * Matches the string values produced by the Rust core identity generator.
 */
declare enum Gender {
    Male = "Male",
    Female = "Female",
    Other = "Other"
}

/**
 * A generated identity as returned by the Rust core identity generator
 * (JSON with camelCase fields).
 */
type Identity = {
    firstName: string;
    lastName: string;
    gender: Gender | string;
    /** Birth date in yyyy-MM-dd format. */
    birthDate: string;
    emailPrefix: string;
    /** Username derived from the name and birth year (alphanumeric only). */
    nickName: string;
};

/**
 * Helper utilities for working with identity birth dates in the client UIs.
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

export { Gender, type Identity, IdentityHelperUtils };
