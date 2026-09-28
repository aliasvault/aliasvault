/**
 * The UI languages of the web app. The translations live in core/i18n (@aliasvault/i18n).
 */

import { DEFAULT_LANGUAGE as CORE_DEFAULT_LANGUAGE, LANGUAGE_CODES as CORE_LANGUAGE_CODES } from '@aliasvault/i18n';
import { getLanguageInfo } from '@aliasvault/models/defaults';

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
export const AVAILABLE_LANGUAGES: ILanguageConfig[] = CORE_LANGUAGE_CODES.map((code) => {
  const info = getLanguageInfo(code);
  return { code, nativeName: info.label, flag: info.flag };
});

/**
 * Default language that is used when no language is set in the browser or when a localized string is not found for the current language.
 */
export const DEFAULT_LANGUAGE = CORE_DEFAULT_LANGUAGE;

export const LANGUAGE_CODES: string[] = [...CORE_LANGUAGE_CODES];

/**
 * Get language config by code.
 * @param code - the language code
 */
export function getLanguageConfig(code: string): ILanguageConfig | undefined {
  return AVAILABLE_LANGUAGES.find(lang => lang.code === code);
}
