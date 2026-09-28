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

/**
 * Import the locale file of a language. One static import per language, so bundlers that support code splitting only
 * load the language in use.
 * @param code - the language code
 */
async function importLocale(code: string): Promise<{ default: TranslationTree }> {
  switch (code) {
    case 'da': return import('../locales/da.json');
    case 'de': return import('../locales/de.json');
    case 'es': return import('../locales/es.json');
    case 'fi': return import('../locales/fi.json');
    case 'fr': return import('../locales/fr.json');
    case 'ga': return import('../locales/ga.json');
    case 'he': return import('../locales/he.json');
    case 'hu': return import('../locales/hu.json');
    case 'id': return import('../locales/id.json');
    case 'it': return import('../locales/it.json');
    case 'nl': return import('../locales/nl.json');
    case 'pl': return import('../locales/pl.json');
    case 'pt': return import('../locales/pt.json');
    case 'ro': return import('../locales/ro.json');
    case 'ru': return import('../locales/ru.json');
    case 'sv': return import('../locales/sv.json');
    case 'uk': return import('../locales/uk.json');
    case 'zh': return import('../locales/zh.json');
    default: return { default: en };
  }
}

/**
 * Load the translations of one language, English for an unknown code.
 * @param code - the language code
 */
export async function loadTranslations(code: string): Promise<TranslationTree> {
  return isLanguageCode(code) ? (await importLocale(code)).default : en;
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
