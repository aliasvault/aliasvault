/**
 * Central configuration for i18n languages
 * Add new languages here to make them available throughout the application
 */

import enTranslations from './locales/en.json';
import nlTranslations from './locales/nl.json';

/**
 * Create a map of all available languages and their resources for i18n.
 * When adding a new language, add the translation JSON file to the locales folder and add the language to the map here.
 */
export const LANGUAGE_RESOURCES = {
  en: {
    translation: enTranslations
  },
  nl: {
    translation: nlTranslations
  }
};

/**
 * List of all available languages with their code, name, native name and flag.
 * When adding a new language, add the language to the map here.
 */
export const AVAILABLE_LANGUAGES: ILanguageConfig[] = [
  {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    flag: '🇺🇸'
  },
  {
    code: 'nl',
    name: 'Dutch',
    nativeName: 'Nederlands',
    flag: '🇳🇱'
  },
  /*
   * {
   * code: 'de',
   * name: 'German',
   * nativeName: 'Deutsch',
   * flag: '🇩🇪'
   * },
   * {
   *   code: 'es',
   *   name: 'Spanish',
   *   nativeName: 'Español',
   *   flag: '🇪🇸'
   * },
   * {
   *   code: 'fr',
   *   name: 'French',
   *   nativeName: 'Français',
   *   flag: '🇫🇷'
   * },
   * {
   *   code: 'uk',
   *   name: 'Ukrainian',
   *   nativeName: 'Українська',
   *   flag: '🇺🇦'
   * }
   */
];

/**
 * Default language that is used when no language is set in the browser or when a localized string is not found for the current language.
 */
export const DEFAULT_LANGUAGE = 'en';

export const LANGUAGE_CODES = AVAILABLE_LANGUAGES.map(lang => lang.code);

export interface ILanguageConfig {
    code: string;
    name: string;
    nativeName: string;
    flag?: string;
  }

/**
 * Type for content translations
 */
export type ContentTranslations = {
  [key: string]: string | ContentTranslations;
};

/**
 * Cache for loaded translations to avoid repeated file reads
 */
const translationCache = new Map<string, ContentTranslations>();

/**
 * Load translations for a specific language
 */
export async function loadTranslations(language: string): Promise<ContentTranslations> {
  const cacheKey = `all:${language}`;

  // Check cache first
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey)!;
  }

  // Get translations from pre-loaded resources
  if (LANGUAGE_RESOURCES[language as keyof typeof LANGUAGE_RESOURCES]) {
    const translationData = LANGUAGE_RESOURCES[language as keyof typeof LANGUAGE_RESOURCES].translation;
    translationCache.set(cacheKey, translationData);
    return translationData;
  }

  // Fallback to English if available
  if (language !== DEFAULT_LANGUAGE && LANGUAGE_RESOURCES[DEFAULT_LANGUAGE]) {
    console.warn(`Translations not found for ${language}, falling back to ${DEFAULT_LANGUAGE}`);
    const fallbackData = LANGUAGE_RESOURCES[DEFAULT_LANGUAGE].translation;
    translationCache.set(cacheKey, fallbackData);
    return fallbackData;
  }

  // Return empty object as last resort
  console.warn(`No translations found for ${language} and no fallback available`);
  return {};
}

/**
 * Load all available translations for i18next
 */
export async function loadAllTranslations(): Promise<Record<string, { translation: ContentTranslations }>> {
  const resources: Record<string, { translation: ContentTranslations }> = {};

  for (const language of AVAILABLE_LANGUAGES) {
    try {
      const translations = await loadTranslations(language.code);
      resources[language.code] = { translation: translations };
    } catch (error) {
      console.warn(`Failed to load translations for ${language.code}:`, error);
    }
  }

  return resources;
}

/**
 * Get language config by code
 */
export function getLanguageConfig(code: string): ILanguageConfig | undefined {
  return AVAILABLE_LANGUAGES.find(lang => lang.code === code);
}

/**
 * Get nested value from object using dot notation
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((current: unknown, key: string) => {
    return current && typeof current === 'object' && current !== null && key in current
      ? (current as Record<string, unknown>)[key]
      : undefined;
  }, obj);
}