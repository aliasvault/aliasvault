/**
 * Language reference shared by all AliasVault clients, read from ../languages.json:
 * - `languages`: display info (flag, native label, BCP-47 region variants) for every language code any feature can
 *   return, e.g. the identity generator and Diceware languages that come from the Rust core.
 * - `uiLanguages`: the languages the apps are translated into (a locale file in ../locales), English first.
 */

import languageData from '../languages.json' with { type: 'json' };

/**
 * Display metadata for a single language.
 */
export interface ILanguageInfo {
  /** ISO 639-1 language code, with a region for a regional variant (e.g. 'nl', 'pt-BR'). */
  code: string;
  /** Emoji flag for the language. */
  flag: string;
  /** Native display label. */
  label: string;
  /** Alternative locale codes (BCP-47 language-region tags) that map onto this language. */
  alternativeCodes?: string[];
}

/**
 * The language every app falls back to.
 */
export const DEFAULT_LANGUAGE = 'en';

/**
 * Display info of every known language, UI language or not.
 */
export const LANGUAGES: ILanguageInfo[] = languageData.languages;

/**
 * The codes of the UI languages the apps offer, English first. Keep in sync with the target languages in the Crowdin project
 * settings.
 */
export const LANGUAGE_CODES: string[] = languageData.uiLanguages;

/**
 * Display info of the UI languages, in {@link LANGUAGE_CODES} order.
 */
export const UI_LANGUAGES: ILanguageInfo[] = LANGUAGE_CODES.map((code) => LANGUAGES.find((language) => language.code === code) ?? { code, flag: '🌐', label: code });

/**
 * Whether a code is one of the UI languages.
 * @param code - the language code
 */
export function isLanguageCode(code: string | null | undefined): code is string {
  return !!code && LANGUAGE_CODES.includes(code);
}

/**
 * Normalize an app/UI language tag to its lowercase base language code (e.g. 'nl-NL' -> 'nl', 'fil-PH' -> 'fil').
 * @param code The language tag.
 * @returns The lowercase base language code.
 */
export function normalizeLanguageCode(code: string | null | undefined): string {
  return (code ?? '').split(/[-_]/)[0].toLowerCase();
}

/**
 * Look up the display metadata for a language code or locale tag (e.g. 'nl', 'nl-BE', 'pt-BR').
 * Falls back to a globe flag and the raw code for unknown languages.
 * @param code The language code or locale tag (case-insensitive).
 * @returns The flag + label info for the code.
 */
export function getLanguageInfo(code: string): ILanguageInfo {
  const match = matchAvailableLanguage(code, LANGUAGES.map((l) => l.code));
  return LANGUAGES.find((l) => l.code === match) ?? { code, flag: '🌐', label: code };
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

  // 3. Base language, matched the same way (an unlisted 'en-ZZ' resolves to 'en', an unlisted 'pt-ZZ' to the variant listing 'pt').
  const base = normalizeLanguageCode(appLanguage);
  return base !== lower ? matchAvailableLanguage(base, availableCodes) : null;
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
