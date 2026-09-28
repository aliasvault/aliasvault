/**
 * Language reference shared by all AliasVault clients. ../languages.json is the single list of known languages:
 * flag, native label, the BCP-47 region variants that map onto each code, and whether the apps offer it as a UI
 * language (`ui`). Languages with `ui: false` are only used by features such as the identity generator.
 */

import languages from '../languages.json';

/**
 * Display metadata for a single language.
 */
export interface ILanguageInfo {
  /** Two-letter ISO 639-1 language code (e.g. 'en', 'nl'). */
  code: string;
  /** Emoji flag for the language. */
  flag: string;
  /** Native display label. */
  label: string;
  /** Whether the apps offer this language as UI language (translated in Crowdin). */
  ui?: boolean;
  /** Alternative locale codes (BCP-47 language-region tags) that map onto this language. */
  alternativeCodes?: string[];
}

/**
 * The language every app falls back to.
 */
export const DEFAULT_LANGUAGE = 'en';

/**
 * Every known language.
 */
export const LANGUAGES: ILanguageInfo[] = languages;

/**
 * The UI languages the apps offer, English first. Keep in sync with the target languages in the Crowdin project
 * settings.
 */
export const UI_LANGUAGES: ILanguageInfo[] = LANGUAGES.filter((language) => language.ui);

/**
 * The codes of the UI languages.
 */
export const LANGUAGE_CODES: string[] = UI_LANGUAGES.map((language) => language.code);

/**
 * Whether a code is one of the UI languages.
 * @param code - the language code
 */
export function isLanguageCode(code: string | null | undefined): code is string {
  return !!code && LANGUAGE_CODES.includes(code);
}

/**
 * Normalize an app/UI language tag to a two-letter lowercase ISO code (e.g. 'nl-NL' -> 'nl').
 * @param code The language tag.
 * @returns The two-letter lowercase code.
 */
export function normalizeLanguageCode(code: string | null | undefined): string {
  return (code ?? '').slice(0, 2).toLowerCase();
}

/**
 * Look up the display metadata for an ISO language code.
 * Falls back to a globe flag and the raw code for unknown languages.
 * @param code The ISO language code (case-insensitive).
 * @returns The flag + label info for the code.
 */
export function getLanguageInfo(code: string): ILanguageInfo {
  const iso = normalizeLanguageCode(code);
  const match = LANGUAGES.find((l) => l.code === iso);
  return match ?? { code, flag: '🌐', label: code };
}

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
export function matchAvailableLanguage(appLanguage: string | null | undefined, availableCodes: string[]): string | null {
  if (!appLanguage) {
    return null;
  }

  const lower = appLanguage.toLowerCase();

  // 1. Exact match against an available code (e.g. 'nl' or even a full tag the feature lists).
  const exact = availableCodes.find((c) => c.toLowerCase() === lower);
  if (exact) {
    return exact;
  }

  /*
   * 2. Alternative-code match: find the language whose region variants include this tag, then return
   *    its base code if the feature supports it (e.g. 'en-GB' -> 'en').
   */
  const altEntry = LANGUAGES.find((l) => l.alternativeCodes?.some((ac) => ac.toLowerCase() === lower));
  if (altEntry) {
    const altMatch = availableCodes.find((c) => c.toLowerCase() === altEntry.code.toLowerCase());
    if (altMatch) {
      return altMatch;
    }
  }

  // 3. Base language code match (e.g. an unlisted 'en-ZZ' still resolves to 'en').
  const base = normalizeLanguageCode(appLanguage);
  const baseMatch = availableCodes.find((c) => c.toLowerCase() === base);
  if (baseMatch) {
    return baseMatch;
  }

  return null;
}

/**
 * Resolve a default language code for an app/UI language, restricted to a set of available codes
 * (e.g. the Diceware wordlist languages returned by the Rust core, or the identity generator's
 * supported languages). Uses {@link matchAvailableLanguage} (region-variant aware), then falls back
 * to the first available code, otherwise English.
 * @param appLanguage The app/UI/browser language tag.
 * @param availableCodes The codes the feature actually supports.
 * @returns The resolved ISO code.
 */
export function resolveDefaultLanguage(appLanguage: string | null | undefined, availableCodes: string[]): string {
  return matchAvailableLanguage(appLanguage, availableCodes) ?? availableCodes[0] ?? DEFAULT_LANGUAGE;
}
