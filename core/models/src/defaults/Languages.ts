/**
 * Generic, cross-platform language reference: maps a two-letter ISO 639-1 code to a flag, a native
 * display label, and the alternative locale codes (BCP-47 region variants) that map onto it
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
  /** Alternative locale codes (BCP-47 language-region tags) that map onto this language. */
  alternativeCodes?: string[];
}

/** Default ISO language code used as the universal fallback. */
export const DEFAULT_LANGUAGE_CODE = 'en';

/**
 * Known languages keyed by ISO 639-1 code, with a flag, native label, and the region-variant locale
 * codes that map onto each.
 */
export const LANGUAGES: ILanguageInfo[] = [
  { code: 'en', flag: '🇺🇸', label: 'English', alternativeCodes: ['en-US', 'en-GB', 'en-CA', 'en-AU', 'en-NZ', 'en-IE', 'en-ZA', 'en-SG', 'en-IN'] },
  { code: 'nl', flag: '🇳🇱', label: 'Nederlands', alternativeCodes: ['nl-NL', 'nl-BE'] },
  { code: 'de', flag: '🇩🇪', label: 'Deutsch', alternativeCodes: ['de-DE', 'de-AT', 'de-CH', 'de-LU', 'de-LI'] },
  { code: 'fr', flag: '🇫🇷', label: 'Français', alternativeCodes: ['fr-FR', 'fr-CA', 'fr-BE', 'fr-CH', 'fr-LU', 'fr-MC'] },
  { code: 'es', flag: '🇪🇸', label: 'Español', alternativeCodes: ['es-ES', 'es-MX', 'es-AR', 'es-CO', 'es-CL', 'es-PE', 'es-VE', 'es-EC', 'es-GT', 'es-CU', 'es-BO', 'es-DO', 'es-HN', 'es-PY', 'es-SV', 'es-NI', 'es-CR', 'es-PA', 'es-UY', 'es-PR'] },
  { code: 'it', flag: '🇮🇹', label: 'Italiano', alternativeCodes: ['it-IT', 'it-CH', 'it-SM', 'it-VA'] },
  { code: 'da', flag: '🇩🇰', label: 'Dansk', alternativeCodes: ['da-DK'] },
  { code: 'fi', flag: '🇫🇮', label: 'Suomi', alternativeCodes: ['fi-FI'] },
  { code: 'he', flag: '🇮🇱', label: 'עברית', alternativeCodes: ['he-IL'] },
  { code: 'pl', flag: '🇵🇱', label: 'Polski', alternativeCodes: ['pl-PL'] },
  { code: 'pt', flag: '🇧🇷', label: 'Português Brasileiro', alternativeCodes: ['pt-BR', 'pt-PT'] },
  { code: 'ro', flag: '🇷🇴', label: 'Română', alternativeCodes: ['ro-RO', 'ro-MD'] },
  { code: 'ru', flag: '🇷🇺', label: 'Русский', alternativeCodes: ['ru-RU', 'ru-BY', 'ru-KZ', 'ru-UA'] },
  { code: 'sv', flag: '🇸🇪', label: 'Svenska', alternativeCodes: ['sv-SE', 'sv-FI'] },
  { code: 'uk', flag: '🇺🇦', label: 'Українська', alternativeCodes: ['uk-UA'] },
  { code: 'zh', flag: '🇨🇳', label: '简体中文', alternativeCodes: ['zh-CN', 'zh-SG', 'zh-Hans', 'zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant'] },
  { code: 'ur', flag: '🇵🇰', label: 'اردو', alternativeCodes: ['ur-PK', 'ur-IN'] },
  { code: 'fa', flag: '🇮🇷', label: 'فارسی', alternativeCodes: ['fa-IR', 'fa-AF'] },
  { code: 'hu', flag: '🇭🇺', label: 'Magyar', alternativeCodes: ['hu-HU'] },
  { code: 'ga', flag: '🇮🇪', label: 'Gaeilge', alternativeCodes: ['ga-IE'] },
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
export function matchAvailableLanguage(
  appLanguage: string | null | undefined,
  availableCodes: string[]
): string | null {
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
  return matchAvailableLanguage(appLanguage, availableCodes) ?? availableCodes[0] ?? DEFAULT_LANGUAGE_CODE;
}
