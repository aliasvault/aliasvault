/**
 * Central configuration for i18n languages.
 */

import { getLanguageInfo } from '@aliasvault/models/defaults';

import enTranslations from './locales/en.json';

/**
 * Create a map of all available languages and their resources for i18n.
 * When adding a new language, add the translation JSON file to the locales folder and add the language to the map here.
 * TODO: add all languages here once the Crowdin integration is (re)enabled for this new web app and replacing the existing Blazor WASM web client translations.
 */
export const LANGUAGE_RESOURCES = {
  en: {
    translation: enTranslations
  },
};

/**
 * A UI language.
 */
export interface ILanguageConfig {
  code: string;
  nativeName: string;
  flag?: string;
}

/**
 * List of all available UI languages with their code, native name and flag.
 */
export const AVAILABLE_LANGUAGES: ILanguageConfig[] =
  (Object.keys(LANGUAGE_RESOURCES) as Array<keyof typeof LANGUAGE_RESOURCES>).map((code) => {
    const info = getLanguageInfo(code);
    return { code, nativeName: info.label, flag: info.flag };
  });

/**
 * Default language that is used when no language is set in the browser or when a localized string is not found for the current language.
 */
export const DEFAULT_LANGUAGE = 'en';

export const LANGUAGE_CODES = AVAILABLE_LANGUAGES.map(lang => lang.code);

/**
 * Get language config by code.
 * @param code - the language code
 */
export function getLanguageConfig(code: string): ILanguageConfig | undefined {
  return AVAILABLE_LANGUAGES.find(lang => lang.code === code);
}
