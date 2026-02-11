/**
 * Represents a language option for identity generation.
 */
export interface ILanguageOption {
  /**
   * The language code (e.g., "en", "nl", "de")
   */
  value: string;

  /**
   * The display label in the native language (e.g., "English", "Nederlands", "Deutsch")
   */
  label: string;

  /**
   * The flag emoji for the language (e.g., "🇬🇧", "🇳🇱", "🇩🇪")
   */
  flag: string;

  /**
   * Alternative language codes that map to this identity generator language.
   * Used for matching UI locale codes to identity generator languages.
   * For example, "en-US", "en-GB", "en-CA" all map to "en"
   */
  alternativeCodes?: string[];
}

/**
 * Gets all available languages for identity generation.
 * Display labels are in the native language, with optional flag emoji that clients can choose to display.
 * Languages are sorted alphabetically by label for consistent display across all platforms.
 * @returns Array of language options sorted alphabetically by label
 */
export function getAvailableLanguages(): ILanguageOption[] {
  const languages: ILanguageOption[] = [
    {
      value: 'da',
      label: 'Dansk',
      flag: '🇩🇰',
      alternativeCodes: ['da-DK']
    },
    {
      value: 'de',
      label: 'Deutsch',
      flag: '🇩🇪',
      alternativeCodes: ['de-DE', 'de-AT', 'de-CH', 'de-LU', 'de-LI']
    },
    {
      value: 'en',
      label: 'English',
      flag: '🇬🇧',
      alternativeCodes: ['en-US', 'en-GB', 'en-CA', 'en-AU', 'en-NZ', 'en-IE', 'en-ZA', 'en-SG', 'en-IN']
    },
    {
      value: 'es',
      label: 'Español',
      flag: '🇪🇸',
      alternativeCodes: ['es-ES', 'es-MX', 'es-AR', 'es-CO', 'es-CL', 'es-PE', 'es-VE', 'es-EC', 'es-GT', 'es-CU', 'es-BO', 'es-DO', 'es-HN', 'es-PY', 'es-SV', 'es-NI', 'es-CR', 'es-PA', 'es-UY', 'es-PR']
    },
    {
      value: 'fr',
      label: 'Français',
      flag: '🇫🇷',
      alternativeCodes: ['fr-FR', 'fr-CA', 'fr-BE', 'fr-CH', 'fr-LU', 'fr-MC']
    },
    {
      value: 'it',
      label: 'Italiano',
      flag: '🇮🇹',
      alternativeCodes: ['it-IT', 'it-CH', 'it-SM', 'it-VA']
    },
    {
      value: 'nl',
      label: 'Nederlands',
      flag: '🇳🇱',
      alternativeCodes: ['nl-NL', 'nl-BE']
    },
    {
      value: 'ro',
      label: 'Română',
      flag: '🇷🇴',
      alternativeCodes: ['ro-RO', 'ro-MD']
    },
    {
      value: 'sv',
      label: 'Svenska',
      flag: '🇸🇪',
      alternativeCodes: ['sv-SE', 'sv-FI']
    },
    {
      value: 'ur',
      label: 'اردو',
      flag: '🇵🇰',
      alternativeCodes: ['ur-PK', 'ur-IN']
    },
    {
      value: 'fa',
      label: 'فارسی',
      flag: '🇮🇷',
      alternativeCodes: ['fa-IR', 'fa-AF']
    }
  ];

  // Sort alphabetically by label using locale-aware comparison
  return languages.sort((a, b) => a.label.localeCompare(b.label));
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
 * mapUiLanguageToIdentityLanguage("fr") // returns null (no French identity generator)
 */
export function mapUiLanguageToIdentityLanguage(uiLanguageCode: string | null | undefined): string | null {
  if (!uiLanguageCode) {
    return null;
  }

  const normalizedCode = uiLanguageCode.toLowerCase();
  const availableLanguages = getAvailableLanguages();

  // First, try exact match with the primary value
  const exactMatch = availableLanguages.find(lang => lang.value.toLowerCase() === normalizedCode);
  if (exactMatch) {
    return exactMatch.value;
  }

  // Then, try matching with alternative codes
  const alternativeMatch = availableLanguages.find(lang =>
    lang.alternativeCodes?.some(code => code.toLowerCase() === normalizedCode)
  );
  if (alternativeMatch) {
    return alternativeMatch.value;
  }

  // Finally, try matching the base language code (e.g., "en" from "en-US")
  const baseCode = normalizedCode.split('-')[0];
  const baseMatch = availableLanguages.find(lang => lang.value.toLowerCase() === baseCode);
  if (baseMatch) {
    return baseMatch.value;
  }

  // No match found
  return null;
}
