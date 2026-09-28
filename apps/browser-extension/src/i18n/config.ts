/**
 * The UI languages of the browser extension. The translations live in core/i18n (@aliasvault/i18n).
 */

import { DEFAULT_LANGUAGE as CORE_DEFAULT_LANGUAGE, LANGUAGE_CODES as CORE_LANGUAGE_CODES, UI_LANGUAGES } from '@aliasvault/i18n/languages';

import type { TranslationTree } from '@aliasvault/i18n';

export interface ILanguageConfig {
    code: string;
    nativeName: string;
    flag?: string;
  }

/**
 * List of all available UI languages with their code, native name and flag.
 */
export const AVAILABLE_LANGUAGES: ILanguageConfig[] = UI_LANGUAGES.map(({ code, label, flag }) => ({ code, nativeName: label, flag }));

/**
 * Default language that is used when no language is set in the browser or when a localized string is not found for the current language.
 */
export const DEFAULT_LANGUAGE = CORE_DEFAULT_LANGUAGE;

export const LANGUAGE_CODES: string[] = [...CORE_LANGUAGE_CODES];

/**
 * Type for content translations
 */
export type ContentTranslations = TranslationTree;

/*
 * The background and content scripts cannot load code on demand and are injected into every page, so they bundle
 * the translations for the top-level namespaces they translate, for every language.
 */
const STANDALONE_NAMESPACES = {
  common: import.meta.glob<TranslationTree>('../../../../core/i18n/locales/*.json', { eager: true, import: 'common' }),
  content: import.meta.glob<TranslationTree>('../../../../core/i18n/locales/*.json', { eager: true, import: 'content' }),
  items: import.meta.glob<TranslationTree>('../../../../core/i18n/locales/*.json', { eager: true, import: 'items' }),
  apiErrors: import.meta.glob<TranslationTree>('../../../../core/i18n/locales/*.json', { eager: true, import: 'apiErrors' }),
};

/**
 * Cache for loaded translations to avoid rebuilding them
 */
const translationCache = new Map<string, ContentTranslations>();

/**
 * Load the translations the background and content scripts use for a specific language
 */
export async function loadTranslations(language: string): Promise<ContentTranslations> {
  const code = LANGUAGE_CODES.includes(language) ? language : DEFAULT_LANGUAGE;
  const cached = translationCache.get(code);
  if (cached) {
    return cached;
  }

  const translations: ContentTranslations = {};
  for (const [namespace, modules] of Object.entries(STANDALONE_NAMESPACES)) {
    const entry = Object.entries(modules).find(([file]) => file.endsWith(`/${code}.json`));
    if (entry) {
      translations[namespace] = entry[1];
    }
  }
  translationCache.set(code, translations);
  return translations;
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
