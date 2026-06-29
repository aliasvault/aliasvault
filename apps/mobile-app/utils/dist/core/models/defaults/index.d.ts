/**
 * Single source of truth for the password-length and Diceware word-count
 * defaults and UI slider ranges shared across every AliasVault client.
 *
 * This file is distributed by core/models/build.sh to all platforms including:
 *   - `core/rust/src/password_generator/defaults.rs` (Rust core)
 *   - `apps/server/Databases/AliasClientDb/Models/PasswordGeneratorDefaults.cs` (C# web client)
 *
 * The TypeScript clients (browser extension, mobile app) import the constants directly from `@/utils/dist/core/models/defaults`.
 */
/** Default length of a generated basic password. */
declare const DEFAULT_PASSWORD_LENGTH = 18;
/** Minimum password length offered by the UI length slider. */
declare const MIN_PASSWORD_LENGTH = 8;
/** Maximum password length (also the hard cap enforced by the generator). */
declare const MAX_PASSWORD_LENGTH = 256;
/** Default number of words in a generated Diceware passphrase. */
declare const DEFAULT_WORD_COUNT = 5;
/** Minimum number of words offered by the UI word-count slider. */
declare const MIN_WORD_COUNT = 3;
/** Maximum number of words (also the hard cap enforced by the generator). */
declare const MAX_WORD_COUNT = 10;

/**
 * Generic, cross-platform language reference: maps a two-letter ISO 639-1 code to a flag, a native
 * display label, and the alternative locale codes (BCP-47 region variants) that map onto it
 */
/**
 * Display metadata for a single language.
 */
interface ILanguageInfo {
    /** Two-letter ISO 639-1 language code (e.g. 'en', 'nl'). */
    code: string;
    /** Emoji flag for the language. */
    flag: string;
    /** Native display label. */
    label: string;
    /** Alternative locale codes (BCP-47 language-region tags) that map onto this language. */
    alternativeCodes?: string[];
}
/** Default ISO language code used as the universal fallback. */
declare const DEFAULT_LANGUAGE_CODE = "en";
/**
 * Known languages keyed by ISO 639-1 code, with a flag, native label, and the region-variant locale
 * codes that map onto each.
 */
declare const LANGUAGES: ILanguageInfo[];
/**
 * Normalize an app/UI language tag to a two-letter lowercase ISO code (e.g. 'nl-NL' -> 'nl').
 * @param code The language tag.
 * @returns The two-letter lowercase code.
 */
declare function normalizeLanguageCode(code: string | null | undefined): string;
/**
 * Look up the display metadata for an ISO language code.
 * Falls back to a globe flag and the raw code for unknown languages.
 * @param code The ISO language code (case-insensitive).
 * @returns The flag + label info for the code.
 */
declare function getLanguageInfo(code: string): ILanguageInfo;
/**
 * Match an app/UI/browser locale to one of a feature's available ISO codes, using the region-variant
 * alternative codes from {@link LANGUAGES} (e.g. 'en-GB' -> 'en', 'de-CH' -> 'de'). Matching order:
 * exact match against an available code, then the alternative-code table, then the base language code
 * (the part before the '-'). Returns null when nothing matches, so callers can decide their own
 * fallback (e.g. "no preference" vs. a concrete default).
 *
 * @param appLanguage The app/UI/browser language tag (e.g. 'en', 'en-US', 'nl-BE').
 * @param availableCodes The codes the feature actually supports.
 * @returns The matching available code (in its original casing) or null if none matched.
 *
 * @example
 * matchAvailableLanguage('en-US', ['en', 'nl']) // 'en'
 * matchAvailableLanguage('de-CH', ['de', 'en']) // 'de'
 * matchAvailableLanguage('ja', ['en', 'nl'])    // null
 */
declare function matchAvailableLanguage(appLanguage: string | null | undefined, availableCodes: string[]): string | null;
/**
 * Resolve a default language code for an app/UI language, restricted to a set of available codes
 * (e.g. the Diceware wordlist languages returned by the Rust core, or the identity generator's
 * supported languages). Uses {@link matchAvailableLanguage} (region-variant aware), then falls back
 * to the first available code, otherwise English.
 * @param appLanguage The app/UI/browser language tag.
 * @param availableCodes The codes the feature actually supports.
 * @returns The resolved ISO code.
 */
declare function resolveDefaultLanguage(appLanguage: string | null | undefined, availableCodes: string[]): string;

export { DEFAULT_LANGUAGE_CODE, DEFAULT_PASSWORD_LENGTH, DEFAULT_WORD_COUNT, type ILanguageInfo, LANGUAGES, MAX_PASSWORD_LENGTH, MAX_WORD_COUNT, MIN_PASSWORD_LENGTH, MIN_WORD_COUNT, getLanguageInfo, matchAvailableLanguage, normalizeLanguageCode, resolveDefaultLanguage };
