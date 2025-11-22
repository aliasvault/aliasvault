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
}

/**
 * Gets all available languages for identity generation.
 * Display labels are in the native language, with optional flag emoji that clients can choose to display.
 * @returns Array of language options
 */
export function getAvailableLanguages(): ILanguageOption[] {
  return [
    { value: 'en', label: 'English', flag: '🇬🇧' },
    { value: 'nl', label: 'Nederlands', flag: '🇳🇱' },
    { value: 'de', label: 'Deutsch', flag: '🇩🇪' }
  ];
}
