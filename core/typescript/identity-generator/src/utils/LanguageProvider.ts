/**
 * Internal definition of an identity-generator language: its ISO code plus the alternative locale
 * codes that map onto it. Display metadata (flag, native label) is intentionally NOT stored here —
 * clients look that up from the shared `core/models` language reference so it lives in one place.
 */
interface ILanguageDef {
  /**
   * The language code (e.g., "en", "nl", "de").
   */
  value: string;

  /**
   * Alternative language codes that map to this identity generator language.
   * Used for matching UI locale codes to identity generator languages.
   * For example, "en-US", "en-GB", "en-CA" all map to "en".
   */
  alternativeCodes?: string[];
}

/**
 * The languages supported by the identity generator. Only ISO codes and their alternative locale
 * codes are defined here; flag emojis and native labels come from the shared `core/models` language
 * reference (`getLanguageInfo`).
 */
const LANGUAGE_DEFS: ILanguageDef[] = [
  { value: 'da', alternativeCodes: ['da-DK'] },
  { value: 'de', alternativeCodes: ['de-DE', 'de-AT', 'de-CH', 'de-LU', 'de-LI'] },
  { value: 'en', alternativeCodes: ['en-US', 'en-GB', 'en-CA', 'en-AU', 'en-NZ', 'en-IE', 'en-ZA', 'en-SG', 'en-IN'] },
  { value: 'es', alternativeCodes: ['es-ES', 'es-MX', 'es-AR', 'es-CO', 'es-CL', 'es-PE', 'es-VE', 'es-EC', 'es-GT', 'es-CU', 'es-BO', 'es-DO', 'es-HN', 'es-PY', 'es-SV', 'es-NI', 'es-CR', 'es-PA', 'es-UY', 'es-PR'] },
  { value: 'fr', alternativeCodes: ['fr-FR', 'fr-CA', 'fr-BE', 'fr-CH', 'fr-LU', 'fr-MC'] },
  { value: 'it', alternativeCodes: ['it-IT', 'it-CH', 'it-SM', 'it-VA'] },
  { value: 'nl', alternativeCodes: ['nl-NL', 'nl-BE'] },
  { value: 'ro', alternativeCodes: ['ro-RO', 'ro-MD'] },
  { value: 'sv', alternativeCodes: ['sv-SE', 'sv-FI'] },
  { value: 'ur', alternativeCodes: ['ur-PK', 'ur-IN'] },
  { value: 'fa', alternativeCodes: ['fa-IR', 'fa-AF'] },
];

/**
 * Gets all available language codes for identity generation.
 * @returns Array of ISO language codes (e.g. ["da", "de", "en", ...]).
 */
export function getAvailableLanguages(): string[] {
  return LANGUAGE_DEFS.map(lang => lang.value);
}

/**
 * Maps a UI language code to an identity generator language code.
 * If no explicit match is found, returns null to indicate no preference.
 *
 * @param uiLanguageCode - The UI language code (e.g., "en", "en-US", "nl-NL", "de-DE", "fr")
 * @returns The matching identity generator language code or null if no match
 *
 * @example
 * mapUiLanguageToIdentityLanguage("en-US") // returns "en"
 * mapUiLanguageToIdentityLanguage("nl") // returns "nl"
 * mapUiLanguageToIdentityLanguage("de-CH") // returns "de"
 * mapUiLanguageToIdentityLanguage("ja") // returns null (no Japanese identity generator)
 */
export function mapUiLanguageToIdentityLanguage(uiLanguageCode: string | null | undefined): string | null {
  if (!uiLanguageCode) {
    return null;
  }

  const normalizedCode = uiLanguageCode.toLowerCase();

  // First, try exact match with the primary value
  const exactMatch = LANGUAGE_DEFS.find(lang => lang.value.toLowerCase() === normalizedCode);
  if (exactMatch) {
    return exactMatch.value;
  }

  // Then, try matching with alternative codes
  const alternativeMatch = LANGUAGE_DEFS.find(lang =>
    lang.alternativeCodes?.some(code => code.toLowerCase() === normalizedCode)
  );
  if (alternativeMatch) {
    return alternativeMatch.value;
  }

  // Finally, try matching the base language code (e.g., "en" from "en-US")
  const baseCode = normalizedCode.split('-')[0];
  const baseMatch = LANGUAGE_DEFS.find(lang => lang.value.toLowerCase() === baseCode);
  if (baseMatch) {
    return baseMatch.value;
  }

  // No match found
  return null;
}
