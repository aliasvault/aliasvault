/**
 * Generic, cross-platform language reference: maps a two-letter ISO 639-1 code to a flag and a
 * native display label.
 */

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
}

/** Default ISO language code used as the universal fallback. */
export const DEFAULT_LANGUAGE_CODE = 'en';

/**
 * Known languages keyed by ISO 639-1 code, with a flag and native label.
 * Covers the AliasVault app UI languages so this list can be reused beyond a single feature.
 */
export const LANGUAGES: ILanguageInfo[] = [
  { code: 'en', flag: '🇬🇧', label: 'English' },
  { code: 'nl', flag: '🇳🇱', label: 'Nederlands' },
  { code: 'de', flag: '🇩🇪', label: 'Deutsch' },
  { code: 'fr', flag: '🇫🇷', label: 'Français' },
  { code: 'es', flag: '🇪🇸', label: 'Español' },
  { code: 'it', flag: '🇮🇹', label: 'Italiano' },
  { code: 'da', flag: '🇩🇰', label: 'Dansk' },
  { code: 'fi', flag: '🇫🇮', label: 'Suomi' },
  { code: 'he', flag: '🇮🇱', label: 'עברית' },
  { code: 'pl', flag: '🇵🇱', label: 'Polski' },
  { code: 'pt', flag: '🇧🇷', label: 'Português' },
  { code: 'ro', flag: '🇷🇴', label: 'Română' },
  { code: 'ru', flag: '🇷🇺', label: 'Русский' },
  { code: 'sv', flag: '🇸🇪', label: 'Svenska' },
  { code: 'uk', flag: '🇺🇦', label: 'Українська' },
  { code: 'zh', flag: '🇨🇳', label: '中文' },
];

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
 * Resolve a default language code for an app/UI language, restricted to a set of available codes
 * (e.g. the Diceware wordlist languages returned by the Rust core). Returns the app language when it
 * is available, otherwise the first available code, otherwise English.
 * @param appLanguage The app/UI language tag.
 * @param availableCodes The codes the feature actually supports.
 * @returns The resolved ISO code.
 */
export function resolveDefaultLanguage(appLanguage: string | null | undefined, availableCodes: string[]): string {
  const iso = normalizeLanguageCode(appLanguage);
  if (availableCodes.some((c) => c.toLowerCase() === iso)) {
    return iso;
  }
  return availableCodes[0] ?? DEFAULT_LANGUAGE_CODE;
}
