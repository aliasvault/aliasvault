/**
 * Shared translations of the AliasVault apps. The files in ../locales are the single source of truth:
 * en.json is edited by hand, the other languages are written by Crowdin.
 */

import en from '../locales/en.json';

import { isLanguageCode } from './languages';

export * from './languages';

/**
 * A (nested) translation tree as loaded from a locale file.
 */
export type TranslationTree = { [key: string]: string | TranslationTree };

/**
 * The English translations, bundled so there always is a fallback.
 */
export const englishTranslations: TranslationTree = en;

/*
 * One loader per language, so bundlers that support code splitting only load the language in use.
 */
const LOADERS: Record<string, () => Promise<{ default: TranslationTree }>> = {
  en: async () => ({ default: en }),
  da: () => import('../locales/da.json'),
  de: () => import('../locales/de.json'),
  es: () => import('../locales/es.json'),
  fi: () => import('../locales/fi.json'),
  fr: () => import('../locales/fr.json'),
  ga: () => import('../locales/ga.json'),
  he: () => import('../locales/he.json'),
  hu: () => import('../locales/hu.json'),
  id: () => import('../locales/id.json'),
  it: () => import('../locales/it.json'),
  nl: () => import('../locales/nl.json'),
  pl: () => import('../locales/pl.json'),
  pt: () => import('../locales/pt.json'),
  ro: () => import('../locales/ro.json'),
  ru: () => import('../locales/ru.json'),
  sv: () => import('../locales/sv.json'),
  uk: () => import('../locales/uk.json'),
  zh: () => import('../locales/zh.json'),
};

/**
 * Load the translations of one language, English for an unknown code.
 * @param code - the language code
 */
export async function loadTranslations(code: string): Promise<TranslationTree> {
  const loader = isLanguageCode(code) ? LOADERS[code] : undefined;
  return loader ? (await loader()).default : en;
}

/**
 * Read a value from a translation tree by its dotted key, e.g. 'common.errors.unknownError'.
 * @param tree - the translation tree
 * @param key - the dotted key
 */
export function getTranslation(tree: TranslationTree, key: string): string | undefined {
  const value = key.split('.').reduce<string | TranslationTree | undefined>((node, segment) => (node && typeof node === 'object' ? node[segment] : undefined), tree);
  return typeof value === 'string' ? value : undefined;
}
